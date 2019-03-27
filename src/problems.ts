import * as vscode from "vscode";
import { DisposableManager } from "./disposableManager";
import { ITestNode, ITestResult } from './nodes';
import TestNodeManager from "./testNodeManager";
import { Config } from "./utility";

export class Problems {

    private static createProblemsFromTests(tests: ITestNode[]) {
        const failedTests = tests.reduce((results, test) => {
            if (test.itBlocks) {
                test.itBlocks.reduce((failedResults, itBlock) => {
                    const testResult = (itBlock as ITestNode).testResult;
                    if (testResult && testResult.status === 'failed') { failedResults.push(testResult); }
                    return failedResults;
                }
                    , results);
            }
            else if (!test.isContainer && test.testResult && test.testResult.status === 'failed') {
                failedTests.push(test.testResult);
            }
            return results;
        }, [] as Array<ITestResult>);

        return failedTests.reduce((groups: any, test) => {
            const filePath = test.testNode.jestTestFile ? test.testNode.jestTestFile.path : 'file path not found';
            if (test.failureMessages) {
                groups[filePath] = groups[filePath] || [];
                test.failureMessages.forEach(fm => {
                    const fileLines = fm.split('\n').filter(l => l.includes(filePath));
                    if (fileLines && fileLines.length) {
                        const failedLine = fileLines[0].substring(fileLines[0].indexOf(filePath) + filePath.length + 1);
                        const parts = failedLine.substring(0, failedLine.length - 1).split(':').map(x => parseInt(x));
                        const point = new vscode.Position(parts[0] - 1, parts[1]);
                        const foundExpect = test.testNode.expects ? test.testNode.expects.find(expect => expect.range(filePath).contains(point)) : undefined;
                        if (foundExpect) {
                            const diag = new vscode.Diagnostic(foundExpect.range(filePath), fm, vscode.DiagnosticSeverity.Error);
                            diag.source = 'Jest';
                            groups[filePath].push(diag);
                        }
                    }
                });
            }
            return groups;
        }, {});
    }

    private _diagnosticCollection: vscode.DiagnosticCollection | null = null;
    private _disposables: DisposableManager = new DisposableManager();

    constructor() {
        if (Config.addProblemsEnabled) {
            this._diagnosticCollection = vscode.languages.createDiagnosticCollection("jest-test-explorer");
            this._disposables.addDisposble("diagnositcs", this._diagnosticCollection);
            this._disposables.addDisposble("testsUpdating", TestNodeManager.onTestsUpdating(this.handleTestsUpdating, this));
            this._disposables.addDisposble("testsUpdated", TestNodeManager.onTestsUpdated(this.addTestResults, this));
        }
    }

    public dispose() {
        if (this._diagnosticCollection) {
            this._diagnosticCollection.dispose();
        }
    }

    private handleTestsUpdating(file: vscode.Uri) {
        if (this._diagnosticCollection === null) {
            return;
        }

        this._diagnosticCollection.delete(file);
    }

    private addTestResults(rootNode?: ITestNode) {

        if (this._diagnosticCollection === null) {
            return;
        }

        this._diagnosticCollection.clear();

        if (!rootNode || !rootNode.children) {
            return;
        }

        const problems = Problems.createProblemsFromTests(rootNode.children);

        const newDiagnostics: Array<[vscode.Uri, vscode.Diagnostic[]]> = [];

        for (const problem in problems) {
            if (problems.hasOwnProperty(problem)) {
                newDiagnostics.push([vscode.Uri.file(problem), problems[problem]]);
            }
        }

        this._diagnosticCollection.set(newDiagnostics);
    }
}
