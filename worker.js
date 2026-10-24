// 反编译 worker —— 放后台线程跑, 大文件不卡界面
import init, { decompile, detectDialect } from "./unluac_wasm.js";

let ready = false;
let bootError = null;

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
  naming: { mode: "heuristic" },
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

async function ensure() {
  if (!ready) {
    await init({ module_or_path: new URL("./unluac_wasm_bg.wasm", import.meta.url) });
    ready = true;
  }
}

// ★ 页面一打开就开始下载 + JIT 预热 wasm, 不等用户拖文件
//   15MB 的 wasm 光下载+JIT 就要 ~35 秒, 提前跑掉能省一半等待
ensure()
  .then(() => self.postMessage({ ok: true, warm: true }))
  .catch((e) => { bootError = String((e && e.message) || e); self.postMessage({ ok: false, warm: true, error: bootError }); });

self.onmessage = async (e) => {
  const { bytes, opts, id } = e.data;
  try {
    try { await ensure(); }
    catch (e) { throw new Error(bootError || String(e)); }
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
