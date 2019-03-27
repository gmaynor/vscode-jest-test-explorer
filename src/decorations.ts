import * as vscode from 'vscode';
import { DisposableManager } from './disposableManager';
import { ITestNode } from './nodes';
import TestNodeManager from './testNodeManager';
import { Config } from './utility';


export class TestStatusEditorDecorations {
    private _disposables: DisposableManager = new DisposableManager();
    private readonly _failedTestDecoration: vscode.TextEditorDecorationType;
    private readonly _passedTestDecoration: vscode.TextEditorDecorationType;
    private readonly _skippedTestDecoration: vscode.TextEditorDecorationType;
    private readonly _notRunTestDecoration: vscode.TextEditorDecorationType;
    private readonly _fileTestMap: { [key: string]: ITestNode[] } = {};
    private _timeout: NodeJS.Timer | undefined = undefined;

    public constructor() {
        this._failedTestDecoration = this.createTestStatusDecorationType(Config.decorationFailed, 'red', '#FF5648', '#AD322D');
        this._passedTestDecoration = this.createTestStatusDecorationType(Config.decorationPassed, 'green', '#3BB26B', '#2F8F51');
        this._skippedTestDecoration = this.createTestStatusDecorationType(Config.decorationSkipped, 'yellow', '#FED37F', '#FED37F');
        this._notRunTestDecoration = this.createTestStatusDecorationType(Config.decorationNotRun, 'darkgrey', '#5D6D7E', '#AEB6BF');

        this._disposables.addDisposble("editorChanged", vscode.window.onDidChangeActiveTextEditor(this.onDidChangeActiveTextEditor, this));
        this._disposables.addDisposble("documentChanged", vscode.workspace.onDidChangeTextDocument(this.onDidChangeTextDocument, this));
        this._disposables.addDisposble("testsUpdated", TestNodeManager.onTestsUpdated(this.handleTestResultsUpdated, this));
        this._disposables.addDisposble("testsUpdating", TestNodeManager.onTestsUpdating(this.handleTestsUpdating, this));
    }

    public dispose() {
        this._disposables.dispose();
    }

    private handleTestsUpdating(file: vscode.Uri) {
        if (this._fileTestMap[file.path]) {
            this._fileTestMap[file.path] = [];
        }

        // trigger updates        
        for (const editor of vscode.window.visibleTextEditors) {
            this.triggerUpdateActiveEditor(editor);
        }
    }

    private handleTestResultsUpdated(rootNode?: ITestNode) {
        // clear existing testFile-testNodes map
        Object.keys(this._fileTestMap).forEach(key => this._fileTestMap[key] = []);

        if (rootNode && rootNode.children) {
            // build map of testFile-testNodes
            const itNodes = rootNode.children.reduce((out, tNode) => { if (tNode.itBlocks) { out.push(...tNode.itBlocks); } else if (!tNode.isContainer) { out.push(tNode); } return out; }, [] as ITestNode[]);
            itNodes.forEach(node => {
                const file = node.jestTestFile ? node.jestTestFile.path : undefined;
                if (file) {
                    if (!this._fileTestMap[file]) {
                        this._fileTestMap[file] = [];
                    }
                    this._fileTestMap[file].push(node);
                }
            });
        }

        // trigger updates        
        for (const editor of vscode.window.visibleTextEditors) {
            this.triggerUpdateActiveEditor(editor);
        }
    }

    private triggerUpdateActiveEditor(editor?: vscode.TextEditor) {
        if (!editor) {
            return;
        }
        if (!this.canUpdateEditor(editor)) {
            return;
        }

        if (this._timeout) {
            clearTimeout(this._timeout);
            this._timeout = undefined;
        }

        this._timeout = setTimeout(() => this.updateActiveEditor(editor), 500);
    }

    private canUpdateEditor(editor?: vscode.TextEditor): boolean {
        if (!editor || !editor.document) {
            return false;
        }

        return !!this._fileTestMap[editor.document.uri.path];
    }

    private updateActiveEditor(editor: vscode.TextEditor) {
        // Clear current decorations first
        editor.setDecorations(this._passedTestDecoration, []);
        editor.setDecorations(this._failedTestDecoration, []);
        editor.setDecorations(this._skippedTestDecoration, []);
        editor.setDecorations(this._notRunTestDecoration, []);

        const itBlocks = this._fileTestMap[editor.document.uri.path] || [];
        if (!itBlocks.length) {
            return;
        }
        const passBlocks = itBlocks.filter(it => it.testResult && it.testResult.status === 'passed');
        const failBlocks = itBlocks.filter(it => it.testResult && it.testResult.status === 'failed');
        const skipBlocks = itBlocks.filter(it => it.testResult && it.testResult.status === 'skipped');
        const notRunBlocks = itBlocks.filter(it => !it.testResult || it.testResult.status === 'pending' || it.testResult.status === 'todo');

        const getDecoOptions = (hoverMessage: string, blocks: ITestNode[]): vscode.DecorationOptions[] => {
            return blocks.map(block => {
                const blockStart = block.position(editor.document.uri.path);
                return {
                    range: new vscode.Range(blockStart, blockStart.translate(0, 1)),
                    hoverMessage: hoverMessage
                };
            });
        };

        if (passBlocks.length) {
            editor.setDecorations(this._passedTestDecoration, getDecoOptions('passed', passBlocks));
        }
        if (failBlocks.length) {
            editor.setDecorations(this._failedTestDecoration, getDecoOptions('failed', failBlocks));
        }
        if (skipBlocks.length) {
            editor.setDecorations(this._skippedTestDecoration, getDecoOptions('skipped', skipBlocks));
        }
        if (notRunBlocks.length) {
            editor.setDecorations(this._notRunTestDecoration, getDecoOptions('not run', notRunBlocks));
        }
    }

    private onDidChangeActiveTextEditor(editor?: vscode.TextEditor) {
        this.triggerUpdateActiveEditor(editor);
    }

    /**
  * This event is fired with the document not dirty when:
  * - before the onDidSaveTextDocument event
  * - the document was changed by an external editor
  */
    private onDidChangeTextDocument(event: vscode.TextDocumentChangeEvent) {
        if (event.document.isDirty) {
            return;
        }
        if (event.document.uri.scheme === 'git') {
            return;
        }

        // Ignore a clean file with a change:
        if (event.contentChanges.length > 0) {
            return;
        }

        // this.removeCachedTestResults(event.document);

        for (const editor of vscode.window.visibleTextEditors) {
            if (editor.document === event.document) {
                this.triggerUpdateActiveEditor(editor);
            }
        }
    }

    private createTestStatusDecorationType(decoText: string, rulerColor: string, lightColor: string, darkColor: string): vscode.TextEditorDecorationType {
        const retVal = vscode.window.createTextEditorDecorationType({
            overviewRulerColor: rulerColor,
            overviewRulerLane: vscode.OverviewRulerLane.Left,
            light: {
                before: {
                    color: lightColor,
                    contentText: decoText,
                },
            },
            dark: {
                before: {
                    color: darkColor,
                    contentText: decoText,
                },
            },
            rangeBehavior: vscode.DecorationRangeBehavior.ClosedClosed,
        });

        this._disposables.addDisposble(`decoration_${decoText}`, retVal);
        return retVal;
    }

    private createFailedExpectDecorationType(failText: string): vscode.TextEditorDecorationType {
        return vscode.window.createTextEditorDecorationType({
            isWholeLine: true,
            overviewRulerColor: 'red',
            overviewRulerLane: vscode.OverviewRulerLane.Left,
            light: {
                before: {
                    color: '#FF564B',
                },
                after: {
                    color: '#FF564B',
                    contentText: ' // ' + failText,
                },
            },
            dark: {
                before: {
                    color: '#AD322D',
                },
                after: {
                    color: '#AD322D',
                    contentText: ' // ' + failText,
                },
            },
        });
    }
}
