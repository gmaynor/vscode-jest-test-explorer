import * as vscode from 'vscode';
import { TestCommands } from './testCommands';
import { getCoverageMap, ICoverageMap } from './nodes';

export function registerCoverageCodeLens(commands: TestCommands) {
  return [
    vscode.languages.registerCodeLensProvider(
      { pattern: '**/*.{ts,tsx,js,jsx}', scheme: 'file' },
      new CoverageCodeLensProvider(commands)
    ),
  ];
}

class CoverageCodeLensProvider implements vscode.CodeLensProvider {
  private disposables: vscode.Disposable[] = [];
  private onDidChangeCodeLensesEmitter = new vscode.EventEmitter<void>();

  public constructor(testCommands: TestCommands) {
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

  public get onDidChangeCodeLenses(): vscode.Event<void> {
    return this.onDidChangeCodeLensesEmitter.event;
  }

  public provideCodeLenses(document: vscode.TextDocument, _token: vscode.CancellationToken) {
    const coverageMap = getCoverageMap() || {};
    const coverageKey = Object.keys(coverageMap).find(x => x === document.uri.path);
    const coverage = coverageKey ? coverageMap[coverageKey] : undefined;
    if (!coverage) {
      return;
    }

    const metrics = Object.keys(coverage.metrics).reduce((previous, metric) => {
      return `${previous}${previous ? '  |  ' : ''}${coverage.metrics[metric].name}: ${coverage.metrics[metric].percentage * 100}%`;
    }, '');

    const range = new vscode.Range(0, 0, 0, 0);
    const command: vscode.Command = {
      title: `Code Coverage : ${metrics}`,
      command: '',
    };

    return [new vscode.CodeLens(range, command)];
  }
}
