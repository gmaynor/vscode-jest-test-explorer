import * as vscode from 'vscode';
import { TestDirectories } from './testDirectories';
import Logger from './logger';
import { Config, IJestDirectory } from './utility';
import { JestTestExplorer } from './jestTestExplorer';
import { DisposableManager } from './disposableManager';

const disposables = new DisposableManager();

export function activate(context: vscode.ExtensionContext) {
	Config.updateCache();
	const testDirectories = new TestDirectories();
	const jestTestExplorer = new JestTestExplorer(context, testDirectories);

	disposables.addDisposble("extension", jestTestExplorer);

	Logger.info("Starting Jest Test Explorer");

	testDirectories.onTestDirectorySearchCompleted((dirs: IJestDirectory[]) => {
		if (dirs.length) {
			Logger.info("Jest Project Directories :");
			dirs.forEach(x => {
				Logger.info(`                            ${x.projectPath}`);
			});
		}
		else {
			Logger.info("No Jest Project Directories Found");
		}
	});

	testDirectories.parseTestDirectories();
}

export function deactivate() {
	disposables.dispose();
}
