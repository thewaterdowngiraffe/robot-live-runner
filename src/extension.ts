import * as vscode from 'vscode';
import * as net from 'net';
import * as path from 'path';
import * as fs from 'fs';

let clientSocket: net.Socket | null = null;
let liveTerminal: vscode.Terminal | null = null;
let isSessionActive = false;
let isExecuting = false;
let isPaused = false;

let statusBarItem: vscode.StatusBarItem;
let executionDecorationType: vscode.TextEditorDecorationType | null = null;
let currentExecutionRanges: vscode.Range[] = [];

// Dynamic Gutter Trackers
let trailDecorations: vscode.TextEditorDecorationType[] = [];
let trailRanges: vscode.Range[][] = [];
let executionHistoryBlocks: number[][] = [];

// Track settings changes to prevent memory leaks
let currentHighlightColor = '';
let currentTrailConfig = '';

let executionQueue: { commandText: string, originalLines: number[] }[] = [];
let currentExecutingCommand: { commandText: string, originalLines: number[] } | null = null;

export function activate(context: vscode.ExtensionContext) {
    statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
    statusBarItem.command = 'robotLiveTest.showMenu';
    context.subscriptions.push(statusBarItem);
    updateContextKeys(false, false, false);

    context.subscriptions.push(
        vscode.commands.registerCommand('robotLiveTest.showMenu', async () => {
            if (!isSessionActive) return;
            const items: vscode.QuickPickItem[] = [];

            if (!isExecuting && !isPaused) {
                items.push({ label: '$(run-all) Run Full Test' });
                items.push({ label: '$(selection) Run Selected Lines' });
                items.push({ label: '$(arrow-down) Run Below' });
            }
            if (isExecuting && !isPaused) items.push({ label: '$(debug-pause) Pause Execution' });
            if (isPaused) items.push({ label: '$(debug-continue) Resume Execution' });
            if (isExecuting || isPaused) items.push({ label: '$(debug-stop) Stop Queue' });
            items.push({ label: '$(trash) Stop Live Session' });

            const selection = await vscode.window.showQuickPick(items, { placeHolder: 'Live Runner Controls' });
            if (!selection) return;

            if (selection.label.includes('Run Full Test')) vscode.commands.executeCommand('robotLiveTest.runTest');
            else if (selection.label.includes('Run Selected Lines')) vscode.commands.executeCommand('robotLiveTest.runSelected');
            else if (selection.label.includes('Run Below')) vscode.commands.executeCommand('robotLiveTest.runBelow');
            else if (selection.label.includes('Pause')) vscode.commands.executeCommand('robotLiveTest.pause');
            else if (selection.label.includes('Resume')) vscode.commands.executeCommand('robotLiveTest.resume');
            else if (selection.label.includes('Stop Queue')) vscode.commands.executeCommand('robotLiveTest.stopBatch');
            else if (selection.label.includes('Stop Live Session')) vscode.commands.executeCommand('robotLiveTest.stopSession');
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('robotLiveTest.start', async () => {
            const editor = vscode.window.activeTextEditor;
            if (!editor || !editor.document.fileName.endsWith('.robot')) return vscode.window.showErrorMessage('Focus a .robot file.');

            const filePath = editor.document.fileName;
            const listenerPath = path.join(context.extensionPath, 'python', 'live_listener.py');
            const testName = getActiveTestCaseName(editor);
            const wsFolder = vscode.workspace.getWorkspaceFolder(editor.document.uri);
            const cwd = wsFolder ? wsFolder.uri.fsPath : path.dirname(filePath);
            const pythonPath = await resolvePythonPath(editor.document.uri);

            if (liveTerminal) liveTerminal.dispose();
            liveTerminal = vscode.window.createTerminal({ name: 'Robot Live Runner', cwd: cwd });
            liveTerminal.show();

            const isWin = process.platform === 'win32';
            const shellPath = (vscode.env.shell || '').toLowerCase();
            const callPrefix = isWin && !shellPath.endsWith('cmd.exe') ? '& ' : '';
            const testFilter = testName ? `-t "${testName}"` : '';

            const configArgs = getRobotConfigArgs(editor.document.uri);
            const cmd = `${callPrefix}"${pythonPath}" -m robot --listener "${listenerPath}:8765" ${configArgs}${testFilter} "${filePath}"`;

            liveTerminal.sendText(cmd);
            vscode.window.showInformationMessage('Starting Live Session (Running Setup)...');
            setTimeout(() => connectToRunnerSocket(), 2500);
        })
    );

    context.subscriptions.push(vscode.commands.registerCommand('robotLiveTest.runTest', () => {
        const editor = vscode.window.activeTextEditor;
        if (editor) sendExecutionBatch(getFullTestCaseLines(editor));
    }));

    context.subscriptions.push(vscode.commands.registerCommand('robotLiveTest.runSelected', () => {
        const editor = vscode.window.activeTextEditor;
        if (!editor) return;
        const doc = editor.document;
        const selection = editor.selection;

        let startLineNum = selection.start.line;
        while (startLineNum > 0) {
            const text = doc.lineAt(startLineNum).text.trim();
            if (text.startsWith('...')) startLineNum--;
            else if (text.startsWith('#') || text === '') startLineNum--;
            else break;
        }

        let lines: { text: string, line: number }[] = [];
        let blockDepth = 0;
        let currentLineNum = startLineNum;
        const targetEndLine = selection.end.line;

        while (currentLineNum < doc.lineCount) {
            const text = doc.lineAt(currentLineNum).text.trim();

            if (text.startsWith('#') || text === '') {
                currentLineNum++;
                continue;
            }

            if (!text.startsWith('...')) {
                // Peek ahead to stitch continuations for accurate block detection
                let fullCommand = text;
                let peekLineNum = currentLineNum + 1;
                while (peekLineNum < doc.lineCount) {
                    const nextText = doc.lineAt(peekLineNum).text.trim();
                    if (nextText.startsWith('#') || nextText === '') {
                        peekLineNum++;
                        continue;
                    }
                    if (nextText.startsWith('...')) {
                        fullCommand += '  ' + nextText.substring(3).trim();
                        peekLineNum++;
                    } else break;
                }

                const upper = fullCommand.toUpperCase();
                const parts = fullCommand.split(/\s{2,}|\t/).filter(p => p.length > 0);

                if (upper.startsWith('FOR ') || upper.startsWith('WHILE ') || upper === 'TRY') {
                    blockDepth++;
                } else if (upper.startsWith('IF ')) {
                    let isInline = parts.length > 2 && !parts[2].startsWith('#');
                    if (!isInline) blockDepth++;
                } else if (upper === 'END') {
                    blockDepth--;
                }
            }

            lines.push({ text, line: currentLineNum });

            if (currentLineNum >= targetEndLine && blockDepth <= 0 && lines.length > 0) {
                let nextLineNum = currentLineNum + 1;
                let hasContinuation = false;
                while (nextLineNum < doc.lineCount) {
                    const nextText = doc.lineAt(nextLineNum).text.trim();
                    if (nextText.startsWith('#') || nextText === '') nextLineNum++;
                    else if (nextText.startsWith('...')) {
                        hasContinuation = true;
                        break;
                    } else break;
                }
                if (!hasContinuation) break;
            }
            currentLineNum++;
        }

        if (lines.length === 0) return vscode.window.showWarningMessage('No executable lines found.');
        sendExecutionBatch(lines);
    }));

    context.subscriptions.push(vscode.commands.registerCommand('robotLiveTest.runBelow', () => {
        const editor = vscode.window.activeTextEditor;
        if (editor) sendExecutionBatch(getLinesFromCursorBelow(editor));
    }));

    context.subscriptions.push(vscode.commands.registerCommand('robotLiveTest.pause', () => {
        isPaused = true;
        updateContextKeys(isSessionActive, false, true);
    }));

    context.subscriptions.push(vscode.commands.registerCommand('robotLiveTest.resume', () => {
        isPaused = false;
        processQueue();
    }));

    context.subscriptions.push(vscode.commands.registerCommand('robotLiveTest.stopBatch', () => {
        executionQueue = [];
        isExecuting = false;
        isPaused = false;
        updateContextKeys(isSessionActive, false, false);
        clearExecutionHighlight();
    }));

    context.subscriptions.push(vscode.commands.registerCommand('robotLiveTest.stopSession', () => {
        sendCommand({ command: 'EXIT_SESSION' });
        cleanupSession();
        vscode.window.showInformationMessage('Live Testing session ended.');
    }));
}

function sendExecutionBatch(lines: { text: string, line: number }[]) {
    if (!clientSocket || !isSessionActive) return vscode.window.showErrorMessage('No active live session.');

    let currentCommand: { commandText: string, originalLines: number[] } | null = null;
    let blockDepth = 0;

    for (let i = 0; i < lines.length; i++) {
        const item = lines[i];
        const trimmed = item.text.trim();

        // Stitch continuations to check block depth accurately
        let fullCommand = trimmed;
        if (!trimmed.startsWith('...')) {
            let j = i + 1;
            while (j < lines.length) {
                const nextTrimmed = lines[j].text.trim();
                if (nextTrimmed.startsWith('...')) {
                    fullCommand += '  ' + nextTrimmed.substring(3).trim();
                    j++;
                } else if (nextTrimmed.startsWith('#') || nextTrimmed === '') {
                    j++;
                } else break;
            }
        }

        const upper = fullCommand.toUpperCase();
        const parts = fullCommand.split(/\s{2,}|\t/).filter(p => p.length > 0);

        let isBlockStart = false;
        let isBlockEnd = false;

        if (!trimmed.startsWith('...')) {
            if (upper.startsWith('FOR ') || upper.startsWith('WHILE ') || upper === 'TRY') {
                isBlockStart = true;
            } else if (upper.startsWith('IF ')) {
                let isInline = parts.length > 2 && !parts[2].startsWith('#');
                if (!isInline) isBlockStart = true;
            } else if (upper === 'END') {
                isBlockEnd = true;
            }
        }

        if (isBlockStart) {
            if (blockDepth === 0) {
                if (currentCommand) executionQueue.push(currentCommand);
                currentCommand = { commandText: item.text, originalLines: [item.line] };
            } else {
                currentCommand!.commandText += '\n    ' + trimmed;
                currentCommand!.originalLines.push(item.line);
            }
            blockDepth++;
        }
        else if (isBlockEnd) {
            if (blockDepth > 0) {
                currentCommand!.commandText += '\n    ' + trimmed;
                currentCommand!.originalLines.push(item.line);
                blockDepth--;
                if (blockDepth === 0) {
                    executionQueue.push(currentCommand!);
                    currentCommand = null;
                }
            } else {
                if (currentCommand) executionQueue.push(currentCommand);
                currentCommand = { commandText: item.text, originalLines: [item.line] };
            }
        }
        else {
            if (trimmed.startsWith('...')) {
                if (currentCommand) {
                    const appendText = blockDepth > 0 ? '\n    ' + trimmed : '    ' + trimmed.substring(3).trim();
                    currentCommand.commandText += appendText;
                    currentCommand.originalLines.push(item.line);
                }
            } else {
                if (blockDepth > 0) {
                    currentCommand!.commandText += '\n    ' + trimmed;
                    currentCommand!.originalLines.push(item.line);
                } else {
                    if (currentCommand) executionQueue.push(currentCommand);
                    currentCommand = { commandText: item.text, originalLines: [item.line] };
                }
            }
        }
    }
    if (currentCommand) executionQueue.push(currentCommand);

    if (!isExecuting && !isPaused) processQueue();
}

function processQueue() {
    if (isPaused) return updateContextKeys(isSessionActive, false, true);
    if (executionQueue.length === 0) {
        isExecuting = false;
        updateContextKeys(isSessionActive, false, false);
        return clearExecutionHighlight();
    }

    isExecuting = true;
    updateContextKeys(isSessionActive, true, false);
    currentExecutingCommand = executionQueue.shift() || null;

    if (currentExecutingCommand) {
        const editor = vscode.window.activeTextEditor;
        if (editor) highlightExecutingLines(editor, currentExecutingCommand.originalLines);
        sendCommand({ command: 'EXECUTE', lines: [currentExecutingCommand.commandText] });
    }
}

function connectToRunnerSocket(retries = 6) {
    clientSocket = new net.Socket();
    clientSocket.connect(8765, '127.0.0.1', () => {
        isSessionActive = true;
        isExecuting = false;
        isPaused = false;
        updateContextKeys(true, false, false);
        vscode.window.showInformationMessage('🟢 Live Session Active!');
    });

    clientSocket.on('data', (data) => {
        const lines = data.toString().split('\n');
        for (const line of lines) {
            if (!line.trim()) continue;
            try {
                const msg = JSON.parse(line);
                if (msg.status === 'EXECUTING_DONE') {
                    const editor = vscode.window.activeTextEditor;
                    if (editor && currentExecutingCommand) {
                        executionHistoryBlocks.push(currentExecutingCommand.originalLines);

                        const config = vscode.workspace.getConfiguration('robotLiveTest');
                        const trailLength = config.get<number>('trailLength', 3);
                        const lastBlocks = executionHistoryBlocks.slice(-trailLength).reverse();

                        trailRanges = [];
                        for (let i = 0; i < trailLength; i++) {
                            if (lastBlocks.length > i) {
                                const ranges = lastBlocks[i].map(row => editor.document.lineAt(row).range);
                                trailRanges.push(ranges);
                            } else {
                                trailRanges.push([]);
                            }
                        }
                        updateTrailDecorations(editor, trailLength, config.get<string>('trailBaseColor', '76, 175, 80'));
                    }
                    processQueue();
                } else if (msg.status === 'ERROR') {
                    vscode.window.showErrorMessage(`Robot Failed: ${msg.error}`);
                    executionQueue = [];
                    isExecuting = false;
                    isPaused = false;
                    updateContextKeys(isSessionActive, false, false);
                    clearExecutionHighlight();
                }
            } catch (e) {}
        }
    });

    clientSocket.on('error', () => {
        if (retries > 0) setTimeout(() => connectToRunnerSocket(retries - 1), 1000);
        else {
            vscode.window.showErrorMessage('Failed to attach to Live Runner.');
            cleanupSession();
        }
    });

    clientSocket.on('close', () => cleanupSession());
}

async function resolvePythonPath(resource: vscode.Uri): Promise<string> {
    try {
        const pyExt = vscode.extensions.getExtension('ms-python.python');
        if (pyExt) {
            if (!pyExt.isActive) await pyExt.activate();
            const envPath = await pyExt.exports?.environments?.getActiveEnvironmentPath(resource);
            if (envPath?.path && fs.existsSync(envPath.path)) return envPath.path;
        }
    } catch (_) {}
    return 'python';
}

function sendCommand(payload: object) {
    if (clientSocket && !clientSocket.destroyed) clientSocket.write(JSON.stringify(payload) + '\n');
}

function updateContextKeys(active: boolean, executing: boolean, paused: boolean) {
    isSessionActive = active;
    isExecuting = executing;
    isPaused = paused;
    vscode.commands.executeCommand('setContext', 'robotLiveTest.isActive', active);
    vscode.commands.executeCommand('setContext', 'robotLiveTest.isExecuting', executing);
    vscode.commands.executeCommand('setContext', 'robotLiveTest.isPaused', paused);

    if (active) {
        if (paused) {
            statusBarItem.text = '$(debug-pause) Live Session: PAUSED';
            statusBarItem.backgroundColor = new vscode.ThemeColor('statusBarItem.warningBackground');
        } else if (executing) {
            statusBarItem.text = '$(sync~spin) Live Session: EXECUTING';
            statusBarItem.backgroundColor = new vscode.ThemeColor('statusBarItem.prominentBackground');
        } else {
            statusBarItem.text = '$(radio-tower) Live Session: READY';
            statusBarItem.backgroundColor = undefined;
        }
        statusBarItem.show();
    } else {
        statusBarItem.hide();
    }
}

function cleanupSession() {
    isSessionActive = false;
    isExecuting = false;
    isPaused = false;
    updateContextKeys(false, false, false);
    executionQueue = [];
    executionHistoryBlocks = [];
    clearExecutionHighlight();
    clearTrailDecorations();
    if (clientSocket) {
        clientSocket.destroy();
        clientSocket = null;
    }
}

function getActiveTestCaseName(editor: vscode.TextEditor): string | null {
    let candidateName: string | null = null;

    for (let i = editor.selection.active.line; i >= 0; i--) {
        const text = editor.document.lineAt(i).text;
        if (/^\*\*\*/.test(text)) {
            if (/^\*\*\*\s*(Test Cases|Tasks)\s*\*\*\*/i.test(text)) {
                return candidateName;
            }
            return null;
        }
        if (!candidateName && /^[A-Za-z0-9_].+/.test(text) && !text.startsWith(' ') && !text.startsWith('\t')) {
            candidateName = text.trim();
        }
    }
    return null;
}

function getFullTestCaseLines(editor: vscode.TextEditor): { text: string, line: number }[] {
    let start = 0, end = editor.document.lineCount;
    for (let i = editor.selection.active.line; i >= 0; i--) {
        if (/^[A-Za-z0-9_].+/.test(editor.document.lineAt(i).text) && !editor.document.lineAt(i).text.startsWith(' ') && !editor.document.lineAt(i).text.startsWith('\t')) {
            start = i + 1; break;
        }
    }
    for (let i = start; i < editor.document.lineCount; i++) {
        if ((/^[A-Za-z0-9_].+/.test(editor.document.lineAt(i).text) && !editor.document.lineAt(i).text.startsWith(' ') && !editor.document.lineAt(i).text.startsWith('\t')) || /^\*\*\*/.test(editor.document.lineAt(i).text)) {
            end = i; break;
        }
    }
    const lines = [];
    for (let i = start; i < end; i++) {
        const text = editor.document.lineAt(i).text.trim();
        if (text && !text.startsWith('#') && !text.startsWith('[')) lines.push({ text, line: i });
    }
    return lines;
}

function getLinesFromCursorBelow(editor: vscode.TextEditor): { text: string, line: number }[] {
    let end = editor.document.lineCount;
    for (let i = editor.selection.active.line + 1; i < editor.document.lineCount; i++) {
        if ((/^[A-Za-z0-9_].+/.test(editor.document.lineAt(i).text) && !editor.document.lineAt(i).text.startsWith(' ') && !editor.document.lineAt(i).text.startsWith('\t')) || /^\*\*\*/.test(editor.document.lineAt(i).text)) {
            end = i; break;
        }
    }
    const lines = [];
    for (let i = editor.selection.active.line; i < end; i++) {
        const text = editor.document.lineAt(i).text.trim();
        if (text && !text.startsWith('#') && !text.startsWith('[')) lines.push({ text, line: i });
    }
    return lines;
}

function highlightExecutingLines(editor: vscode.TextEditor, lineNumbers: number[]) {
    const configColor = vscode.workspace.getConfiguration('robotLiveTest').get<string>('highlightColor', 'rgba(100, 150, 255, 0.3)');

    if (!executionDecorationType || currentHighlightColor !== configColor) {
        if (executionDecorationType) executionDecorationType.dispose();
        currentHighlightColor = configColor;
        executionDecorationType = vscode.window.createTextEditorDecorationType({
            backgroundColor: currentHighlightColor,
            isWholeLine: true,
            overviewRulerColor: new vscode.ThemeColor('editorOverviewRuler.infoForeground'),
            overviewRulerLane: vscode.OverviewRulerLane.Left
        });
    }
    currentExecutionRanges = lineNumbers.map(lineNum => editor.document.lineAt(lineNum).range);
    editor.setDecorations(executionDecorationType, currentExecutionRanges);
}

function clearExecutionHighlight() {
    if (executionDecorationType) {
        const decType = executionDecorationType;
        vscode.window.visibleTextEditors.forEach(editor => editor.setDecorations(decType, []));
    }
    currentExecutionRanges = [];
}

function createGutterDecoration(rgb: string, opacity: number): vscode.TextEditorDecorationType {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 12 16" preserveAspectRatio="none"><rect x="8" y="0" width="4" height="16" fill="rgba(${rgb}, ${opacity})"/></svg>`;
    const uri = vscode.Uri.parse(`data:image/svg+xml;utf8,${encodeURIComponent(svg)}`);
    return vscode.window.createTextEditorDecorationType({ gutterIconPath: uri, gutterIconSize: 'auto' });
}

function updateTrailDecorations(editor: vscode.TextEditor, length: number, rgb: string) {
    const newConfig = `${length}-${rgb}`;
    if (currentTrailConfig !== newConfig) {
        clearTrailDecorations();
        currentTrailConfig = newConfig;
        trailDecorations = [];
        for (let i = 0; i < length; i++) {
            const opacity = 1.0 - (i / length);
            trailDecorations.push(createGutterDecoration(rgb, opacity));
        }
    }
    for (let i = 0; i < length; i++) {
        if (trailDecorations[i] && trailRanges[i]) editor.setDecorations(trailDecorations[i], trailRanges[i]);
    }
}

function clearTrailDecorations() {
    if (trailDecorations.length > 0) {
        trailDecorations.forEach(dec => {
            vscode.window.visibleTextEditors.forEach(editor => editor.setDecorations(dec, []));
        });
    }
    trailRanges = [];
}
// Helper to extract settings.json and launch.json configurations for Robot Framework
function getRobotConfigArgs(resource: vscode.Uri): string {
    const liveConfig = vscode.workspace.getConfiguration('robotLiveTest', resource);
    const useWorkspace = liveConfig.get<boolean>('useWorkspaceSettings', true);
    const additionalArgs = liveConfig.get<string>('additionalArgs', '');
    let argsArray: string[] = [];

    if (useWorkspace) {
        // 2. Grab arguments from launch.json configurations
        const launchConfig = vscode.workspace.getConfiguration('launch', resource);
        const launchConfigs = launchConfig.get<any[]>('configurations', []);
        // Find the first Robot-related launch config that has args defined
        const robotLaunch = launchConfigs.find(c =>
            (c.type === 'robotcode' || c.type === 'robotframework-lsp' || (c.name && c.name.toLowerCase().includes('robot')))
            && c.args && c.args.length > 0
        );

        if (robotLaunch && robotLaunch.args) {
            for (const arg of robotLaunch.args) {
                argsArray.push(arg.includes(' ') ? `"${arg}"` : arg);
            }
        }

        // 1. Grab explicit custom settings from settings.json
        const config = vscode.workspace.getConfiguration(undefined, resource);
        const rcOutputDir = config.get<string>('robotcode.robot.outputDir');
        if (rcOutputDir) argsArray.push(`-d "${rcOutputDir}"`);

        const rcArgs = config.get<string[]>('robotcode.robot.args', []);
        const rcVars = config.get<Record<string, string>>('robotcode.robot.variables', {});
        const legArgs = config.get<string[]>('robot.args', []);
        const legVars = config.get<Record<string, string>>('robot.variables', {});

        for (const arg of [...legArgs, ...rcArgs]) argsArray.push(arg.includes(' ') ? `"${arg}"` : arg);
        for (const [key, value] of Object.entries({ ...legVars, ...rcVars })) argsArray.push(`-v "${key}:${value}"`);




    }

    // 3. Append any additional args specified in the Live Runner settings
    if (additionalArgs) argsArray.push(additionalArgs);

    return argsArray.length > 0 ? argsArray.join(' ') + ' ' : '';
}

export function deactivate() {
    cleanupSession();
}