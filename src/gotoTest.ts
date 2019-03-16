import * as vscode from 'vscode';
import Logger from './logger';
import { ITestNode } from './nodes';

export class GotoTest {

    public go(test: ITestNode): void {
        const fileName = test.jestTestFile ? test.jestTestFile.path : undefined;
        const nameRange = test.nameRange(fileName || '');

        try {
            if (!fileName) {
                Logger.debug(`Unable to get the fileName for test "${test.name}`);
                return;
            }

            vscode.workspace.openTextDocument(fileName).then((doc) => {
                vscode.window.showTextDocument(doc).then((editor) => {
                    if (!vscode.window.activeTextEditor) {
                        return;
                    }
                    if (!nameRange) {
                        return;
                    }
                    const selection = new vscode.Selection(nameRange.start, nameRange.start);
                    vscode.window.activeTextEditor.selection = selection;
                    vscode.window.activeTextEditor.revealRange(selection, vscode.TextEditorRevealType.InCenter);
                });
            });
        } catch (r) {
            Logger.error(r.message);
            vscode.window.showWarningMessage(r.message);
        }
    }

}
