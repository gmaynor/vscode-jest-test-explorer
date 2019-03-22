import * as vscode from 'vscode';
import { TestCommands } from './testCommands';
import { TestDirectories, IJestDirectory } from './testDirectories';
import { DisposableManager } from './disposableManager';
import { StatusBar } from './statusbar';
import { JestTestExplorerTreeDataProvider } from './testExplorerTree';
import { ITestNode } from './nodes';
import { GotoTest } from './gotoTest';
import { Problems } from './problems';
import { TestStatusEditorDecorations } from './decorations';
import Logger from './logger';
import { Config } from './utility';
import { registerTestCodeLens } from './testCodeLensProvider';
import { registerCoverageCodeLens } from './coverageCodeLensProvider';

export class JestTestExplorer {

    private _disposables: DisposableManager = new DisposableManager();
    private _optionals: { [key: string]: any } = {};
    private _testCommands: TestCommands;
    private _treeData: JestTestExplorerTreeDataProvider;
    private _tree: vscode.TreeView<ITestNode | undefined>;

    constructor(private context: vscode.ExtensionContext, testDirectories: TestDirectories) {
        this._testCommands = new TestCommands(testDirectories);
        this._disposables.addDisposble("testCommands", this._testCommands);
        this._disposables.addDisposble("statusBar", new StatusBar(this._testCommands));

        this._treeData = new JestTestExplorerTreeDataProvider(context, this._testCommands);
        this._disposables.addDisposble("treeData", this._treeData);
        this._tree = vscode.window.createTreeView("jestTestExplorer", { treeDataProvider: this._treeData });

        testDirectories.onTestDirectorySearchCompleted(this.directorySearchCompleted, this);

        this._disposables.addDisposble("configChange", vscode.workspace.onDidChangeConfiguration(this.handleConfigChanged, this));
    }

    public dispose() {
        this._disposables.dispose();
    }

    private registerCommands() {
        const gotoTest = new GotoTest();
        this.registerCommand("gotoTest", (test: ITestNode) => { gotoTest.go(test); });
        this.registerCommand("showLog", () => { Logger.show(); });
        this.registerCommand("stop", () => { this._testCommands.stopTests(); });
        this.registerCommand("refreshTestExplorer", () => { this._testCommands.discoverTests(); });
        this.registerCommand("runAllTests", () => { this._testCommands.runAllTests(); });
        this.registerCommand("runTest", (test: ITestNode) => { this._testCommands.runTest(test); });
        this.registerCommand("debugTest", (test: ITestNode) => { this._testCommands.debugTest(test); });
        this.registerCommand("runTestInContext", (test: ITestNode) => {
            const openTestView = vscode.commands.executeCommand("workbench.view.extension.test", "workbench.view.extension.test");
            openTestView.then(() => this._tree.reveal(test, { select: false, focus: true, expand: 3 })).then(() => { this._testCommands.runTest(test); });
        });
        this.registerCommand("debugTestInContext", (test: ITestNode) => {
            const openTestView = vscode.commands.executeCommand("workbench.view.extension.test", "workbench.view.extension.test");
            openTestView.then(() => this._tree.reveal(test, { select: false, focus: true, expand: 3 })).then(() => { this._testCommands.debugTest(test); });
        });
    }

    private registerCommand(name: string, callback: any, thisArg?: any) {
        this._disposables.addDisposble(`command_${name}`, vscode.commands.registerCommand(`jest-test-explorer.${name}`, callback, thisArg));
    }

    private directorySearchCompleted(dirs: IJestDirectory[]) {
        if (!dirs.length) {
            this._disposables.removeDisposable("statusBar");
            return;
        }

        this.registerCommands();

        this.manageOptionals();

        this._testCommands.discoverTests();
    }

    private handleConfigChanged(e: vscode.ConfigurationChangeEvent) {

        if (e.affectsConfiguration('jest-test-explorer')) {
            Config.updateCache();
            this.manageOptionals();
        }
        if (e.affectsConfiguration('jest-test-explorer.useTreeView')) {
            this._treeData.refresh();
        }
    }

    private manageOptionals() {
        this.addRemoveProblems();
        this.addRemoveStatusDecorations();
        this.addRemoveTestCodeLens();
        this.addRemoveCoverageCodeLens();
    }

    private addRemoveProblems() {
        const key = "problems";
        if (Config.addProblemsEnabled) {
            if (this._optionals[key]) {
                return;
            }
            this._optionals[key] = new Problems(this._testCommands);
            this._disposables.addDisposble(key, this._optionals[key]);
        }
        else if (this._optionals[key]) {
            this._disposables.removeDisposable(key);
            delete this._optionals[key];
        }
    }

    private addRemoveStatusDecorations() {
        const key = "editorDeco";
        if (Config.statusDecorationsEnabled) {
            if (this._optionals[key]) {
                return;
            }
            this._optionals[key] = new TestStatusEditorDecorations(this._testCommands);
            this._disposables.addDisposble(key, this._optionals[key]);
        }
        else if (this._optionals[key]) {
            this._disposables.removeDisposable(key);
            delete this._optionals[key];
        }
    }

    private addRemoveTestCodeLens() {
        const key = "testCodeLens";
        if (Config.codeLensEnabled) {
            this._disposables.addDisposble(key, registerTestCodeLens(this._testCommands));
        }
        else {
            this._disposables.removeDisposable(key);
        }
    }

    private addRemoveCoverageCodeLens() {
        const key = "coverageCodeLens";
        if (Config.showCoverageEnabled) {
            this._disposables.addDisposble(key, registerCoverageCodeLens(this._testCommands));
        }
        else {
            this._disposables.removeDisposable(key);
        }
    }
}