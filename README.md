# opencode-free-bridge

**OpenCode Zen & Cline 渠道增强桥接器 — 专为 DeepSeek Harness (DSH) 打造。**

无需复杂代理，无需在 DSH 界面手动填写繁琐的客户端自定义头，直接赋能 DSH 原生 `opencode` 渠道及 `cline` 官方中转渠道。

---

## ✨ 特性

- **多渠道官方协议特征自动注入**：
  - **OpenCode Zen 渠道 (`opencode.ai/zen`)**：
    - 自动模拟官方 CLI User-Agent 与 Client 特征；
    - 动态生成符合规范的 `X-Session-Id`、`x-opencode-session`、`x-session-affinity`，彻底解决 `MissingSessionID` 报错；
    - 每轮请求自动生成唯一 `x-opencode-request` 与上下文标识；
    - 未配置 Key（或误填 URL）时自动使用官方匿名通道（`Bearer public`）。
  - **Cline 渠道 (`api.cline.bot`)**：
    - 自动注入完整的 Cline 官方客户端特征头（`user-agent: Cline/4.1.16`、`x-client-type: cline-vscode`、`x-platform: vscode`、`http-referer` 等）；
    - 鉴权完全由用户在 DSH 设置中配置的 Key 决定，原生透传直通，不设代码层内置 Key 兜底。
- **100% 流量精准隔离**：
  - 仅在网络请求目标为 `opencode.ai/zen` 或 `api.cline.bot` 时介入；
  - 对 DeepSeek 官方模型、OpenAI、Claude、Gemini 等其他所有渠道 100% 原样直通，零副作用。
- **纯原生轻量中间件**：体积仅数 KB，基于 DSH Cordis 插件架构，支持热插拔与无残留卸载。

---

## 📦 安装方法

在终端运行以下命令，将插件安装到 DSH 的 `web` Profile：

```bash
dsh plugin --profile web add github:huahai0202/opencode-free-bridge
```

---

## 🚀 使用说明

### 1. OpenCode Zen
- 重启 DSH：`dsh web`
- 在模型选择器中直接进入 **`opencode`** 分组，无需填写 Key 即可畅享免费模型。

### 2. Cline 渠道
在 DSH 的 `settings.yaml` 中配置 `cline` 提供方（或在 DSH Web 设置中添加自定义提供方）：
- Base URL: `https://api.cline.bot/api/v1`
- 协议: `OpenAI Compatible` (`openai-completions`)
- 请求头无需手动复制，插件会自动拦截补全全部官方认证头部。

---

## 🔌 ACP Profile / Paseo 接入

`web` Profile 的安装命令**不会**覆盖 ACP 通道：`dsh --profile acp` 是独立的出厂模板 Profile，需要把插件挂到它的用户层（典型场景：通过 [Agent Client Protocol](https://agentclientprotocol.com/) 接入 Paseo 等外部客户端）。

### 1. 挂载到 acp Profile

1. 生成用户层目录（如不存在）：`dsh --profile acp --dump-config`，随后出现 `~/.dsh/profiles/acp/`；
2. 编辑 `~/.dsh/profiles/acp/package.json`，把插件加入依赖与 bundles：

   ```json
   {
     "dependencies": {
       "opencode-free-bridge": "github:huahai0202/opencode-free-bridge"
     },
     "dsh": {
       "profile": {
         "bundles": [
           "@deepseek-ai/dsh-base",
           "@deepseek-ai/dsh-acp-app",
           "opencode-free-bridge"
         ],
         "patchReload": "startup"
       }
     }
   }
   ```

3. 安装依赖：`cd ~/.dsh/profiles/acp && dsh plugin --profile acp install`
4. 验证层树出现插件：`dsh --profile acp --dump-config | grep opencode-free-bridge`

### 2. 注册为 Paseo Provider

在 `~/.paseo/config.json` 的 `agents.providers` 下添加（凭据全部由 DSH 自管，Paseo 不接触密钥）：

```json
"dsh": {
  "extends": "acp",
  "label": "DSH (DeepSeek Harness)",
  "command": ["dsh", "--profile", "acp"],
  "env": {}
}
```

重启 Paseo 后**新建 agent**（每次 agent 会话都会重新 spawn `dsh`），模型选择器即出现 DSH 的全部分组（`deepseek-official` / `fastmodel` / `opencode` / `cline`）；其中 `opencode` 与 `cline` 分组经本插件注入协议头，免费模型可直接使用，无需 Key 兜底。

### 3. ACP 验证脚本

`tools/` 内置两个零依赖脚本（Node ≥ 22），用于在接入外部客户端前先本地验证链路：

```bash
node tools/acp-smoke.mjs     # initialize + session/new，打印模型目录与配置项
node tools/acp-turn.mjs      # 完整一轮对话，默认走 OpenCode 免费模型，验证 MissingSessionID 400 已消失

# 可选参数：--cwd <工作目录>  --model '["cline","deepseek/deepseek-v4-flash"]'  --prompt "..."
# --profile <name> 可改为其他 ACP Profile
```

---

## 📄 开源许可

[MIT](./LICENSE) © huahai0202
