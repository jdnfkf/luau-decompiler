// 反编译 worker —— 放后台线程跑, 大文件不卡界面
import init, { decompile, detectDialect } from "./unluac_wasm.js";

let ready = false;
let bootError = null;

const WASM_URL = new URL("./unluac_wasm_bg.wasm", import.meta.url);
const CACHE_NAME = "luau-decompiler-wasm-v1";

const FAST_SKIP = [
  "table-constructors",
  "temp-inline",
  "repeat-root-lifetimes",
  "native-call-frames",
  "source-frame-materializations",
  "lower-fixed-table-batches"
];

const DEFAULT_OPTS = {
  dialect: "auto",
  naming: { mode: "simple" },
  readability: {
    returnInlineMaxComplexity: 2,
    indexInlineMaxComplexity: 2,
    argsInlineMaxComplexity: 2,
    accessBaseInlineMaxComplexity: 2,
    skipPasses: FAST_SKIP
  },
  generate: {
    mode: "permissive",
    comment: true,
    luauVectorConstructor: { constructor: "vector", size: 3 }
  }
};

// ============================================================
//  wasm 下载: 带进度 + 自动重试 + 缓存
//  为什么不用 instantiateStreaming?
//  它在响应体被中断时会直接抛 "Response body loading was aborted",
//  11MB 的文件在移动网络下断一次就全废, 而且没有任何重试机会。
//  自己 fetch + 读完再 instantiate, 断了能重试, 还能显示进度。
// ============================================================
async function fetchWasm(onProgress) {
  // 1) 先看浏览器缓存 (第二次打开就秒开)
  try {
    if (typeof caches !== "undefined") {
      const cache = await caches.open(CACHE_NAME);
      const hit = await cache.match(WASM_URL);
      if (hit) {
        onProgress({ phase: "cache", pct: 100 });
        return await hit.arrayBuffer();
      }
    }
  } catch (e) { /* 缓存不可用就算了 */ }

  // 2) 下载, 断了重试
  let lastErr = null;
  for (let attempt = 1; attempt <= 4; attempt++) {
    try {
      onProgress({ phase: "download", attempt, max: 4 });
      const res = await fetch(WASM_URL, { cache: "no-store" });
      if (!res.ok) throw new Error("HTTP " + res.status);

      const total = Number(res.headers.get("content-length")) || 0;
      const reader = res.body.getReader();
      const chunks = [];
      let received = 0;
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(value);
        received += value.length;
        onProgress({
          phase: "progress",
          received,
          total,
          pct: total ? Math.round((received * 100) / total) : 0
        });
      }
      const buf = new Uint8Array(received);
      let off = 0;
      for (const c of chunks) { buf.set(c, off); off += c.length; }

      // 存进缓存, 下次打开秒开
      try {
        if (typeof caches !== "undefined") {
          const cache = await caches.open(CACHE_NAME);
          await cache.put(WASM_URL, new Response(buf, {
            headers: { "Content-Type": "application/wasm" }
          }));
        }
      } catch (e) { /* 存不了就算了 */ }

      return buf.buffer;
    } catch (e) {
      lastErr = e;
      onProgress({ phase: "retry", attempt, max: 4, error: String((e && e.message) || e) });
      await new Promise((r) => setTimeout(r, 700 * attempt));
    }
  }
  throw new Error("引擎下载失败(已重试 4 次): " + String((lastErr && lastErr.message) || lastErr));
}

async function ensure() {
  if (ready) return;
  const bytes = await fetchWasm((p) => self.postMessage({ ok: true, progress: p }));
  // 传 ArrayBuffer 而不是 URL → 走 WebAssembly.instantiate(bytes), 不会被流中断坑
  await init({ module_or_path: bytes });
  ready = true;
}

// ★ 页面一打开就开始下载 + 预热, 不等用户拖文件
ensure()
  .then(() => self.postMessage({ ok: true, warm: true }))
  .catch((e) => {
    bootError = String((e && e.message) || e);
    self.postMessage({ ok: false, warm: true, error: bootError });
  });

self.onmessage = async (e) => {
  const { bytes, opts, id } = e.data;
  try {
    try { await ensure(); }
    catch (err) { throw new Error(bootError || String(err)); }
    const t0 = performance.now();
    const dia = detectDialect(bytes);
    const src = decompile(bytes, opts || DEFAULT_OPTS);
    const ms = performance.now() - t0;
    self.postMessage({ ok: true, id, dialect: dia, source: src, ms });
  } catch (err) {
    let msg;
    try {
      msg = (err && err.message) ? String(err.message)
           : (typeof err === "string" ? err : JSON.stringify(err));
    } catch (_) { msg = String(err); }
    self.postMessage({ ok: false, id, error: msg });
  }
};
