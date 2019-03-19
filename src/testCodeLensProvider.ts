"use strict";
import { CancellationToken, CodeLens, CodeLensProvider, Disposable, Event, EventEmitter, TextDocument, Range, Command } from "vscode";
import { TestCommands } from "./testCommands";
import { getRootNode, ITestNode } from './nodes';
import { Utility, DefaultPosition } from "./utility";

class TestStatusCodeLens extends CodeLens {

    public static fromTestNode(filePath: string, test: ITestNode): TestStatusCodeLens | undefined {
        if (!test.testResult) {
            return;
        }

        const icon = TestStatusCodeLens.parseOutcome(test.testResult.status);

        if (!icon.length) {
            return;
        }

        return new TestStatusCodeLens(filePath, test, icon, test.testResult.failureMessages);
    }

    public constructor(filePath: string, result: ITestNode, icon: string, failureMessages?: string[]) {
        const start = result.position(filePath);
        const range = new Range(start, start);
        
        super(range);

        this.command = {
            title: icon,
            command: '',
            tooltip: failureMessages ? failureMessages.join('\n\n') : undefined
        };
    }

    private static parseOutcome(outcome: string): string {
        if (outcome === "passed") {
            return Utility.codeLensPassed;
        } else if (outcome === "failed") {
            return Utility.codeLensFailed;
        } else if (outcome === "skipped") {
            return Utility.codeLensSkipped;
        } else {
            return "";
        }
    }
}

class RunTestCodeLens extends CodeLens {

    public constructor(filePath: string, testNode: ITestNode) {
        const start = testNode.position(filePath);
        super(new Range(start, start));

        const cmd: Command = {
            title: testNode.children && testNode.children.length > 0 ? 'run tests' : 'run test',
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
            command: "jest-test-explorer.debugTest",
            tooltip: 'Debugs the specified test',
            arguments: [testNode]
        };

        this.command = cmd;
    }
}

export class TestCodeLensProvider implements CodeLensProvider {
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
        if (!Utility.codeLensEnabled) {
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
                if (x.testResult) {
                    const tLens = TestStatusCodeLens.fromTestNode(filePath, x);
                    if (tLens) {
                        mapped.push(tLens);
                    }
                }
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
