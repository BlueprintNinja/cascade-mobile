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
                        await triggerCascade(request.prompt);
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

async function triggerCascade(prompt: string) {
    const injectedPrompt = `${prompt}\n\nIMPORTANT: After you have finished your answer, run this exact terminal command to return your response (replace YOUR_ANSWER with your full answer, keep the quotes):\ncurl -s -X POST http://127.0.0.1:${httpPort}/response -d 'YOUR_ANSWER'`;

    // Stage prompt in clipboard
    await vscode.env.clipboard.writeText(injectedPrompt);

    // Focus the Cascade panel — try known commands, swallow all failures
    const focusCandidates = [
        'workbench.action.focusAuxiliaryBar',
        'workbench.action.focusSideBar',
        'windsurf.openChatView',
        'windsurf.cascadePanel',
    ];
    for (const cmd of focusCandidates) {
        try {
            await vscode.commands.executeCommand(cmd);
            break;
        } catch {
            // try next candidate
        }
    }

    // Wait for the Cascade WebView input to gain focus
    await delay(800);

    // Cascade's input is a WebView — the VS Code `type` command doesn't reach it.
    // Use AppleScript to simulate Cmd+V (paste) then Enter (submit) at the OS level.
    await pasteAndSubmitViaAppleScript();
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

function pasteAndSubmitViaAppleScript(): Promise<void> {
    const script = [
        'tell application "System Events"',
        '    keystroke "v" using {command down}',
        '    delay 0.15',
        '    key code 36',
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
