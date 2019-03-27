import * as vscode from 'vscode';
import * as nodes from './nodes';
import { DefaultPosition, DefaultRange, IJestDirectory, JestTestFile, debounce } from './utility';
import { ParseResult, discoverTests, rediscoverTests, discoverTestsForFile } from './testDiscovery';
import CoverageMapManager from './coverageMapManager';
import { DisposableManager } from './disposableManager';
import { file } from 'babel-types';


const getNewParseResult = (type: nodes.TestNodeType, file?: JestTestFile, name?: string): RootNode | DescribeNode | ItNode | ExpectNode => {
    switch (type) {
        case 'root':
            return new RootNode();
        case 'describe':
            return new DescribeNode(name);
        case 'it':
            if (!file) {
                throw Error('Can\'t construct a new ItNode without a JestTestFile.');
            }
            return new ItNode(file, name);
        case 'expect':
            if (!file) {
                throw Error('Can\'t construct a new ExpectNode without a JestTestFile.');
            }
            return new ExpectNode(file, name);
        default:
            throw Error(`Unexpected type '${type}'`);
    }
};

class TestResult implements nodes.ITestResult {
    failureMessages?: Array<string>;

    constructor(public testNode: nodes.ITestNode, public status: nodes.TestStatus, failMessages?: string[]) {
        this.failureMessages = failMessages;
    }
}

class ContainerTestResult implements nodes.ITestResult {

    constructor(public testNode: nodes.ITestNode) {

    }

    public get status(): nodes.TestStatus {
        const children: nodes.ITestNode[] = this.testNode.children || [];
        if (!children.length) {
            return 'pending';
        }

        if (children.some((child: nodes.ITestNode) => child.testResult ? child.testResult.status === 'failed' : false)) {
            return 'failed';
        }
        const statii: Array<nodes.TestStatus> = ['passed', 'skipped', 'todo'];
        let retVal: nodes.TestStatus | undefined;
        for (let i = 0; i < statii.length && !retVal; i++) {
            const s = statii[i];
            if (children.every((child: nodes.ITestNode) => child.testResult ? child.testResult.status === s : false)) {
                retVal = s;
            }
        }

        return retVal || 'pending';
    }

    public get failureMessages(): Array<string> | undefined {
        if (!this.testNode.children || !this.testNode.children.length) {
            return;
        }

        const retVal: string[] = [];
        this.testNode.children.forEach(child => {
            const childMessages: Array<string> | undefined = child.testResult ? child.testResult.failureMessages : undefined;
            if (childMessages && childMessages.length) {
                retVal.push(childMessages.join('\n'));
            }
        });
        if (retVal.length) {
            return retVal;
        }
    }
}

interface IManagedTestNode extends nodes.ITestNode {
    start: vscode.Position;
    end: vscode.Position;
    nameStart: vscode.Position;
    nameEnd: vscode.Position;
    remergeWith(other: IManagedTestNode): void;
}

class NodeMap {
    private _thisNodes: nodes.ITestNode[] = [];
    private _otherNodes: nodes.ITestNode[] = [];
    private _thisIts: ItNode[] = [];
    private _otherIts: ItNode[] = [];

    public get thisNodes() {
        return this._thisNodes;
    }
    public get otherNodes() {
        return this._otherNodes;
    }
    public get thisItNodes() {
        return this._thisIts;
    }
    public get otherItNodes() {
        return this._otherIts;
    }
    public addThisNode(node: nodes.ITestNode) {
        this._thisNodes.push(node);
        if (node.type === 'it') {
            this._thisIts.push(node as ItNode);
        }
    }
    public addOtherNode(node: nodes.ITestNode) {
        this._otherNodes.push(node);
        if (node.type === 'it') {
            this._otherIts.push(node as ItNode);
        }
    }
}

class FileNodeMap {
    private readonly _map: { [key: string]: NodeMap } = {};

    public get files(): string[] {
        return Object.keys(this._map);
    }

    public getMapForFile(file: string): NodeMap | undefined {
        return this._map[file];
    }

    public addThisNode(file: string, node: nodes.ITestNode) {
        this.getNodeMap(file).addThisNode(node);
    }
    public addOtherNode(file: string, node: nodes.ITestNode) {
        this.getNodeMap(file).addOtherNode(node);
    }

    private getNodeMap(file: string) {
        if (!this._map[file]) {
            this._map[file] = new NodeMap();
        }
        return this._map[file];
    }
}

class TestNode implements IManagedTestNode {
    type: nodes.TestNodeType;
    file?: JestTestFile;
    name?: string;
    isContainer: boolean;
    start: vscode.Position = DefaultPosition;
    end: vscode.Position = DefaultPosition;
    nameStart: vscode.Position = DefaultPosition;
    nameEnd: vscode.Position = DefaultPosition;
    running: boolean = false;
    parent?: nodes.ITestNode;
    children?: Array<nodes.ITestNode>;
    expects?: Array<nodes.ITestNode>;
    itBlocks?: ItNode[];
    private _testResult?: nodes.ITestResult;

    private childDescribesMap: { [key: string]: DescribeNode } = {};

    constructor(type: nodes.TestNodeType, file?: JestTestFile, name?: string) {
        this.type = type;
        this.file = file;
        this.name = name;
        this.isContainer = this.type === 'root' || this.type === 'describe';
    }

    public get fqName(): string | undefined {
        if (!this.name) {
            return undefined;
        }
        let parentName: string | undefined;
        if (this.parent) {
            parentName = this.parent.fqName;
        }
        return `${parentName ? parentName + ":" : ""}${this.name}`;
    }

    public get jestTestFile(): JestTestFile | undefined {
        return this.file;
    }

    public set location(value: nodes.NodeLocation) {
        this.start = value.start;
        this.end = value.end;
    }

    public set nameLocation(value: nodes.NodeLocation) {
        this.nameStart = value.start;
        this.nameEnd = value.end;
    }

    public get testResult() {
        return this._testResult;
    }

    public set testResult(value: nodes.ITestResult | undefined) {
        this._testResult = value;
    }

    addChild(type: nodes.TestNodeType, name?: string, file?: JestTestFile): nodes.ITestNode {
        const child: nodes.ITestNode = getNewParseResult(type, file, name);
        return this.addChildNode(child);
    }

    public position(filePath: string): vscode.Position {
        if (!this.file || this.file.path !== filePath) {
            return DefaultPosition;
        }

        return this.start;
    }

    public range(filePath: string): vscode.Range {
        const pos = this.position(filePath);

        return pos === DefaultPosition ? DefaultRange : new vscode.Range(pos, this.end);
    }

    public namePosition(filePath: string): vscode.Position {
        if (!this.file || this.file.path !== filePath) {
            return DefaultPosition;
        }

        return this.nameStart;
    }

    public nameRange(filePath: string): vscode.Range {
        const pos = this.namePosition(filePath);

        return pos === DefaultPosition ? DefaultRange : new vscode.Range(pos, this.nameEnd);
    }

    public mergeWith(other: nodes.ITestNode): void {
        if (!other.children) {
            return;
        }
        other.children.forEach(x => {
            if (x.type === 'describe' && this.childDescribesMap[x.name || '']) {
                this.childDescribesMap[x.name || ''].mergeWith(x);
            }
            else {
                this.addChildNode(x);
            }
        });
    }

    public remergeWith(other: IManagedTestNode): void {
        // remerge children
        if (!other.children) {
            return;
        }
        if (!this.children) {
            other.children.forEach(child => this.addChildNode(child));
            return;
        }
        const fileNodesMap = this.getFileNodesMap(other);
        const files = fileNodesMap.files;

        files.forEach(file => {
            const map = fileNodesMap.getMapForFile(file);
            if (map) {
                this.removeDeletedExistingNodes(file, map);
            }
        });

        other.children.forEach(otherChild => {
            let thisChild: nodes.ITestNode | undefined;
            // if container, find a child of ours with the same fqName
            if (otherChild.isContainer) {
                thisChild = this.children ? this.children.find(child => child.fqName === otherChild.fqName) : undefined;
            }
            else {
                thisChild = this.children ? this.children.find(child => {
                    if (!child.jestTestFile || !otherChild.jestTestFile) {
                        return false;
                    }
                    return child.jestTestFile.path === otherChild.jestTestFile.path && child.fqName === otherChild.fqName;
                }) : undefined;
            }
            if (thisChild) {
                (thisChild as IManagedTestNode).remergeWith(otherChild as IManagedTestNode);
            }
            else {
                this.addChildNode(otherChild);
            }
        });
    }

    public filter(f: (node: nodes.ITestNode) => boolean, filterSelf: boolean = false, ): Array<nodes.ITestNode> {
        const filtered: Array<nodes.ITestNode> = [];

        const _filter = (node: nodes.ITestNode, _filterSelf: boolean) => {
            if (_filterSelf && f(node)) {
                filtered.push(node);
            }

            if (node.children) {
                node.children.forEach(c => _filter(c, true));
            }
        };

        _filter(this, filterSelf);
        return filtered;
    }

    /**
     * Gets an array of ITestNode containing the given node and all ancestors and descendants.
     * 
     * @returns {nodes.ITestNode[]}
     */
    public flatten(): nodes.ITestNode[] {
        const flatDown = this.flattenDown();
        const flatUp = this.flattenUp();

        return [...flatUp, ...flatDown.slice(1)];
    }

    /**
     * Gets an array of ITestNode containing the given node and all ancestors.
     * 
     * @returns {nodes.ITestNode[]}
     * 
     * Nodes will be returned in descending order of ancestry.
     */
    public flattenUp(): nodes.ITestNode[] {
        const retVal: nodes.ITestNode[] = [this];
        let parent = this.parent;
        while (parent) {
            retVal.push(parent);
            parent = parent.parent;
        }

        return retVal.reverse();
    }

    /**
     * Gets an array of ITestNode containing this node and all descendants.
     * 
     * @returns {nodes.ITestNode[]}
     */
    public flattenDown(): nodes.ITestNode[] {
        const retVal: nodes.ITestNode[] = [this];
        if (this.children) {
            this.children.forEach(child => {
                const childRet = child.flattenDown();
                retVal.push(...childRet);
            });
        }
        return retVal;
    }

    public removeNodesForFile(file: string) {
        if (!this.children) {
            return;
        }
        const nodes: nodes.ITestNode[] = [];
        this.children.forEach(child => {
            nodes.push(...child.flattenDown().filter(c => c.position(file) !== DefaultPosition));
        });
        nodes.sort((a, b) => { const aName = a.fqName || ''; const bName = b.fqName || ''; if (aName > bName) { return -1; } if (aName < bName) { return 1; } return 0; });
        nodes.forEach(n => {
            if (n.type === 'it' && n.parent) {
                (n.parent as TestNode).removeChildNode(n);
            }
            else {
                const dNode = n as DescribeNode;
                dNode.removeFoundIn(file);
                dNode.removeNameFoundIn(file);
                if (!dNode.foundIn.length && dNode.parent) {
                    (dNode.parent as TestNode).removeChildNode(dNode);
                }
            }
        });
    }

    protected addChildNode(node: nodes.ITestNode): nodes.ITestNode {
        switch (node.type) {
            case nodes.TestNodeTypes.describe:
                if (this.childDescribesMap[node.name || '']) {
                    this.childDescribesMap[node.name || ''].mergeWith(node);
                    return this.childDescribesMap[node.name || ''];
                }
                else {
                    this.childDescribesMap[node.name || ''] = node as DescribeNode;
                    if (node.itBlocks) {
                        node.itBlocks.forEach(x => this.addItBlock(x as ItNode));
                    }
                }
                break;
            case nodes.TestNodeTypes.it:
                this.addItBlock(node as ItNode);
                break;
            case nodes.TestNodeTypes.expect:
                this.addExpectBlock(node);
                node.parent = this;
                return node;
            default:
                throw TypeError(`unexpected child node type: ${node.type}`);
        }
        node.parent = this;
        if (!this.children) {
            this.children = [node];
        } else {
            this.children.push(node);
        }
        return node;
    }
    protected addItBlock(node: ItNode) {
        if (!this.itBlocks) {
            this.itBlocks = [];
        }
        this.itBlocks.push(node);
        if (this.parent) {
            (this.parent as TestNode).addItBlock(node);
        }
    }
    protected addExpectBlock(node: nodes.ITestNode) {
        if (!this.expects) {
            this.expects = [];
        }
        this.expects.push(node);
    }

    protected removeChildNode(node: nodes.ITestNode) {
        if (!this.children || !this.children.includes(node)) {
            return;
        }
        this.children = this.children.filter(child => child !== node);
        if (node.type === 'it') {
            this.removeItBlock(node as ItNode);
        }
    }
    protected removeItBlock(it: ItNode) {
        if (this.itBlocks && this.itBlocks.includes(it)) {
            this.itBlocks = this.itBlocks.filter(ib => ib !== it);
        }
        if (this.parent) {
            (this.parent as TestNode).removeItBlock(it);
        }
    }

    protected getFileNodesMap(otherNode: IManagedTestNode) {
        const fileNodesMap = new FileNodeMap();
        const otherFlats: nodes.ITestNode[] = otherNode.children ? otherNode.children.reduce((out, child) => { out.push(...child.flattenDown()); return out; }, [] as nodes.ITestNode[]) : [];
        otherFlats.forEach(o => {
            if (o.type === 'describe') {
                const od = o as DescribeNode;
                od.foundIn.forEach(fi => {
                    fileNodesMap.addOtherNode(fi.file.path, o);
                });
            }
            else if (o.jestTestFile) {
                fileNodesMap.addOtherNode(o.jestTestFile.path, o);
            }
        });
        const files = fileNodesMap.files;
        if (this.children) {
            const thisFlats: nodes.ITestNode[] = [];
            this.children.forEach(child => {
                thisFlats.push(...child.flattenDown().filter(f => files.filter(file => f.position(file) !== DefaultPosition).length > 0));
            });
            thisFlats.forEach(t => {
                if (t.type === 'describe') {
                    const td = t as DescribeNode;
                    td.foundIn.forEach(fi => {
                        if (files.includes(fi.file.path)) {
                            fileNodesMap.addThisNode(fi.file.path, t);
                        }
                    });
                }
                else if (t.jestTestFile) {
                    fileNodesMap.addThisNode(t.jestTestFile.path, t);
                }
            });
        }

        return fileNodesMap;
    }

    protected removeDeletedExistingNodes(file: string, map: NodeMap) {
        // first, remove existing tests which no longer exist.
        map.thisItNodes.forEach(it => {
            if (it.parent && !map.otherItNodes.find(oi => oi.fqName === it.fqName)) {
                (it.parent as TestNode).removeChildNode(it);
            }
        });
        // then, remove existing suites which no longer exist.
        map.thisNodes.filter(tn => tn.type === 'describe').forEach(tn => {
            const dNode = tn as DescribeNode;
            const other = map.otherNodes.find(o => o.type === dNode.type && o.fqName === dNode.fqName);
            if (!other) {
                dNode.removeFoundIn(file);
                dNode.removeNameFoundIn(file);
            }
            if (!dNode.foundIn.length && dNode.parent) {
                (dNode.parent as TestNode).removeChildNode(dNode);
            }
        });
    }
}

class RootNode extends TestNode {
    constructor() {
        super('root');
    }
}

class DescribeNode extends TestNode {
    protected _foundIn: nodes.NodeLocation[] = [];
    protected _nameFoundIn: nodes.NodeLocation[] = [];
    constructor(name?: string) {
        super('describe', undefined, name);
    }

    public get foundIn(): nodes.NodeLocation[] {
        return this._foundIn.slice();
    }

    public get nameFoundIn(): nodes.NodeLocation[] {
        return this._nameFoundIn.slice();
    }

    public addFoundIn(value: nodes.NodeLocation): void {
        this._foundIn.push(value);
    }

    public removeFoundIn(file: string) {
        this._foundIn = this._foundIn.filter(fi => fi.file.path !== file);
    }

    public addNameFoundIn(value: nodes.NodeLocation): void {
        this._nameFoundIn.push(value);
    }

    public removeNameFoundIn(file: string) {
        this._nameFoundIn = this._nameFoundIn.filter(fi => fi.file.path !== file);
    }

    public mergeWith(other: nodes.ITestNode): void {
        super.mergeWith(other);
        if (other.type === this.type) {
            const mergeNodeLocations = (thisLocations: nodes.NodeLocation[], otherLocations: nodes.NodeLocation[]) => {
                otherLocations.forEach(ol => {
                    let tl = thisLocations.filter(x => x.file === ol.file);
                    if (tl && tl.length) {
                        tl = tl.filter(x => x.start.isEqual(ol.start));
                    }
                    if (!tl || !tl.length) {
                        thisLocations.push(ol);
                    }
                });
            };
            mergeNodeLocations(this.foundIn, (other as DescribeNode).foundIn);
            mergeNodeLocations(this.nameFoundIn, (other as DescribeNode).nameFoundIn);
        }
    }

    public position(filePath: string): vscode.Position {
        const foundIn = this._foundIn.find(fi => fi.file.path === filePath);
        if (!foundIn) {
            return DefaultPosition;
        }

        return foundIn.start;
    }

    public range(filePath: string): vscode.Range {
        const foundIn = this._foundIn.find(fi => fi.file.path === filePath);
        if (!foundIn) {
            return DefaultRange;
        }

        return new vscode.Range(foundIn.start, foundIn.end);
    }

    public namePosition(filePath: string): vscode.Position {
        const foundIn = this._nameFoundIn.find(fi => fi.file.path === filePath);
        if (!foundIn) {
            return DefaultPosition;
        }

        return foundIn.start;
    }

    public nameRange(filePath: string): vscode.Range {
        const foundIn = this._nameFoundIn.find(fi => fi.file.path === filePath);
        if (!foundIn) {
            return DefaultRange;
        }

        return new vscode.Range(foundIn.start, foundIn.end);
    }

    public remergeWith(other: IManagedTestNode) {
        if (this.fqName !== other.fqName) {
            return;
        }
        const otherD = other as DescribeNode;
        otherD._foundIn.forEach(fI => {
            const thisFI = this._foundIn.find(tfi => tfi.file.path === fI.file.path);
            if (thisFI) {
                thisFI.start = fI.start;
                thisFI.end = fI.end;
            }
            else {
                this.addFoundIn(fI);
            }
        });

        super.remergeWith(other);
    }
}

class ItNode extends TestNode {
    constructor(file: JestTestFile, name?: string) {
        super('it', file, name);
    }

    public remergeWith(other: IManagedTestNode) {
        if (this.fqName !== other.fqName) {
            return;
        }
        this.start = other.start;
        this.end = other.end;
        this.nameStart = other.nameStart;
        this.nameEnd = other.nameEnd;

        this.remergeExpects(other.expects);
    }

    private remergeExpects(others?: nodes.ITestNode[]) {
        // positive identification of an ExpectNode is difficult and unnecessary
        // remerging an ItNode will always mean replacing its contents, including its
        // ExpectNodes
        this.expects = undefined;
        if (!others || !others.length) {
            return;
        }
        others.forEach(other => this.addExpectBlock(other));
    }
}

class ExpectNode extends TestNode {
    constructor(file: JestTestFile, name?: string) {
        super('expect', file, name);
    }

    public remergeWith(other: IManagedTestNode) {
        this.start = other.start;
        this.end = other.end;
        this.nameStart = other.nameStart;
        this.nameEnd = other.nameEnd;
    }
}

export default class TestNodeManager {
    private static _rootNode: RootNode | undefined;
    private static _disposables: DisposableManager = new DisposableManager();
    private static _fileTestNodes: { [key: string]: nodes.ITestNode[] } = {};
    private static _jestDirs: IJestDirectory[] | undefined = undefined;
    private static onTestsUpdatingEmitter = new vscode.EventEmitter<vscode.Uri>();
    private static onTestsUpdatedEmitter = new vscode.EventEmitter<nodes.ITestNode | undefined>();

    public static get onTestsUpdated(): vscode.Event<nodes.ITestNode | undefined> {
        return TestNodeManager.onTestsUpdatedEmitter.event;
    }

    public static get onTestsUpdating(): vscode.Event<vscode.Uri> {
        return TestNodeManager.onTestsUpdatingEmitter.event;
    }

    public static get RootNode(): nodes.ITestNode | undefined {
        return TestNodeManager._rootNode;
    }

    public static async LoadTests(jestDirs: IJestDirectory[]): Promise<void> {
        TestNodeManager._jestDirs = jestDirs;
        const pResults: ParseResult[] = [];
        for (let jestDir of jestDirs) {
            pResults.push(await discoverTests(jestDir));
        }

        const rootNode = new RootNode();

        pResults.forEach(pResult => {
            const pRoot = TestNodeManager.loadTestsForParseResult(pResult);

            rootNode.mergeWith(pRoot);
        });

        TestNodeManager._rootNode = rootNode;

        TestNodeManager.loadFileTestNodes();

        TestNodeManager.onTestsUpdatedEmitter.fire(rootNode);

        TestNodeManager.addWatchers(jestDirs);
    }

    public static ParseTestResults(stdout: string): void {

        const rawResult = JSON.parse(stdout);

        const its = TestNodeManager._rootNode ? TestNodeManager._rootNode.itBlocks : undefined;

        if (!its) {
            return;
        }

        rawResult.testResults.forEach((x: any) => {
            x.assertionResults.forEach((a: any) => {
                const aFQ = a.ancestorTitles.join(':');
                const fqName = `${(aFQ && aFQ.length) ? aFQ + ':' : ''}${a.title}`;
                const node = its.find(n => n.fqName === fqName);
                if (node && (!node.testResult || a.status !== 'pending')) {
                    node.testResult = new TestResult(node, a.status, a.failureMessages);
                    node.running = false;
                    let parent = node.parent;
                    while (parent && !parent.testResult) {
                        parent.testResult = new ContainerTestResult(parent);
                        parent = parent.parent;
                    }
                }
            });
        });

        TestNodeManager.onTestsUpdatedEmitter.fire(TestNodeManager._rootNode);

        CoverageMapManager.ProcessRawCoverage(rawResult.coverageMap);
    }

    public static GetTestNodesForFile(filePath: string): nodes.ITestNode[] | undefined {
        if (!TestNodeManager._fileTestNodes[filePath]) {
            return;
        }
        const retVal = TestNodeManager._fileTestNodes[filePath].slice();

        return retVal;
    }

    public static dispose() {
        TestNodeManager._disposables.dispose();
    }

    private static loadTestsForParseResult(pResult: ParseResult): RootNode {

        const addChildNode = (pResult: ParseResult, parent: nodes.ITestNode) => {
            const child = (parent as TestNode).addChild(pResult.type, pResult.name, pResult.locations.length === 1 ? pResult.locations[0].file : undefined);
            if (child.type === nodes.TestNodeTypes.describe) {
                const dNode = child as DescribeNode;
                pResult.locations.forEach(loc => {
                    dNode.addFoundIn(loc);
                });
                pResult.nameLocations.forEach(loc => {
                    dNode.addNameFoundIn(loc);
                });
            }
            else if (child.type !== nodes.TestNodeTypes.root) {
                const tNode = child as TestNode;
                if (pResult.locations.length === 1) {
                    tNode.location = pResult.locations[0];
                }
                if (pResult.nameLocations.length === 1) {
                    tNode.nameLocation = pResult.locations[0];
                }
            }
            if (pResult.children) {
                pResult.children.forEach(x => addChildNode(x, child));
            }
            if (pResult.expects) {
                pResult.expects.forEach(x => addChildNode(x, child));
            }
        };

        const pRoot = new RootNode();

        if (pResult.children) {
            pResult.children.forEach(child => addChildNode(child, pRoot));
        }

        return pRoot;
    }

    private static loadFileTestNodes() {
        TestNodeManager._fileTestNodes = {};

        const rootNode = TestNodeManager._rootNode;

        if (rootNode && rootNode.itBlocks) {
            rootNode.itBlocks.forEach(it => {
                const file = it.jestTestFile ? it.jestTestFile.path : '';
                if (!TestNodeManager._fileTestNodes[file]) {
                    TestNodeManager._fileTestNodes[file] = [];
                }
                const arry = TestNodeManager._fileTestNodes[file];
                const flatNodes = it.flattenUp();
                flatNodes.forEach(node => {
                    if (!arry.includes(node)) {
                        arry.push(node);
                    }
                });
            });
        }

    }

    private static addWatchers(jestDirs: IJestDirectory[]) {
        TestNodeManager._disposables.addDisposble("documentChanged", vscode.workspace.onDidChangeTextDocument(TestNodeManager.onDidChangeTextDocument));

        const watcher = vscode.workspace.createFileSystemWatcher("**/*.{js,jsx,ts,tsx}", false, true, false);
        TestNodeManager._disposables.addDisposble("fsWatcher", watcher);
        TestNodeManager._disposables.addDisposble("fileDeleted", watcher.onDidDelete(TestNodeManager.handleFileDeleted));
        TestNodeManager._disposables.addDisposble("fileCreated", watcher.onDidCreate(TestNodeManager.handleFileCreated));
    }

    private static parseChangedDocument = debounce((doc: vscode.TextDocument) => {
        // reparse the file
        const jestTestFile = TestNodeManager.getJestTestFile(doc.fileName);
        if (!jestTestFile) {
            return;
        }
        const updatedTests = TestNodeManager.loadTestsForParseResult(rediscoverTests(doc.getText(), jestTestFile));

        // merge changes into our root node
        if (TestNodeManager._rootNode) {
            TestNodeManager._rootNode.remergeWith(updatedTests);
        }

        // alert the rest of the extension that there are changes
        TestNodeManager.onTestsUpdatedEmitter.fire(TestNodeManager._rootNode);
        TestNodeManager.loadFileTestNodes();
    }, 2500, false);

    private static fireTestsUpdating = debounce((uri: vscode.Uri) => {
        TestNodeManager.onTestsUpdatingEmitter.fire(uri);
    }, 2000, true);

    private static async onDidChangeTextDocument(event: vscode.TextDocumentChangeEvent) {
        if (!event.contentChanges.length) {
            return;
        }
        if (event.document.uri.scheme === 'git') {
            return;
        }

        // ignore a file that isn't one of our test files
        if (!TestNodeManager._fileTestNodes[event.document.fileName]) {
            return;
        }

        TestNodeManager.fireTestsUpdating(event.document.uri);
        TestNodeManager.parseChangedDocument(event.document);
    }

    private static handleFileDeleted(uri: vscode.Uri) {
        if (!TestNodeManager._fileTestNodes[uri.path] || !TestNodeManager._rootNode) {
            return;
        }

        TestNodeManager._rootNode.removeNodesForFile(uri.path);
        delete TestNodeManager._fileTestNodes[uri.path];

        // alert the rest of the extension that there are changes
        TestNodeManager.onTestsUpdatedEmitter.fire(TestNodeManager._rootNode);
    }

    private static getJestTestFile(filePath: string): JestTestFile | undefined {
        let jestFile: JestTestFile | undefined = undefined;
        const nodes = TestNodeManager._fileTestNodes[filePath];
        if (nodes) {
            const itWithJestTestFile = nodes.find(it => !!it.jestTestFile);
            jestFile = itWithJestTestFile ? itWithJestTestFile.jestTestFile : undefined;
        }
        if (!jestFile) {
            const jestDir = TestNodeManager._jestDirs ? TestNodeManager._jestDirs.find(jd => filePath.startsWith(jd.projectPath)) : undefined;
            if (jestDir) {
                jestFile = new JestTestFile(jestDir, filePath);
            }
        }

        return jestFile;
    }

    private static handleFileCreated(uri: vscode.Uri) {
        const jestFile = TestNodeManager.getJestTestFile(uri.path);
        if (!jestFile) {
            return;
        }

        discoverTestsForFile(jestFile)
            .then(parseResult => {
                const newTests = TestNodeManager.loadTestsForParseResult(parseResult);
                if (TestNodeManager._rootNode) {
                    TestNodeManager._rootNode.mergeWith(newTests);
                }
                else {
                    TestNodeManager._rootNode = newTests;
                }
            })
            .then(() => {
                if (!TestNodeManager._fileTestNodes[uri.path]) {
                    TestNodeManager._fileTestNodes[uri.path] = [];
                }

                // alert the rest of the extension that there are changes
                TestNodeManager.onTestsUpdatedEmitter.fire(TestNodeManager._rootNode);
            });
    }
}