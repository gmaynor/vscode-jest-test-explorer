// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as vscode from 'vscode';
import { TestDirectories, IJestDirectory } from './testDirectories';
import { TestCommands } from './testCommands';
import Logger from './logger';
import { Problems } from './problems';
import { StatusBar } from './statusbar';
import { GotoTest } from './gotoTest';
import { JestTestExplorerTreeDataProvider } from './testExplorerTree';
import { registerCoverageCodeLens } from './coverageCodeLensProvider';
import { TestCodeLensProvider } from './testCodeLensProvider';
import { EditorDecorations } from './decorations';
import { ITestNode } from './nodes';
import { Utility } from './utility';

const disposables: vscode.Disposable[] = [];

// this method is called when your extension is activated
// your extension is activated the very first time the command is executed
export function activate(context: vscode.ExtensionContext) {

	Utility.updateCache();

	const testDirectories = new TestDirectories();
	const testCommands = new TestCommands(testDirectories);
	const statusbar = new StatusBar(testCommands);
	context.subscriptions.push(statusbar);

	disposables.push(vscode.Disposable.from(testCommands));

	const treeDataProvider = new JestTestExplorerTreeDataProvider(context, testCommands);
	const tree = vscode.window.createTreeView("jestTestExplorer", { treeDataProvider });

	testDirectories.onTestDirectorySearchCompleted((dirs) => { if (!dirs || !dirs.length) { statusbar.dispose(); } else { onJestDirectoriesDiscovered(context, testCommands, tree, dirs); } });


	Logger.info("Starting Jest Test Explorer");

	testDirectories.parseTestDirectories();
}

function onJestDirectoriesDiscovered(context: vscode.ExtensionContext, testCommands: TestCommands, tree: vscode.TreeView<ITestNode | undefined>, dirs: IJestDirectory[]) {
	Logger.info("Jest Project Directories :");
	dirs.forEach(x => {
		Logger.info(`                            ${x.projectPath}`);
	});
	const gotoTest = new GotoTest();
	const problems = new Problems(testCommands);
	const editorDeco = new EditorDecorations(testCommands);
	
	context.subscriptions.push(problems);
	context.subscriptions.push(editorDeco);

	const codeLensProvider = new TestCodeLensProvider(testCommands);
	context.subscriptions.push(codeLensProvider);
	context.subscriptions.push(vscode.languages.registerCodeLensProvider(
		[{ language: "javascript", scheme: "file" }, { language: "typescript", scheme: "file" }],
		codeLensProvider));

	context.subscriptions.push(...registerCoverageCodeLens(testCommands));

	context.subscriptions.push(vscode.commands.registerCommand("jest-test-explorer.showLog", () => {
		Logger.show();
	}));

	context.subscriptions.push(vscode.commands.registerCommand("jest-test-explorer.stop", () => {
		testCommands.stopTests();
	}));

	context.subscriptions.push(vscode.commands.registerCommand("jest-test-explorer.refreshTestExplorer", () => {
		testCommands.discoverTests();
	}));

	context.subscriptions.push(vscode.commands.registerCommand("jest-test-explorer.runAllTests", () => {
		testCommands.runAllTests();
	}));

	context.subscriptions.push(vscode.commands.registerCommand("jest-test-explorer.runTest", (test: ITestNode) => {
		testCommands.runTest(test);
	}));

	context.subscriptions.push(vscode.commands.registerTextEditorCommand("jest-test-explorer.runTestInContext", (editor: vscode.TextEditor, edit: vscode.TextEditorEdit, test: ITestNode) => {
		const openTestView = vscode.commands.executeCommand("workbench.view.extension.test", "workbench.view.extension.test");
		openTestView.then(() => tree.reveal(test, {select: false, focus: true, expand: 3})).then(() => testCommands.runTest(test));
	}));

	context.subscriptions.push(vscode.commands.registerTextEditorCommand("jest-test-explorer.debugTest", (editor: vscode.TextEditor, edit: vscode.TextEditorEdit, test: ITestNode) => {
		const openTestView = vscode.commands.executeCommand("workbench.view.extension.test", "workbench.view.extension.test");
		openTestView.then(() => tree.reveal(test, {select: false, focus: true, expand: 3})).then(() => {
			testCommands.debugTest(test);
		});
	}));

	context.subscriptions.push(vscode.commands.registerCommand("jest-test-explorer.gotoTest", (test: ITestNode) => {
		gotoTest.go(test);
	}));

	testCommands.discoverTests();
}

// this method is called when your extension is deactivated
export function deactivate() {
	while (disposables.length) {
		const d = disposables.pop();
		if (d) {
			d.dispose();
		}
	}
}
