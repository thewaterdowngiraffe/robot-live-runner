import * as vscode from 'vscode';
import { commandsMap} from './commands';
import { statusUpdateEmitter,status ,historyProvider,sendExecutionBatch} from './listener_interface';
import { CommandTreeDataProvider } from './sidebar';
import { importsTreeProvider_obj, ImportNode } from './ImportsTreeProvider';
import { MSG } from './config';

export function activate(context: vscode.ExtensionContext) {
    for (const [commandId, commandFunc] of Object.entries(commandsMap)) {
        const disposable = vscode.commands.registerCommand(commandId, commandFunc.command);
        context.subscriptions.push(disposable);
    }

    status.extensionPath=context.extensionPath;

    const treeDataProvider = new CommandTreeDataProvider(context);
    vscode.window.registerTreeDataProvider('robotLiveTest.controlsView', treeDataProvider);


    context.subscriptions.push(
    vscode.commands.registerCommand('robotLiveTest.gotoHistory', async (uri: vscode.Uri, range: vscode.Range) => {
        const doc = await vscode.workspace.openTextDocument(uri);
        const editor = await vscode.window.showTextDocument(doc, { preview: true });

        // Highlight the lines and scroll them into the center of the view
        editor.selection = new vscode.Selection(range.start, range.end);
        editor.revealRange(range, vscode.TextEditorRevealType.InCenter);
    }));
    vscode.window.registerTreeDataProvider('robotLiveTest.historyView', historyProvider);
    context.subscriptions.push(
        vscode.window.onDidChangeActiveTextEditor(() => {
            treeDataProvider.checkActiveEditor(vscode.window.activeTextEditor);
        }),

        // ADDED: Listen for Proxy updates to refresh the UI automatically
        statusUpdateEmitter.event(() => {
            treeDataProvider.refresh();
        })
    );

    context.subscriptions.push(vscode.window.onDidEndTerminalShellExecution((event) => {
            if (status.liveTerminal !== null && event.terminal===status.liveTerminal ){
                if(status.isSessionActive){vscode.window.showErrorMessage(MSG.error.terminalClosed);}
                status.isSessionActive=false;
                status.liveTerminal=null;
            }
    }));

    context.subscriptions.push(vscode.window.onDidCloseTerminal((closedTerminal) => {
            if (status.liveTerminal !== null && closedTerminal===status.liveTerminal){
                // inform user
                vscode.window.showErrorMessage(MSG.error.terminalClosed);
                // update status'
                status.isSessionActive=false;
                status.liveTerminal=null;
            }
    }));



    vscode.window.registerTreeDataProvider('robotLiveTest.ImportsView', importsTreeProvider_obj);
    // This is the reimport button
    const reimportCommand = vscode.commands.registerCommand('robotLiveTest.reimport', (node: ImportNode) => {
        if (!node.fullPath) { return; }
        let robotKeyword = '';
        if (node.itemType === 'resource') {
            robotKeyword = `Import Resource    \${EXECDIR}/${node.fullPath}`;
        } else if (node.itemType === 'variable') {
            robotKeyword = `Import Variables    \${EXECDIR}/${node.fullPath}`;
        }

        // Just use what is active, for if there is an error, if not, user can check the terminal and debug.
        const activeEditor = vscode.window.activeTextEditor as vscode.TextEditor;

        // prep command to be sent
        const batchItem = {
            text: robotKeyword,
            line: 0,
            editor: activeEditor
        };

        // execute the new command.
        sendExecutionBatch([batchItem]);
        vscode.window.showInformationMessage(`Re-importing ${node.label}...`);
    });

    context.subscriptions.push(reimportCommand);
}
export function deactivate(){status.isSessionActive=false;}