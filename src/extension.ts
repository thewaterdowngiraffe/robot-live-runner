import * as vscode from 'vscode';
import * as net from 'net';
import * as path from 'path';

let clientSocket: net.Socket | null = null;
let liveTerminal: vscode.Terminal | null = null;
let isSessionActive = false;
let isExecuting = false;
let isPaused = false;

export function activate(context: vscode.ExtensionContext) {
    updateContextKeys(false, false, false);

    // 1. Start Live Session
    context.subscriptions.push(
        vscode.commands.registerCommand('robotLiveTest.start', async () => {
            const editor = vscode.window.activeTextEditor;
            if (!editor || !editor.document.fileName.endsWith('.robot')) {
                vscode.window.showErrorMessage('Please focus a .robot file to start Live Testing.');
                return;
            }

            const filePath = editor.document.fileName;
            const listenerPath = path.join(context.extensionPath, 'python', 'live_listener.py');

            // Find current test case name under cursor
            const testName = getActiveTestCaseName(editor);

            if (liveTerminal) {
                liveTerminal.dispose();
            }

            liveTerminal = vscode.window.createTerminal('Robot Live Runner');
            liveTerminal.show();

            const testFilter = testName ? `-t "${testName}"` : '';
            const cmd = `robot --listener "${listenerPath}:8765" ${testFilter} "${filePath}"`;

            liveTerminal.sendText(cmd);
            vscode.window.showInformationMessage('Starting Live Session (Running Setup)...');

            // Connect to socket with retry
            setTimeout(() => connectToRunnerSocket(), 2500);
        })
    );

    // 2. Run Entire Test Case Body
    context.subscriptions.push(
        vscode.commands.registerCommand('robotLiveTest.runTest', () => {
            const editor = vscode.window.activeTextEditor;
            if (!editor) return;
            const lines = getFullTestCaseLines(editor);
            sendExecutionBatch(lines);
        })
    );

    // 3. Run Selected Lines
    context.subscriptions.push(
        vscode.commands.registerCommand('robotLiveTest.runSelected', () => {
            const editor = vscode.window.activeTextEditor;
            if (!editor) return;
            const selection = editor.selection;
            const text = editor.document.getText(selection);
            const lines = text.split('\n').map(l => l.trim()).filter(l => l.length > 0);
            if (lines.length === 0) {
                vscode.window.showWarningMessage('No lines selected.');
                return;
            }
            sendExecutionBatch(lines);
        })
    );

    // 4. Run Below (From cursor down to end of test case)
    context.subscriptions.push(
        vscode.commands.registerCommand('robotLiveTest.runBelow', () => {
            const editor = vscode.window.activeTextEditor;
            if (!editor) return;
            const lines = getLinesFromCursorBelow(editor);
            sendExecutionBatch(lines);
        })
    );

    // 5. Pause
    context.subscriptions.push(
        vscode.commands.registerCommand('robotLiveTest.pause', () => {
            sendCommand({ command: 'PAUSE' });
            isPaused = true;
            updateContextKeys(isSessionActive, isExecuting, isPaused);
        })
    );

    // 6. Resume
    context.subscriptions.push(
        vscode.commands.registerCommand('robotLiveTest.resume', () => {
            sendCommand({ command: 'RESUME' });
            isPaused = false;
            updateContextKeys(isSessionActive, isExecuting, isPaused);
        })
    );

    // 7. Stop Current Batch
    context.subscriptions.push(
        vscode.commands.registerCommand('robotLiveTest.stopBatch', () => {
            sendCommand({ command: 'STOP_BATCH' });
            isExecuting = false;
            isPaused = false;
            updateContextKeys(isSessionActive, isExecuting, isPaused);
        })
    );

    // 8. Stop Live Testing Session
    context.subscriptions.push(
        vscode.commands.registerCommand('robotLiveTest.stopSession', () => {
            sendCommand({ command: 'EXIT_SESSION' });
            cleanupSession();
            vscode.window.showInformationMessage('Live Testing session ended.');
        })
    );
}

function connectToRunnerSocket(retries = 5) {
    clientSocket = new net.Socket();
    clientSocket.connect(8765, '127.0.0.1', () => {
        isSessionActive = true;
        isExecuting = false;
        isPaused = false;
        updateContextKeys(true, false, false);
        vscode.window.showInformationMessage('🟢 Live Session Active! Ready to execute steps.');
    });

    clientSocket.on('data', (data) => {
        const lines = data.toString().split('\n');
        for (const line of lines) {
            if (!line.trim()) continue;
            try {
                const msg = JSON.parse(line);
                if (msg.status === 'EXECUTING_START') {
                    isExecuting = true;
                    updateContextKeys(isSessionActive, isExecuting, isPaused);
                } else if (msg.status === 'EXECUTING_DONE') {
                    isExecuting = false;
                    isPaused = false;
                    updateContextKeys(isSessionActive, isExecuting, isPaused);
                }
            } catch (e) {}
        }
    });

    clientSocket.on('error', () => {
        if (retries > 0) {
            setTimeout(() => connectToRunnerSocket(retries - 1), 1000);
        } else {
            vscode.window.showErrorMessage('Failed to attach to Robot Framework Live Runner.');
            cleanupSession();
        }
    });

    clientSocket.on('close', () => {
        cleanupSession();
    });
}

function sendExecutionBatch(lines: string[]) {
    if (!clientSocket || !isSessionActive) {
        vscode.window.showErrorMessage('No active live session. Click "Run Live Test" first.');
        return;
    }
    isExecuting = true;
    updateContextKeys(isSessionActive, isExecuting, isPaused);
    sendCommand({ command: 'EXECUTE', lines: lines });
}

function sendCommand(payload: object) {
    if (clientSocket && !clientSocket.destroyed) {
        clientSocket.write(JSON.stringify(payload) + '\n');
    }
}

function updateContextKeys(active: boolean, executing: boolean, paused: boolean) {
    isSessionActive = active;
    isExecuting = executing;
    isPaused = paused;
    vscode.commands.executeCommand('setContext', 'robotLiveTest.isActive', active);
    vscode.commands.executeCommand('setContext', 'robotLiveTest.isExecuting', executing);
    vscode.commands.executeCommand('setContext', 'robotLiveTest.isPaused', paused);
}

function cleanupSession() {
    isSessionActive = false;
    isExecuting = false;
    isPaused = false;
    updateContextKeys(false, false, false);
    if (clientSocket) {
        clientSocket.destroy();
        clientSocket = null;
    }
}

// Helpers for extracting test code
function getActiveTestCaseName(editor: vscode.TextEditor): string | null {
    const doc = editor.document;
    const curLine = editor.selection.active.line;
    for (let i = curLine; i >= 0; i--) {
        const text = doc.lineAt(i).text;
        if (/^\*\*\*\s*(Test Cases|Tasks)\s*\*\*\*/i.test(text)) break;
        if (/^[A-Za-z0-9_].+/.test(text) && !text.startsWith(' ') && !text.startsWith('\t')) {
            return text.trim();
        }
    }
    return null;
}

function getFullTestCaseLines(editor: vscode.TextEditor): string[] {
    const doc = editor.document;
    const curLine = editor.selection.active.line;
    let start = -1;
    let end = doc.lineCount;

    // Find start of test case
    for (let i = curLine; i >= 0; i--) {
        const text = doc.lineAt(i).text;
        if (/^[A-Za-z0-9_].+/.test(text) && !text.startsWith(' ') && !text.startsWith('\t')) {
            start = i + 1;
            break;
        }
    }
    if (start === -1) start = 0;

    // Find end of test case
    for (let i = start; i < doc.lineCount; i++) {
        const text = doc.lineAt(i).text;
        if ((/^[A-Za-z0-9_].+/.test(text) && !text.startsWith(' ') && !text.startsWith('\t')) || /^\*\*\*/.test(text)) {
            end = i;
            break;
        }
    }

    const lines: string[] = [];
    for (let i = start; i < end; i++) {
        const line = doc.lineAt(i).text.trim();
        if (line && !line.startsWith('#') && !line.startsWith('[')) {
            lines.push(line);
        }
    }
    return lines;
}

function getLinesFromCursorBelow(editor: vscode.TextEditor): string[] {
    const doc = editor.document;
    const start = editor.selection.active.line;
    let end = doc.lineCount;

    for (let i = start + 1; i < doc.lineCount; i++) {
        const text = doc.lineAt(i).text;
        if ((/^[A-Za-z0-9_].+/.test(text) && !text.startsWith(' ') && !text.startsWith('\t')) || /^\*\*\*/.test(text)) {
            end = i;
            break;
        }
    }

    const lines: string[] = [];
    for (let i = start; i < end; i++) {
        const line = doc.lineAt(i).text.trim();
        if (line && !line.startsWith('#') && !line.startsWith('[')) {
            lines.push(line);
        }
    }
    return lines;
}

export function deactivate() {
    cleanupSession();
}