# Luau 反编译器 (Luau Decompiler)

浏览器里的 Roblox / Luau 字节码反编译器。**纯前端、零上传、零依赖第三方 API**。

拖一个 `.luau` 字节码文件进页面，几十秒后就能拿到可读的 Luau 源码。

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
