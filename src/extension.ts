// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as vscode from 'vscode';
import { TestDirectories } from './testDirectories';
import { TestCommands } from './testCommands';
import Logger from './logger';
import { Problems } from './problems';
import { StatusBar } from './statusbar';
import { GotoTest } from './gotoTest';
import { JestTestExplorerTreeDataProvider } from './testExplorerTree';
import { TestCodeLensProvider } from './testCodeLensProvider';
import { ITestNode } from './nodes';
import { Utility } from './utility';

// this method is called when your extension is activated
// your extension is activated the very first time the command is executed
export function activate(context: vscode.ExtensionContext) {
	const testDirectories = new TestDirectories();
	const testCommands = new TestCommands(testDirectories);
	const problems = new Problems(testCommands);
	const statusbar = new StatusBar(testCommands);
	const gotoTest = new GotoTest();

	Logger.info("Starting Jest Test Explorer");

	testDirectories.parseTestDirectories().then(() => {
		Logger.info("Jest Project Directories :");
		testDirectories.getTestDirectories().forEach(x => {
			Logger.info(`                            ${x.projectPath}`);
		});

		context.subscriptions.push(problems);
		context.subscriptions.push(statusbar);

		Utility.updateCache();

		const treeDataProvider = new JestTestExplorerTreeDataProvider(context, testCommands, statusbar);
		const tree = vscode.window.createTreeView("jestTestExplorer", { treeDataProvider });

		const codeLensProvider = new TestCodeLensProvider(testCommands);
		context.subscriptions.push(codeLensProvider);
		context.subscriptions.push(vscode.languages.registerCodeLensProvider(
			[{ language: "javascript", scheme: "file" }, { language: "typescript", scheme: "file" }],
			codeLensProvider));
	
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
	
		context.subscriptions.push(vscode.commands.registerCommand("jest-test-explorer.gotoTest", (test: ITestNode) => {
			gotoTest.go(test);
		}));
	
		testCommands.discoverTests();
	});
}

// this method is called when your extension is deactivated
export function deactivate() {}
