<div align="center">

<img src="src-tauri/icons/icon.png" width="108" height="108" alt="MyCurl Logo" />

# MyCurl

**把 AI 给的 `curl` 命令直接存成接口库**

免拆 URL · 自动收好 API Key · 数据只存本地

**简体中文** · [English](README.en.md)

[![License: MIT](https://img.shields.io/badge/License-MIT-10b981?style=flat-square)](LICENSE)
![Platform](https://img.shields.io/badge/macOS-Apple%20Silicon%20%2F%20Intel-111827?style=flat-square)
![Size](https://img.shields.io/badge/安装包-~4%20MB-3b82f6?style=flat-square)
![Local-First](https://img.shields.io/badge/存储-纯本地%20·%20免登录-f59e0b?style=flat-square)

</div>

<br />

<div align="center">
  <img src="assets/mock-main.png" width="96%" alt="MyCurl 主界面" />
</div>

---

## 解决什么问题

调大模型或接第三方接口时，文档和 AI 给的往往是一整段 `curl` 命令，里面混着明文密钥和 JSON 请求体，有时末尾还带着 `| jq` 管道。

用传统接口工具，你得先登录账号，新建请求，把网址和 Header 拆开填好，再把 Token 和 JSON 粘进去。过几天换个 Key，又要去聊天记录里翻。

在 MyCurl 里，复制整段 `curl` 命令，切回软件按 `⌘V` 就行。

<div align="center">
  <img src="assets/mock-paste-curl.png" width="96%" alt="粘贴 cURL 智能归档预览" />
</div>

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

点一下「归档并打开」，软件会自动做好这几件事：

- **按域名建好目录**：识别出 OpenAI 或 DeepSeek 这类常用接口，或是你自己的服务域名，自动归入对应目录并提取 `{{base_url}}`。
- **提取并打码密钥**：把明文 `sk-...` 或 `x-api-key` 收纳为目录密钥变量 `{{api_key}}`。同一站点的相同密钥会自动复用，截图或录屏时不怕漏 Key。
- **自动生成好认的接口名**：根据接口路径、模型名和提问内容，直接命名为 `对话补全 · gpt-4o-mini · 你是什么模型`，不用在一堆 `New Request` 里挨个找。
- **保留 `jq` 筛选规则**：命令末尾带的 `| jq` 表达式会自动填进右侧响应筛选栏，只看核心字段，随时也能切回完整 JSON。

<div align="center">
  <img src="assets/mock-archived.png" width="96%" alt="一键归档后的界面" />
</div>

---

## 几个顺手的设计

**大模型流式返回直接看正文**
调 AI 接口不用对着满屏的 `data: {"choices":[...]}` 一行行找字。MyCurl 会把 SSE 流式数据直接拼成完整回答，DeepSeek 和 Claude 的思考过程（Reasoning）也会单独折叠展示，同时记录首字耗时与总耗时。

**密钥直接下拉选，不用手敲括号**
在认证栏配 Bearer Token 或管理目录密钥时，输入框旁边自带「选择密钥」下拉菜单。点开就能选已有的 `{{api_key}}` 并查看当前生效值，也可以直接跳去密钥库修改。

<div align="center">
  <img src="assets/mock-auth-picker.png" width="96%" alt="认证栏密钥选择器与剪贴板 cURL 感应" />
</div>

**一键导出脱敏文档和干净代码**
接口调通后要发给同事或贴进文档，可以按单条请求或整个目录导出 Markdown 接口文档，里面的密钥默认自动打码。也可以随时复制纯粹的 `cURL` 命令，或转成前端 `fetch` 与 Python `requests` 代码。

**4 MB 安装包，数据只留在本地**
原生 macOS 应用，体积只有 4 MB 左右，点开即用。不强制注册登录，所有接口数据、密钥和请求历史都保存在本机 `~/.mycurl/` 目录下，自带本地自动备份。支持直接导入 Postman Collection v2.1。

---

## 近期更新

<!-- 以后有新特性，直接在下面列表追加一行，或替换上方截图即可 -->

- [x] **中英双语界面**：设置里支持一键切换简体中文与 English。
- [x] **清爽 cURL 复制**：复制出来的 `curl` 默认去掉多余的 `-sS -L` 参数，贴进终端或文档更干净。
- [x] **剪贴板 cURL 自动感应**：复制单条或多条 `curl` 后切回软件，顶栏直接提示一键归档。
- [x] **认证栏密钥选择器**：在请求与目录认证页下拉选用已有密钥变量，支持一键跳转编辑。
- [x] **工作区与环境切换菜单**：顶栏直接切换不同项目工作区，或切换开发与生产环境。
- [x] **命令面板支持中英文搜索**，按 `⌘K` 可发送当前请求、复制 cURL、导出代码或文档、创建请求副本，也能切换环境、工作区、主题和布局。
- [x] **文件夹可以顺序运行接口**，点「运行全部」会按列表顺序发送本层请求。每行显示状态和耗时，点开就能查看响应。中途停止也会汇总已完成请求的成功与异常数。
- [x] **文件夹右上角的 `···` 菜单**收好了新建子文件夹、导出脱敏 Postman 集合和删除操作。设置底部也可以展开快捷键速查。

---

## 常用快捷键

| 快捷键（⌘ 或 Ctrl） | 功能 |
| :---: | :--- |
| `⌘I` / `⌘⇧V` / `⌘V` | 打开 cURL 归档，或在输入框外用 `⌘V` 直接粘贴导入 |
| `⌘K` | 搜索请求、文件夹或命令，切换环境和工作区 |
| `⌘↵` | 发送当前请求 |
| `⌘N` | 新建空白请求 |
| `⌘L` | 聚焦并选中当前请求的 URL |
| `⌘D` | 在编辑区外复制当前请求副本 |
| `⌘S` | 立即保存到本地 |

---

## 下载与运行

直接用安装包的话，去右侧 [**Releases**](../../releases) 页面下载最新的 macOS `.dmg`（支持 Apple Silicon 与 Intel），拖进应用程序即可。

如果想从源码本地运行或自己打包（需 Node.js 20+ 和 Rust 环境）：

```bash
git clone https://github.com/JASON-QWeb/MyCurl.git
cd MyCurl
npm install

# 启动桌面开发模式
npm run tauri:dev

# 打包 macOS .app 与 .dmg
npm run tauri:build:mac
```

---

## 开源协议

基于 [MIT License](LICENSE) 开源。
