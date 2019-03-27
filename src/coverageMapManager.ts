import * as vscode from 'vscode';
import * as nodes from './nodes';
import { DefaultPosition, DefaultRange, IJestDirectory, JestTestFile } from './utility';
import { ParseResult, discoverTests } from './testDiscovery';


interface ICoverageLoc {
    start: { line: number, column: number };
    end: { line: number, column: number };
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

class FileCoverageResult implements nodes.IFileCoverageResult {
    public readonly branchMap: nodes.INumberMap<IBranch> = {};
    public readonly fnMap: nodes.INumberMap<IFn> = {};
    public readonly statementMap: nodes.INumberMap<vscode.Range> = {};
    public readonly branchHits: nodes.INumberMap<number[]> = {};
    public readonly fnHits: nodes.INumberMap<number> = {};
    public readonly statementHits: nodes.INumberMap<number> = {};
    public readonly metrics: nodes.ICoverageMetrics = {};
    public readonly lineMap: nodes.INumberMap<number> = {};
    private readonly _path: string;

    public static locToRange(loc: ICoverageLoc): vscode.Range {
        const posInvalid = (pos: { line: number | null, column: number | null }): boolean => {
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
            this.branchHits[key] = [...jsonNode.b[key]];
        });
        Object.keys(jsonNode.f).map(key => parseInt(key)).forEach(key => {
            this.fnHits[key] = jsonNode.f[key];
        });
        Object.keys(jsonNode.s).map(key => parseInt(key)).forEach(key => {
            this.statementHits[key] = jsonNode.s[key];
        });
        Object.keys(this.statementHits).map(key => parseInt(key)).forEach(key => {
            const statement = this.statementMap[key];
            if (!statement) {
                return;
            }
            const line = statement.start.line;
            const count = this.statementHits[key];
            const prevVal = this.lineMap[line];
            if (prevVal === undefined || prevVal < count) {
                this.lineMap[line] = count;
            }
        });

        this.calculateMetrics();
    }

    public get path(): string {
        return this._path;
    }

    public get uncoveredLines(): Array<number> {
        const ret: Array<number> = [];
        Object.keys(this.lineMap).map(key => parseInt(key)).forEach(key => {
            if (this.lineMap[key] === 0) {
                ret.push(key);
            }
        });
        return ret;
    }

    private calculateMetrics() {
        const getHits = (key: string, map: nodes.INumberMap<number> | nodes.INumberMap<number[]>) => {
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
        const lines = Object.keys(this.lineMap).length;
        const lineHits = Object.keys(this.lineMap).map(key => parseInt(key)).reduce((count, key) => { if (this.lineMap[key] > 0) { count += 1; } return count; }, 0);

        this.metrics['statements'] = { name: 'statements', instanceCount: statements, hitCount: statementHits, percentage: statementHits / statements };
        this.metrics['functions'] = { name: 'functions', instanceCount: fns, hitCount: fnHits, percentage: fnHits / fns };
        this.metrics['branches'] = { name: 'branches', instanceCount: branches, hitCount: branchHits, percentage: branchHits / branches };
        this.metrics['lines'] = { name: 'lines', instanceCount: lines, hitCount: lineHits, percentage: lineHits / lines };
    }
}

export default class CoverageMapManager {
    private static _coverageMap: nodes.ICoverageMap | undefined;
    private static onCoverageUpdatedEmitter = new vscode.EventEmitter<nodes.ICoverageMap | undefined>();

    public static get onCoverageUpdated(): vscode.Event<nodes.ICoverageMap | undefined> {
        return CoverageMapManager.onCoverageUpdatedEmitter.event;
    }

    public static get CoverageMap(): nodes.ICoverageMap | undefined {
        return CoverageMapManager._coverageMap;
    }

    public static ProcessRawCoverage(rawCoverage?: any) {
        if (!rawCoverage) {
            return;
        }
        CoverageMapManager._coverageMap = Object.keys(rawCoverage).reduce((out, key) => { out[key] = new FileCoverageResult(rawCoverage[key]); return out; }, {} as nodes.ICoverageMap);

        CoverageMapManager.onCoverageUpdatedEmitter.fire(CoverageMapManager._coverageMap);
    }
}