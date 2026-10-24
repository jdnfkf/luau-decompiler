// 反编译 worker —— 放后台线程跑, 大文件不卡界面
import init, { decompile, detectDialect } from "./unluac_wasm.js";

let ready = false;

const DEFAULT_OPTS = {
  dialect: "auto",
  naming: { mode: "heuristic" },
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

self.onmessage = async (e) => {
  const { bytes, opts, id } = e.data;
  try {
    await ensure();
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
