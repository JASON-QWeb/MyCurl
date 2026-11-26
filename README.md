<div align="center">

<img src="src-tauri/icons/icon.png" width="108" height="108" alt="MyCurl Logo" />

# MyCurl

**把 AI 或文档给的 `curl` 命令直接存成接口库**

免拆 URL · 自动收好 API Key · 数据只存本地

**简体中文** · [English](README.en.md)

[快速开始](#快速开始) · [核心工作流](#粘贴即归档) · [更多能力](#更多顺手的能力) · [快捷键](#常用快捷键)

[![License: MIT](https://img.shields.io/badge/License-MIT-10b981?style=flat-square)](LICENSE)
![Platform](https://img.shields.io/badge/macOS%2011%2B-Apple%20Silicon%20%2F%20Intel-111827?style=flat-square)
![Stack](https://img.shields.io/badge/Tauri%20v2-Rust%20%2B%20Node-3b82f6?style=flat-square)
![Local-First](https://img.shields.io/badge/存储-纯本地%20·%20免登录-f59e0b?style=flat-square)

</div>

<br />

<div align="center">
  <img src="assets/mock-main.png" width="96%" alt="MyCurl 主界面：左侧按域名归档的接口目录，中间请求编辑区，右侧响应与 jq 筛选区" />
  <p><sub>主界面：按域名自动归类的目录树、带密钥打码的请求编辑区，以及支持 SSE 流式拼接与 <code>jq</code> 筛选的响应面板</sub></p>
</div>

---

## 粘贴即归档

调大模型或接第三方接口时，文档和 AI 给的往往是一整段 `curl` 命令，里面混着明文密钥和 JSON 请求体，有时末尾还带着 `| jq` 管道。用传统接口工具，你得先登录、新建请求、手动拆开 URL / Header / Body，过几天换 Key 又得去聊天记录里翻。

在 MyCurl 里，复制整段 `curl` 命令，切回软件按 `⌘V`（或点顶栏自动弹出的剪贴板导入提示）就行：

```bash
curl 'https://api.openai.com/v1/chat/completions' \
  -H "Authorization: Bearer sk-demo-9f8e7d6c5b4a3210fedcba9876543210" \
  -H 'Content-Type: application/json' \
  --data-raw '{
    "model": "gpt-4o-mini",
    "messages": [{ "role": "user", "content": "你是什么模型" }],
    "stream": false
  }' | jq -r '.choices[0].message.content // .error.message // .'
```

<div align="center">
  <img src="assets/mock-paste-curl.png" width="96%" alt="粘贴 cURL 智能归档预览弹窗" />
  <p><sub>粘贴后自动解析目标目录、密钥变量、接口名与 <code>jq</code> 筛选表达式</sub></p>
</div>

点击「归档并打开」，软件会自动完成 4 件事：

- **按域名建好目录**：识别常见模型服务商（OpenAI、Anthropic、DeepSeek、Gemini）或自定义域名，归入对应目录并提取 `{{base_url}}`。
- **提取并打码密钥**：把明文 `sk-...` 或 `x-api-key` 收纳为目录密钥变量 `{{api_key}}`。同一站点的请求自动复用同一密钥，截图或录屏不漏 Key。
- **生成易读的接口名**：根据路由、模型名和提问内容自动命名（如 `对话补全 · gpt-4o-mini · 你是什么模型`），告别满屏 `New Request`。
- **保留 `jq` 筛选规则**：命令末尾的 `| jq` 会直接填入右侧响应筛选栏，只看核心字段，随时可切回原始 JSON。

<div align="center">
  <img src="assets/mock-archived.png" width="96%" alt="一键归档后的请求与响应界面" />
  <p><sub>归档完成：密钥已转为 <code>{{api_key}}</code>，响应区自动按 <code>jq</code> 提取核心字段</sub></p>
</div>

---

## 快速开始

### 1. 最快本地试用（仅需 Node.js 20+）

无需安装 Rust，直接启动本地 Web 服务并在浏览器打开，数据同样保存在 `~/.mycurl/`：

```bash
git clone https://github.com/JASON-QWeb/MyCurl.git
cd MyCurl
npm install
npm start
```

首次执行会自动构建前端并在 `http://localhost:5899` 打开页面。

### 2. macOS 原生桌面版（`.dmg`）

前往 [**Releases**](https://github.com/JASON-QWeb/MyCurl/releases) 下载最新 macOS 安装包（支持 Apple Silicon 与 Intel，需 macOS 11+），将 `MyCurl.app` 拖入「应用程序」即可。

> **提示**：未签名安装包首次打开如遇 macOS 提示「无法验证开发者」，在终端执行一次：
> ```bash
> xattr -cr /Applications/MyCurl.app
> ```

### 3. 从源码运行或打包桌面端（需 Node.js 20+ 与 Rust 1.77+）

```bash
# 启动 Tauri 桌面开发模式
npm run tauri:dev

# 打包当前架构的 macOS .app 与 .dmg
npm run tauri:build:mac

# 打包通用架构（Apple Silicon + Intel）
npm run tauri:build:universal
```

---

## 更多顺手的能力

**大模型流式返回与响应调试**
调 AI 接口不必对着满屏 `data: {"choices":[...]}` 找字。MyCurl 会将 SSE 流式数据实时拼成完整回答，单独折叠 DeepSeek / Claude 的思考过程（Reasoning），并记录首字耗时（TTFB）、总耗时与 Token 用量。支持响应历史 Diff 对比，也能把 `jq` 筛选出的字段一键存为目录或环境变量。

**密钥下拉选择与高效导航**
在请求或目录的认证栏配 Bearer Token / API Key 时，点击输入框旁的「选择密钥」即可直接选用已有变量、查看当前生效值或跳转密钥库编辑。配合顶栏剪贴板 `curl` 感应、工作区与环境切换、`⌘K` 中英文命令面板，以及文件夹一键「运行全部」顺序测试，日常调试几乎不用切窗口。

<div align="center">
  <img src="assets/mock-auth-picker.png" width="96%" alt="认证栏密钥选择器与顶栏剪贴板 cURL 感应" />
  <p><sub>认证栏下拉直接选用 <code>{{api_key}}</code>，顶栏实时感应剪贴板中的 <code>curl</code> 命令</sub></p>
</div>

**多格式导入与脱敏导出**
- **导入**：支持 **OpenAPI、Postman Collection v2.1、Apifox、HAR、`.http`、`.env` 环境变量、MyCurl 备份** 以及单条/多条 `cURL`。
- **导出**：支持按单条请求或整个目录导出脱敏 **Markdown 文档**、**脱敏 Postman 集合**、**`.http` 文件**，或生成清爽 `cURL`（默认去除多余 `-sS -L`）、JavaScript `fetch`、Python `requests` 代码；导出代码支持在「密钥脱敏 / 保留 `{{变量}}` / 填充明文」三种模式间切换。

**本地优先，中英双语**
桌面端基于 Tauri v2 与 Rust HTTP 引擎构建，免登录、无云端强制同步。所有工作区、密钥与响应历史默认原子写入本机 `~/.mycurl/`（可通过 `MYCURL_DATA_DIR` 环境变量自定义路径），并自带定期滚动备份。设置中支持一键切换简体中文与 English。

---

## 常用快捷键

| 快捷键（macOS 用 `⌘`，Windows/Linux 用 `Ctrl`） | 功能 |
| :---: | :--- |
| `⌘I` / `⌘⇧V` / `⌘V` | 打开 cURL 归档，或在输入框外直接 `⌘V` 粘贴导入 |
| `⌘K` | 打开命令面板（中英文搜索请求、文件夹、命令与环境/工作区切换） |
| `⌘↵` | 发送当前请求 |
| `⌘N` | 新建空白请求 |
| `⌘L` | 聚焦并选中当前请求 URL |
| `⌘D` | 在编辑区外复制当前请求副本 |
| `⌘S` | 立即保存到本地 |

---

## 开源协议

基于 [MIT License](LICENSE) 开源。
