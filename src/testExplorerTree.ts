import * as path from 'path';
import * as vscode from 'vscode';
import { TreeDataProvider, TreeItem } from 'vscode';
import { DisposableManager } from './disposableManager';
import { TestCommands } from './testCommands';
import TestNodeManager from './testNodeManager';
import { ITestNode, TestNodeType } from './nodes';
import { Config, DefaultPosition, DefaultRange } from './utility';

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
    flatten() {
        return [this];
    }
    flattenUp() {
        return [this];
    }
    flattenDown() {
        return [this];
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
    private _disposables: DisposableManager = new DisposableManager();
    private _discovering: boolean = false;
    private _rootNode?: ITestNode;
    private _onDidChangeTreeData: vscode.EventEmitter<any> = new vscode.EventEmitter<any>();
    public readonly onDidChangeTreeData: vscode.Event<any> = this._onDidChangeTreeData.event;

    constructor(private context: vscode.ExtensionContext, testCommands: TestCommands) {
        this._disposables.addDisposble("disoveringTests", testCommands.onTestDiscoveryStarted(this.updateWithDiscoveringTests, this));
        this._disposables.addDisposble("testsUpdated", TestNodeManager.onTestsUpdated(this.updateWithDiscoveredTests, this));
        this._disposables.addDisposble("testRun", testCommands.onTestRun(this.updateTreeWithRunningTests, this));
        this._disposables.addDisposble("testStop", testCommands.onTestStop(this.updateTreeWithStoppedTests, this));
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

        const useTreeView = Config.useTreeViewEnabled;
        return {
            label: useTreeView ? element.name : element.fqName,
            iconPath: this.getIcon(element),
            collapsibleState: element.isContainer ? Config.defaultCollapsibleState : void 0,
            contextValue: element.isContainer ? 'folder' : 'test',
            command: element.isContainer ? undefined : {
                command: "jest-test-explorer.gotoTest",
                title: "",
                arguments: [element],
            }
        };
    }

    public getChildren(element?: ITestNode): ITestNode[] | Thenable<ITestNode[]> {

        const sortChildren = (children: ITestNode[]): ITestNode[] => {
            return children.sort((a, b) => {
                if (a.isContainer && !b.isContainer) { return -1; }
                if (!a.isContainer && b.isContainer) { return 1; }
                if (a.isContainer && b.isContainer) {
                    const aName = a.name || '';
                    const bName = b.name || '';
                    if (aName < bName) { return -1; }
                    if (aName > bName) { return 1; }
                }
                // const aName = a.fqName || '';
                // const bName = b.fqName || '';
                // if (aName < bName) { return -1; }
                // if (aName > bName) { return 1; }
                
                return 0;
        });
    };

    if(element) {
        return sortChildren(element.children || []);
    }

    if(this._discovering) {
        return [new LoadingNode()];
    }

    if(!this._rootNode) {
        return ["Please open or set the test project", "and ensure your project compiles."].map((e) => {
            return new ErrorNode(e);
        });
    }

    const useTreeView = Config.useTreeViewEnabled;

    if(!useTreeView) {
        return this._rootNode.itBlocks || [];
    }

        return sortChildren(this._rootNode.children || []);
    }

    public getParent(element ?: ITestNode): ITestNode | undefined {
    if (!element) {
        return;
    }
    if (!element.parent || element.parent.type === 'root') {
        return;
    }
    return element.parent;
}

    public refresh() {
    this._onDidChangeTreeData.fire();
}

    public dispose() {
    this._disposables.dispose();
}

    private updateWithDiscoveringTests(): void {
    this._discovering = true;
    this._onDidChangeTreeData.fire();
}
    private updateWithDiscoveredTests(node ?: ITestNode) {
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
