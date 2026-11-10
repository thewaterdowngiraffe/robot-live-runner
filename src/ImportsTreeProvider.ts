import * as vscode from 'vscode';

export class ImportNode extends vscode.TreeItem {
    constructor(
        public readonly label: string,
        public readonly collapsibleState: vscode.TreeItemCollapsibleState,
        public readonly itemType: 'folder' | 'resource' | 'variable',
        public readonly fullPath?: string
    ) {
        super(label, collapsibleState);
        // 'file' contextValue triggers the inline button in package.json
        this.contextValue = this.itemType === 'folder' ? 'folder' : 'file';

        if (this.itemType === 'folder') {
            this.iconPath = new vscode.ThemeIcon('folder');
        } else if (this.itemType === 'resource') {
            this.iconPath = new vscode.ThemeIcon('symbol-namespace');
        } else {
            this.iconPath = new vscode.ThemeIcon('symbol-variable');
        }
    }
}

export class ImportsTreeProvider implements vscode.TreeDataProvider<ImportNode> {
    private _onDidChangeTreeData: vscode.EventEmitter<ImportNode | undefined | void> = new vscode.EventEmitter<ImportNode | undefined | void>();
    readonly onDidChangeTreeData: vscode.Event<ImportNode | undefined | void> = this._onDidChangeTreeData.event;

    // Stores the parsed tree hierarchy
    private treeData: any = {};

    refresh(importsDict: Record<string, string>): void {
        this.treeData = this.buildTree(importsDict);
        this._onDidChangeTreeData.fire();
    }
    public clear(){this.refresh({});}

    private buildTree(importsDict: Record<string, string>) {
        const root: any = {};
        for (const [filePath, type] of Object.entries(importsDict)) {
            const parts = filePath.split('/');
            let current = root;

            for (let i = 0; i < parts.length; i++) {
                const part = parts[i];
                const isFile = i === parts.length - 1;

                if (!current[part]) {
                    current[part] = isFile ? { _type: type, _fullPath: filePath } : {};
                }
                current = current[part];
            }
        }
        return root;
    }

    getTreeItem(element: ImportNode): vscode.TreeItem {
        return element;
    }

    getChildren(element?: ImportNode): Thenable<ImportNode[]> {
        if (!this.treeData) {
            return Promise.resolve([]);
        }

        // If no element is passed, we are at the root
        let targetNode = this.treeData;

        // If an element is passed, navigate to its children
        if (element && element.fullPath) {
            const parts = element.fullPath.split('/');
            for (const part of parts) {
                targetNode = targetNode[part];
            }
        }

        const children: ImportNode[] = [];
        for (const key of Object.keys(targetNode)) {
            if (key.startsWith('_')) { continue; } // Skip metadata keys

            const nodeData = targetNode[key];
            const isFile = nodeData._type !== undefined;

            if (isFile) {
                children.push(new ImportNode(
                    key,
                    vscode.TreeItemCollapsibleState.None,
                    nodeData._type,
                    nodeData._fullPath
                ));
            } else {
                // To track folder paths, reconstruct the path up to this point
                const folderPath = element ? `${element.fullPath}/${key}` : key;
                children.push(new ImportNode(
                    key,
                    vscode.TreeItemCollapsibleState.Collapsed,
                    'folder',
                    folderPath
                ));
            }
        }

        // Sort folders first, then alphabetically
        children.sort((a, b) => {
            if (a.itemType === 'folder' && b.itemType !== 'folder') { return -1; }
            if (a.itemType !== 'folder' && b.itemType === 'folder') { return 1; }
            return a.label.localeCompare(b.label);
        });

        return Promise.resolve(children);
    }
}

export const importsTreeProvider_obj = new ImportsTreeProvider();