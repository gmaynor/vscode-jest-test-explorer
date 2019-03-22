import * as vscode from 'vscode';

export class DisposableManager {
    private _disposables: { [key: string]: { dispose: () => any } | undefined } = {};

    public addDisposble(key: string, value: { dispose: () => any }) {
        const existing = this._disposables[key];
        if (existing) {
            existing.dispose();
        }
        this._disposables[key] = value;
    }

    public removeDisposable(key: string) {
        const existing = this._disposables[key];
        if (existing) {
            existing.dispose();
            delete this._disposables[key];
        }
    }

    public dispose() {
        Object.keys(this._disposables).forEach(key => {
            this.removeDisposable(key);
        });
    }

}