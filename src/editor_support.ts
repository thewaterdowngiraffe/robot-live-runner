import * as vscode from 'vscode';
import * as fs from 'fs';
/**
 * Returns the starting line of the selected code. will move up though the code if the top of
 * the selected code has ... indicating that function is above.
 */
export function GetSelectionTrueStart(editor:vscode.TextEditor,startLineNum:number = editor.selection.start.line) {
    while (startLineNum > 0) {
        const text = editor.document.lineAt(startLineNum).text.trim();
        if (text.startsWith('...')) {startLineNum--;}
        else {return startLineNum;}
    }
    return startLineNum;
}

/**
 * this will get the start of the keyword or test case and return the line number.
 * @param editor the active vscode editor
 * @returns the starting index of the test
 */
export function GetStartOfAction(
    editor:vscode.TextEditor,
    cursorLine:number=editor.selection.active.line
){
    for (let i = cursorLine; i >= 0; i--) {
        if (/^[A-Za-z0-9_].+/.test(editor.document.lineAt(i).text) && !editor.document.lineAt(i).text.startsWith(' ') && !editor.document.lineAt(i).text.startsWith('\t')) {
           return i + 1;
        }
    }
    return 0;
}

export const RemoveCommentsFromLine = (text:string):string => {
    if(text.startsWith('[') && ( text.toLowerCase().startsWith('[setup]') || text.toLowerCase().startsWith('[teardown]'))){
        const modifiedText=text.replace(/\[(?:[Ss]etup|[Tt]eardown)\](?:\t+|\s{2,})/,"");
        vscode.window.showInformationMessage(`modified "${text}" -> "${modifiedText}"`);
        text = modifiedText;
    }
    return text.split(/(?:\s{2,}|\t)#/)[0];
};

export function getActiveTestCaseName(editor: vscode.TextEditor): string | null {
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


export async function resolvePythonPath(resource: vscode.Uri): Promise<string> {
    try {
        const pyExt = vscode.extensions.getExtension('ms-python.python');
        if (pyExt) {
            if (!pyExt.isActive){ await pyExt.activate();}
            const envPath = await pyExt.exports?.environments?.getActiveEnvironmentPath(resource);
            if (envPath?.path && fs.existsSync(envPath.path)) {return envPath.path;}
        }
    } catch (_) {}
    return 'python';
}
