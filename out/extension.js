"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.activate = activate;
exports.deactivate = deactivate;
const vscode = require("vscode");
const WebSocket = require("ws");
const path = require("path");
const RESPONSE_FILE = '.cascade_response.md';
let wss = null;
let activeConnection = null;
let fileWatcher = null;
let statusBarItem;
function activate(context) {
    statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
    statusBarItem.command = 'cascadeMobile.status';
    context.subscriptions.push(statusBarItem);
    const config = vscode.workspace.getConfiguration('cascadeMobile');
    const autoStart = config.get('autoStart', true);
    context.subscriptions.push(vscode.commands.registerCommand('cascadeMobile.start', () => startServer(context)), vscode.commands.registerCommand('cascadeMobile.stop', () => stopServer()), vscode.commands.registerCommand('cascadeMobile.status', () => showStatus()));
    setupFileWatcher(context);
    if (autoStart) {
        startServer(context);
    }
}
function startServer(context) {
    if (wss) {
        vscode.window.showWarningMessage('Cascade Mobile: Server is already running.');
        return;
    }
    const config = vscode.workspace.getConfiguration('cascadeMobile');
    const port = config.get('port', 8080);
    try {
        wss = new WebSocket.Server({ port });
        wss.on('connection', (ws) => {
            activeConnection = ws;
            updateStatusBar(true, true);
            ws.on('message', async (message) => {
                try {
                    const request = JSON.parse(message.toString());
                    if (request.type === 'execute_prompt' && typeof request.prompt === 'string') {
                        await triggerCascade(request.prompt);
                    }
                    else {
                        ws.send(JSON.stringify({ type: 'error', message: 'Unknown request type or missing prompt.' }));
                    }
                }
                catch (err) {
                    ws.send(JSON.stringify({ type: 'error', message: String(err) }));
                }
            });
            ws.on('close', () => {
                if (activeConnection === ws) {
                    activeConnection = null;
                }
                updateStatusBar(true, false);
            });
            ws.on('error', (err) => {
                console.error('Cascade Mobile: WebSocket client error', err);
            });
        });
        wss.on('error', (err) => {
            vscode.window.showErrorMessage(`Cascade Mobile: Server error — ${err.message}`);
            wss = null;
            updateStatusBar(false, false);
        });
        context.subscriptions.push({ dispose: () => stopServer() });
        updateStatusBar(true, false);
        vscode.window.showInformationMessage(`Cascade Mobile: Listening on ws://localhost:${port}`);
    }
    catch (err) {
        vscode.window.showErrorMessage(`Cascade Mobile: Failed to start server — ${String(err)}`);
    }
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
}
function showStatus() {
    const config = vscode.workspace.getConfiguration('cascadeMobile');
    const port = config.get('port', 8080);
    if (!wss) {
        vscode.window.showInformationMessage('Cascade Mobile: Server is not running. Use "Cascade Mobile: Start Server" to start it.');
        return;
    }
    const connectedMsg = activeConnection ? 'Client connected.' : 'No client connected.';
    vscode.window.showInformationMessage(`Cascade Mobile: Running on ws://localhost:${port}. ${connectedMsg}`);
}
function updateStatusBar(running, connected) {
    if (!running) {
        statusBarItem.text = '$(circle-slash) Cascade Mobile';
        statusBarItem.tooltip = 'Cascade Mobile: Server stopped';
        statusBarItem.backgroundColor = undefined;
    }
    else if (connected) {
        statusBarItem.text = '$(radio-tower) Cascade Mobile';
        statusBarItem.tooltip = 'Cascade Mobile: Client connected';
        statusBarItem.backgroundColor = new vscode.ThemeColor('statusBarItem.warningBackground');
    }
    else {
        statusBarItem.text = '$(plug) Cascade Mobile';
        statusBarItem.tooltip = 'Cascade Mobile: Listening, no client';
        statusBarItem.backgroundColor = undefined;
    }
    statusBarItem.show();
}
async function triggerCascade(prompt) {
    const workspaceFolder = vscode.workspace.workspaceFolders?.[0]?.uri;
    const responseFilePath = workspaceFolder
        ? path.posix.join(workspaceFolder.fsPath, RESPONSE_FILE)
        : undefined;
    const injectedPrompt = responseFilePath
        ? `${prompt}\n\nCRITICAL INSTRUCTION: Write ONLY your final response to the file \`${RESPONSE_FILE}\` at the workspace root. Do not print your response in the chat.`
        : prompt;
    await vscode.env.clipboard.writeText(injectedPrompt);
    // Focus Cascade — try multiple known command IDs for compatibility
    const focusCommands = [
        'windsurf.cascade.focus',
        'workbench.panel.chat.view.windsurf.focus',
        'workbench.action.chat.open',
    ];
    for (const cmd of focusCommands) {
        try {
            await vscode.commands.executeCommand(cmd);
            break;
        }
        catch {
            // try next
        }
    }
    await delay(300);
    await vscode.commands.executeCommand('editor.action.clipboardPasteAction');
    await delay(100);
    // Submit — try multiple known command IDs
    const submitCommands = [
        'windsurf.cascade.submit',
        'workbench.action.chat.submit',
        'workbench.action.acceptSelectedQuickOpenItem',
    ];
    for (const cmd of submitCommands) {
        try {
            await vscode.commands.executeCommand(cmd);
            break;
        }
        catch {
            // try next
        }
    }
}
function setupFileWatcher(context) {
    fileWatcher = vscode.workspace.createFileSystemWatcher(`**/${RESPONSE_FILE}`);
    fileWatcher.onDidCreate(async (uri) => handleResponseFile(uri));
    fileWatcher.onDidChange(async (uri) => handleResponseFile(uri));
    context.subscriptions.push(fileWatcher);
}
async function handleResponseFile(uri) {
    try {
        const raw = await vscode.workspace.fs.readFile(uri);
        const content = Buffer.from(raw).toString('utf-8');
        if (activeConnection && activeConnection.readyState === WebSocket.OPEN) {
            activeConnection.send(JSON.stringify({ type: 'response', content }));
        }
        await vscode.workspace.fs.delete(uri);
    }
    catch (err) {
        console.error('Cascade Mobile: Failed to process response file', err);
    }
}
function delay(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}
function deactivate() {
    stopServer();
    fileWatcher?.dispose();
    statusBarItem?.dispose();
}
//# sourceMappingURL=extension.js.map