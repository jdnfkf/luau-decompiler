// zip.js —— 零依赖 ZIP 读 / 写
// 读: 只用浏览器原生 DecompressionStream("deflate-raw"), 不引任何 CDN
// 写: 只用 store(不压缩) 模式, 体积大一点但零依赖, 浏览器随便能解开
//
// 用法:
//   const files = await readZip(arrayBuffer);  // -> [{path, bytes}]
//   const blob  = makeZip([{path:"a/b.lua", data:"文本"}]);

const TE = new TextEncoder();
const TD = new TextDecoder();

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

export function crc32(buf) {
  let c = 0xFFFFFFFF;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xFF] ^ (c >>> 8);
  return (c ^ 0xFFFFFFFF) >>> 0;
}

async function inflateRaw(bytes) {
  if (typeof DecompressionStream === "undefined") {
    throw new Error("这个浏览器不支持 DecompressionStream, 压缩包解不开");
  }
  const ds = new DecompressionStream("deflate-raw");
  const stream = new Blob([bytes]).stream().pipeThrough(ds);
  const out = new Uint8Array(await new Response(stream).arrayBuffer());
  return out;
}

// ---------- 读 ----------
export async function readZip(arrayBuffer) {
  const dv = new DataView(arrayBuffer);
  const len = dv.byteLength;

  // 找 EOCD (0x06054b50), 从尾部往前扫
  let eocd = -1;
  const maxBack = Math.min(len, 65557);
  for (let i = len - 22; i >= len - maxBack && i >= 0; i--) {
    if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error("这不是有效的 ZIP 文件 (找不到中央目录)");

  const count = dv.getUint16(eocd + 10, true);
  let off = dv.getUint32(eocd + 16, true);
  const files = [];

  for (let n = 0; n < count; n++) {
    if (off + 46 > len) break;
    if (dv.getUint32(off, true) !== 0x02014b50) break;   // 中央目录项签名不对, 停
    const method = dv.getUint16(off + 10, true);
    const csize = dv.getUint32(off + 20, true);
    const usize = dv.getUint32(off + 24, true);
    const nameLen = dv.getUint16(off + 28, true);
    const extraLen = dv.getUint16(off + 30, true);
    const cmtLen = dv.getUint16(off + 32, true);
    const lho = dv.getUint32(off + 42, true);
    const nameBytes = new Uint8Array(arrayBuffer, off + 46, nameLen);
    const path = TD.decode(nameBytes);

    // 本地文件头: 数据起点 = 30 + 文件名长度 + 扩展字段长度
    let dataStart = -1;
    if (lho + 30 <= len && dv.getUint32(lho, true) === 0x04034b50) {
      const lNameLen = dv.getUint16(lho + 26, true);
      const lExtraLen = dv.getUint16(lho + 28, true);
      dataStart = lho + 30 + lNameLen + lExtraLen;
    }

    let bytes = null;
    if (!path.endsWith("/") && dataStart >= 0 && dataStart + csize <= len) {
      const raw = new Uint8Array(arrayBuffer, dataStart, csize);
      if (method === 0) bytes = raw;
      else if (method === 8) bytes = await inflateRaw(raw);
      // 其它压缩算法(rare) 不支持, 留 null
    }

    files.push({ path, bytes, method, usize, csize });
    off += 46 + nameLen + extraLen + cmtLen;
  }
  return files;
}

// ---------- 写 (store 模式, 不压缩) ----------
export function makeZip(entries) {
  // entries: [{path, data: string|Uint8Array}]
  const parts = [];
  const central = [];
  let offset = 0;

  for (const e of entries) {
    const nameBytes = TE.encode(e.path);
    const data = typeof e.data === "string" ? TE.encode(e.data) : e.data;
    const crc = crc32(data);

    const lh = new Uint8Array(30 + nameBytes.length);
    const lv = new DataView(lh.buffer);
    lv.setUint32(0, 0x04034b50, true);
    lv.setUint16(4, 20, true);              // version needed
    lv.setUint16(6, 0, true);               // flags
    lv.setUint16(8, 0, true);               // method = store
    lv.setUint16(10, 0, true);              // time
    lv.setUint16(12, 0x21, true);           // date (1996-01-01, 随便填个合法值)
    lv.setUint32(14, crc, true);
    lv.setUint32(18, data.length, true);
    lv.setUint32(22, data.length, true);
    lv.setUint16(26, nameBytes.length, true);
    lv.setUint16(28, 0, true);
    lh.set(nameBytes, 30);

    parts.push(lh, data);

    const ch = new Uint8Array(46 + nameBytes.length);
    const cv = new DataView(ch.buffer);
    cv.setUint32(0, 0x02014b50, true);
    cv.setUint16(4, 20, true);
    cv.setUint16(6, 20, true);
    cv.setUint16(8, 0, true);
    cv.setUint16(10, 0, true);
    cv.setUint16(12, 0, true);
    cv.setUint16(14, 0x21, true);
    cv.setUint32(16, crc, true);
    cv.setUint32(20, data.length, true);
    cv.setUint32(24, data.length, true);
    cv.setUint16(28, nameBytes.length, true);
    cv.setUint32(42, offset, true);
    ch.set(nameBytes, 46);
    central.push(ch);

    offset += lh.length + data.length;
  }

  const cdSize = central.reduce((a, c) => a + c.length, 0);
  const eocd = new Uint8Array(22);
  const ev = new DataView(eocd.buffer);
  ev.setUint32(0, 0x06054b50, true);
  ev.setUint16(8, entries.length, true);
  ev.setUint16(10, entries.length, true);
  ev.setUint32(12, cdSize, true);
  ev.setUint32(16, offset, true);

  return new Blob([...parts, ...central, eocd], { type: "application/zip" });
}
