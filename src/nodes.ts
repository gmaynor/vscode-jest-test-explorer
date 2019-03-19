import * as vscode from 'vscode';
import { IJestDirectory, JestTestFile } from './testDirectories';
import { ParseResult, discoverTests } from './testDiscovery';
import { TestNodeType, TestNodeTypes, TestStatus, DefaultPosition, DefaultRange } from './utility';
import { stat } from 'fs';

export type DescribeLocation = {
  file: JestTestFile,
  start: vscode.Position,
  end: vscode.Position
};

export interface ITestResult {
    status: TestStatus;
    failureMessages?: Array<string>;
    testNode: ITestNode;
}

export interface ITestNode {
  type: TestNodeType;
  isContainer: boolean;
  name?: string;
  fqName: string | undefined;
  parent?: ITestNode;
  children?: Array<ITestNode>;
  itBlocks?: ItNode[];
  jestTestFile?: JestTestFile;
  running: boolean;
  testResult?: ITestResult;
  position(filePath: string): vscode.Position;
  nameRange(filePath: string): vscode.Range;
  mergeWith(other: ITestNode): void;
}

interface IFn {
  name: string;
  loc: vscode.Range;
  decl?: vscode.Range;
}
interface IBranch {
  type: string;
  loc: vscode.Range;
  locations: vscode.Range[];
}
interface IMap<T> {
  [key: number]: T;
}
interface ICoverageLoc {
  start: { line: number, column: number };
  end: { line: number, column: number };
}
interface ICoverageMetric {
  name: string;
  instanceCount: number;
  hitCount: number;
  percentage: number;
}
interface ICoverageMetrics {
  [key: string]: ICoverageMetric;
}

export interface IFileCoverageResult {
  path: string;
  branchMap: IMap<IBranch>;
  fnMap: IMap<IFn>;
  statementMap: IMap<vscode.Range>;
  branchHits: IMap<number[]>;
  fnHits: IMap<number>;
  statementHits: IMap<number>;
  metrics: ICoverageMetrics;
}

export interface ICoverageMap {
  [key: string]: IFileCoverageResult;
}

const getNewParseResult = (type: TestNodeType, file?: JestTestFile, name?: string): RootNode | DescribeNode | ItNode => {
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
    default:
      throw Error(`Unexpected type '${type}'`);
  }
};

class TestResult implements ITestResult {
    failureMessages?: Array<string>;

    constructor(public testNode: ITestNode, public status: TestStatus, failMessages?: string[]) {
        this.failureMessages = failMessages;
    }
}

class ContainerTestResult implements ITestResult {

    constructor(public testNode: ITestNode) {

    }

    public get status(): TestStatus {
        const children: ITestNode[] = this.testNode.children || [];
        if (!children.length) {
            return 'pending';
        }

        if (children.some((child: ITestNode) => child.testResult ? child.testResult.status === 'failed' : false)) {
            return 'failed';
        }
        const statii: Array<TestStatus> = [ 'passed', 'skipped', 'todo' ];
        let retVal: TestStatus | undefined;
        for (let i = 0; i < statii.length && !retVal; i++) {
            const s = statii[i];
            if (children.every((child: ITestNode) => child.testResult ? child.testResult.status === s : false)) {
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

class TestNode implements ITestNode {
  type: TestNodeType;
  file?: JestTestFile;
  name?: string;
  isContainer: boolean;
  start: vscode.Position = DefaultPosition;
  end: vscode.Position = DefaultPosition;
  running: boolean = false;
  parent?: ITestNode;
  children?: Array<ITestNode>;
  itBlocks?: ItNode[];
  private _testResult?: ITestResult;

  private childDescribesMap: { [key: string]: DescribeNode } = {};

  constructor(type: TestNodeType, file?: JestTestFile, name?: string) {
    this.type = type;
    this.file = file;
    this.name = name;
    this.isContainer = this.type === 'root' || this.type === 'describe';
  }

  addChild(type: TestNodeType, name?: string, file?: JestTestFile): ITestNode {
    const child: ITestNode = getNewParseResult(type, file, name);
    this.addChildNode(child);
    return child;
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

  public position(filePath: string): vscode.Position {
    if (!this.file || this.file.path !== filePath) {
      return DefaultPosition;
    }

    return this.start;
  }

  public nameRange(filePath: string): vscode.Range {
    const position = this.position(filePath);

    return position === DefaultPosition ? DefaultRange : new vscode.Range(position, position.translate(0, this.name ? this.name.length : 0));
  }

  public mergeWith(other: ITestNode): void {
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

  public filter(f: (node: ITestNode) => boolean, filterSelf: boolean = false, ): Array<ITestNode> {
    const filtered: Array<ITestNode> = [];

    const _filter = (node: ITestNode, _filterSelf: boolean) => {
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

  public get testResult() {
      return this._testResult;
  }

  public set testResult(value: ITestResult | undefined) {
      this._testResult = value;
  }

  protected addChildNode(node: ITestNode): void {
    let addToChildren = true;
    switch (node.type) {
      case TestNodeTypes.describe:
        if (this.childDescribesMap[node.name || '']) {
          addToChildren = false;
          this.childDescribesMap[node.name || ''].mergeWith(node);
        }
        else if (node.itBlocks) {
          this.childDescribesMap[node.name || ''] = node as DescribeNode;
          node.itBlocks.forEach(x => this.addItBlock(x));
        }
        break;
      case TestNodeTypes.it:
        this.addItBlock(node as ItNode);
        break;
      default:
        throw TypeError(`unexpected child node type: ${node.type}`);
    }
    if (!addToChildren) {
      return;
    }
    node.parent = this;
    if (!this.children) {
      this.children = [node];
    } else {
      this.children.push(node);
    }
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
}

class RootNode extends TestNode {
  constructor() {
    super('root');
  }
}

class DescribeNode extends TestNode {
  protected _foundIn: DescribeLocation[] = [];
  constructor(name?: string) {
    super('describe', undefined, name);
  }

  public get foundIn(): DescribeLocation[] {
    return this._foundIn.slice();
  }

  public addFoundIn(value: DescribeLocation): void {
    this._foundIn.push(value);
  }

  public mergeWith(other: ITestNode): void {
    super.mergeWith(other);
    if (other.type === this.type) {
      const alsoFound = (<DescribeNode>other).foundIn;
      alsoFound.forEach(af => {
        let thisFound = this.foundIn.filter(x => x.file === af.file);
        if (!thisFound || !thisFound.length) {
          this.foundIn.push(af);
        }
        else {
          thisFound = thisFound.filter(x => x.start.isEqual(af.start));
        }
        if (!thisFound || thisFound.length === 0) {
          this.foundIn.push(af);
        }
      });
    }
  }

  public position(filePath: string): vscode.Position {
    const foundIn = this._foundIn.find(fi => fi.file.path === filePath);
    if (!foundIn) {
      return DefaultPosition;
    }

    return foundIn.start;
  }
}

class ItNode extends TestNode {
  constructor(file: JestTestFile, name?: string) {
    super('it', file, name);
  }
}

class FileCoverageResult implements IFileCoverageResult {
  public readonly branchMap: IMap<IBranch> = {};
  public readonly fnMap: IMap<IFn> = {};
  public readonly statementMap: IMap<vscode.Range> = {};
  public readonly branchHits: IMap<number[]> = {};
  public readonly fnHits: IMap<number> = {};
  public readonly statementHits: IMap<number> = {};
  public readonly metrics: ICoverageMetrics = {};
  private readonly _path: string;

  public static locToRange(loc: ICoverageLoc): vscode.Range {
    const posInvalid = (pos: { line: number | null, column: number | null}): boolean => {
      if (pos.line === null || pos.line < 0) {
        return true;
      }
      if (pos.column === null || pos.column < 0) {
        return true;
      }
      return false;
    };
    if (posInvalid(loc.start)) {
      return DefaultRange;
    }
    if (posInvalid(loc.end)) {
      loc.end = loc.start;
    }
    return new vscode.Range(loc.start.line - 1, loc.start.column, loc.end.line - 1, loc.end.column);
  }

  public constructor(jsonNode: any) {
    this._path = jsonNode.path;
    Object.keys(jsonNode.branchMap).map(key => parseInt(key)).forEach(key => {
      const tmp = jsonNode.branchMap[key];
      this.branchMap[key] = { type: tmp.type, loc: FileCoverageResult.locToRange(tmp.loc), locations: (tmp.locations as ICoverageLoc[]).map(loc => FileCoverageResult.locToRange(loc)) };
    });
    Object.keys(jsonNode.fnMap).map(key => parseInt(key)).forEach(key => {
      const tmp = jsonNode.fnMap[key];
      this.fnMap[key] = { name: tmp.name, loc: FileCoverageResult.locToRange(tmp.loc), decl: tmp.decl ? FileCoverageResult.locToRange(tmp.decl) : undefined };
    });
    Object.keys(jsonNode.statementMap).map(key => parseInt(key)).forEach(key => {
      const tmp = jsonNode.statementMap[key];
      this.statementMap[key] = FileCoverageResult.locToRange(tmp);
    });
    Object.keys(jsonNode.b).map(key => parseInt(key)).forEach(key => {
      this.branchHits[key] = [ ...jsonNode.b[key] ];
    });
    Object.keys(jsonNode.f).map(key => parseInt(key)).forEach(key => {
      this.fnHits[key] = jsonNode.f[key];
    });
    Object.keys(jsonNode.s).map(key => parseInt(key)).forEach(key => {
      this.statementHits[key] = jsonNode.s[key];
    });

    this.calculateMetrics();
  }

  public get path(): string {
    return this._path;
  }

  private calculateMetrics() {
    const getHits = (key: string, map: IMap<number> | IMap<number[]>) => {
      const keyNum = parseInt(key);
      let hits: number | number[] = map[keyNum];
      if (!Array.isArray(hits)) {
        return hits > 0 ? 1 : 0;
      }
      return hits.reduce((out, hit) => { if (hit > 0) { out += 1; } return out; }, 0);
    };
    const statements = Object.keys(this.statementMap).length;
    const statementHits = Object.keys(this.statementHits).reduce((count: number, key: string) => { count += getHits(key, this.statementHits); return count; }, 0);
    const fns = Object.keys(this.fnMap).length;
    const fnHits = Object.keys(this.fnHits).reduce((count: number, key: string) => { count += getHits(key, this.fnHits); return count; }, 0);
    const branches = Object.keys(this.branchMap).reduce((count, key) => { const keyNum = parseInt(key); count += this.branchMap[keyNum].locations.length; return count; }, 0);
    const branchHits = Object.keys(this.branchHits).reduce((count: number, key: string) => { count += getHits(key, this.branchHits); return count; }, 0);

    this.metrics['statements'] = { name: 'statement coverage', instanceCount: statements, hitCount: statementHits, percentage: statementHits / statements };
    this.metrics['functions'] = { name: 'function coverage', instanceCount: fns, hitCount: fnHits, percentage: fnHits / fns };
    this.metrics['branches'] = { name: 'branch coverage', instanceCount: branches, hitCount: branchHits, percentage: branchHits / branches };
  }
}


let _rootNode: RootNode;
let _coverageMap: ICoverageMap;

export const getRootNode = ():ITestNode | undefined => {
    return _rootNode;
};

export const getCoverageMap = (): ICoverageMap | undefined => {
  return _coverageMap;
};


export const loadTests = async (jestDirs: IJestDirectory[]): Promise<ITestNode> => {
    const pResults: ParseResult[] = [];
    for (let jestDir of jestDirs) {
        pResults.push(await discoverTests(jestDir));
    }

    _rootNode = new RootNode();

    const addChildNode = (pResult: ParseResult, parent: ITestNode) => {
        const child = (parent as TestNode).addChild(pResult.type, pResult.name, pResult.locations.length === 1 ? pResult.locations[0].file : undefined);
        if (child.type === TestNodeTypes.describe) {
            const dNode = child as DescribeNode;
            pResult.locations.forEach(loc => {
                dNode.addFoundIn(loc);
            });
        }
        else if (child.type === TestNodeTypes.it && pResult.locations.length === 1) {
            const iNode = child as ItNode;
            iNode.start = pResult.locations[0].start;
            iNode.end = pResult.locations[0].end;
        }
        if (pResult.children) {
            pResult.children.forEach(x => addChildNode(x, child));
        }
    };

    pResults.forEach(pResult => {
        const pRoot = new RootNode();
        if (pResult.children) {
            pResult.children.forEach(child => { addChildNode(child, pRoot); });
        }

        _rootNode.mergeWith(pRoot);
    });

    return _rootNode;
};


export const parseTestResults = (stdout: string): void => {
    const rawResult = JSON.parse(stdout);

    const its = _rootNode ? _rootNode.itBlocks : undefined;

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
                let parent = node.parent;
                while (parent && !parent.testResult) {
                    parent.testResult = new ContainerTestResult(parent);
                    parent = parent.parent;
                }
            }
        });
    });

    _coverageMap = Object.keys(rawResult.coverageMap).reduce((out, key) => { out[key] = new FileCoverageResult(rawResult.coverageMap[key]); return out; }, {} as ICoverageMap);
};
