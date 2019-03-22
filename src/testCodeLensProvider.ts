import * as vscode from 'vscode';
import { CancellationToken, CodeLens, CodeLensProvider, Disposable, Event, EventEmitter, TextDocument, Range, Command } from "vscode";
import { TestCommands } from "./testCommands";
import { getRootNode, ITestNode } from './nodes';
import { Config, DefaultPosition } from "./utility";

class RunTestCodeLens extends CodeLens {

    public constructor(filePath: string, testNode: ITestNode) {
        const start = testNode.position(filePath);
        super(new Range(start, start));

        let lensTitle = testNode.isContainer ? 'run tests' : 'run test';
        if (testNode.testResult && (testNode.testResult.status === 'passed' || testNode.testResult.status === 'failed')) {
            lensTitle = `re-${lensTitle}`;
        }

        const cmd: Command = {
            title: lensTitle,
            command: "jest-test-explorer.runTestInContext",
            tooltip: 'Runs the specified test(s)',
            arguments: [testNode]
        };

        this.command = cmd;
    }
}

class DebugTestCodeLens extends CodeLens {

    public constructor(filePath: string, testNode: ITestNode) {
        const start = testNode.position(filePath);
        super(new Range(start, start));

        const cmd: Command = {
            title: 'debug test',
            command: "jest-test-explorer.debugTestInContext",
            tooltip: 'Debugs the specified test',
            arguments: [testNode]
        };

        this.command = cmd;
    }
}

export function registerTestCodeLens(commands: TestCommands) {
    return vscode.languages.registerCodeLensProvider(
        { pattern: '**/*.{ts,tsx,js,jsx}', scheme: 'file' },
        new TestCodeLensProvider(commands)
      );
  }
  
class TestCodeLensProvider implements CodeLensProvider {
    private disposables: Disposable[] = [];
    private onDidChangeCodeLensesEmitter = new EventEmitter<void>();

    public constructor(private testCommands: TestCommands) {
        this.disposables.push(testCommands.onTestDiscoveryFinished(() => this.onDidChangeCodeLensesEmitter.fire()));
        this.disposables.push(testCommands.onTestResultsUpdated(() => this.onDidChangeCodeLensesEmitter.fire()));
    }

    public dispose() {
        while (this.disposables.length) {
            const disposable = this.disposables.pop();
            if (disposable) {
                disposable.dispose();
            }
        }
    }

    public get onDidChangeCodeLenses(): Event<void> {
        return this.onDidChangeCodeLensesEmitter.event;
    }

    public provideCodeLenses(document: TextDocument, token: CancellationToken): CodeLens[] | Thenable<CodeLens[]> {
        if (!Config.codeLensEnabled) {
            return [];
        }
        const rootNode = getRootNode();
        if (!rootNode) {
            return [];
        }
        const filePath = document.uri.path;
        const reducer = (result: ITestNode[], child: ITestNode): ITestNode[] => { if (!child.position(filePath).isEqual(DefaultPosition)) { result.push(child); } if (child.children) { child.children.forEach(x => result = reducer(result, x)); } return result;  };
        const resultsForFile = rootNode.children ? rootNode.children.reduce(reducer, []) : [];
        const mapped: CodeLens[] = [];
        if (resultsForFile.length) {
            resultsForFile.forEach(x => {
                mapped.push(new RunTestCodeLens(document.uri.path, x));
                if (!x.isContainer) {
                    mapped.push(new DebugTestCodeLens(document.uri.path, x));
                }
            });
        }

        return mapped;
    }

    public resolveCodeLens(codeLens: CodeLens, token: CancellationToken): CodeLens {
        return codeLens;
    }
}
