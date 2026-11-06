
import * as vscode from 'vscode';
import {status} from './listener_interface';

export function highlightExecutingLines(editor: vscode.TextEditor, lineNumbers: number[]) {
    const configColor = vscode.workspace.getConfiguration('robotLiveTest').get<string>('highlightColor', 'rgba(100, 150, 255, 0.3)');

    if (!status.executionDecorationType || status.currentHighlightColor !== configColor) {
        if (status.executionDecorationType) {status.executionDecorationType.dispose();}
        status.currentHighlightColor = configColor;
        status.executionDecorationType = vscode.window.createTextEditorDecorationType({
            backgroundColor: status.currentHighlightColor,
            isWholeLine: true,
            overviewRulerColor: new vscode.ThemeColor('editorOverviewRuler.infoForeground'),
            overviewRulerLane: vscode.OverviewRulerLane.Left
        });
    }
    status.currentExecutionRanges = lineNumbers
        .filter(lineNum => lineNum < editor.document.lineCount)
        .map(lineNum => editor.document.lineAt(lineNum).range);
    editor.setDecorations(status.executionDecorationType, status.currentExecutionRanges);
}

export function updateTrailDecorations(editor: vscode.TextEditor, length: number, rgb: string) {
    const newConfig = `${length}-${rgb}`;
    if (status.currentTrailConfig !== newConfig) {
        clearTrailDecorations();
        status.currentTrailConfig = newConfig;
        status.trailDecorations = [];
        for (let i = 0; i < length; i++) {
            const opacity = 1.5 - (i / length);
            status.trailDecorations.push(createGutterDecoration(rgb, opacity));
        }
    }
    for (let i = 0; i < length; i++) {
        if (status.trailDecorations[i] && status.trailRanges[i]){
            editor.setDecorations(status.trailDecorations[i], status.trailRanges[i]);
        }
    }
}
export function clearTrailDecorations() {
    if (status.trailDecorations.length > 0) {
        status.trailDecorations.forEach(dec => {
            vscode.window.visibleTextEditors.forEach(editor => editor.setDecorations(dec, []));
        });
    }
    status.trailRanges = [];
}
function createGutterDecoration(rgb: string, opacity: number): vscode.TextEditorDecorationType {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 12 16" preserveAspectRatio="none"><rect x="8" y="0" width="4" height="16" fill="rgba(${rgb}, ${opacity})"/></svg>`;
    const uri = vscode.Uri.parse(`data:image/svg+xml;utf8,${encodeURIComponent(svg)}`);
    return vscode.window.createTextEditorDecorationType({ gutterIconPath: uri, gutterIconSize: 'auto' });
}
export function clearExecutionHighlight() {
    if (status.executionDecorationType) {
        const decType = status.executionDecorationType;
        vscode.window.visibleTextEditors.forEach(editor => editor.setDecorations(decType, []));
    }
    status.currentExecutionRanges = [];
}


// Creates the red squiggly lines and populates the "Problems" panel
export const liveTestDiagnostics = vscode.languages.createDiagnosticCollection("robotLiveTest");

// Creates the red background and inline text injection
export const errorDecorationType = vscode.window.createTextEditorDecorationType({
    isWholeLine: true,
    backgroundColor: 'rgba(255, 0, 0, 0.15)', // Light red background
    after: {
        margin: '0 0 0 2em',
        color: '#f14c4c', // VS Code error red
        fontWeight: 'bold'
    }
});