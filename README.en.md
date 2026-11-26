<div align="center">

<img src="src-tauri/icons/icon.png" width="108" height="108" alt="MyCurl Logo" />

# MyCurl

**Paste any `curl` command from AI or docs to save it as a clean API collection**

No manual URL splitting · Auto-extracted API keys · 100% local storage

[简体中文](README.md) · **English**

[![License: MIT](https://img.shields.io/badge/License-MIT-10b981?style=flat-square)](LICENSE)
![Platform](https://img.shields.io/badge/macOS-Apple%20Silicon%20%2F%20Intel-111827?style=flat-square)
![Size](https://img.shields.io/badge/DMG-~4%20MB-3b82f6?style=flat-square)
![Local-First](https://img.shields.io/badge/Storage-Local%20·%20No%20Login-f59e0b?style=flat-square)

</div>

<br />

<div align="center">
  <img src="assets/mock-main.png" width="96%" alt="MyCurl Main Window" />
</div>

---

## Why MyCurl

When testing LLM endpoints or third-party APIs, docs and AI assistants usually hand you a full `curl` command containing raw API keys, a JSON payload, and sometimes a `| jq` pipe at the end.

In traditional API clients, you have to sign in, create a request, split the URL and headers by hand, and paste the token and body into separate tabs. A week later when you rotate a key, you end up digging through old chat logs again.

In MyCurl, copy the whole `curl` block, switch back to the app, and press `⌘V`.

<div align="center">
  <img src="assets/mock-paste-curl.png" width="96%" alt="Paste cURL Smart Import Preview" />
</div>

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

Click **Import & Open**, and MyCurl handles the rest:

- **Groups by host**: Detects common providers (OpenAI, Anthropic, DeepSeek, Gemini) or your own domain, puts the request into a matching folder, and extracts `{{base_url}}`.
- **Extracts and masks secrets**: Pulls raw `sk-...` tokens or `x-api-key` headers into a folder secret variable `{{api_key}}`. Requests on the same host reuse the same secret, keeping keys hidden during screen shares or screenshots.
- **Generates readable request names**: Names the request after the route, model, and prompt instead of leaving a pile of `New Request` tabs.
- **Keeps `jq` filters**: Any `| jq` expression at the end of the command goes straight into the response filter bar so you can inspect the exact field or toggle back to the raw JSON.

<div align="center">
  <img src="assets/mock-archived.png" width="96%" alt="Organized Request View" />
</div>

---

## Practical Details

**Readable SSE streaming for LLMs**
Instead of scrolling through raw `data: {"choices":[...]}` lines, MyCurl assembles SSE chunks into a single reply view, separates reasoning blocks (DeepSeek R1, Claude), and records TTFB and total duration.

**Pick secrets from a dropdown**
When setting up a Bearer token or API key in the Auth tab, click the **Secrets** dropdown next to the input to pick an existing `{{api_key}}`, check its active value, or jump straight to the secrets vault.

<div align="center">
  <img src="assets/mock-auth-picker.png" width="96%" alt="Auth Secret Picker & Clipboard Detection" />
</div>

**Export masked docs and clean code**
Export a single request or an entire folder as Markdown API documentation with secrets masked automatically. Copy clean `cURL` commands (without noisy `-sS -L` flags), or generate JavaScript `fetch` and Python `requests` snippets.

**~4 MB native macOS app, local-only data**
Built with Tauri v2 and a Rust HTTP core. No account required. All workspaces, secrets, and response history live under `~/.mycurl/` on your machine with automatic local backups. Supports importing Postman Collection v2.1 JSON files.

---

## Recent Updates

- [x] **English & Chinese UI**: Switch between English and Simplified Chinese anytime in Settings.
- [x] **Clean cURL copy**: Copied `curl` commands omit noisy default `-sS -L` flags.
- [x] **Clipboard cURL detection**: Copy one or more `curl` commands and switch back to the app for a one-click import prompt in the top bar.
- [x] **Auth secret picker**: Pick existing secret variables from a dropdown in request and folder Auth tabs.
- [x] **Workspace & environment switchers**: Switch projects or dev/prod environments from the top bar.
- [x] **Search commands in English or Chinese** with `⌘K`. Send the active request, copy its cURL, export code or docs, or duplicate it. You can also switch environments, workspaces, themes, and layouts.
- [x] **Run a folder’s requests in order** with **Run All**. See each status and duration as it arrives, then check how many passed or failed. Stop at any time or open a completed request to inspect its response.
- [x] **The folder’s `···` menu** now holds subfolder creation, masked Postman export, and deletion. Expand **Keyboard Shortcuts** at the bottom of Settings for the full shortcut list.

---

## Keyboard Shortcuts

| Shortcut (⌘ or Ctrl) | Action |
| :---: | :--- |
| `⌘I` / `⌘⇧V` / `⌘V` | Open cURL import, or paste with `⌘V` outside an editor |
| `⌘K` | Search requests, folders, or commands, and switch environments or workspaces |
| `⌘↵` | Send current request |
| `⌘N` | Create a new blank request |
| `⌘L` | Focus and select the active request URL |
| `⌘D` | Duplicate the active request when focus is outside an editor |
| `⌘S` | Save locally now |

---

## Download & Build from Source

Grab the latest macOS `.dmg` from [**Releases**](../../releases) and drag `MyCurl.app` into `/Applications`.

To run or build from source (requires Node.js 20+ and Rust):

```bash
git clone https://github.com/JASON-QWeb/MyCurl.git
cd MyCurl
npm install

# Start desktop dev mode
npm run tauri:dev

# Build macOS .app and .dmg
npm run tauri:build:mac
```

---

## License

Released under the [MIT License](LICENSE).
