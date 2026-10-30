#!/usr/bin/env python3
#=============================================================
#  luau_api_server.py - Luau 字节码反编译 HTTP API
#
#  跑在 LunaUX 离线引擎的 Python 里 (通过 ../luna 启动器),
#  所以不需要联网、不依赖任何第三方 API。
#
#  接口:
#    GET  /                  测试页 (网页版, 可拖文件)
#    GET  /health            {"ok":true,"engine":"lunaux"}
#    POST /decompile         JSON   {"bytecode":"<base64>"}  → 源码(纯文本)
#    POST /decompile/raw     body 直接是字节码原始二进制     → 源码(纯文本)
#    GET  /decompile?b64=..  同上, 但走 URL 参数
#    GET  /disasm?b64=..     反汇编 (不是源码)
#    POST /decompile/zip     body 直接是 zip 二进制
#                             → 返回 zip: 每个字节码文件对应一个 .luau, 目录结构保留
#                             (这就是官网那种"浏览器只传文件, 服务器算"的批量版)
#
#  启动:  ./luau-api.sh [--host 0.0.0.0] [--port 8787]
#=============================================================

import argparse
import base64
import binascii
import importlib.util
import json
import os
import socketserver
import sys
import threading
import traceback
import zipfile
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

HERE = os.path.dirname(os.path.abspath(__file__))


def _find_engine():
    """在几个常见位置找 luna.so"""
    cands = [
        os.environ.get("LUA_SO") or "",
        os.path.join(HERE, "luna.so"),
        os.path.join(HERE, "lunaux-offline", "luna.so"),
        os.path.join(HERE, "..", "luna.so"),
        os.path.join(HERE, "..", "lunaux-offline", "luna.so"),
    ]
    for c in cands:
        if c and os.path.isfile(c):
            return os.path.abspath(c)
    return os.path.join(HERE, "luna.so")


ENGINE_PATH = _find_engine()

_engine = None
_engine_lock = threading.Lock()


def load_engine():
    """加载 luna.so (只加载一次)"""
    global _engine
    if _engine is not None:
        return _engine
    with _engine_lock:
        if _engine is not None:
            return _engine
        if not os.path.isfile(ENGINE_PATH):
            raise RuntimeError("engine not found: %s" % ENGINE_PATH)
        spec = importlib.util.spec_from_file_location("luna", ENGINE_PATH)
        if spec is None or spec.loader is None:
            raise RuntimeError("cannot load engine: %s" % ENGINE_PATH)
        mod = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(mod)
        _engine = mod
        return _engine


def do_decompile(data, options=None):
    eng = load_engine()
    out = eng.decompile_bytecode(bytes(data), options or {})
    if isinstance(out, (bytes, bytearray)):
        out = out.decode("utf-8", "replace")
    return out


def do_disasm(data):
    eng = load_engine()
    out = eng.disassemble_bytecode(bytes(data))
    if isinstance(out, (bytes, bytearray)):
        out = out.decode("utf-8", "replace")
    return out


# ---------- zip 批量 ----------
#  浏览器把整个 zip 丢过来, 服务端解开、挨个反编译、再打包回去。
#  这样浏览器完全不用下引擎, 也不用一个文件一个文件传 —— 和官网一个思路。
def _write(zout, name, text):
    """往 zip 里写一个文件, 文件名带 UTF-8 标志 (bit 11)。

    Python 的 zipfile 默认不设这个标志, 中文名在 Windows / 部分安卓
    解压出来会乱码, 所以手工建 ZipInfo 并置 flag_bits。
    """
    if isinstance(text, str):
        text = text.encode("utf-8")
    zi = zipfile.ZipInfo(name, date_time=(2026, 1, 1, 0, 0, 0))
    zi.compress_type = zipfile.ZIP_DEFLATED
    zi.flag_bits |= 0x800
    zi.external_attr = 0o644 << 16
    zout.writestr(zi, text)


def decompile_zip(data):
    import io

    zin = zipfile.ZipFile(io.BytesIO(bytes(data)))
    outbuf = io.BytesIO()
    # ZIP 文件名里的中文必须靠 UTF-8 标志位(bit 11)才能被正确还原,
    # 不加的话 Windows / 部分安卓解压出来就是乱码。
    zout = zipfile.ZipFile(outbuf, "w", zipfile.ZIP_DEFLATED)
    report = []
    ok = skipped = failed = 0

    for info in zin.infolist():
        name = info.filename
        if name.endswith("/"):
            continue
        if "__MACOSX/" in name or os.path.basename(name).startswith("."):
            continue
        try:
            raw = zin.read(name)
        except Exception as e:
            failed += 1
            report.append("[失败] %s  读取出错: %s" % (name, e))
            continue

        # 文本文件跳过 (不是字节码)
        head = raw[:256]
        try:
            head.decode("utf-8")
            is_text = True
        except UnicodeDecodeError:
            is_text = False
        if is_text and not (1 <= head[0] <= 31 if head else False):
            skipped += 1
            report.append("[跳过] %s  文本文件, 不是字节码" % name)
            continue

        try:
            src = do_decompile(raw)
        except Exception as e:
            failed += 1
            report.append("[失败] %s  %s" % (name, e))
            continue

        ok += 1
        base = name.rsplit(".", 1)[0] if "." in name.rsplit("/", 1)[-1] else name
        _write(zout, base + ".luau", src)
        report.append("[成功] %s  -> %s.luau  (%d 字符)" % (name, base, len(src)))

    report.insert(0, "批量反编译报告\n=============\n成功 %d / 跳过 %d / 失败 %d\n" % (ok, skipped, failed))
    _write(zout, "_反编译报告.txt", "\n".join(report))
    zout.close()
    return outbuf.getvalue(), {"ok": ok, "skipped": skipped, "failed": failed, "total": ok + skipped + failed}


INDEX_HTML = """<!DOCTYPE html>
<html lang="zh-CN"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Luau 反编译 API</title>
<style>
 body{background:#0d1117;color:#e6edf3;font:15px/1.6 system-ui,sans-serif;margin:0;padding:24px 16px}
 .w{max-width:680px;margin:0 auto}
 h1{font-size:20px;margin:0 0 4px}
 .s{color:#8b949e;font-size:13px;margin:0 0 20px}
 .c{background:#161b22;border:1px solid #30363d;border-radius:12px;padding:16px;margin-bottom:14px}
 #d{border:2px dashed #30363d;border-radius:10px;padding:30px;text-align:center;cursor:pointer;background:#1c2129}
 #d.hot{border-color:#58a6ff;background:#1b2a3f}
 pre{background:#0a0e14;border:1px solid #30363d;border-radius:8px;padding:12px;overflow:auto;
     font:12.5px/1.55 ui-monospace,Menlo,Consolas,monospace;max-height:50vh;white-space:pre}
 code{background:#1c2129;padding:1px 5px;border-radius:4px;font-size:12px}
 b{color:#58a6ff}
 .m{font:12px/1.9 ui-monospace,monospace;color:#8b949e}
 button{background:#1c2129;color:#e6edf3;border:1px solid #30363d;border-radius:8px;padding:8px 14px;cursor:pointer}
 button:hover{border-color:#58a6ff;color:#58a6ff}
</style></head><body><div class="w">
<h1>Luau 反编译 API</h1>
<p class="s">本地运行 · 字节码不出你的手机 · 支持 Luau v3~v14</p>

<div class="c">
  <div id="d"><b>拖进来</b> 或 <b>点击选择</b><br>
  <span class="m">.luau / .luac / .bin / .out</span></div>
  <input type="file" id="f" style="display:none">
  <div class="m" id="st" style="margin-top:10px"></div>
</div>

<div class="c">
  <div class="m" style="margin-bottom:8px">HTTP 接口:</div>
  <pre style="max-height:none">curl -sS -X POST http://127.0.0.1:8787/decompile \\
  -H 'Content-Type: application/json' \\
  -d '{"bytecode":"'$(base64 -w0 x.luau)'"}'</pre>
  <pre style="max-height:none">curl -sS -X POST --data-binary @x.luau \\
  http://127.0.0.1:8787/decompile/raw -o out.lua</pre>
</div>

<div class="c" id="oc" style="display:none">
  <div class="m" id="os" style="margin-bottom:8px"></div>
  <pre id="o"></pre>
  <button onclick="dl()">⬇ 下载源码</button>
</div>
</div>
<script>
let src='';
const $=i=>document.getElementById(i);
async function go(f){
  if(!f) return;
  $('st').textContent='读取 '+f.name+' ('+(f.size/1024).toFixed(1)+' KB) …';
  const b=new Uint8Array(await f.arrayBuffer());
  $('st').textContent='反编译中, 大文件可能要几十秒 …';
  const t0=Date.now();
  try{
    const r=await fetch('/decompile/raw',{method:'POST',body:b});
    const t=await r.text();
    if(!r.ok) throw new Error(t);
    src=t;
    $('o').textContent=t;
    $('oc').style.display='block';
    $('os').textContent=(f.size/1024).toFixed(1)+' KB → '+t.length.toLocaleString()+' 字符 / '+t.split('\\n').length+' 行 · '+((Date.now()-t0)/1000).toFixed(1)+'s';
    $('st').textContent='✅ 完成';
  }catch(e){ $('st').textContent='❌ '+e.message; }
}
$('d').onclick=()=>$('f').click();
$('f').onchange=e=>go(e.target.files[0]);
['dragenter','dragover'].forEach(ev=>$('d').addEventListener(ev,e=>{e.preventDefault();$('d').classList.add('hot')}));
['dragleave','drop'].forEach(ev=>$('d').addEventListener(ev,e=>{e.preventDefault();$('d').classList.remove('hot')}));
$('d').addEventListener('drop',e=>go(e.dataTransfer.files[0]));
function dl(){const b=new Blob([src],{type:'text/plain'});const a=document.createElement('a');
 a.href=URL.createObjectURL(b);a.download='output.lua';a.click();}
</script></body></html>"""


class Handler(BaseHTTPRequestHandler):
    server_version = "LuauAPI/1.0"
    protocol_version = "HTTP/1.1"

    # ---------- 工具 ----------
    def _cors(self):
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        # 自定义响应头默认浏览器 JS 读不到, 必须显式 expose
        self.send_header("Access-Control-Expose-Headers", "X-Batch-Stats")

    def _send(self, code, body, ctype="text/plain; charset=utf-8"):
        if isinstance(body, str):
            body = body.encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        self._cors()
        self.end_headers()
        try:
            self.wfile.write(body)
        except (BrokenPipeError, ConnectionResetError):
            pass

    def _json(self, code, obj):
        self._send(code, json.dumps(obj, ensure_ascii=False), "application/json; charset=utf-8")

    def _err(self, code, msg):
        self._json(code, {"ok": False, "error": str(msg)})

    def log_message(self, fmt, *a):
        sys.stderr.write("[%s] %s\n" % (self.log_date_time_string(), fmt % a))
        sys.stderr.flush()

    # ---------- 路由 ----------
    def do_OPTIONS(self):
        self.send_response(204)
        self._cors()
        self.send_header("Content-Length", "0")
        self.end_headers()

    def do_GET(self):
        path, _, query = self.path.partition("?")
        if path in ("/", "/index.html"):
            return self._send(200, INDEX_HTML, "text/html; charset=utf-8")
        if path == "/health":
            try:
                load_engine()
                return self._json(200, {"ok": True, "engine": "lunaux", "pid": os.getpid()})
            except Exception as e:
                return self._err(500, e)
        if path in ("/decompile", "/disasm"):
            params = {}
            for kv in query.split("&"):
                if not kv:
                    continue
                k, _, v = kv.partition("=")
                params[k] = v
            b64 = params.get("b64") or params.get("bytecode")
            if not b64:
                return self._err(400, "missing b64 param")
            try:
                data = base64.b64decode(b64 + "=" * (-len(b64) % 4))
            except (binascii.Error, ValueError) as e:
                return self._err(400, "bad base64: %s" % e)
            return self._run(path, data)
        return self._err(404, "not found: %s" % path)

    def do_POST(self):
        path, _, _q = self.path.partition("?")
        try:
            n = int(self.headers.get("Content-Length") or 0)
        except ValueError:
            n = 0
        body = self.rfile.read(n) if n else b""

        if path == "/decompile/raw":
            return self._run("/decompile", body)

        if path == "/decompile":
            try:
                obj = json.loads(body.decode("utf-8"))
            except (ValueError, UnicodeDecodeError) as e:
                return self._err(400, "bad json: %s" % e)
            b64 = obj.get("bytecode") or obj.get("data")
            if not b64:
                return self._err(400, "missing 'bytecode' field")
            try:
                data = base64.b64decode(b64 + "=" * (-len(b64) % 4))
            except (binascii.Error, ValueError) as e:
                return self._err(400, "bad base64: %s" % e)
            return self._run("/decompile", data)

        if path == "/disasm/raw":
            return self._run("/disasm", body)

        if path == "/decompile/zip":
            return self._run("/decompile/zip", body)

        return self._err(404, "not found: %s" % path)

    def _run(self, kind, data):
        if not data:
            return self._err(400, "empty body")
        try:
            if kind == "/disasm":
                out = do_disasm(data)
            elif kind == "/decompile/zip":
                out, stat = decompile_zip(data)
                self.send_response(200)
                self.send_header("Content-Type", "application/zip")
                self.send_header("Content-Length", str(len(out)))
                self.send_header("X-Batch-Stats", json.dumps(stat))
                self._cors()
                self.end_headers()
                try:
                    self.wfile.write(out)
                except (BrokenPipeError, ConnectionResetError):
                    pass
                return
            else:
                out = do_decompile(data)
        except Exception as e:
            sys.stderr.write(traceback.format_exc())
            return self._err(500, e)
        return self._send(200, out)


class Server(ThreadingHTTPServer):
    daemon_threads = True
    allow_reuse_address = True


def main():
    ap = argparse.ArgumentParser(description="Luau 反编译 HTTP API")
    ap.add_argument("--host", default="127.0.0.1", help="监听地址 (默认只听本机; 局域网用 0.0.0.0)")
    ap.add_argument("--port", type=int, default=8787)
    args = ap.parse_args()

    try:
        load_engine()
        print("engine: OK", file=sys.stderr)
    except Exception as e:
        print("engine load failed: %s" % e, file=sys.stderr)
        sys.exit(1)

    srv = Server((args.host, args.port), Handler)
    shown = "127.0.0.1" if args.host in ("0.0.0.0", "") else args.host
    print("=" * 52, file=sys.stderr)
    print("  Luau 反编译 API 已启动", file=sys.stderr)
    print("  本机:      http://%s:%d/" % (shown, args.port), file=sys.stderr)
    if args.host == "0.0.0.0":
        print("  局域网:    http://<你的手机IP>:%d/  (手机自己访问用 127.0.0.1)" % args.port, file=sys.stderr)
    print("  Ctrl+C 停止", file=sys.stderr)
    print("=" * 52, file=sys.stderr)
    sys.stderr.flush()
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        print("\nbye", file=sys.stderr)
        srv.shutdown()


if __name__ == "__main__":
    main()
