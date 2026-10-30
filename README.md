# Luau 反编译器 (Luau Decompiler)

浏览器里的 Roblox / Luau 字节码反编译器。**纯前端、零上传、零依赖第三方 API**。

拖一个 `.luau` 字节码文件进页面，几十秒后就能拿到可读的 Luau 源码。


---

# 网站怎么连服务器？—— 三选一，填对网址就行

网站（https://jdnfkf.github.io/luau-decompiler/）只是个空壳，**真正干活的是"服务器"**。
你只需要让它知道"服务器在哪"，填一个网址进输入框就行。

界面上一共两个框：

| 输入框 | 填什么 | 什么时候用 |
|---|---|---|
| **☁️ 官方 API** | `https://xxx.workers.dev` | 想要官方引擎输出（最准） |
| **🖥 反编译服务器** | `http://127.0.0.1:8787` | 手机上跑了 Termux 服务器 |

**优先级：官方 API > 本地服务器 > 浏览器内引擎（兜底，慢）**

---

## 方案 A —— 手机 Termux 起服务器（推荐，5 分钟，不用注册任何东西）

### 第 1 步：装离线引擎（只需一次）

```bash
pkg install -y qemu-user-x86-64
cd "/storage/emulated/0/1/LunaUX反编译工具"
rm -rf lunaux-offline
bash install-offline.sh "$PWD/lunaux-offline"
```

> ⚠️ `pkg install` 报 403 Forbidden 的话（Termux 镜像走 IPv6 被拒），加 `-o Acquire::ForceIPv4=true`：
> ```bash
> apt-get -o Acquire::ForceIPv4=true install -y qemu-user-x86-64
> ```

### 第 2 步：起服务器

```bash
cd "/storage/emulated/0/1/LunaUX反编译工具/lunaux-offline"
nohup ./luau-api.sh > /dev/null 2>&1 &
```

### 第 3 步：网站里填网址

**「🖥 反编译服务器」那栏填：**

```
http://127.0.0.1:8787
```

点 **「🔗 连接」** → 右上角徽章变成 **「服务器模式 🖥」** 就成了。

> 💡 为什么是 127.0.0.1：服务器就跑在你手机里，手机浏览器当然是用 127.0.0.1 指它。
> 网站是 https，但浏览器规定 `http://127.0.0.1` 算安全来源，所以**不会被"混合内容"拦掉**。

### 验证服务器活了没

在 Termux 里跑：

```bash
curl -s http://127.0.0.1:8787/health
```

看到 `{"ok": true, "engine": "lunaux", ...}` 就说明好了。
或者直接用手机浏览器打开 `http://127.0.0.1:8787/`，那里也有个能拖文件的网页版。

---

## 方案 B —— 官方 API（输出质量最高，但要注册 Cloudflare）

官方 API **不给 CORS 头**，浏览器会被同源策略拦住，所以要加一层中转。
用 Cloudflare Workers，免费、3 分钟、地址永久。

### 第 1 步：部署中转

1. 打开 <https://dash.cloudflare.com> → **Workers & Pages** → Create → Worker
2. 把同包的 `official-proxy-worker.js` **全文粘进去** → Deploy
3. 复制它给你的 `https://xxx.workers.dev` 地址

### 第 2 步：网站里填网址

**「☁️ 官方 API」那栏填：**

```
https://xxx.workers.dev
```

点 **「⚡ 直连官方」** → 徽章变成 **「☁️ 官方 API」**。

### 第 3 步（可选）：绑自己的域名，地址更好记

Workers → Settings → Domains & Routes → Add → 挂个二级域名，比如 `api.你的域名.com`。
以后填 `https://api.你的域名.com` 就行，Worker 地址变了也不用改。

> ❓ **官方会不会哪天没了？** 第三方服务没这个承诺。
> 但你放心：**方案 A 的引擎就是官方 v1.4.7 原版**（sha256 `def7b346ba8b...` 跟官方下载页一模一样），
> 官方真关停了，你手机上的服务器照样跑。**方案 A 才是真正的"永久"**，方案 B 只是图个方便。

---

## 方案 C —— 电脑上跑服务器，手机也能用

电脑上（Linux）：

```bash
python3 luau_api_server.py --host 0.0.0.0 --port 8787
```

然后查电脑的局域网 IP（`ip addr` 或 Windows `ipconfig`），
**「🖥 反编译服务器」填** `http://192.168.x.x:8787`（把 192.168.x.x 换成实际 IP）。

> ⚠️ 电脑和手机要在同一个 WiFi。
> ⚠️ 跨网络（不在同一个 WiFi）时浏览器会拦"混合内容"，这种情况用方案 B 的 Cloudflare Worker 更稳。

---

## 三种方案实测对比（485KB 字节码）

| | 打开网页 | 单文件 | zip 批量 | 输出质量 |
|---|---|---|---|---|
| **A. Termux 服务器** | 0 下载 | **19 ms** | **0.5 秒** | 官方引擎 ✅ |
| **B. 官方 API** | 0 下载 | **1.4 秒** | 逐个传 | 官方引擎 ✅ |
| **C. 浏览器内引擎**（兜底） | 下 11MB | 8 秒 | 8 秒+ | 诊断式伪代码 ⚠️ |

---

## 出问题看这里

| 现象 | 原因 | 怎么办 |
|---|---|---|
| 徽章一直「未连接」 | 服务器没起 | Termux 里跑 `curl -s http://127.0.0.1:8787/health` 看通不通 |
| `pkg install` 报 403 | Termux 镜像 IPv6 被拒 | 加 `-o Acquire::ForceIPv4=true` |
| 官方 API 报 1010 | Cloudflare 拦了 Worker 的请求 | `official-proxy-worker.js` 里已经带浏览器 UA，一般不会遇到 |
| 提示「混合内容」 | 填的是局域网 IP 但页面是 https | 换成 `http://127.0.0.1:8787`（同一台设备）或用方案 B |
| 页面一直转圈 | 在下 11MB 浏览器引擎 | 连上服务器就完全不用下了 |

---

## 手动用 curl 反编译（不开网站）

```bash
# 单个文件 → 源码
base64 -w0 x.luau > /tmp/b.txt
curl -s -X POST http://127.0.0.1:8787/decompile \
  -H 'Content-Type: application/json' \
  -d "{\"bytecode\":\"$(cat /tmp/b.txt)\"}" -o out.lua

# 原始二进制直接传
curl -s -X POST --data-binary @x.luau http://127.0.0.1:8787/decompile/raw -o out.lua

# 整个 zip 批量（服务端解开挨个算再打包回来，目录结构保留）
curl -s -X POST --data-binary @你的包.zip http://127.0.0.1:8787/decompile/zip -o 结果.zip
```

---

## 它能干什么

- 支持 **Luau v3 ~ v14**（含 Roblox 客户端专用的 **opcode 混淆**，`key = 203`）
- 还原控制流、字符串常量、表结构、API 调用名
- 变量名用启发式从用法反推（`r0_4` → `friendcache`）
- 支持 Roblox 客户端的 `CALLFB` / `CMPPROTO` 等 v12+ 新指令（等价降级处理）
- 650 KB 的大文件约 30~60 秒

## 用法

### 网页（推荐）

打开 <https://xxx.github.io/luau-decompiler/>，把字节码拖进去。

### JS API

页面暴露了全局函数，可在控制台 / 油猴脚本 / 自己的页面里调：

```js
const src = await window.luauDecompile(uint8array);   // → 源码字符串
const dia = await window.luauDetect(uint8array);      // → "luau" / "luajit" / ...
```

可选参数：

```js
await window.luauDecompile(bytes, {
  naming:   { mode: "heuristic" },   // "debug-like" | "simple" | "heuristic"
  generate: { mode: "permissive",    // "strict" | "permissive"
              luauVectorConstructor: { constructor: "vector", size: 3 } }
});
```

> ⚠️ `luauVectorConstructor` **必须给**，否则 Roblox 脚本里的 vector 常量会直接报错。

### 怎么拿到字节码

在 Roblox 执行器里：

```lua
writefile("x.luau", getscriptbytecode(game:GetService("ReplicatedStorage").Emotes))
```

然后把 `x.luau` 传到手机 / 电脑，用页面打开。

---

## 本地跑

```bash
# 任意静态服务器都行
python3 -m http.server 8000
# 然后打开 http://127.0.0.1:8000/
```

需要用 HTTP 打开（不能直接 `file://`），因为页面用了 ES module + Web Worker。

---

## 原理

引擎是 [unluac-rs](https://github.com/x3zvawq/unluac-rs)（Rust）。原版只支持 Luau v3~v7，
本仓库在 **parser 层**打了补丁扩展到 v14：

- 放宽版本上限到 14
- 新增常量类型：`9 = INTEGER`、`10 = CLASS_SHAPE`、`11 = VECTORD`
- 支持 v12+ 的 proto 长度前缀
- **opcode 混淆还原**：Roblox 客户端存的是 `原值 × 203⁻¹ mod 256`，解出即 `存储值 × 203 mod 256`
- 新指令降级：`CALLFB → CALL`（语义相同），`CMPPROTO` / `FASTPCALL` / userdata 相关 → `NOP`
- 支持 v11+ 的 feedback slots、v12+ 的 cost 尾字段

**思路是把 v14 在 parser 层降级成 v7 语义**，opcode enum 和 transformer 一行没动。

编译成 WebAssembly（wasm-bindgen）后在浏览器里跑，所以不需要服务器，反编译过程完全在本地。

---

## 已知限制

- 输出带 `recovery errors` 标记：少数分支因指令降级被合并，**读代码没问题，但不保证能原样重新编译**
- Roblox 客户端字节码里没有原始变量名，Roblox 官方也拿不回来，只能启发式猜
- wasm 体积约 6~15 MB（视构建配置），首次加载需要等一下

---

## 许可

引擎部分基于 [unluac-rs](https://github.com/x3zvawq/unluac-rs)（MIT），本仓库补丁与网页部分 MIT。

---

## 服务器模式（推荐 · 和官网同款架构）

官网的做法是**浏览器只传文件、服务器算**，所以打开网页零下载、结果秒出。
本项目现在也是这个架构：

| | 浏览器内引擎（兜底） | 服务器模式（推荐） |
|---|---|---|
| 首次打开 | 要下 11MB WASM | **0 下载** |
| 单文件 (485KB) | 8 秒 | **19 ms** |
| zip 批量 | 8 秒+ | **0.5 秒** |
| 输出质量 | 诊断式伪代码 | **官方引擎**（带类型标注 / upvalue 注释 / 行号） |

### 启动服务器

**手机 (Termux)** —— 用交付包里的离线引擎（官方原生 `.so`，ARM 走 qemu）：

```bash
cd "/storage/emulated/0/1/LunaUX反编译工具-1/lunaux-offline"
nohup ./luau-api.sh > /dev/null 2>&1 &
```

**电脑 (Linux)**：

```bash
python3 server/luau_api_server.py --host 0.0.0.0 --port 8787
```

### 网站里连上

页面打开会自动找 `127.0.0.1:8787`；连不上就手动填：

- 手机自己访问 → `http://127.0.0.1:8787`
- 电脑上的服务器 → `http://192.168.x.x:8787`

### 服务器接口

| 接口 | 说明 |
|---|---|
| `GET /health` | 探活 `{"ok":true,"engine":"lunaux"}` |
| `POST /decompile/raw` | body = 字节码二进制 → 源码纯文本 |
| `POST /decompile` | JSON `{"bytecode":"<base64>"}` → 源码纯文本 |
| `POST /decompile/zip` | body = zip 二进制 → **zip**（每个字节码文件对应一个 `.luau`，目录结构保留，附 `_反编译报告.txt`） |
| `GET /disasm?b64=..` | 反汇编 |

### zip 批量（服务端版）

浏览器把**整个 zip** 原样 POST 给 `/decompile/zip`，服务端解开、挨个反编译、再打包返回。
目录结构原样保留，附一份 `_反编译报告.txt`（成功/跳过/失败统计）。

---

## ☁️ 官方 API 直连（推荐 · 输出质量最高）

官网 <https://lunaux-decompiler.dev/demo> 是 **浏览器只传文件、服务器算**，所以打开网页零下载、1MB 文件约 1 秒，
输出带类型标注 / upvalue 注释 / 行号。

**好消息：反编译纯字节码不需要 API Key**（key 只用于 `.rbxl` 场景文件，见官网 `/getkey`）。

**唯一的障碍**：官方 API 不返回 `Access-Control-Allow-Origin` 头，浏览器直连会被同源策略拦掉。
解决办法是加一层**中转** —— 本仓库提供了现成的 Cloudflare Worker：

### 部署中转（免费，3 分钟）

1. 打开 <https://dash.cloudflare.com> → **Workers & Pages** → Create → Worker
2. 把 [`official-proxy-worker.js`](official-proxy-worker.js) 的内容整段粘进去 → Deploy
3. 拿到 `https://xxx.workers.dev` 地址

### 网站里启用

在「☁️ 官方 API」那栏填上这个地址 → 点 **⚡ 直连官方** → 右上角显示「☁️ 官方 API」就成功了。

### 怎么让它永久

| 想要的效果 | 怎么做 |
|---|---|
| 永久免费地址 | Cloudflare Worker 的 `xxx.workers.dev` 就是永久的，账号在就在 |
| 不想记 Worker 地址 | Workers → Settings → Domains → 绑自己的域名二级域名（如 `api.你的域名.com`） |
| **完全不依赖官方** | 用本仓库的 `server/`（本地引擎，sha256 与官方 v1.4.7 **完全一致**） |

### 🔒 关于「官方会不会挂」

- 官方 API 现在是活的，但第三方服务没有永久承诺 —— 域名可能换、接口可能改。
- **本仓库 `server/` 里的引擎是官方 v1.4.7 原版**（sha256 `def7b346ba8b...` 与官方下载页一致），
  所以**哪怕官方哪天关停，本地服务器照样能跑**，这就是最稳的「永久化」。
- 三种模式随时可切，优先级：**官方 API → 本地/自建服务器 → 浏览器内引擎**。

