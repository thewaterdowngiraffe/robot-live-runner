import * as vscode from 'vscode';
import * as net from 'net';
import * as path from 'path';
import {MSG} from './config';
import { lineData,status_defaults} from './dataTypes';

import { HistoryTreeProvider } from './sidebar';
import { getActiveTestCaseName, resolvePythonPath } from './editor_support';
import {importsTreeProvider_obj} from './ImportsTreeProvider';
import {highlightExecutingLines,updateTrailDecorations,clearExecutionHighlight,clearTrailDecorations,liveTestDiagnostics,errorDecorationType} from './editor_markup';
export const statusUpdateEmitter = new vscode.EventEmitter<void>();

export function sendExecutionBatch(lines: { text: string, line: number,editor:vscode.TextEditor }[]) {
    if (!status.clientSocket || !status.isSessionActive) {
        return vscode.window.showErrorMessage('No active live session.');
    }
    /**
     * this will remove any and all continuations that don't have a keyword or action assigned.
     * @param lines the lines to be cleaned up.
     * @returns the cleaned lines without breaking data at the start.
     */
    function removeContinuationsWithoutKeywords(lines:lineData[]){
        var newLines:lineData[] = [];
        for(const line of lines){
            if(newLines.length===0 && line.text.trim().startsWith("...")){ continue;}
            newLines.push(line);
        }
        return newLines;
    }


    lines = removeContinuationsWithoutKeywords(lines);


    let currentCommand: { commandText: string, originalLines: number[],editor:vscode.TextEditor } | null = null;
    let blockDepth = 0;

    // add the current command to the queue.
    const flush = () => {
        if (currentCommand) {
            status.executionQueue.push(currentCommand);
            currentCommand = null;
        }
    };

    // merge blocks into the current command. (blocks and stuff will get added as one command).
    const append = (item: { text: string, line: number,editor:vscode.TextEditor }, isContinuation: boolean) => {
        if (!currentCommand) {
            currentCommand = { commandText: item.text, originalLines: [item.line],editor:item.editor };
            return;
        }

        // At root level, continuations are stitched inline. Inside blocks, they are new indented lines.
        const appendText = (blockDepth === 0 && isContinuation)
            ? '    ' + item.text.trim().substring(3).trim()
            : '\n    ' + item.text.trim();

        currentCommand.commandText += appendText;
        currentCommand.originalLines.push(item.line);
    };

    for (let i = 0; i < lines.length; i++) {
        const item = lines[i];
        const trimmed = item.text.trim();
        const upper = trimmed.toUpperCase();
        const isCont = trimmed.startsWith('...');   // continuation

        let isBlockStart = false;
        let isBlockEnd = false;

        if (!isCont) {
            const parts = upper.split(/\s{2,}|\t/).filter(p => p.length > 0);

            if (/^(FOR|WHILE|TRY|GROUP)\b/.test(upper) || (/^(IF)\b/.test(upper) && parts.length <= 2)) {
                isBlockStart = true;
            } else if (upper === 'END') {
                isBlockEnd = true;
            }
        }

        // Apply state logic
        if (isBlockStart) {
            if (blockDepth === 0) {flush();} // Start of a brand new root block
            append(item, isCont);
            blockDepth++;
        }
        else if (isBlockEnd) {
            if (blockDepth === 0) {flush();} // Handle a stray END safely
            append(item, isCont);

            if (blockDepth > 0) {
                blockDepth--;
                if (blockDepth === 0) {flush();} // End of root block, send it!
            }
        }
        else {
            // Standard keywords and continuations
            if (blockDepth === 0 && !isCont) {flush();} // Start new root command
            append(item, isCont);
        }
    }

    flush();
    // console.table(status.executionQueue);
    if (!status.isExecuting && !status.isPaused) {
        processQueue();
    }
}





export const historyProvider = new HistoryTreeProvider();
/**
 * This is the main event, queue and runner statuses are set here.
 */

// TODO rename status -> listener_connection
export const status = new Proxy(status_defaults, {
  set(target, prop, value) {
    // console.table([target, prop, value]);
    // cant be paused if not executing (set isPaused to false)
    if (prop === 'isExecuting') {
        if (value === false){
            target.isPaused=false;
            target.executionQueue = [];
            clearExecutionHighlight();
        }
      vscode.commands.executeCommand('setContext', 'robotLiveTest.isExecuting', value);
    }
    else if (prop === 'currentExecutingCommand'){ //&& status.isExecuting === false){
        // new command coming in, while not executing: means execution is about to start so clear markups
        if (!status.isExecuting && target.currentExecutingCommand !== null){
            if(target.currentExecutingCommand.editor!==null){
                target.currentExecutingCommand.editor.setDecorations(errorDecorationType, []);
            }
            liveTestDiagnostics.clear();
        }
        if (value!==null){
            historyProvider.addHistoryItem(value);
        }
    }

    else if (prop === 'isSessionActive' && target.isSessionActive !== value){
        target.isExecuting=false;
        if (value === false) {
            clearTrailDecorations();
            historyProvider.clear();
            importsTreeProvider_obj.clear();
            clearExecutionHighlight();

            target.executionHistoryBlocks = [];
            //kill client if you kill session.
            if (target.clientSocket){
                target.clientSocket.destroy();
                target.clientSocket = null;
            }
        }
        vscode.commands.executeCommand('setContext', 'robotLiveTest.isActive', value);
    }
    // if session is active than executing and paused must be false
    else if (prop ==='isPaused' && target.isPaused !== value) {
        vscode.commands.executeCommand('setContext', 'robotLiveTest.isPaused', status.isPaused);
    }


    const result = Reflect.set(target, prop, value);
    statusUpdateEmitter.fire();
    return result;
  }

});




// TODO create a function that generates the launch arg
export async function ConnectToLiveTest(context:vscode.ExtensionContext|null=null){
    if(context===null || !context){return vscode.window.showWarningMessage("Focus a .robot file.");}
    if(status.extensionPath===null){return vscode.window.showWarningMessage("Extension error, missing path to extension. Please report a bug.");}
    if(status.isSessionActive){return vscode.window.showErrorMessage("Session is already live.");}

    const editor = vscode.window.activeTextEditor;
    if (!editor || !editor.document.fileName.endsWith('.robot')) {return vscode.window.showErrorMessage('Focus a .robot file.');}
    const filePath = editor.document.fileName;


    const listenerPath = path.join(status.extensionPath, 'python', 'live_listener.py');
    const testName = getActiveTestCaseName(editor);
    const wsFolder = vscode.workspace.getWorkspaceFolder(editor.document.uri);
    const cwd = wsFolder ? wsFolder.uri.fsPath : path.dirname(filePath);
    const pythonPath = await resolvePythonPath(editor.document.uri);





    // if no terminal in this state, check if one exists, if so, than use it, else, create one.
    // BUG if terminal is new and python extension is used, occasionally, the virtual env is not activated before running.
    // TODO see if i can hook into vscode's python envs extension.
    if (status.liveTerminal===null) {
        const myTerminal = vscode.window.terminals.find(t => t.name === "Robot Live Runner");
        // if i can find one than reuse it, else, create new one
        status.liveTerminal = myTerminal ? myTerminal : vscode.window.createTerminal({ name: 'Robot Live Runner', cwd: cwd });
        //set is as main view
        status.liveTerminal.show();
    }


    const isWin = process.platform === 'win32';
    const shellPath = (vscode.env.shell || '').toLowerCase();
    const callPrefix = isWin && !shellPath.endsWith('cmd.exe') ? '& ' : '';
    const testFilter = testName ? `-t "${testName}"` : '';

    const configArgs = getRobotConfigArgs(editor.document.uri);
    const cmd = `${callPrefix}"${pythonPath}" -m robot --listener "${listenerPath}:8765" ${configArgs}${testFilter} "${filePath}"`;

    status.liveTerminal.sendText(cmd);
    await vscode.window.withProgress({
        location: vscode.ProgressLocation.Notification,
        title: "Starting Live Session",
        cancellable: false
    }, async (progress) => {
        await connectToRunnerSocket(progress);
    });
}



function connectToRunnerSocket(
    progress: vscode.Progress<{ message?: string; increment?: number }>,
    retries = 15
): Promise<void> {
    return new Promise((resolve) => {
        progress.report({ message: `${String.fromCodePoint((128359 - retries % 12))} Connecting to socket... (${retries} attempts left)` });
        status.clientSocket = new net.Socket();
        // NOTE port and ip set here
        status.clientSocket.connect(8765, '127.0.0.1', () => {
            status.isSessionActive = true;
            progress.report({ message: MSG.connection.success });
            const payload = JSON.stringify({ command: "GET_IMPORTS" });
            status.clientSocket?.write(payload + '\n');
            setTimeout(() => resolve(), 1500);
        });


        let socketBuffer = '';


        // NOTE: THIS Is what keeps calling the processQueue. it runs one thing, than calls itself again and again until empty
        status.clientSocket.on('data', (data) => {
            socketBuffer += data.toString('utf8');

            let newlineIndex: number;
            while ((newlineIndex = socketBuffer.indexOf('\n')) !== -1) {
                const line = socketBuffer.slice(0, newlineIndex).trim();
                socketBuffer = socketBuffer.slice(newlineIndex + 1);

                if (!line) {continue;}
                try {
                    const msg = JSON.parse(line);
                    if (msg.status === "IMPORTS_LIST") {
                        // Pass the dictionary to the tree provider to render
                        importsTreeProvider_obj.refresh(msg.imports);
                    }
                    else if (msg.status === 'EXECUTING_DONE') {

                        processQueue();
                    } else if (msg.status === 'ERROR') {
                        vscode.window.showErrorMessage(`Robot Failed: ${msg.error}`);
                        status.isExecuting = false;
                        // console.table(status.currentExecutingCommand)

                        if (status.currentExecutingCommand && status.currentExecutingCommand?.originalLines.length > 0) {
                            const lines = status.currentExecutingCommand.originalLines;
                            const executingEditor = status.currentExecutingCommand.editor;

                            // Create a range covering the entire failed block
                            if (executingEditor && lines[0] >= 0) {
                                const range = new vscode.Range(lines[0], 0, lines[lines.length - 1], Number.MAX_VALUE);
                                // 1. Set Diagnostic (Hover & Problems Panel)
                                const diagnostic = new vscode.Diagnostic(
                                    range,
                                    `Exception has occurred: ${msg.error}`,
                                    vscode.DiagnosticSeverity.Error
                                );
                                liveTestDiagnostics.set(executingEditor.document.uri, [diagnostic]);

                                // 2. Set Inline Decoration (Visual red block and injected text)
                                executingEditor.setDecorations(errorDecorationType, [{
                                    range: range,
                                    renderOptions: {
                                        after: {
                                            contentText: ` ◀ Exception has occurred: ${msg.error}`
                                        }
                                    }
                                }]);
                            }
                        }

                    }
                } catch (e) {}
            }
        });
        status.clientSocket.on('error', () => {
            if (!status.isSessionActive && retries > 0) {
                status.clientSocket?.destroy();
                setTimeout(() => connectToRunnerSocket(progress, retries - 1).then(resolve), 1000);
            } else {
                if (!status.isSessionActive) {
                    progress.report({ message: MSG.connection.failed });
                    setTimeout(() => resolve(), 2500);
                }
            }
        });
        status.clientSocket.on('close', () => status.isSessionActive=false);
    });
}

export function processQueue() {
    if (status.isPaused) {return;}
    if (status.executionQueue.length === 0) {
        status.isExecuting = false;
        return;
    }
    status.currentExecutingCommand = status.executionQueue.shift() || null;
    status.isExecuting = true;
    if (status.currentExecutingCommand) {
        const editor = vscode.window.activeTextEditor;
        if (editor) {
            // Highlight the actively executing line
            highlightExecutingLines(editor, status.currentExecutingCommand.originalLines);
            status.executionHistoryBlocks.push(status.currentExecutingCommand.originalLines);
            const config = vscode.workspace.getConfiguration('robotLiveTest');
            /** how many lines. */
            const trailLength = config.get<number>('trailLength', 3);
            const lastBlocks = status.executionHistoryBlocks.slice(-trailLength).reverse();
            status.trailRanges = [];
            for (let i = 0; i < trailLength; i++) {
                if (lastBlocks.length > i) {
                    const ranges = lastBlocks[i]
                        .filter(row => row < editor.document.lineCount)
                        .map(row => editor.document.lineAt(row).range);
                    status.trailRanges.push(ranges);
                } else {
                    status.trailRanges.push([]);
                }
            }
            updateTrailDecorations(editor, trailLength, config.get<string>('trailBaseColor', '76, 175, 80'));
        }
        sendCommand({ command: 'EXECUTE', lines: [status.currentExecutingCommand.commandText] });
    }
}



function sendCommand(payload: object) {
    if (status.clientSocket && !status.clientSocket.destroyed) {status.clientSocket.write(JSON.stringify(payload) + '\n');}
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
        if (rcOutputDir) {argsArray.push(`-d "${rcOutputDir}"`);}

        const rcArgs = config.get<string[]>('robotcode.robot.args', []);
        const rcVars = config.get<Record<string, string>>('robotcode.robot.variables', {});
        const legArgs = config.get<string[]>('robot.args', []);
        const legVars = config.get<Record<string, string>>('robot.variables', {});

        for (const arg of [...legArgs, ...rcArgs]) { argsArray.push(arg.includes(' ') ? `"${arg}"` : arg);};
        for (const [key, value] of Object.entries({ ...legVars, ...rcVars })) {argsArray.push(`-v "${key}:${value}"`);}
    }

    // 3. Append any additional args specified in the Live Runner settings
    if (additionalArgs) {argsArray.push(additionalArgs);}
    return argsArray.length > 0 ? argsArray.join(' ') + ' ' : '';
}