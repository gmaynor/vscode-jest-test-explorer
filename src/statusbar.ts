import * as vscode from "vscode";
import { TestCommands } from "./testCommands";
import { ITestNode } from './nodes';

export class StatusBar {
    private status: vscode.StatusBarItem;
    private baseStatusText: string = "";

    public constructor(testCommand: TestCommands) {
        this.status = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
        testCommand.onTestDiscoveryStarted(this.updateWithDiscoveringTest, this);
        testCommand.onTestResultsUpdated(this.updateCounts);
        this.discovering();
    }

    public discovering() {
        this.baseStatusText = "";
        this.status.text = `$(beaker) $(sync~spin) Discovering tests`;
        this.status.show();
    }

    public discovered(numberOfTests: number) {
        this.baseStatusText = `$(beaker) ${numberOfTests} tests`;
        this.status.text = this.baseStatusText;
    }

    public testRunning(numberOfTestRun: number) {
        this.status.text = `${this.baseStatusText} ($(sync~spin) Running ${numberOfTestRun} tests)`;
    }

    private updateCounts(results: ITestNode[]) {
        const counts = results.reduce(( result, x ) => { 
                result.passed += (x.itBlocks || []).filter(a => { const tNode = a as ITestNode; return tNode.testResult && tNode.testResult.status  === 'passed'; }).length; 
                result.failed += (x.itBlocks || []).filter(a => { const tNode = a as ITestNode; return tNode.testResult && tNode.testResult.status  === 'failed'; }).length; 
                result.notExecuted += (x.itBlocks || []).filter(a => { const tNode = a as ITestNode; return tNode.testResult && tNode.testResult.status  !== 'passed' && tNode.testResult.status !== 'failed'; }).length; 
                return result; }, { passed: 0, failed: 0, notExecuted: 0 });

        this.status.text = `${this.baseStatusText} ($(check) ${counts.passed} | $(x) ${counts.failed} | $(question) ${counts.notExecuted})`;        
    }

    public dispose() {
        if (this.status) {
            this.status.dispose();
        }
    }

    private updateWithDiscoveringTest() {
        this.discovering();
    }
}
