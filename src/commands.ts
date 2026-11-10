import * as vscode from 'vscode';
import {GetSelectionTrueStart,GetStartOfAction,RemoveCommentsFromLine} from './editor_support';
import { sendExecutionBatch, status, } from './listener_interface';
import { ConnectToLiveTest,processQueue } from './listener_interface';
import { lineData,CommandEntry} from './dataTypes';
import { MSG } from './config';



// have isSessionActive be set by the connection and teardown status
async function StartLiveTest(context:vscode.ExtensionContext|null=null) {
    // focus on tab so you can see stuff.
    await vscode.commands.executeCommand('workbench.view.extension.robot-live-test-panel')
    .then(()=>{
        ConnectToLiveTest(context)
        .catch((message)=>{return vscode.window.showErrorMessage(`start live test failed. ${message}`);});
    });


}
function StopLiveTest() { status.isSessionActive = false; return vscode.window.showWarningMessage('Live testing session has been terminated');}

function RunFullTest() {
    const data = GetCodeToRun(true);
    if (data) {sendExecutionBatch(data);}
}

function RunBelow() {
    const data = GetCodeToRun(false);
    if (data) {sendExecutionBatch(data);}
}

function GetCodeToRun(getAll:boolean=false){

    const editor = vscode.window.activeTextEditor;

    if (!editor) {vscode.window.showInformationMessage(MSG.error.editorNotFocused);return;}
    //move up if needed
    const runSection = getAll ? GetStartOfAction(editor) : GetSelectionTrueStart(editor);
    // inform user of change
    if (!getAll && runSection<editor.selection.start.line){

        vscode.window.showInformationMessage(`run started on '...' starting on ${runSection} instead of ${editor.selection.start.line}.`);
    }

    const lines: lineData[]  = [];
    for (let i = runSection; i < editor.document.lineCount; i++) {
        if (
            (
                /^[A-Za-z0-9_].+/.test(editor.document.lineAt(i).text) &&
                !editor.document.lineAt(i).text.startsWith(' ') &&
                !editor.document.lineAt(i).text.startsWith('\t')
            ) || /^\*\*\*/.test(editor.document.lineAt(i).text)
        ) {
            break;
        }
        const text = editor.document.lineAt(i).text.trim();
        // normal stuff
        if (text && !text.startsWith('#') && !text.startsWith('[')){
                lines.push({ "text":RemoveCommentsFromLine(text), line: i,editor});
            }
        // only let setup and teardown pass.
        else if (text && text.startsWith('[') && (/^(setup|teardown)/.test(text.toLowerCase()))){
            lines.push({ "text":RemoveCommentsFromLine(text), line: i,editor});
        }

    }

    // nothing to do
    if (lines.length===0) {vscode.window.showInformationMessage(MSG.error.nothingToRun); return;}

    return lines;
}


function PauseExecution() {
    status.isPaused=true;
    return vscode.window.showWarningMessage(MSG.status.action.paused);
}
function ResumeExecution() {
    status.isPaused=false;
    vscode.window.showInformationMessage(MSG.status.action.resume);
    processQueue();
    }

function StopCurrentQueue() {status.isExecuting=false; console.table(status); return vscode.window.showWarningMessage('stop current queue ran.');}

function RunSelectedLines() {
    const editor = vscode.window.activeTextEditor;
    if (!editor) {return;}
    const doc = editor.document;
    const selection = editor.selection;

    /**
     * Returns True if there is code that can be ran within the selected section
     * False if not.
     */
    function DoesSelectionHaveCode() {
        for (let i = selection.start.line; i <= selection.end.line; i++) {
            const t = doc.lineAt(i).text.trim();
            if (t !== '' && !t.startsWith('#')) {
                return true;
            }
        }
        return false;
    }
    /**
     * Processes the command if it is multi line and returns the entire thing.
     * Ignores commented segments in the middle of your command just like robot framework.
     *
     * @param text Text of the current line.
     * @returns the entire command multi line or not.
     */
    function GetEntireCommand(text: string) {
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
            } else{ break;}
        }
        return fullCommand;
    }
    function GetBlockDepth(fullCommand: string) {

        const upper = fullCommand.toUpperCase();
        const parts = fullCommand.split(/\s{2,}|\t/).filter(p => p.length > 0);

        // TODO does the assess groups: yes - fixed
        if (upper.startsWith('FOR ') || upper.startsWith('WHILE ') || upper.startsWith('GROUP ') || upper === 'TRY') {
            blockDepth++;
        } else if (upper.startsWith('IF ')) {
            let isInline = parts.length > 2 && !parts[2].startsWith('#');
            if (!isInline) {blockDepth++;}
        } else if (upper === 'END') {
            blockDepth--;
        }
        return blockDepth;
    }
    function ExitSelection(currentLineNum: number) {
        let nextLineNum = currentLineNum + 1;
        let hasContinuation = false;
        while (nextLineNum < doc.lineCount) {
            const nextText = doc.lineAt(nextLineNum).text.trim();
            if (nextText.startsWith('#') || nextText === '') {nextLineNum++;}
            else if (nextText.startsWith('...')) {
                hasContinuation = true;
                break;
            } else {break;}
        }
        if (!hasContinuation) {return true;}
        return false;
    }

    /** This is the depth of the command. allows for dealing with groups, ifs, whiles, try and for loops */
    let blockDepth = 0;

    // Check to see if there is anything to run.
    if (!DoesSelectionHaveCode()) {
        return vscode.window.showWarningMessage(MSG.error.nothingToRun);
    }
    let currentLineNum = GetSelectionTrueStart(editor);
    let lines: lineData[] = [];
    // Loop until `ExitSelection` finishes or i reach the end of the file.
    while (currentLineNum < doc.lineCount) {
        const text = doc.lineAt(currentLineNum).text.trim();

        // if its a comment, skip
        if ((text.startsWith('#') || text === '') && currentLineNum < selection.end.line) {
            currentLineNum++;
            continue;
        }

        if (!text.startsWith('...')) {
            // Peek ahead to stitch continuations for accurate block detection
            let fullCommand = GetEntireCommand(text);
            blockDepth = GetBlockDepth(fullCommand);
        }
        //Add the lines
        lines.push({ "text":RemoveCommentsFromLine(text), line: currentLineNum, editor});

        // check if we are done.
        if (
            currentLineNum >= selection.end.line &&
            blockDepth <= 0 &&
            lines.length > 0 &&
            ExitSelection(currentLineNum)
        ) {
            break;
        }
        currentLineNum++;
    }
    if (lines.length === 0) {return vscode.window.showWarningMessage(MSG.error.nothingToRun);}
    sendExecutionBatch(lines);
}



/**
 * This is the list of commands and the config for each.
 * To add more commands ensure that they are defined in [package.json](../package.json).
 * Adjust the order here for what order they will render in.
 * See `CommandEntry` for how to setup
 */
export const commandsMap: Record<string, CommandEntry> = {
    'robotLiveTest.StartLiveTest': {
        command: StartLiveTest,
        requireRobotFile:true,
        requiresContext:true,
        isVisible: (s) => !s.isSessionActive
    },
    'robotLiveTest.runSelected': {
        command: RunSelectedLines,
        toolTip:"Runs the selected lines, press ",
        isVisible: (s) => s.isSessionActive && !s.isExecuting
    },
    'robotLiveTest.PauseExecution': {
        command: PauseExecution,
        isVisible: (s) => s.isExecuting && !s.isPaused
    },
    'robotLiveTest.RunBelow': {
        command: RunBelow,
        isVisible: (s) => s.isSessionActive
    },
    'robotLiveTest.RunFullTest': {
        command: RunFullTest,
        isVisible: (s) => s.isSessionActive && !s.isExecuting
    },
    'robotLiveTest.ResumeExecution': {
        command: ResumeExecution,
        isVisible: (s) => s.isExecuting && s.isPaused
    },
    'robotLiveTest.StopLiveTest': {
        command: StopLiveTest,
        isVisible: (s) => s.isSessionActive
    },
    'robotLiveTest.StopCurrentQueue': {
        command: StopCurrentQueue,
        isVisible: (s) => s.isExecuting
    }
};