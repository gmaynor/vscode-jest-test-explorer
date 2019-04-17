
import * as Babylon from 'babel-types';
import { File as BabylonFile, Node as BabylonNode } from 'babel-types';
import { BabylonOptions, parse as babylonParse, PluginName } from 'babylon';
import * as vscode from 'vscode';
import Logger from './logger';
import { readfileP, existsP, IJestDirectory, Config, writeFile } from './utility';
import { TestDirectories } from './testDirectories';
import { normalize } from 'path';


async function _getASTfor(file: vscode.Uri): Promise<BabylonFile> {
  return readfileP(file.path).then((buffer: Buffer) => {
    const _data = buffer.toString();
    return _getASTforContent(_data);
  });
}

function _getASTforContent(content: string): BabylonFile {
  const plugins: PluginName[] = ['jsx', 'classConstructorCall', 'doExpressions', 'objectRestSpread', 'decorators', 'classProperties', 'exportExtensions', 'asyncGenerators', 'functionBind', 'functionSent', 'dynamicImport'];
  const config: BabylonOptions = { plugins, sourceType: 'module' };

  return babylonParse(content, config);
}

const isFunctionCall = (node: BabylonNode) => Babylon.isExpressionStatement(node) && Babylon.isCallExpression((<Babylon.ExpressionStatement>node).expression);

const isFunctionDeclaration = (nodeType: string) => nodeType === 'ArrowFunctionExpression' || nodeType === 'FunctionExpression';

const isConnectCall = (node: BabylonNode) => {
  let call: Babylon.CallExpression | undefined;
  if (Babylon.isCallExpression(node)) {
    call = node as Babylon.CallExpression;
  }
  else if (Babylon.isExpressionStatement(node)) {
    if (Babylon.isCallExpression((node as Babylon.ExpressionStatement).expression)) {
      call = (node as Babylon.ExpressionStatement).expression as Babylon.CallExpression;
    }
  }
  if (!call) {
    return false;
  }
  let callee = call.callee;
  while (Babylon.isCallExpression(callee)) {
      callee = (callee as Babylon.CallExpression).callee;
  }
  return (callee as Babylon.Identifier).name === 'connect';
};

export class TestFileGenerator {

  constructor(private _testDirectories: TestDirectories) {

  }

  public async generateTestFiles(uri: vscode.Uri) {
    const bFile = await _getASTfor(uri);

    const jestDir = this._testDirectories.getJestDirectoryForFile(uri.path);
    const folders = jestDir ? [jestDir.projectName, ...uri.path.substring(jestDir.projectPath.length + 1).split('/')] : [];
    const writers: Promise<void>[] = [];

    const namedNodesMap = bFile.program.body.reduce((out, node) => {
      let isExported = false;
      let isDefault = false;
      let namedNode: any = undefined;
      let exportType: 'function' | 'class' = 'class';
      let name: string | undefined = undefined;
      if (Babylon.isExportNamedDeclaration(node)) {
        isExported = true;
        namedNode = (node as Babylon.ExportNamedDeclaration).declaration || node;
        if (Babylon.isVariableDeclaration(namedNode)) {
          namedNode = (namedNode as Babylon.VariableDeclaration).declarations[0];
        }
      }
      else if (Babylon.isExportDefaultDeclaration(node)) {
        isExported = true;
        isDefault = true;
        namedNode = (node as Babylon.ExportDefaultDeclaration).declaration;
      }
      else if (Babylon.isVariableDeclaration(node)) {
        namedNode = (node as Babylon.VariableDeclaration).declarations[0];
      }
      else {
        namedNode = node;
      }

      if (Babylon.isClassDeclaration(namedNode)) {
        name = (namedNode as Babylon.ClassDeclaration).id.name;
        exportType = 'class';
      }
      else if (Babylon.isFunctionDeclaration(namedNode)) {
        name = (namedNode as Babylon.FunctionDeclaration).id.name;
        exportType = 'function';
      }
      else if (Babylon.isVariableDeclarator(namedNode)) {
        name = ((namedNode as Babylon.VariableDeclarator).id as Babylon.Identifier).name;
        if (Babylon.isArrowFunctionExpression(namedNode.init)) {
          exportType = 'function';
        }
        else if (Babylon.isFunctionExpression(namedNode.init)) {
          exportType = 'function';
        }
        else if (Babylon.isNewExpression(namedNode.init)) {
          const callee = (namedNode.init as Babylon.NewExpression).callee;
          if (Babylon.isIdentifier(callee)) {
            const found = out.find(o => o.name === (callee as Babylon.Identifier).name);
            if (found) {
              found.isExported = found.isExported || isExported;
              found.isDefault = found.isDefault || isDefault;
            }
          }
          name = undefined;
        }
        else {
          name = undefined;
        }
      }
      else if (Babylon.isExportNamedDeclaration(namedNode)) {
        namedNode.specifiers.forEach(spec => {
          const found = out.find(o => o.name === spec.local.name);
          if (found) {
            //out.push({ node: found.node, name: spec.local.name, isExported, isDefault, exportType: found.exportType });
            found.isExported = isExported;
            found.isDefault = found.isDefault || isDefault;
          }
        });
      }
      else if (isConnectCall(namedNode)) {
        const found = out.find(o => o.name === ((namedNode as Babylon.CallExpression).arguments[0] as Babylon.Identifier).name);
        if (found) {
          found.isDefault = found.isDefault || isDefault;
          found.isExported = found.isExported || isExported;
        }
      }
      if (name) {
        out.push({ node: namedNode, name, isExported, isDefault, exportType });
      }

      return out;
    }, [] as Array<{ name: string, node: Babylon.Statement, isExported: boolean, isDefault: boolean, exportType: 'class' | 'function' }>);

    const exportNodes = namedNodesMap.filter(nodeInfo => nodeInfo.isExported); // bFile.program.body.filter(node => Babylon.isExportDeclaration(node));

    exportNodes.forEach(en => {
      if (en.exportType === 'class') {
        writers.push(this.writeTestFileForClass(en.node as Babylon.ClassDeclaration, uri.path, en.isDefault));
      }
      else if (en.exportType === 'function') {
        writers.push(this.writeTestFileForFunction(en.node as Babylon.FunctionDeclaration, uri.path, en.isDefault));
      }
    });

    return Promise.all(writers);
  }

  private async writeTestFileForClass(classDecl: Babylon.ClassDeclaration, filePath: string, isDefault: boolean) {
    const { pathParts, namespaceParts } = this.getPathParts(filePath);
    namespaceParts.push(classDecl.id.name);
    const fileNameParts = pathParts[pathParts.length - 1].split('.');
    pathParts[pathParts.length - 1] = `${classDecl.id.name}.tests.${fileNameParts[fileNameParts.length - 1]}`;
    const testFilePath = pathParts.join('/');
    const fileExists = await existsP(testFilePath);
    if (fileExists) {
      Logger.info(`NOT generating test file '${testFilePath}'.  The file already exists.`);
      return;
    }
    Logger.info(`generating test file '${testFilePath}`);

    const lines: string[] = [];
    let importName = isDefault ? classDecl.id.name : `{ ${classDecl.id.name} }`;
    lines.push(`import ${importName} from '${this.getImportFromString(filePath.split('/'), pathParts)}';`);
    lines.push('');

    let dIdx = 0;
    let indent = '';
    namespaceParts.forEach(nsPart => {
      lines.push(`${indent}describe('${nsPart}', () => {`);

      dIdx++;
      indent += '    ';
    });

    const methods = classDecl.body.body.filter(node => Babylon.isClassMethod(node)).map(node => node as Babylon.ClassMethod);
    const methodNames = methods.map(node => (node.key as Babylon.Identifier).name);
    methodNames.forEach(method => {
      lines.push('');
      lines.push(`${indent}test('${method}', () => {`);
      lines.push(`${indent}    `);
      lines.push(`${indent}    expect('unimplemented test to fail').toBe('true');`);
      lines.push(`${indent}});`);
    });

    namespaceParts.forEach(nsPart => {
      dIdx--;
      indent = indent.substring(0, indent.length - 4);

      lines.push(`${indent}});`);
    });

    writeFile(testFilePath, lines.join('\n'));
  }

  private async writeTestFileForFunction(fn: Babylon.FunctionDeclaration, filePath: string, isDefault: boolean) {
    const { pathParts, namespaceParts } = this.getPathParts(filePath);
    const fileNameParts = pathParts[pathParts.length - 1].split('.');
    pathParts[pathParts.length - 1] = `${fn.id.name}.tests.${fileNameParts[fileNameParts.length - 1]}`;
    const testFilePath = pathParts.join('/');
    const fileExists = await existsP(testFilePath);
    if (fileExists) {
      Logger.info(`NOT generating test file '${testFilePath}'.  The file already exists.`);
      return;
    }
    Logger.info(`generating test file '${testFilePath}`);

    const lines: string[] = [];
    let importName = isDefault ? fn.id.name : `{ ${fn.id.name} }`;
    lines.push(`import ${importName} from '${this.getImportFromString(filePath.split('/'), pathParts)}';`);
    lines.push('');

    let dIdx = 0;
    let indent = '';
    namespaceParts.forEach(nsPart => {
      lines.push(`${indent}describe('${nsPart}', () => {`);

      dIdx++;
      indent += '    ';
    });
    
    lines.push('');
    lines.push(`${indent}test('${fn.id.name}', () => {`);
    lines.push(`${indent}    `);
    lines.push(`${indent}    expect('unimplemented test to fail').toBe('true');`);
    lines.push(`${indent}});`);

    namespaceParts.forEach(nsPart => {
      dIdx--;
      indent = indent.substring(0, indent.length - 4);

      lines.push(`${indent}});`);
    });

    writeFile(testFilePath, lines.join('\n'));
  }

  private getImportFromString(fileNameParts: string[], testFileParts: string[]): string {
    const retArry: string[] = [];
    let idx = 0;
    while (idx < fileNameParts.length && idx < testFileParts.length) {
      if (fileNameParts[idx] !== testFileParts[idx++]) {
        break;
      }
    }
    for (let i = idx - 1; i < testFileParts.length - 1; i++) {
      retArry.push('..');
    }
    for (let i = idx - 1; i < fileNameParts.length; i++) {
      retArry.push(fileNameParts[i]);
    }

    const fileName = fileNameParts[fileNameParts.length - 1];
    retArry[retArry.length - 1] = fileName.slice(0, fileName.lastIndexOf('.'));

    return retArry.join('/');
  }

  private getPathParts(filePath: string): { pathParts: string[], namespaceParts: string[] } {
    let testFilePath = Config.testFileLocation;
    const jestDir = this._testDirectories.getJestDirectoryForFile(filePath) || { projectName: '', projectPath: '' };
    let pathParts: string[] = [];
    let namespaceParts: string[] = [];
    if (testFilePath.length) {
      const fpTruncated = filePath.substring(jestDir.projectPath.length + 1).split('/');
      const testDir = normalize(`${jestDir.projectPath}/${testFilePath}`);
      pathParts = [...testDir.split('/'), ...fpTruncated.slice(1)];
      namespaceParts = [jestDir.projectName, ...fpTruncated.slice(1, fpTruncated.length - 1)];
    }
    else {
      pathParts = filePath.split('/');
      namespaceParts = pathParts.slice(0, pathParts.length - 1);
    }
    const fileNameParts = pathParts[pathParts.length - 1].split('.');
    pathParts[pathParts.length - 1] = `${fileNameParts.slice(0, fileNameParts.length - 1)}.tests.${fileNameParts[fileNameParts.length - 1]}`;

    return { pathParts, namespaceParts };
  }
}
