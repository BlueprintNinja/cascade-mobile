# Cascade Mobile

A Windsurf extension that bridges external applications to the [Cascade](https://windsurf.com) AI agent via WebSocket. Send prompts to Cascade from any tool — mobile apps, scripts, automations — and receive the responses over a persistent connection.

## How It Works

The extension runs three components inside Windsurf's Node.js environment:

- **Ingress** — A WebSocket server (`ws://localhost:8080` by default) that listens for incoming prompt requests from external clients.
- **Actuator** — VS Code API calls that focus the Cascade panel, inject the prompt, and submit it programmatically.
- **Egress** — A file system watcher that detects when Cascade writes its response to `.cascade_response.md` in the workspace, reads the content, sends it back over the WebSocket, and deletes the file.

```
External Client ──── WebSocket ──── Extension ──── Cascade
                                         │               │
                                    File Watcher ◄── response file
                                         │
                              WebSocket response ────► External Client
```

## Requirements

- [Windsurf](https://windsurf.com) (or VS Code `^1.85.0`)
- Node.js 18+

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

## Project Structure

```
cascade-mobile/
├── src/
│   └── extension.ts     # Extension entry point: server, actuator, file watcher
├── package.json          # Extension manifest and dependencies
├── tsconfig.json         # TypeScript configuration
└── .vscodeignore         # Files excluded from the packaged .vsix
```

## Packaging

```bash
npm run compile          # Compile TypeScript to out/
npm run package          # Bundle into .vsix via @vscode/vsce
```

## Notes

- The egress `fileWatcher` mode works by instructing Cascade (via a prompt injection) to write its response to `.cascade_response.md`. This file is automatically cleaned up after it is read.
- Only one WebSocket client connection is active at a time; a new connection replaces the previous one.
- Internal Windsurf command IDs (`windsurf.cascade.focus`, `windsurf.cascade.submit`) may change across Windsurf versions. The actuator tries multiple known IDs and falls back gracefully.
