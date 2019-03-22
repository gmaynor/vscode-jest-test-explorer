import * as vscode from "vscode";
import { TestCommands } from "./testCommands";
import { ITestNode } from './nodes';
import { DisposableManager } from './disposableManager';

export class StatusBar {
    private status: vscode.StatusBarItem;
    private baseStatusText: string = "";
    private _disposables = new DisposableManager();

    public constructor(testCommand: TestCommands) {
        this.status = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
        this._disposables.addDisposble("status", this.status);
        this._disposables.addDisposble("discoveryStarted", testCommand.onTestDiscoveryStarted(this.discovering, this));
        this._disposables.addDisposble("discoveryFinished", testCommand.onTestDiscoveryFinished(this.discovered, this));
        this._disposables.addDisposble("testRun", testCommand.onTestRun(this.running, this));
        this._disposables.addDisposble("resultsUpdated", testCommand.onTestResultsUpdated(this.updateCounts, this));
        this.discovering();

        this.status.command = "workbench.view.extension.test";
    }

    public dispose() {
        this._disposables.dispose();
    }

    private discovering() {
        this.baseStatusText = "";
        this.status.text = `$(beaker) $(sync~spin) Discovering Jest tests`;
        this.status.show();
    }

    private discovered(e: ITestNode | undefined) {
        this.baseStatusText = `$(beaker) ${e && e.itBlocks ? e.itBlocks.length : 0} Jest tests`;
        this.status.text = this.baseStatusText;
    }

    private running(node: ITestNode) {
        const testRun: ITestNode[] = node.isContainer ? node.itBlocks || [] : [node];

        this.status.text = `${this.baseStatusText} ($(sync~spin) Running ${testRun.length} Jest tests)`;
    }

    private updateCounts(results: ITestNode[]) {
        const tests: ITestNode[] = results.reduce((out, item) => { if (item.itBlocks && item.itBlocks.length > 0) { out.push(...item.itBlocks); } else if (!item.isContainer) { out.push(item); }  return out;}, [] as ITestNode[]);
        const counts = results.reduce(( result, x ) => { 
                if (x.isContainer) {
                    const itBlocks = x.itBlocks || [];
                    result.passed += itBlocks.filter(a => { const tNode = a as ITestNode; return tNode.testResult && tNode.testResult.status  === 'passed'; }).length; 
                    result.failed += itBlocks.filter(a => { const tNode = a as ITestNode; return tNode.testResult && tNode.testResult.status  === 'failed'; }).length; 
                    result.notExecuted += itBlocks.filter(a => { const tNode = a as ITestNode; return tNode.testResult && tNode.testResult.status  !== 'passed' && tNode.testResult.status !== 'failed'; }).length; 
                }
                else if (!x.testResult) { result.notExecuted += 1; }
                else {
                    switch (x.testResult.status) {
                        case 'passed':
                            result.passed += 1;
                            break;
                        case 'failed':
                            result.failed += 1;
                            break;
                        default:
                            result.notExecuted += 1;
                            break;
                    }
                }
                return result; }, { passed: 0, failed: 0, notExecuted: 0 });

        this.status.text = `${this.baseStatusText} ($(check) ${counts.passed} | $(x) ${counts.failed} | $(question) ${counts.notExecuted})`;        
    }
}
