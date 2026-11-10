import * as vscode from 'vscode';
import * as net from 'net';
export type lineData = {
 text: string;
 line: number;
 editor:vscode.TextEditor;
};

export interface CommandEntry {
    command: (...args: any[]) => any;
    icon?: string;
    requireRobotFile?: boolean;
    toolTip?:string
    requiresContext?:boolean; //if true pass in context
    isVisible?: (currentStatus: typeof status_defaults) => boolean;
}


export interface status_interface {
    isSessionActive:boolean;
    isPaused:boolean;
    isExecuting:boolean;
    executionQueue:any[];
    currentExecutingCommand: { commandText: string, originalLines: number[],editor:vscode.TextEditor } | null;
    executionHistoryBlocks: number[][];
    trailRanges: vscode.Range[][];
    liveTerminal: vscode.Terminal | null;
    clientSocket:net.Socket | null ;
    trailDecorations:vscode.TextEditorDecorationType[];
    executionDecorationType: vscode.TextEditorDecorationType | null;
    currentExecutionRanges:vscode.Range[];
    currentHighlightColor:string;
    currentTrailConfig:string;
    extensionPath:string|null;

}

export const status_defaults:status_interface = {
    isSessionActive:false,
    isPaused:false,
    isExecuting:false,
    executionQueue:[],
    currentExecutingCommand: null,
    executionHistoryBlocks:[],
    trailRanges:[],
    liveTerminal:null,
    clientSocket: null,
    trailDecorations:[],
    executionDecorationType:null,
    currentExecutionRanges:[],
    currentHighlightColor: '',
    currentTrailConfig: '',
    extensionPath:null
};
