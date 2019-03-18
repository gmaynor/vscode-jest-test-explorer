import * as vscode from "vscode";
import { ITestNode, ITestResult } from './nodes';
import { Utility } from "./utility";
import { TestCommands } from "./testCommands";

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

        return failedTests.reduce((groups: any, item) => {
            const val = item.testNode.jestTestFile ? item.testNode.jestTestFile.path : 'file path not found';
            if (item.failureMessages) {
                groups[val] = groups[val] || [];
                item.failureMessages.forEach(fm => {
                    const fileLines = fm.split('\n').filter(l => l.includes(val));
                    if (fileLines && fileLines.length) {
                        const failedLine = fileLines[0].substring(fileLines[0].indexOf(val) + val.length + 1);
                        const parts = failedLine.substring(0, failedLine.length - 1).split(':');
                        groups[val].push(new vscode.Diagnostic(new vscode.Range(parseInt(parts[0]) - 1, parseInt(parts[1]) - 1, parseInt(parts[0]) - 1, parseInt(parts[1]) + 100), fm));
                    }
                });
            }
        }, {});
    }

    private _diagnosticCollection: vscode.DiagnosticCollection | null = null;

    constructor(testCommands: TestCommands) {
        if (Utility.getConfiguration().get<boolean>("addProblems")) {
            testCommands.onTestResultsUpdated(this.addTestResults, this);
            this._diagnosticCollection = vscode.languages.createDiagnosticCollection("jest-test-explorer");
        }
    }

    public dispose() {
        if (this._diagnosticCollection) {
            this._diagnosticCollection.dispose();
        }
    }

    private addTestResults(tests: ITestNode[]) {

        if (this._diagnosticCollection === null) {
            return;
        }

        this._diagnosticCollection.clear();

        const problems = Problems.createProblemsFromTests(tests);

        const newDiagnostics: Array<[vscode.Uri, vscode.Diagnostic[]]> = [];

        for (const problem in problems) {
            if (problems.hasOwnProperty(problem)) {
                newDiagnostics.push([vscode.Uri.file(problem), problems[problem]]);
            }
        }

        this._diagnosticCollection.set(newDiagnostics);
    }
}
