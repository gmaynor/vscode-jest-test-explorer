import * as fs from "fs";
import * as glob from "glob";
import * as path from "path";
import { promisify } from 'util';
import * as vscode from "vscode";
import Logger from "./logger";
import { Utility } from "./utility";

export interface IJestDirectory {
    projectPath: string;
    jestPath: string;
    configPath: string;
}

export class JestTestFile {
    jestDirectory: IJestDirectory;
    path: string;
    constructor(jestDirectory: IJestDirectory, path: string) {
        this.jestDirectory = jestDirectory;
        this.path = path;
    }
}

/* Maintains a list of all Directories containing
   Jest test files, as well as a map of the directories
   and their contained tests */
export class TestDirectories {

    private readonly jestExecSubPath: string = "./node_modules/.bin/jest";
    private readonly jestConfigNames: string[] = [ "jest.config.js", "jest.config.json" ];
    private readonly jestExecIgnoreDirs: string[] = [ ".vscode", "node_modules", "bin", "obj", "coverage" ];

    private executors: IJestDirectory[] = [];
    private testsForDirectory: Array<{ dir: string, name: string }> = [];

    /* Search all Workspace Folders for directories containing Jest Test files.
       We are assuming that Jest will be installed locally for projects that
       contain tests (<directory>/node_modules/.bin/jest will exist) */
    public async parseTestDirectories() {

        if (!vscode.workspace || !vscode.workspace.workspaceFolders) {
            return;
        }

        Logger.info("Finding Jest Projects in workspace folders.");
        const start = Date.now();
        await this.findExecutors();
        const end = Date.now();
        Logger.info(`Found ${this.executors.length} Jest Projects in ${(end - start) / 1000} seconds.`);
    }

    /* Add discovered tests to the list */
    public addTestsForDirectory(testsForDirectory?: Array<{ dir: string, name: string }>) {
        if (!testsForDirectory) {
            return;
        }

        this.testsForDirectory = this.testsForDirectory.concat(testsForDirectory);
    }

    /* Clear the list of discovered tests */
    public clearTestsForDirectory() {
        this.testsForDirectory = [];
    }

    /* Get the directories containing tests whose names begin
       with the given string.  Returns all test directories 
       if no testName is provided */
    public getTestDirectories(testName?: string): IJestDirectory[] {

        if (testName && testName !== "") {
            const dirForTestName = this
                .testsForDirectory
                .filter((t) => t.name.startsWith(testName))
                .map((t) => t.dir);

            return this.executors.filter(x => dirForTestName.indexOf(x.projectPath) > -1);
        }

        return this.executors.slice();
    }

    private async findExecutors(): Promise<void> {
        this.executors = [];

        if (!vscode.workspace || !vscode.workspace.workspaceFolders) {
            return;
        }

        const wsfExecPromises: Promise<IJestDirectory[]>[] = [];
        vscode.workspace.workspaceFolders.forEach(x => wsfExecPromises.push(this.getJestTestDirectories(x.uri.fsPath).then((dirs: string[]) => {
            const dirPromises: Promise<IJestDirectory>[] = [];
            dirs.forEach(dir => { 
                dirPromises.push( this.getJestConfigPath(dir).then(configPath => { return <IJestDirectory>{ projectPath: dir, jestPath: path.normalize(path.resolve(dir, this.jestExecSubPath)), configPath: configPath }; }));
            });
            return Promise.all(dirPromises);
        })));
        const results = await Promise.all(wsfExecPromises).then(execs => {
            const flat: IJestDirectory[] = execs.reduce((acc, x) => { if (x.length > 0) { acc.push(...x); } return acc; }, []);
            return flat;
        });

        if (results && results.length > 0) {
            this.executors.push(...results);
        }
    }

    private async getJestTestDirectories(folder: string): Promise<string[]> {
        const retVal: string[] = [];
        const thisPath = await Utility.PathToFileIfExists(folder, this.jestExecSubPath);

        if (thisPath !== null) {
            retVal.push(folder);
        }
        else {
            const subDirs = await Utility.GetSubDirs(folder, this.jestExecIgnoreDirs);
            if (subDirs.length === 0) {
                return retVal;
            }
            const subPromises: Promise<string[]>[] = [];
            subDirs.forEach(x => subPromises.push(this.getJestTestDirectories(x)));
            const subResults = await Promise.all(subPromises);
            if (subResults) {
                subResults.forEach(x => {
                    retVal.push(...x);
                });
            }
        }

        return retVal;
    }

    private async getJestConfigPath(folder: string): Promise<string | null> {
        if (!folder) {
            return null;
        }

        for (let i = 0; i < this.jestConfigNames.length; i++) {
            const ret = await Utility.PathToFileIfExists(folder, this.jestConfigNames[i]);
            if (ret) {
                return ret;
            }
        }
        return null;
    }
}
