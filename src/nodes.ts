import * as vscode from 'vscode';
import { DefaultPosition, DefaultRange, JestTestFile } from './utility';


export type TestNodeType = 'root' | 'describe' | 'it' | 'expect';
export const TestNodeTypes = {
  root: 'root',
  describe: 'describe',
  it: 'it',
  expect: 'expect'
};

export type TestStatus = 'pending' | 'passed' | 'failed' | 'skipped' | 'todo';

export type NodeLocation = {
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
  expects?: Array<ITestNode>;
  itBlocks?: ITestNode[];
  jestTestFile?: JestTestFile;
  running: boolean;
  testResult?: ITestResult;
  position(filePath: string): vscode.Position;
  range(filePath: string): vscode.Range;
  namePosition(filePath: string): vscode.Position;
  nameRange(filePath: string): vscode.Range;
  mergeWith(other: ITestNode): void;
  flatten(): ITestNode[];
  flattenUp(): ITestNode[];
  flattenDown(): ITestNode[];
}

/** A Map of type T having numeric keys */
export interface INumberMap<T> {
  [key: number]: T;
}

export interface ICoverageMetric {
  name: string;
  instanceCount: number;
  hitCount: number;
  percentage: number;
}
export interface ICoverageMetrics {
  [key: string]: ICoverageMetric;
}

export interface IFileCoverageResult {
  path: string;
  branchMap: INumberMap<{ type: string, loc: vscode.Range, locations: vscode.Range[] }>;
  fnMap: INumberMap<{ name: string, loc: vscode.Range, decl?: vscode.Range }>;
  statementMap: INumberMap<vscode.Range>;
  branchHits: INumberMap<number[]>;
  fnHits: INumberMap<number>;
  statementHits: INumberMap<number>;
  lineMap: INumberMap<number>;
  metrics: ICoverageMetrics;
  uncoveredLines: Array<number>;
}

export interface ICoverageMap {
  [key: string]: IFileCoverageResult;
}
