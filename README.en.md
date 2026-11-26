<div align="center">

<img src="src-tauri/icons/icon.png" width="108" height="108" alt="MyCurl Logo" />

# MyCurl

**Paste any `curl` command from AI or docs to save it as a clean API collection**

No manual URL splitting · Auto-extracted API keys · 100% local storage

[简体中文](README.md) · **English**

[Quick Start](#quick-start) · [Core Workflow](#paste-to-organize) · [Features](#built-for-daily-api-work) · [Shortcuts](#keyboard-shortcuts)

[![License: MIT](https://img.shields.io/badge/License-MIT-10b981?style=flat-square)](LICENSE)
![Platform](https://img.shields.io/badge/macOS%2011%2B-Apple%20Silicon%20%2F%20Intel-111827?style=flat-square)
![Stack](https://img.shields.io/badge/Tauri%20v2-Rust%20%2B%20Node-3b82f6?style=flat-square)
![Local-First](https://img.shields.io/badge/Storage-Local%20·%20No%20Login-f59e0b?style=flat-square)

</div>

<br />

<div align="center">
  <img src="assets/mock-main.png" width="96%" alt="MyCurl main window showing host-grouped folders, request editor with masked secrets, and SSE/jq response viewer" />
  <p><sub>Main window: host-grouped collection tree, secret-masked request editor, and response viewer with SSE assembly and <code>jq</code> filtering</sub></p>
</div>

---

## Paste to Organize

When testing LLM endpoints or third-party APIs, docs and AI assistants usually hand you a full `curl` command containing raw API keys, a JSON payload, and sometimes a `| jq` pipe. In traditional API clients, you sign in, create a request, split the URL and headers by hand, and dig through old chats whenever a key rotates.

In MyCurl, copy the whole `curl` block, switch back to the app, and press `⌘V` (or click the clipboard import banner in the top bar):

```bash
curl 'https://api.openai.com/v1/chat/completions' \
  -H "Authorization: Bearer sk-demo-9f8e7d6c5b4a3210fedcba9876543210" \
  -H 'Content-Type: application/json' \
  --data-raw '{
    "model": "gpt-4o-mini",
    "messages": [{ "role": "user", "content": "Hello!" }],
    "stream": false
  }' | jq -r '.choices[0].message.content // .error.message // .'
```

<div align="center">
  <img src="assets/mock-paste-curl.png" width="96%" alt="Paste cURL smart import preview modal" />
  <p><sub>Smart import preview: automatically detects target folder, secret variables, request name, and <code>jq</code> filter</sub></p>
</div>

Click **Import & Open**, and MyCurl handles four things automatically:

- **Groups by host**: Detects common providers (OpenAI, Anthropic, DeepSeek, Gemini) or your own domain, puts the request into a matching folder, and extracts `{{base_url}}`.
- **Extracts and masks secrets**: Pulls raw `sk-...` tokens or `x-api-key` headers into a folder secret variable `{{api_key}}`. Requests on the same host reuse the same secret, keeping keys hidden during screen shares or screenshots.
- **Generates readable request names**: Names the request after the route, model, and prompt instead of leaving a pile of `New Request` tabs.
- **Keeps `jq` filters**: Any trailing `| jq` expression goes straight into the response filter bar so you can inspect the exact field or toggle back to raw JSON.

<div align="center">
  <img src="assets/mock-archived.png" width="96%" alt="Organized request view with masked API key and filtered response" />
  <p><sub>After import: the key is replaced with <code>{{api_key}}</code> and the response pane applies the <code>jq</code> filter automatically</sub></p>
</div>

---

## Quick Start

### 1. Fastest Local Trial (Node.js 20+ only)

Try MyCurl without installing Rust. This starts a local Node server and opens the app in your browser while storing data in `~/.mycurl/`:

```bash
git clone https://github.com/JASON-QWeb/MyCurl.git
cd MyCurl
npm install
npm start
```

The first run builds the frontend automatically and opens `http://localhost:5899`.

### 2. Native macOS App (`.dmg`)

Download the latest macOS installer from [**Releases**](https://github.com/JASON-QWeb/MyCurl/releases) (Apple Silicon & Intel, macOS 11+) and drag `MyCurl.app` into `/Applications`.

> **Note**: If macOS blocks an unsigned build with "cannot verify developer", run once in Terminal:
> ```bash
> xattr -cr /Applications/MyCurl.app
> ```

### 3. Run or Build the Desktop App from Source (Node.js 20+ & Rust 1.77+)

```bash
# Start Tauri desktop dev mode
npm run tauri:dev

# Build macOS .app and .dmg for the current architecture
npm run tauri:build:mac

# Build universal macOS binary (Apple Silicon + Intel)
npm run tauri:build:universal
```

---

## Built for Daily API Work

**Readable LLM streaming & response tools**
Instead of scrolling through raw `data: {"choices":[...]}` chunks, MyCurl assembles SSE streams into a clean reply view, collapses reasoning blocks (DeepSeek, Claude), and tracks TTFB, total duration, and token usage. You can also diff response history snapshots or save a `jq`-filtered field directly as a folder or environment variable.

**Dropdown secret picker & fast navigation**
In request or folder Auth tabs, click the **Secrets** dropdown next to the token input to pick an existing variable, check its active value, or jump straight to the secrets vault. Combined with clipboard `curl` detection, workspace and environment switchers, the bilingual `⌘K` command palette, and sequential folder execution (**Run All**), most tasks stay a keystroke away.

<div align="center">
  <img src="assets/mock-auth-picker.png" width="96%" alt="Auth secret picker dropdown and top-bar clipboard cURL detection" />
  <p><sub>Pick <code>{{api_key}}</code> directly in the Auth tab, with live clipboard <code>curl</code> detection in the top bar</sub></p>
</div>

**Broad import & masked export**
- **Import**: Supports **OpenAPI, Postman Collection v2.1, Apifox, HAR, `.http`, `.env` environments, MyCurl backups**, and single or multi-command `cURL`.
- **Export**: Export a single request or an entire folder as masked **Markdown docs**, **masked Postman collections**, **`.http` files**, or clean `cURL` (without noisy `-sS -L` flags), JavaScript `fetch`, and Python `requests` snippets — with selectable secret modes (**Mask**, **Keep `{{variable}}`**, or **Raw**).

**Local-first & bilingual UI**
The desktop app runs on Tauri v2 and a Rust HTTP engine (with a Node server fallback for local browser use). No account required. Workspaces, secrets, and response history are written atomically to `~/.mycurl/` (overridable via `MYCURL_DATA_DIR`) with rolling local backups. Switch between English and Simplified Chinese anytime in Settings.

---

## Keyboard Shortcuts

| Shortcut (`⌘` on macOS, `Ctrl` on Windows/Linux) | Action |
| :---: | :--- |
| `⌘I` / `⌘⇧V` / `⌘V` | Open cURL import, or paste with `⌘V` outside an editor |
| `⌘K` | Open command palette (search requests, folders, commands, workspaces & environments) |
| `⌘↵` | Send current request |
| `⌘N` | Create a new blank request |
| `⌘L` | Focus and select the active request URL |
| `⌘D` | Duplicate the active request when focus is outside an editor |
| `⌘S` | Save locally now |

---

## License

Released under the [MIT License](LICENSE).
