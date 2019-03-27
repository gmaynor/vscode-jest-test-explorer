/**
 * Test file parsing derived from jest-community/jest-editor-support (https://github.com/jest-community/jest-editor-support)
 *     src/parsers/babylon_parser.js
 *     src/parsers/parser_nodes.js
 *     src/types.js
 * 
 * Those files' copyright and license info are below.
 * 
 * Copyright (c) 2014-present, Facebook, Inc. All rights reserved.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 */

import * as Babylon from 'babel-types';
import { File as BabylonFile, Node as BabylonNode } from 'babel-types';
import { BabylonOptions, parse as babylonParse, PluginName } from 'babylon';
import * as vscode from 'vscode';
import { Executor } from './executor';
import Logger from './logger';
import { NodeLocation, TestNodeType, TestNodeTypes } from './nodes';
import { DefaultRange, IJestDirectory, JestTestFile, readfileP } from './utility';

type NameAndRanges = {
  name?: string,
  range?: vscode.Range,
  nameRange?: vscode.Range
};

export class ParseResult {
  private _type: TestNodeType;
  private _locations: NodeLocation[] = [];
  private _nameLocations: NodeLocation[] = [];
  private _children?: ParseResult[];
  private _expects?: ParseResult[];

  constructor(type: TestNodeType, private _name?: string, private _fnName?: string) {
    this._type = type;
  }

  public get type(): TestNodeType {
    return this._type;
  }

  public get name(): string | undefined {
    return this._name;
  }

  public get fnName(): string | undefined {
    return this._fnName;
  }

  public get locations(): NodeLocation[] {
    return this._locations;
  }

  public get nameLocations(): NodeLocation[] {
    return this._nameLocations;
  }

  public get children(): ParseResult[] | undefined {
    return this._children;
  }

  public get expects(): ParseResult[] | undefined {
    return this._expects;
  }

  public addChild(child: ParseResult) {
    if (child._type === TestNodeTypes.expect) {
      this.addExpect(child);
      return;
    }
    if (!this._children) {
      this._children = [];
    }
    this._children.push(child);
  }

  private addExpect(expect: ParseResult) {
    if (!this._expects) {
      this._expects = [];
    }
    this._expects.push(expect);
  }
}

interface GetAstResult {
  babylonFile: BabylonFile;
  jestTestFile: JestTestFile;
  fileText: string;
}

async function _getASTfor(file: JestTestFile): Promise<GetAstResult> {
  return readfileP(file.path).then((buffer: Buffer) => {
    const _data = buffer.toString();
    //return { babylonFile: babylonParse(_data, config), jestTestFile: file, fileText: _data };
    return _getASTforContent(_data, file);
  });
}

function _getASTforContent(content: string, file: JestTestFile): GetAstResult {
  const plugins: PluginName[] = ['estree', 'jsx', 'classConstructorCall', 'doExpressions', 'objectRestSpread', 'decorators', 'classProperties', 'exportExtensions', 'asyncGenerators', 'functionBind', 'functionSent', 'dynamicImport'];
  const config: BabylonOptions = { plugins, sourceType: 'module' };

  return { babylonFile: babylonParse(content, config), jestTestFile: file, fileText: content };
}

const isFunctionCall = (node: BabylonNode) => Babylon.isExpressionStatement(node) && Babylon.isCallExpression((<Babylon.ExpressionStatement>node).expression);

const isFunctionDeclaration = (nodeType: string) => nodeType === 'ArrowFunctionExpression' || nodeType === 'FunctionExpression';

// When given a node in the AST, does this represent
// the start of an expect expression?
const isAnExpect = (node: BabylonNode) => {
  const name = getNameForNode(node);
  return name === 'expect';
};

// When given a node in the AST, does this represent
// the start of an it/test block?
const isAnIt = (node: BabylonNode) => {
  const name = getNameForNode(node);
  return name === 'it' || name === 'fit' || name === 'test';
};

const isAnDescribe = (node: BabylonNode) => {
  const name = getNameForNode(node);
  return name === 'describe';
};

const getGetNameAndRange = (ast: GetAstResult) => {
  return (bNode: BabylonNode): NameAndRanges => {
    if (!isFunctionCall(bNode)) {
      return { name: undefined, range: undefined };
    }

    if (isAnExpect(bNode)) {
      return getNameAndRangeForExpect(bNode);
    }

    const cExp = (<Babylon.CallExpression>(<Babylon.ExpressionStatement>bNode).expression);
    const arg: Babylon.Expression | Babylon.SpreadElement | null = cExp.arguments.length ? cExp.arguments[0] : null;
    const sourceLoc: Babylon.SourceLocation = arg ? arg.loc : cExp.loc;
    let name: string | null = null;

    if (Babylon.isTemplateLiteral(arg)) {
      name = ast.fileText.substring(arg.start + 1, arg.end - 1);
    } else {
      try {
        name = (arg as Babylon.StringLiteral).value;
      }
      catch (error) {
      }
    }

    if (name === null) {
      throw new TypeError(
        `failed to get name and range from: ${JSON.stringify(bNode)}`,
      );
    }

    return {
      name: name,
      range: new vscode.Range(bNode.loc.start.line - 1, bNode.loc.start.column, bNode.loc.end.line - 1, bNode.loc.end.column),
      nameRange: new vscode.Range(sourceLoc.start.line - 1, sourceLoc.start.column, sourceLoc.end.line - 1, sourceLoc.end.column)
    };
  };
};

const getNameAndRangeForExpect = (bNode: BabylonNode): NameAndRanges => {
  const cExp = (<Babylon.CallExpression>(<Babylon.ExpressionStatement>bNode).expression);
  let name = '';
  let callee: any = cExp.callee;
  let sourceLoc: Babylon.SourceLocation | undefined;
  let args: any[] | undefined = (!!callee && !!callee.arguments && !!callee.arguments.length) ? callee.arguments : undefined;
  while (callee) {

    if (callee.property && callee.property.name) {
      name = `${callee.property.name}${name.length ? '.' : ''}${name}`;
    }
    if (callee.name) {
      sourceLoc = callee.loc;
      let addOn = callee.name;
      if (args) {
        let argArry = args.reduce((out, arg) => { if (arg.name) { out.push(arg.name); } else if (arg.value) { out.push(arg.value.toString()); } return out; }, [] as string[]);
        addOn = `${callee.name}(${argArry.join(', ')})`;
      }
      name = `${addOn}${name.length ? '.' : ''}${name}`;
    }

    args = (!!callee.arguments && !!callee.arguments.length) ? callee.arguments : undefined;
    callee = callee.callee || callee.object;
  }

  return {
    name: name,
    range: new vscode.Range(bNode.loc.start.line - 1, bNode.loc.start.column, bNode.loc.end.line - 1, bNode.loc.end.column),
    nameRange: sourceLoc ? new vscode.Range(sourceLoc.start.line - 1, sourceLoc.start.column, sourceLoc.end.line - 1, sourceLoc.end.column) : DefaultRange
  };

};

const getNodeWithName = (node: BabylonNode): BabylonNode | undefined => {
  if (!isFunctionCall(node)) {
    return;
  }
  const nodeAsExpressionStatement = <Babylon.ExpressionStatement>node;
  const nodeExpression = nodeAsExpressionStatement ? <Babylon.CallExpression>nodeAsExpressionStatement.expression : undefined;
  let name = nodeExpression && nodeExpression.callee ? (<any>nodeExpression.callee).name : undefined;
  let callee: any = nodeExpression ? nodeExpression.callee : undefined;
  while (!name && callee) {
    if (callee.name) {
      name = callee.name;
    }
    else {
      callee = callee.callee || callee.object;
    }
  }

  return callee;
};

// Pull out the name of a CallExpression (describe/it/expect)
// handle cases where it's a member expression (.only)
const getNameForNode = (node: BabylonNode) => {
  // if (!isFunctionCall(node)) {
  //   return false;
  // }
  // const nodeAsExpressionStatement = <Babylon.ExpressionStatement>node;
  // const nodeExpression = nodeAsExpressionStatement ? <Babylon.CallExpression>nodeAsExpressionStatement.expression : undefined;
  // let name = nodeExpression && nodeExpression.callee ? (<any>nodeExpression.callee).name : undefined;
  // let callee: any = nodeExpression ? nodeExpression.callee : undefined;
  // while (!name && callee) {
  //   if (callee.name) {
  //     name = callee.name;
  //   }
  //   else {
  //     callee = callee.callee || callee.object;
  //   }
  // }
  // return name;

  const nodeWithName: any = getNodeWithName(node);
  if (!nodeWithName) {
    return false;
  }
  return nodeWithName.name;
};

const getAddNode = (getNameAndRange: (bNode: BabylonNode) => NameAndRanges, file: JestTestFile) => {
  return (type: TestNodeType, parent: ParseResult, babylonNode: BabylonNode, ): ParseResult => {
    const nameAndRange = getNameAndRange(babylonNode);

    const child = new ParseResult(type, nameAndRange.name, getNameForNode(babylonNode));
    if (nameAndRange.range) {
      child.locations.push({ file: file, start: nameAndRange.range.start, end: nameAndRange.range.end });
    }
    if (nameAndRange.nameRange) {
      child.nameLocations.push({ file: file, start: nameAndRange.nameRange.start, end: nameAndRange.nameRange.end });
    }

    if (parent) {
      parent.addChild(child);
    }

    if (type !== TestNodeTypes.root && !child.name) {
      console.warn(`block is missing name: ${JSON.stringify(babylonNode)}`);
    }
    return child;
  };
};

// Get a recursive AST parser
const getSearchNodes = (addNode: Function) => {
  const searchNodes = (babylonParent: any, parent: ParseResult) => {
    // Look through the node's children
    let child: ParseResult | undefined;

    for (const node in babylonParent.body) {
      if (!babylonParent.body.hasOwnProperty(node)) {
        return;
      }

      child = undefined;
      // Pull out the node
      const element = babylonParent.body[node];

      if (isAnDescribe(element)) {
        child = addNode('describe', parent, element);
      } else if (isAnIt(element)) {
        child = addNode('it', parent, element);
      } else if (isAnExpect(element)) {
        child = addNode('expect', parent, element);
      } else if (element && element.type === 'VariableDeclaration') {
        element.declarations
          .filter(
            (declaration: any) =>
              declaration.init && isFunctionDeclaration(declaration.init.type),
          )
          .forEach((declaration: any) => searchNodes(declaration.init.body, parent));
      } else if (
        element &&
        element.type === 'ExpressionStatement' &&
        element.expression &&
        element.expression.type === 'AssignmentExpression' &&
        element.expression.right &&
        isFunctionDeclaration(element.expression.right.type)
      ) {
        searchNodes(element.expression.right.body, parent);
      } else if (
        element.type === 'ReturnStatement' &&
        element.argument.arguments
      ) {
        element.argument.arguments
          .filter((argument: any) => isFunctionDeclaration(argument.type))
          .forEach((argument: any) => searchNodes(argument.body, parent));
      }

      if (isFunctionCall(element)) {
        const cExp = <Babylon.CallExpression>(<Babylon.ExpressionStatement>element).expression;
        cExp.arguments.filter((arg: any) => Babylon.isFunction(arg))
          .forEach((arg: any) => searchNodes(arg.body, child || parent));
      }
    }
  };

  return searchNodes;
};

function parseAST(ast: GetAstResult, parentResult?: ParseResult): ParseResult {
  const out = parentResult ? parentResult : new ParseResult('root');

  const addNodeFn = getAddNode(getGetNameAndRange(ast), ast.jestTestFile);
  const searchNodes = getSearchNodes(addNodeFn);
  const program: BabylonNode = ast.babylonFile['program'];

  searchNodes(program, out);

  return out;
}

async function parseFile(file: JestTestFile, parentResult?: ParseResult): Promise<ParseResult> {

  const ast = await _getASTfor(file);

  return parseAST(ast, parentResult);
}

async function parseFiles(files: JestTestFile[]): Promise<ParseResult> {
  const parseResult = new ParseResult('root');

  for (let file of files) {
    await parseFile(file, parseResult);
  }

  return parseResult;
}

function getJestTestFiles(jestDir: IJestDirectory): Promise<string[]> {
  const command = jestDir.jestPath;
  const commandArgs: string[] = ["--ci", "--listTests", `--rootDir ${jestDir.projectPath}`];

  if (jestDir.configPath) {
    commandArgs.push(`-c ${jestDir.configPath}`);
  }

  return new Promise((resolve, reject) => {
    const cmd = `${command} ${commandArgs.join(' ')}`;
    Executor.exec(cmd, (err: Error, stdout: string, stderr: string) => {
      if (err) {
        Logger.error(`Error while executing "${cmd}": ${err.message}`);
        reject(err);
        return;
      }

      resolve(stdout.trim().split(/[\r\n]+/g));
    }, jestDir.projectPath);
  });
}

export function discoverTests(jestDir: IJestDirectory): Promise<ParseResult> {
  Logger.info(`Discovering tests in '${jestDir.projectPath}'`);
  const jestDiscovery: Promise<string[]> = getJestTestFiles(jestDir);

  return jestDiscovery.then(files => {
    return parseFiles(files.map(x => new JestTestFile(jestDir, x)));
  });
}

export async function discoverTestsForFile(jestFile: JestTestFile): Promise<ParseResult> {
  return await parseFile(jestFile);
}

export function rediscoverTests(content: string, file: JestTestFile): ParseResult {
  return parseAST(_getASTforContent(content, file));
}
