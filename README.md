# Cascade Mobile

A Windsurf extension that bridges external applications to the [Cascade](https://windsurf.com) AI agent via WebSocket. Send prompts to Cascade from any tool — mobile apps, scripts, automations — and receive the responses over a persistent connection.

## How It Works

The extension runs three components inside Windsurf's Node.js environment:

- **Ingress** — A WebSocket server (`ws://localhost:8080`) that receives prompt requests from external clients.
- **Actuator** — AppleScript activates Windsurf, presses `Cmd+Shift+I` to focus Cascade, and pastes the prompt via `Cmd+V`.
- **Egress** — A lightweight HTTP server (`http://127.0.0.1:8081`) that Cascade POSTs its response to via `curl`. The extension forwards the content back over the WebSocket.

```
External Client ─── WebSocket (8080) ─── Extension ─── Cascade (via AppleScript)
                                              │               │
                                   HTTP POST (8081) ◄── curl response
                                              │
                               WebSocket response ──────► External Client
```

## Requirements

- [Windsurf](https://windsurf.com) (macOS, tested on Apple Silicon)
- Node.js 18+
- Windsurf must have **Accessibility permissions** (System Settings → Privacy & Security → Accessibility)

## Installation

### From source

```bash
npm install
npm run package      # produces cascade-mobile-0.1.0.vsix
```

In Windsurf, open the Extensions panel → `...` menu → **Install from VSIX** → select the `.vsix` file.

### Development (Extension Development Host)

Press `F5` in Windsurf/VS Code with this project open to launch a development host with the extension active.

## Usage

### Sending a prompt

Connect a WebSocket client to `ws://localhost:8080` and send:

```json
{ "type": "execute_prompt", "prompt": "Refactor this function to use async/await" }
```

The extension injects the prompt into Cascade and instructs it to write its response to `.cascade_response.md`.

### Receiving the response

When Cascade finishes and writes the response file, the extension sends back:

```json
{ "type": "response", "content": "..." }
```

On error:

```json
{ "type": "error", "message": "..." }
```

### Example client (Node.js)

```js
const WebSocket = require('ws');
const ws = new WebSocket('ws://localhost:8080');

ws.on('open', () => {
    ws.send(JSON.stringify({ type: 'execute_prompt', prompt: 'Write a Python hello world' }));
});

ws.on('message', (data) => {
    const msg = JSON.parse(data);
    if (msg.type === 'response') console.log(msg.content);
});
```

## Commands

| Command | Description |
|---|---|
| `Cascade Mobile: Start Server` | Start the WebSocket ingress server |
| `Cascade Mobile: Stop Server` | Stop the server |
| `Cascade Mobile: Show Status` | Show current server and connection status |

## Configuration

Settings are under `cascadeMobile.*` in VS Code/Windsurf settings:

| Setting | Default | Description |
|---|---|---|
| `cascadeMobile.port` | `8080` | WebSocket server port |
| `cascadeMobile.autoStart` | `true` | Start server automatically on launch |
| `cascadeMobile.egressMode` | `fileWatcher` | Response capture method (`fileWatcher` or `mcp`) |

## Status Bar

The status bar item (bottom-right) shows the current state:

- `$(circle-slash) Cascade Mobile` — server stopped
- `$(plug) Cascade Mobile` — server running, no client connected
- `$(radio-tower) Cascade Mobile` — server running, client connected

## Mobile Web UI (Streamlit)

A chat UI lives in `client/` — run it on your Mac and access it from your phone on the same network.

### Setup

```bash
cd client
pip install -r requirements.txt
```

### Run

```bash
streamlit run app.py
```

Then open `http://<your-mac-ip>:8501` on your phone (find your IP with `ipconfig getifaddr en0`).

> The Streamlit server must be able to reach `ws://localhost:8080` — so it must run on the same machine as Windsurf.

## Project Structure

```
cascade-mobile/
├── src/
│   └── extension.ts          # Extension: WebSocket ingress, AppleScript actuator, HTTP egress
├── client/
│   ├── app.py                # Streamlit mobile chat UI
│   ├── requirements.txt      # Python dependencies
│   └── .streamlit/
│       └── config.toml       # Dark theme + server config
├── package.json              # Extension manifest and dependencies
├── tsconfig.json             # TypeScript configuration
└── .vscodeignore             # Files excluded from the packaged .vsix
```

## Packaging

```bash
npm run compile          # Compile TypeScript to out/
npm run package          # Bundle into .vsix via @vscode/vsce
```

## Notes

- Cascade must be in **Code mode** (agentic) for the curl egress to fire automatically. The file watcher is a fallback for Write mode.
- Only one WebSocket client connection is active at a time; a new connection replaces the previous one.
- The actuator uses AppleScript (`Cmd+Shift+I`) to focus Cascade — Windsurf must have Accessibility permissions granted.
