import * as vscode from 'vscode';
import { commandsMap} from './commands';
import {status} from './listener_interface';

export class CommandTreeDataProvider implements vscode.TreeDataProvider<vscode.TreeItem> {
    private _onDidChangeTreeData = new vscode.EventEmitter<vscode.TreeItem | undefined | void>();
    readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

    private isRobotFileOpen = false;

    constructor(private context: vscode.ExtensionContext) {
        this.checkActiveEditor(vscode.window.activeTextEditor);
    }

    refresh(): void {
        this._onDidChangeTreeData.fire();
    }

    // ADDED: Prevents unnecessary refreshes on non-robot file tab switching
    public checkActiveEditor(editor: vscode.TextEditor | undefined) {
        // if robot or resource file, than allow updates
        const isRobot = !!editor?.document.fileName.toLowerCase().endsWith('.robot');
        const isResource = !!editor?.document.fileName.toLowerCase().endsWith('.resource');

        if (this.isRobotFileOpen !== (isRobot || isResource)){
            this.isRobotFileOpen = (isRobot || isResource);
            this.refresh();
        }
    }

    getTreeItem(element: vscode.TreeItem): vscode.TreeItem {
        return element;
    }

    getChildren(element?: vscode.TreeItem): Thenable<vscode.TreeItem[]> {
        if (element){ return Promise.resolve([]);} // No nested elements

        const pkgCommands: any[] = this.context.extension.packageJSON.contributes?.commands || [];

        const treeItems = Object.entries(commandsMap)
            // is current state correct for this to be displayed
            .filter(([_, details]) =>
                !(details.requireRobotFile && !this.isRobotFileOpen) &&
                !(details.isVisible && !details.isVisible(status))
            )
            // finally map each item (with a valid view state) to a tree item
            .map(([commandId,command_data]) => {
                const pkgCmd = pkgCommands.find(c => c.command === commandId);
                const item = new vscode.TreeItem(pkgCmd.title, vscode.TreeItemCollapsibleState.None);

                item.command = { command: commandId, title: pkgCmd.title };
                item.contextValue = `${commandId}_active:${status.isSessionActive}_exec:${status.isExecuting}_paused:${status.isPaused}`;
                // set the tool tip in the commandsMap. its optional else use blank.
                item.tooltip = command_data?.toolTip || "";
                if (command_data?.requiresContext || false){item.command.arguments = [this.context];}

                // 3. Extract the icon straight from package.json (e.g. "$(play)")
                if (pkgCmd.icon?.startsWith('$(')) {
                    item.iconPath = new vscode.ThemeIcon(pkgCmd.icon.slice(2, -1));
                }

                return item;
            });
        // console.log(status);
        return Promise.resolve(treeItems);
    }
}

export class HistoryTreeProvider implements vscode.TreeDataProvider<vscode.TreeItem> {
    // 1. Create an event emitter so VS Code knows when to refresh the UI
    private _onDidChangeTreeData: vscode.EventEmitter<vscode.TreeItem | undefined | void> = new vscode.EventEmitter<vscode.TreeItem | undefined | void>();
    readonly onDidChangeTreeData: vscode.Event<vscode.TreeItem | undefined | void> = this._onDidChangeTreeData.event;

    // 2. Store the history (maximum 20)
    private historyQueue: any[] = [];
    public clear(){
        this.historyQueue = [];
        this._onDidChangeTreeData.fire();
    }

    public addHistoryItem(commandData: any) {
        // Add to the top of the list

        // console.log(commandData.originalLines[0], 0, endLine, 0)
        const edge = commandData.originalLines.length-1;
        if (commandData.originalLines[0]===commandData.originalLines[edge] && commandData.originalLines[edge] === 0){
                return;
        }

        this.historyQueue.unshift(commandData);

        // Enforce the 20-item limit
        if (this.historyQueue.length > 20) {
            this.historyQueue.pop(); // Remove the oldest at the bottom
        }

        // Trigger a UI refresh
        this._onDidChangeTreeData.fire();
    }

    getTreeItem(element: vscode.TreeItem): vscode.TreeItem {
        return element;
    }

    getChildren(): Thenable<vscode.TreeItem[]> {
        const treeItems = this.historyQueue.map((cmd) => {
            // Assuming originalLines is 1-indexed (e.g. [6, 7, 8])
            // VS Code ranges are 0-indexed, so we subtract 1
            const startLine = cmd.originalLines[0];
            const endLine = cmd.originalLines[cmd.originalLines.length - 1];


            const range = new vscode.Range(startLine, 0, endLine, 0);

            // Format multiline commands so they fit nicely in the sidebar
            const lines = cmd.commandText.split('\n');
            const displayLabel = lines.length > 1 ? `${lines[0]} ...` : lines[0];

            const item = new vscode.TreeItem(displayLabel.trim());
            item.description = `Line ${cmd.originalLines[0]}`;
            item.tooltip = cmd.commandText; // Show full multiline command on hover
            item.contextValue = 'historyItem';

            // Attach the navigation command
            item.command = {
                command: 'robotLiveTest.gotoHistory',
                title: 'Go To Source',
                arguments: [cmd.editor.document.uri, range]
            };

            return item;
        });

        return Promise.resolve(treeItems);
    }
}
