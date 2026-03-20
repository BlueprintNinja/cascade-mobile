import * as vscode from 'vscode';
import * as WebSocket from 'ws';
import { execFile } from 'child_process';
import * as http from 'http';

const RESPONSE_FILE = '.cascade_response.md';

let wss: WebSocket.Server | null = null;
let httpServer: http.Server | null = null;
let activeConnection: WebSocket | null = null;
let fileWatcher: vscode.FileSystemWatcher | null = null;
let statusBarItem: vscode.StatusBarItem;
let httpPort = 8081;

export function activate(context: vscode.ExtensionContext) {
    statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
    statusBarItem.command = 'cascadeMobile.status';
    context.subscriptions.push(statusBarItem);

    const config = vscode.workspace.getConfiguration('cascadeMobile');
    const autoStart = config.get<boolean>('autoStart', true);

    context.subscriptions.push(
        vscode.commands.registerCommand('cascadeMobile.start', () => startServer(context)),
        vscode.commands.registerCommand('cascadeMobile.stop', () => stopServer()),
        vscode.commands.registerCommand('cascadeMobile.status', () => showStatus()),
    );

    setupFileWatcher(context);
    startHttpServer(context);

    if (autoStart) {
        startServer(context);
    }
}

function startServer(context: vscode.ExtensionContext) {
    if (wss) {
        vscode.window.showWarningMessage('Cascade Mobile: Server is already running.');
        return;
    }

    const config = vscode.workspace.getConfiguration('cascadeMobile');
    const port = config.get<number>('port', 8080);

    try {
        wss = new WebSocket.Server({ port });

        wss.on('connection', (ws: WebSocket) => {
            activeConnection = ws;
            updateStatusBar(true, true);

            ws.on('message', async (message: WebSocket.RawData) => {
                try {
                    const request = JSON.parse(message.toString());
                    if (request.type === 'execute_prompt' && typeof request.prompt === 'string') {
                        await triggerCascade(request.prompt, request.project);
                    } else {
                        ws.send(JSON.stringify({ type: 'error', message: 'Unknown request type or missing prompt.' }));
                    }
                } catch (err) {
                    ws.send(JSON.stringify({ type: 'error', message: String(err) }));
                }
            });

            ws.on('close', () => {
                if (activeConnection === ws) {
                    activeConnection = null;
                }
                updateStatusBar(true, false);
            });

            ws.on('error', (err: Error) => {
                console.error('Cascade Mobile: WebSocket client error', err);
            });
        });

        wss.on('error', (err: Error) => {
            vscode.window.showErrorMessage(`Cascade Mobile: Server error — ${err.message}`);
            wss = null;
            updateStatusBar(false, false);
        });

        context.subscriptions.push({ dispose: () => stopServer() });
        updateStatusBar(true, false);
        vscode.window.showInformationMessage(`Cascade Mobile: Listening on ws://localhost:${port}`);
    } catch (err) {
        vscode.window.showErrorMessage(`Cascade Mobile: Failed to start server — ${String(err)}`);
    }
}

function startHttpServer(context: vscode.ExtensionContext) {
    httpServer = http.createServer((req, res) => {
        if (req.method === 'POST' && req.url === '/response') {
            let body = '';
            req.on('data', (chunk: Buffer) => { body += chunk.toString(); });
            req.on('end', () => {
                res.writeHead(200, { 'Content-Type': 'text/plain' });
                res.end('ok');
                if (activeConnection && activeConnection.readyState === WebSocket.OPEN) {
                    activeConnection.send(JSON.stringify({ type: 'response', content: body }));
                }
            });
        } else {
            res.writeHead(404);
            res.end();
        }
    });
    httpServer.listen(httpPort, '127.0.0.1', () => {
        console.log(`Cascade Mobile: HTTP response receiver on http://127.0.0.1:${httpPort}`);
    });
    context.subscriptions.push({ dispose: () => { httpServer?.close(); httpServer = null; } });
}

function stopServer() {
    if (!wss) {
        return;
    }
    wss.close(() => {
        wss = null;
        activeConnection = null;
        updateStatusBar(false, false);
        vscode.window.showInformationMessage('Cascade Mobile: Server stopped.');
    });
    httpServer?.close();
    httpServer = null;
}

function showStatus() {
    const config = vscode.workspace.getConfiguration('cascadeMobile');
    const port = config.get<number>('port', 8080);

    if (!wss) {
        vscode.window.showInformationMessage('Cascade Mobile: Server is not running. Use "Cascade Mobile: Start Server" to start it.');
        return;
    }

    const connectedMsg = activeConnection ? 'Client connected.' : 'No client connected.';
    vscode.window.showInformationMessage(`Cascade Mobile: Running on ws://localhost:${port}. ${connectedMsg}`);
}

function updateStatusBar(running: boolean, connected: boolean) {
    if (!running) {
        statusBarItem.text = '$(circle-slash) Cascade Mobile';
        statusBarItem.tooltip = 'Cascade Mobile: Server stopped';
        statusBarItem.backgroundColor = undefined;
    } else if (connected) {
        statusBarItem.text = '$(radio-tower) Cascade Mobile';
        statusBarItem.tooltip = 'Cascade Mobile: Client connected';
        statusBarItem.backgroundColor = new vscode.ThemeColor('statusBarItem.warningBackground');
    } else {
        statusBarItem.text = '$(plug) Cascade Mobile';
        statusBarItem.tooltip = 'Cascade Mobile: Listening, no client';
        statusBarItem.backgroundColor = undefined;
    }
    statusBarItem.show();
}

async function triggerCascade(prompt: string, projectHint?: string) {
    const workspaceName = vscode.workspace.workspaceFolders?.[0]?.name ?? 'this workspace';
    const projectContext = projectHint
        ? `[Context: project "${projectHint}"]\n`
        : `[Context: project "${workspaceName}"]\n`;
    const injectedPrompt = `${projectContext}${prompt}\n\nPlease also run this terminal command with your answer substituted in (this sends it back to the app that asked): curl -s -X POST http://127.0.0.1:${httpPort}/response -d '<your answer here>'`;

    // Stage prompt in clipboard
    await vscode.env.clipboard.writeText(injectedPrompt);

    // Use AppleScript to: activate Windsurf, open Cascade (Cmd+Shift+I), paste, submit.
    // This bypasses VS Code focus commands entirely — reliable since the Cascade input
    // is a WebView that doesn't accept the VS Code `type` command.
    await focusCascadeAndSubmitViaAppleScript();
}

function setupFileWatcher(context: vscode.ExtensionContext) {
    fileWatcher = vscode.workspace.createFileSystemWatcher(`**/${RESPONSE_FILE}`);

    fileWatcher.onDidCreate(async (uri: vscode.Uri) => handleResponseFile(uri));
    fileWatcher.onDidChange(async (uri: vscode.Uri) => handleResponseFile(uri));

    context.subscriptions.push(fileWatcher);
}

async function handleResponseFile(uri: vscode.Uri) {
    vscode.window.showInformationMessage('Cascade Mobile: response file detected, sending over WebSocket.');
    try {
        const raw = await vscode.workspace.fs.readFile(uri);
        const content = Buffer.from(raw).toString('utf-8');

        if (activeConnection && activeConnection.readyState === WebSocket.OPEN) {
            activeConnection.send(JSON.stringify({ type: 'response', content }));
        }

        await vscode.workspace.fs.delete(uri);
    } catch (err) {
        console.error('Cascade Mobile: Failed to process response file', err);
    }
}

function delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

function focusCascadeAndSubmitViaAppleScript(): Promise<void> {
    // 1. Activate Windsurf so it is the frontmost app
    // 2. Press Cmd+Shift+I — this is windsurf.triggerCascade (opens/focuses Cascade)
    // 3. Wait for the WebView input to be ready
    // 4. Paste clipboard contents (Cmd+V)
    // 5. Press Enter to submit
    const script = [
        'tell application "Windsurf" to activate',
        'delay 0.3',
        'tell application "System Events"',
        '    tell process "Windsurf"',
        '        keystroke "i" using {command down, shift down}',
        '        delay 1.2',
        '        keystroke "v" using {command down}',
        '        delay 0.2',
        '        key code 36',
        '    end tell',
        'end tell',
    ].join('\n');
    return new Promise((resolve, reject) => {
        execFile('osascript', ['-e', script], (err) => {
            if (err) { reject(err); } else { resolve(); }
        });
    });
}

export function deactivate() {
    stopServer();
    fileWatcher?.dispose();
    statusBarItem?.dispose();
}
