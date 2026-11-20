<div align="center">

<img src="src-tauri/icons/icon.png" width="112" height="112" alt="MyCurl Logo" />

# MyCurl

**面向中文开发者的本地优先 API 调试客户端 & AI cURL 智能归档工具**

参考 [Yaak](https://github.com/mountain-loop/yaak) 设计理念 · **Rust + Tauri v2 原生核心** · 离线优先 · 零云端上传

![Rust](https://img.shields.io/badge/Core-Rust%20%2B%20Tauri%20v2-orange?style=flat-square)
![Frontend](https://img.shields.io/badge/UI-React%2018%20%2B%20TypeScript-3178c6?style=flat-square)
![Platform](https://img.shields.io/badge/macOS-Apple%20Silicon%20%2F%20Intel-111827?style=flat-square)
![Local-First](https://img.shields.io/badge/Storage-Local--First-10b981?style=flat-square)

</div>

---

## 为什么做 MyCurl？

日常调用大模型或对接第三方接口时，AI 或官方文档经常会直接给出一大段包含明文密钥、路径、JSON 请求体甚至 `| jq` 管道的 `curl` 命令。传统 API 工具需要手动拆 URL、填 Header、配 Token、建目录、写笔记——重复且容易在聊天记录里弄丢密钥。

在 **MyCurl** 里，你只需要复制整段指令，切回应用按 **`⌘I`**（或直接 **`⌘V`**）：

```bash
curl -sS 'https://api.example.com/v1/chat/completions' \
  -H "Authorization: Bearer sk-xxxxxxxxxxxxxxxxxxxxxxxxxxxx" \
  -H 'Content-Type: application/json' \
  --data-raw '{
    "model": "model-j",
    "messages": [{ "role": "user", "content": "你是什么模型" }],
    "stream": false
  }' | jq -r '.choices[0].message.content // .error.message // .'
```

MyCurl 会自动为你完成整套归档：

| 自动识别项 | 归档结果 |
| --- | --- |
| **域名目录** | 自动创建或归入对应站点目录（如 `api.example.com`、`OpenAI · api.openai.com`、`Google Gemini` 等） |
| **路由前缀** | 自动提取 `https://api.example.com/v1` 为目录变量 `{{base_url}}`，请求地址转为 `{{base_url}}/chat/completions` |
| **敏感密钥** | 自动识别 `Bearer`、`x-api-key`、`?key=`、Basic 密码及 `$OPENAI_API_KEY`，收纳为遮罩保护的目录密钥 `{{api_key}}`（同站点同密钥自动复用） |
| **请求体与命名** | JSON 自动格式化，并根据路由 / 模型名 / Prompt 自动生成中文请求名（如 `对话补全 · model-j · 你是什么模型`） |
| **`jq` 响应筛选** | 自动捕获管道中的 `.choices[0].message.content // .error.message // .` 并填入响应筛选栏，一键切换筛选结果与原始 JSON |
| **接口文档** | 自动生成密钥脱敏后的 Markdown 请求文档与目录概览文档，支持一键导出整套 `.md` |

---

## 核心特性

- **原生 Rust + Tauri v2 引擎**：底层基于 `reqwest` + `rustls` + `tokio`，体积轻巧（macOS `.dmg` 约 3 MB），无 CORS 限制，支持 gzip / brotli / deflate 自动解压、HTTP/SOCKS 代理、`-k` 忽略自签名证书、重定向链追踪与跨域认证头剥离。
- **AI SSE 流式对话视图**：通过 Tauri v2 IPC Channel 实时流式推送响应帧，自动拼接 OpenAI、DeepSeek（含思考过程 `reasoning_content`）、Anthropic Claude、Google Gemini 的流式输出，亦可切换查看原始事件流。
- **多层级变量与密钥库**：支持 `全局变量` < `当前子环境` < `文件夹变量` 覆盖链，输入框与 CodeMirror 6 编辑器内实时高亮 `{{变量}}` 并支持 `{{` 自动补全（内置 `{{$uuid}}`、`{{$timestamp}}`、`{{$isoTimestamp}}` 等动态变量），提供跨目录「密钥总览」。
- **多形态 cURL 兼容**：支持 bash / zsh 反斜杠续行、Markdown 代码块、`export VAR=...`、Windows cmd `^` 转义（Chrome 复制为 cURL）、批量多条粘贴、以及剪贴板自动检测。
- **代码生成与集合互通**：一键导出为 cURL（脱敏 / 保留 `{{变量}}` / 明文）、JavaScript `fetch`、Python `requests` 与 Markdown 文档；支持导入 Postman Collection v2.1 与 MyCurl 备份（可选脱敏）。
- **克制的桌面交互**：深色 / 浅色 / 跟随系统主题、左右 / 上下双栏布局切换、可拖拽面板、每请求保留最近 30 条响应历史。

---

## 快捷操作

| 快捷键 | 功能 |
| --- | --- |
| `⌘I` / `⌘⇧V` | 打开「粘贴 cURL 智能归档」窗口 |
| `⌘V`（非输入区 / URL 栏） | 检测到 cURL 命令时自动弹出智能归档预览 |
| `⌘K` | 打开全局命令与接口快速跳转面板 |
| `⌘↵` | 发送当前请求 |
| `⌘N` | 新建空白 HTTP 请求 |

---

## 快速开始

### 环境要求
- **Node.js** 20+
- **Rust** stable（[rustup.rs](https://rustup.rs/)，含 `rustfmt` 与 `clippy`）
- **macOS** 11+ 与 Xcode Command Line Tools（用于打包原生 `.app` / `.dmg`）

### 安装与运行

```bash
# 1. 安装前端依赖
npm install

# 2. 启动 Rust + Tauri macOS 桌面应用（开发热更新）
npm run tauri:dev
```

> 若仅需在浏览器中快速调试前端界面，也可使用内置的 Node 本地代理模式：`npm start`（或 `npm run dev`）。

### 构建 macOS 桌面应用

```bash
# 构建当前架构的 macOS .app 与 .dmg
npm run tauri:build:mac

# 构建 Apple Silicon (M1–M4) + Intel 通用 Universal 安装包
rustup target add aarch64-apple-darwin x86_64-apple-darwin
npm run tauri:build:universal
```

产物位置：
- 应用包：`src-tauri/target/release/bundle/macos/MyCurl.app`
- 安装镜像：`src-tauri/target/release/bundle/dmg/MyCurl_<version>_<arch>.dmg`

---

## CI/CD 自动化流水线

仓库已配置完整的 GitHub Actions 工作流（位于 [`.github/workflows/`](.github/workflows)）：

1. **持续集成（`ci.yml`）**
   - 推送或 PR 至 `main` / `master` 时自动运行：
     - 前端 TypeScript 类型检查、Vitest 单元测试、Vite 生产构建
     - Rust `cargo fmt --check`、`cargo clippy -- -D warnings`、`cargo test`
     - macOS `.app` 与 `.dmg` 真实打包验证并上传 CI Artifact
2. **macOS 发版（`release-macos.yml`）**
   - 推送 `v*` 标签（如 `git tag v0.1.0 && git push origin v0.1.0`）或在 Actions 页面手动触发 `workflow_dispatch`（可选 `universal-apple-darwin` / `aarch64-apple-darwin` / `x86_64-apple-darwin`）。
   - 自动产出 `.dmg`、`.app.tar.gz` 与 `SHA256SUMS.txt` 并发布至 GitHub Releases。
   - **可选 Apple 签名与公证**：在仓库 `Settings → Secrets` 中配置 `APPLE_CERTIFICATE`、`APPLE_CERTIFICATE_PASSWORD`、`APPLE_SIGNING_IDENTITY`、`APPLE_ID`、`APPLE_PASSWORD`、`APPLE_TEAM_ID` 即可自动启用正式签名与公证；未配置时默认构建未签名安装包。

---

## 项目结构

```text
MyCurl/
├── src-tauri/                 # Rust + Tauri v2 桌面端核心
│   ├── src/
│   │   ├── lib.rs             # Tauri IPC 命令注册与剪贴板集成
│   │   ├── http_engine.rs     # reqwest + rustls 流式 HTTP 引擎与取消控制
│   │   └── storage.rs         # 原子持久化、自动滚动备份与响应历史
│   ├── icons/                 # macOS .icns / Windows .ico / PNG 图标集
│   └── tauri.conf.json        # Tauri 应用与 macOS DMG 打包配置
├── src/                       # React + TypeScript 前端界面
│   ├── lib/                   # cURL 解析、智能归档、jq 筛选、SSE 解析、代码/文档导出
│   ├── store/                 # Zustand 状态管理与持久化调度
│   └── components/            # 侧边栏、请求/响应面板、目录文档视图、智能导入弹窗等
├── server/                    # 浏览器预览模式降级代理（Node + Undici）
├── scripts/gen-icons.mjs      # 图标生成脚本（从 assets/icon-source.png 生成全套图标）
├── tests/                     # Vitest 单元测试
└── .github/workflows/         # CI 与 macOS Release GitHub Actions
```

---

## 隐私与本地数据

- 所有工作区、目录、环境变量、密钥与响应历史**仅保存在本机** `~/.mycurl/` 目录（可通过环境变量 `MYCURL_DATA_DIR` 自定义）：
  - `~/.mycurl/data.json`：工作区主数据（原子写入，避免异常退出损坏）
  - `~/.mycurl/backups/`：自动定期滚动备份（保留最近 30 份）
  - `~/.mycurl/history/`：按请求分别保存的最近 30 条响应记录
- 不会向任何第三方服务器发送遥测或同步数据。

---

## 常用开发命令

```bash
npm run typecheck          # TypeScript 类型检查
npm test                   # 运行前端单元测试（Vitest）
npm run rust:test          # 运行 Rust 核心单元测试（cargo test）
npm run tauri:dev          # 启动 Rust + Tauri 桌面端开发模式
npm run tauri:build:mac    # 打包 macOS .app 与 .dmg
node scripts/gen-icons.mjs # 从 assets/icon-source.png 重新生成全套应用图标
```
