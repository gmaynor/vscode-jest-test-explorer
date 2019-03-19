import * as vscode from 'vscode';
import { IJestDirectory } from './testDirectories';
import { ITestNode } from './nodes';

export class DebugConfigurationProvider implements vscode.DebugConfigurationProvider {
  private _test: ITestNode | undefined;
  
  public constructor(private dirs: IJestDirectory[],
                     private getJestCommand: (jestDir: IJestDirectory, test?: ITestNode) => { command: string, commandArgs: string[] }) {
    
  }

  /**
   * Prepares injecting the name of the test, which has to be debugged, into the `DebugConfiguration`,
   * This function has to be called before `vscode.debug.startDebugging`.
   */
  public prepareTestRun(test: ITestNode) {
    this._test = test;
  }

  resolveDebugConfiguration(_folder: vscode.WorkspaceFolder | undefined, debugConfiguration: vscode.DebugConfiguration, _token?: vscode.CancellationToken) {
    if (debugConfiguration.name !== 'vscode-jest-tests') {
      return debugConfiguration;
    }

    if (!debugConfiguration.env) {
      debugConfiguration.env = {};
    }
    // necessary for running CRA test scripts in non-watch mode
    debugConfiguration.env.CI = 'vscode-jest-tests';

    const jestDir = (this._test && this._test.jestTestFile) ? this._test.jestTestFile.jestDirectory : undefined;

    if (!debugConfiguration.args) {
      debugConfiguration.args = [];
    }

    if (this._test) {
      if (this._test.jestTestFile) {
        debugConfiguration.args.push(this._test.jestTestFile.path);
      }
      debugConfiguration.args.push('--testNamePattern');
      debugConfiguration.args.push(this._test.fqName ? `${this._test.fqName.replace(/:/gi, ' ')}$` : '');
    }

    this._test = undefined;

    return debugConfiguration;
  }

  provideDebugConfigurations(folder: vscode.WorkspaceFolder | undefined, _token?: vscode.CancellationToken) {

    // try to get the IJestDirectory for the provided WorkspaceFolder
    const jestDir = this.dirs.find(dir => dir.workspaceFolder === folder);
    const program = jestDir ? jestDir.jestPath : '${workspaceFolder}/node_modules/.bin/jest';
    const cwd = jestDir ? jestDir.projectPath : '${workspaceFolder}';

    // default jest config according to:
    // https://github.com/Microsoft/vscode-recipes/tree/master/debugging-jest-tests#configure-launchjson-file-for-your-test-framework
    const debugConfiguration: vscode.DebugConfiguration = {
      type: 'node',
      name: 'vscode-jest-tests',
      request: 'launch',
      args: ['--runInBand'],
      cwd: cwd,
      console: 'integratedTerminal',
      internalConsoleOptions: 'neverOpen',
      program: program,
      disableOptimisticBPs: true
    };

    return [debugConfiguration];
  }
}