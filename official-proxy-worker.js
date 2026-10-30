//=============================================================
//  LunaUX 官方 API 中转 (Cloudflare Worker)
//  作用: 官方 API 不带 CORS 头, 浏览器直连会被拦。
//        这个 Worker 加一层 CORS, 网页就能直接调官方引擎。
//  特点: 免费、全球加速、永久（绑自己的域名就不用记 Worker 地址）
//
//  部署 (3 分钟):
//    1. 打开 https://dash.cloudflare.com → Workers & Pages → Create
//    2. 粘贴本文件全部内容 → Deploy
//    3. 把生成的 https://xxx.workers.dev 地址填到网站「☁️ 官方 API」那一栏
//
//  绑定自己的域名 (可选, 更永久):
//    Workers & Pages → 你的 Worker → Settings → Domains & Routes → Add
//    选个域名加个二级域名 (比如 api.你的域名.com) 就行
//=============================================================

const UPSTREAM = "https://lunaux-decompiler.dev";

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    // 预检: 直接回 CORS 头
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders() });
    }

    // 自己的健康检查
    if (url.pathname === "/health") {
      return json({ ok: true, upstream: UPSTREAM });
    }

    // 只转发官方那四个接口
    const allow = ["/api/decompile", "/api/disassemble", "/api/cfg", "/api/compile"];
    if (!allow.includes(url.pathname)) {
      return json({ detail: "not found" }, 404);
    }
    if (request.method !== "POST") {
      return json({ detail: "Method Not Allowed" }, 405);
    }

    const body = await request.text();
    let upstream;
    try {
      upstream = await fetch(UPSTREAM + url.pathname, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          // 官方接口如果以后要 key, 把 key 填在这里 (Workers → Settings → Variables)
          ...(env && env.LUNAUX_KEY ? { Authorization: "Bearer " + env.LUNAUX_KEY } : {})
        },
        body
      });
    } catch (e) {
      return json({ detail: "upstream unreachable: " + String(e) }, 502);
    }

    const text = await upstream.text();
    const h = corsHeaders();
    h["Content-Type"] = upstream.headers.get("content-type") || "text/plain; charset=utf-8";
    // 官方返回 500 时正文是 JSON 错误, 保留状态码让网页能提示
    return new Response(text, { status: upstream.status, headers: h });
  }
};

function corsHeaders() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Access-Control-Max-Age": "86400"
  };
}
function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "Content-Type": "application/json", ...corsHeaders() }
  });
}
