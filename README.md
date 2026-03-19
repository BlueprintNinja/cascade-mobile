Blueprint: Building a Native Windsurf Cascade Connector

This plan outlines how to build a VS Code/Windsurf extension that acts as a bridge between an external application (your remote trigger) and the internal Cascade AI agent.     

By building an extension, we run inside Windsurf's Node.js environment, giving us access to internal commands and background processes without relying on OS-level UI hacking.

Architecture Overview

The system will consist of three main components operating within the extension:

The Ingress (Local Server): A lightweight WebSocket or HTTP server running inside the extension that listens for incoming prompts from your external tools.

The Actuator (Command Execution): VS Code API calls that programmatically focus the Cascade chat, inject the prompt, and execute it.

The Egress (MCP Server / Return Channel): A Model Context Protocol (MCP) tool registered by your extension that Cascade is instructed to call with its final answer, sending the data back to your local server.

Phase 1: Extension Scaffolding & Setup

Since Windsurf is a fork of VS Code, you build extensions for it the exact same way you build for VS Code using TypeScript.

Install Prerequisites: Ensure you have Node.js and Git installed.

Install the Generator: Run npm install -g yo generator-code.

Generate the Project: Run yo code in your terminal.

Choose New Extension (TypeScript).

Name it cascade-remote-connector.

Windsurf specific setup: In your package.json, under engines, ensure the vscode version matches the base version Windsurf uses (usually ^1.85.0 or similar).

Phase 2: Building the Ingress (The Local Server)

Inside your src/extension.ts file, the activate function runs as soon as the IDE starts. We will use this to boot up a local server.

Install Dependencies: npm install ws (for WebSockets) or express. WebSockets are recommended for two-way, real-time communication.

Initialize Server in activate:

import * as vscode from 'vscode';
import * as WebSocket from 'ws';

export function activate(context: vscode.ExtensionContext) {
    console.log('Cascade Connector is active!');

    // Start a WebSocket server on a specific port (e.g., 8080)
    const wss = new WebSocket.Server({ port: 8080 });

    wss.on('connection', function connection(ws) {
        ws.on('message', async function incoming(message) {
            const request = JSON.parse(message.toString());
            if (request.type === 'execute_prompt') {
                await triggerCascade(request.prompt);
            }
        });
    });

    // Clean up on deactivate
    context.subscriptions.push({ dispose: () => wss.close() });
}


Phase 3: The Actuator (Triggering Cascade)

We need to programmatically pass the text to Cascade. Since internal APIs for direct silent AI querying are usually undocumented, we simulate the UI action using native VS Code commands.

Discover internal commands: In Windsurf, open Keyboard Shortcuts (Cmd+K Cmd+S) and search for "Cascade". Look for the Command IDs (e.g., workbench.panel.chat.view.windsurf.focus or similar).

Execute the prompt:

async function triggerCascade(prompt: string) {
    // 1. Put prompt in the clipboard
    await vscode.env.clipboard.writeText(prompt);

    // 2. Focus the Cascade input box (Replace with exact Windsurf command ID)
    await vscode.commands.executeCommand('windsurf.cascade.focus');

    // 3. Optional: Delay slightly to ensure UI is ready
    await new Promise(resolve => setTimeout(resolve, 200));

    // 4. Paste the prompt and execute
    await vscode.commands.executeCommand('editor.action.clipboardPasteAction');
    await vscode.commands.executeCommand('windsurf.cascade.submit'); // Or simulate 'Enter'
}


Phase 4: The Egress (Capturing the Response)

This is where the Airlock extension gave us a major clue. Getting the response out of the chat UI is hard. Instead, we use the Model Context Protocol (MCP) or native file system watchers.

Approach A: The MCP Tool (Highly Recommended)

Windsurf supports MCP, which allows agents to use custom tools. Your extension can register an MCP tool called transmit_response_to_remote.

Register the Tool: In your extension, register a tool that takes a JSON payload containing the agent's answer.

Inject the Instruction: When you receive a prompt via WebSocket, modify it before pasting it into Cascade:

Original: "Write a Python function to..."

Injected: "Write a Python function to... CRITICAL: Do not print the code in the chat. You MUST use the transmit_response_to_remote tool and pass your final code to it."

Capture & Return: When Cascade calls your tool, your extension receives the payload natively. You then send that payload back through your open WebSocket connection to the remote user!

Approach B: The Native File Watcher (Fallback)

If setting up an MCP server is too complex initially, use the file-dump trick from the Python script, but do it entirely natively inside the extension.

Inject Instruction: Tell Cascade to write to a specific .cascade_tmp.md file in the workspace.

Watch the File: Use vscode.workspace.createFileSystemWatcher('**/.cascade_tmp.md').

Read and Send: When the watcher detects the file is written, use vscode.workspace.fs.readFile to get the content, send it over the WebSocket, and then use vscode.workspace.fs.delete to clean it up.

Phase 5: Packaging & Deployment

Test locally: Press F5 in your development VS Code/Windsurf window to open an Extension Development Host.

Package: Run npx vsce package. This generates a .vsix file.

Install: In Windsurf, go to the Extensions panel, click the ... menu, and select Install from VSIX. Select your packaged file.

Summary of the New Flow

Your remote tool connects to ws://localhost:8080.

It sends: {"type": "execute_prompt", "prompt": "Create a React button component"}.

The Extension receives this, appends the MCP/File instructions, focuses the Cascade panel, pastes the text, and submits it.

Cascade processes the request and, following its prompt instructions, uses your MCP tool to deliver the payload.

The Extension receives the tool invocation and pushes the data back down the WebSocket to your remote tool.
