import * as path from 'path';
import * as vscode from 'vscode';
import { TreeDataProvider, TreeItem } from 'vscode';
import Logger from './logger';
import { TestCommands } from './testCommands';
import { ITestNode } from './nodes';
import { Utility, TestNodeType, DefaultPosition, DefaultRange } from './utility';

class ArtificialTestNode implements ITestNode {
    public name: string;
    public running: boolean = false;
    constructor(name: string) {
        this.name = name;
    }
    get type(): TestNodeType {
        return 'root';
    }
    get isContainer(): boolean {
        return false;
    }
    get fqName(): string {
        return this.name;
    }
    position(filePath: string): vscode.Position {
        return DefaultPosition;
    }
    range(filePath: string): vscode.Range {
        return DefaultRange;
    }
    namePosition(filePath: string): vscode.Position {
        return DefaultPosition;
    }
    nameRange(filePath: string): vscode.Range {
        return DefaultRange;
    }
    mergeWith(other: ITestNode) {
    }
}
class ErrorNode extends ArtificialTestNode {
}
class LoadingNode extends ArtificialTestNode {
    constructor() {
        super('...Loading');
        this.running = true;
    }
}

export class JestTestExplorerTreeDataProvider implements TreeDataProvider<ITestNode> {
    private _discovering: boolean = false;
    private _rootNode?: ITestNode;
    private _onDidChangeTreeData: vscode.EventEmitter<any> = new vscode.EventEmitter<any>();
    public readonly onDidChangeTreeData: vscode.Event<any> = this._onDidChangeTreeData.event;

    constructor(private context: vscode.ExtensionContext, private testCommands: TestCommands) {
        testCommands.onTestDiscoveryStarted(this.updateWithDiscoveringTests, this);
        testCommands.onTestDiscoveryFinished(this.updateWithDiscoveredTests, this);
        testCommands.onTestRun(this.updateTreeWithRunningTests, this);
        testCommands.onTestStop(this.updateTreeWithStoppedTests, this);
        testCommands.onTestResultsUpdated(this.updateTreeWithStoppedTests, this);
    }

    public getTreeItem(element: ITestNode): TreeItem {
        if (element instanceof ErrorNode) {
            return new TreeItem(element.name);
        }
        if (element instanceof LoadingNode) {
            return {
                label: element.name,
                iconPath: this.getIcon(element)
            };
        }

        const useTreeView = Utility.getConfiguration().get<string>("useTreeView");
        return {
            label: useTreeView ? element.name : element.fqName,
            iconPath: this.getIcon(element),
            collapsibleState: element.isContainer ? Utility.defaultCollapsibleState : void 0,
            contextValue: element.isContainer ? 'folder' : 'test',
            command: element.isContainer ? undefined : {
                command: "jest-test-explorer.gotoTest",
                title: "",
                arguments: [element],
            }
        };
    }

    public getChildren(element?: ITestNode): ITestNode[] | Thenable<ITestNode[]> {

        if (element) {
            return element.children || [];
        }

        if (this._discovering) {
            return [new LoadingNode()];
        }

        if (!this._rootNode) {
            return ["Please open or set the test project", "and ensure your project compiles."].map((e) => {
                return new ErrorNode(e);
            });
        }

        const useTreeView = Utility.getConfiguration().get<string>("useTreeView");

        if (!useTreeView) {
            return this._rootNode.itBlocks || [];
        }

        return this._rootNode.children || [];
    }

    public getParent(element?: ITestNode): ITestNode | undefined {
        if (!element) {
            return;
        }
        if (!element.parent || element.parent.type === 'root') {
            return;
        }
        return element.parent;
    }

    private updateWithDiscoveringTests(): void {
        this._discovering = true;
        this._onDidChangeTreeData.fire();
    }
    private updateWithDiscoveredTests(node?: ITestNode) {
        this._discovering = false;
        this._rootNode = node;
        this._onDidChangeTreeData.fire();
    }

    private updateTreeWithRunningTests(node: ITestNode) {
        const testRun: ITestNode[] = node.isContainer ? node.itBlocks || [] : [node];

        testRun.forEach((testNode: ITestNode) => {
            testNode.running = true;
            this._onDidChangeTreeData.fire(testNode);
        });
    }

    private updateTreeWithStoppedTests() {
        if (this._rootNode && this._rootNode.itBlocks) {
            this._rootNode.itBlocks.forEach(x => { x.running = false; });
        }
        this._onDidChangeTreeData.fire();
    }

    private getIcon(node: ITestNode): { dark: string, light: string } {
        let retVal: string;
        if (node.running) {
            retVal = "spinner.svg";
        }
        else if (!node.testResult) {
            retVal = node.isContainer ? 'namespace.png' : 'testNotRun.png';
        }
        else {
            const status = node.testResult.status;
            switch (status) {
                case 'failed':
                    retVal = 'Failed.png';
                    break;
                case 'passed':
                    retVal = 'Passed.png';
                    break;
                case 'skipped':
                    retVal = 'NotExecuted.png';
                    break;
                default:
                    retVal = node.isContainer ? '.png' : 'NotRun.png';
                    break;
            }
            retVal = `${node.isContainer ? 'namespace' : 'test'}${retVal}`;
        }
        return {
            dark: this.context.asAbsolutePath(path.join("resources", "dark", retVal)),
            light: this.context.asAbsolutePath(path.join("resources", "light", retVal)),
        };
    }
}
