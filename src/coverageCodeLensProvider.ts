import * as vscode from 'vscode';
import CoverageMapManager from './coverageMapManager';
import { DisposableManager } from './disposableManager';

export function registerCoverageCodeLens() {
  return vscode.languages.registerCodeLensProvider(
      { pattern: '**/*.{ts,tsx,js,jsx}', scheme: 'file' },
      new CoverageCodeLensProvider()
    );
}

class CoverageCodeLensProvider implements vscode.CodeLensProvider {
  private _disposables: DisposableManager = new DisposableManager();
  private onDidChangeCodeLensesEmitter = new vscode.EventEmitter<void>();

  public constructor() {
    this._disposables.addDisposble("coverageUpdated", CoverageMapManager.onCoverageUpdated(() => this.onDidChangeCodeLensesEmitter.fire()));
  }

  public dispose() {
    this._disposables.dispose();
  }

  public get onDidChangeCodeLenses(): vscode.Event<void> {
    return this.onDidChangeCodeLensesEmitter.event;
  }

  public provideCodeLenses(document: vscode.TextDocument, _token: vscode.CancellationToken) {
    const coverageMap = CoverageMapManager.CoverageMap || {};
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
