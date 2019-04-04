"use strict";

import { platform, tmpdir } from 'os';
import * as path from 'path';
import * as fs from 'fs';
import { promisify } from 'util';
import * as vscode from 'vscode';

/* Promisify version of fs.readdir */
export const readdirP = promisify(fs.readdir);
/* Promisify version of fs.readFile */
export const readfileP = promisify(fs.readFile);
/* Promisify version of fs.stat */
export const statP = promisify(fs.stat);
/* Promisify version of fs.exists */
export const existsP = promisify(fs.exists);
/* Promisify version of fs.mkdir */
export const mkdirP = promisify(fs.mkdir);
/* Promisify version of fs.open */
export const openP = promisify(fs.open);
/* Creates a directory and all of its ancestor directories (as needed) */
export function mkdirRecursive(path: string) {
    return mkdirP(path, { recursive: true });
}
/* Promisify version of fs.writeFile */
export const writeFileP = promisify(fs.writeFile);

/*
    writes a file after first creating its containing directory structure if needed
*/
export async function writeFile(path: string, data: string | Buffer) {
    const parts = path.split('/');
    const dirPath = parts.slice(0, parts.length - 1).join('/');
    return existsP(dirPath).then(exists => {
        if (exists) {
            writeFileP(path, data);
        }
        else {
            mkdirRecursive(dirPath).then(() => writeFileP(path, data));
        }
    });
}

export const DefaultPosition: vscode.Position = new vscode.Position(0.01, 0.01);
export const DefaultRange: vscode.Range = new vscode.Range(DefaultPosition, DefaultPosition);

export interface IJestDirectory {
    projectName: string;
    projectPath: string;
    jestPath: string;
    configPath: string;
    workspaceFolder: vscode.WorkspaceFolder;
}

export class JestTestFile {
    jestDirectory: IJestDirectory;
    path: string;
    constructor(jestDirectory: IJestDirectory, path: string) {
        this.jestDirectory = jestDirectory;
        this.path = path;
    }
}

/**
 * A function that emits a side effect and does not return anything.
 */
type DebouncedProcedure = (...args: any[]) => void;

export function debounce<F extends DebouncedProcedure>(func: F, wait: number = 50, isImmediate: boolean = false): F {
  let timeoutId: NodeJS.Timeout | undefined;

  return function(this: any, ...args: any[]) {
    const context = this;

    const later = function() {
      timeoutId = undefined;
      if (!isImmediate) {
        func.apply(context, args);
      }
    };

    const callNow = isImmediate && timeoutId === undefined;

    if (timeoutId !== undefined) {
      clearTimeout(timeoutId);
    }

    timeoutId = setTimeout(later, wait);

    if (callNow) {
      func.apply(context, args);
    }
  } as any;
}

export class Config {
    private static useTreeView: boolean;
    private static autoExpandTree: boolean;
    private static showCodeLens: boolean;
    private static showStatusDecorations: boolean;
    private static generatedTestFileLocation: string;
    private static collectCoverage: boolean;
    private static showCoverage: boolean;
    private static addProblems: boolean;
    private static failed: string;
    private static passed: string;
    private static skipped: string;
    private static notRun: string;

    public static get useTreeViewEnabled(): boolean {
        return Config.useTreeView;
    }

    public static get autoExpandEnabled(): boolean {
        return Config.autoExpandTree;
    }

    public static get codeLensEnabled(): boolean {
        return Config.showCodeLens;
    }

    public static get statusDecorationsEnabled(): boolean {
        return Config.showStatusDecorations;
    }

    public static get addProblemsEnabled(): boolean {
        return Config.addProblems;
    }

    public static get collectCoverageEnabled(): boolean {
        return Config.collectCoverage;
    }

    public static get showCoverageEnabled(): boolean {
        return Config.collectCoverage && Config.showCoverage;
    }

    public static get testFileLocation(): string {
        return Config.generatedTestFileLocation;
    }

    public static get decorationFailed(): string {
        return Config.failed;
    }

    public static get decorationPassed(): string {
        return Config.passed;
    }

    public static get decorationSkipped(): string {
        return Config.skipped;
    }

    public static get decorationNotRun(): string {
        return Config.notRun;
    }

    public static get defaultCollapsibleState(): vscode.TreeItemCollapsibleState {
        return Config.autoExpandTree ? vscode.TreeItemCollapsibleState.Expanded : vscode.TreeItemCollapsibleState.Collapsed;
    }

    public static get pathForResultFile(): string {
        const pathForResultFile = Config.getConfiguration().get<string>("pathForResultFile");
        return pathForResultFile ? Utility.resolvePath(pathForResultFile) : tmpdir();
    }

    public static get additionalArgumentsOption(): string {
        const testArguments = Config.getConfiguration().get<string>("testArguments");
        return (testArguments && testArguments.length > 0) ? ` ${testArguments}` : "";
    }

    public static getConfiguration(): vscode.WorkspaceConfiguration {
        return vscode.workspace.getConfiguration("jest-test-explorer");
    }

    public static updateCache() {
        const configuration = Config.getConfiguration();
        const osx = platform() === "darwin";

        Config.useTreeView = configuration.get<boolean>("useTreeView", true);
        Config.showCodeLens = configuration.get<boolean>("showCodeLens", true);
        Config.showStatusDecorations = configuration.get<boolean>("showStatusDecorations", true);
        Config.addProblems = configuration.get<boolean>("addProblems", true);
        Config.collectCoverage = configuration.get<boolean>("collectCoverage", false);
        Config.showCoverage = configuration.get<boolean>("showCoverage", false);
        Config.generatedTestFileLocation = configuration.get<string>("generatedTestFileLocation", "");
        Config.failed = Config.getDecorationText(configuration, "decorationFailed", "\u2715"); // Multiplication Sign
        Config.passed = Config.getDecorationText(configuration, "decorationPassed", osx ? "\u2705" : "\u2714"); // White Heavy Check Mark / Heavy Check Mark
        Config.skipped = Config.getDecorationText(configuration, "decorationSkipped", "\u26a0"); // Warning
        Config.notRun = Config.getDecorationText(configuration, "decorationNotRun", "\u25cb"); // Open Circle
        Config.autoExpandTree = configuration.get<boolean>("autoExpandTree", false);
    }

    private static getDecorationText(configuration: vscode.WorkspaceConfiguration, name: string, fallback: string): string {
        // This is an invisible character that indicates the previous character
        // should be displayed as an emoji, which in our case adds some colour
        const emojiVariation = "\ufe0f";

        const setting = configuration.get<string>(name);
        return setting ? setting : (fallback + emojiVariation);
    }
}

export class Utility {

    /** 
    Returns a Promise which resolves to an array of normalized, fully resolved paths
       to subdirectories of the specified folder.  
    Discovered subdirectories whose names are found in the ignoreDirs parameter will be excluded.
    @param folder {string} : the directory to search
    @param ignoreDirs {string[]} : optional directory names to exclude
    */
    public static async GetSubDirs(folder: string, ignoreDirs: string[] = []): Promise<string[]> {
        const retVal: string[] = [];

        const contents: string[] = await readdirP(folder);
        if (contents) {
            const statPromises: Promise<string>[] = [];
            contents.forEach(x => {
                if (ignoreDirs.indexOf(x) < 0) {
                    const fullPath = path.normalize(path.resolve(folder, x));
                    statPromises.push(new Promise<string>((resolve, reject) => {
                        statP(fullPath).then(stat => resolve(stat.isDirectory() ? fullPath : ""));
                    }));
                }
            });
            const statResults = await Promise.all(statPromises);
            if (statResults) {
                const subDirs = statResults.filter(x => x !== "");
                retVal.push(...subDirs);
            }
        }

        return retVal;
    }

    /**
    Returns a Promise which resolves to the normalized, fully resolved path to a file.
       If the file does not exist, the Promise resolves to null.
    */
    public static async PathToFileIfExists(folder: string, fileName: string): Promise<string | null> {
        const retPath = path.normalize(path.resolve(folder, fileName));
        const exists = await existsP(retPath);
        if (exists) {
            return retPath;
        }
        return null;
    }

    /**
     * Returns a Promise which resolves to the contents of the specified file.
     * If the file doesn't exist, the Promise resolves to null.
     */
    public static async ReadFile(filePath: string): Promise<string | null> {
        const exists = await existsP(filePath);
        if (!exists) {
            return null;
        }
        const retVal = await readfileP(filePath);
        return retVal.toString();
    }

    /**
     * Returns a Promise which resolves to the contents of the specified file.
     * If the file doesn't exist, the Promise resolves to null.
     * If the file exists, it is deleted after the contents are read.
     */
    public static async ReadFileAndDelete(filePath: string): Promise<string | null> {
        const exists = await existsP(filePath);
        if (!exists) {
            return null;
        }
        const retVal = await readfileP(filePath);
        await promisify(fs.unlink)(filePath);
        return retVal.toString();
    }

    /**
     * @description
     * Checks to see if the @see{vscode.workspace.rootPath} is
     * the same as the directory given, and resolves the correct
     * string to it if not.
     * @param dir
     * The directory specified in the options.
     */
    public static resolvePath(dir: string, wsFolder?: vscode.WorkspaceFolder): string {
        if (path.isAbsolute(dir)) {
            return dir;
        }
        const folder = wsFolder ? wsFolder : vscode.workspace.workspaceFolders ? vscode.workspace.workspaceFolders[0] : undefined;
        const wsf = folder ? folder.uri.fsPath : '';
        return path.resolve(wsf, dir);
    }
}

/**
 * Implementation of a first-in-first-out (FIFO) data structure -
 * items are added to the end of the queue and removed from the front.
 */
export class Queue<T> {
    /*
        Derived from Queue.js by Kate Morley (http://code.iamkate.com)
        which was released under the terms of the CC0 1.0 Universal legal code:

        http://creativecommons.org/publicdomain/zero/1.0/legalcode
    */

    private arry: T[] = [];
    private offset: number = 0;

    /**
     * Returns the current length of the Queue
     */
    get Length() {
        return this.arry.length - this.offset;
    }

    /**
     * Returns true if the Queue is empty, false otherwise
     */
    get IsEmpty() {
        return this.Length === 0;
    }

    /**
     * Enqueues the specified item
     */
    public Enqueue(item: T) {
        this.arry.push(item);
    }

    /**
     * Dequeues an item and returns it.  If the queue is empty, the value
     * 'undefined' is returned.
     */
    public Dequeue(): T | undefined {
        // return immediately if the queue is empty
        if (this.IsEmpty) {
            return undefined;
        }

        const retVal = this.arry[this.offset];

        // increment the offset and remove free space if neccessary
        if (++this.offset * 2 >= this.arry.length) {
            this.arry = this.arry.slice(this.offset);
            this.offset = 0;
        }

        return retVal;
    }

    /**
     * Returns the item at the front of the queue without dequeueing it.
     * If the queue is empty then 'undefined' is returned.
     */
    public Peek(): T | undefined {
        if (this.IsEmpty) {
            return undefined;
        }
        return this.arry[this.offset];
    }


    /**
     * Returns an array containing the items in the Queue.
     
     * By default, the items will be ordered with the front of the Queue at index 0
     * and the back of the Queue at index n.
     * 
     * If 'true' is passed in the reverse parameter, the items
     * will be ordered with the back of the Queue at index 0
     * and the front of the Queue at index n.
     * 
     * If the Queue is empty, an empty array will be returned.
     */
    public ToArray(reverse = false): T[] {
        if (this.IsEmpty) {
            return [];
        }

        if (!reverse) {
            return this.arry.slice(this.offset);
        }

        const retVal: T[] = [];
        for (let i = this.arry.length - 1; i >= this.offset; i--) {
            retVal.push(this.arry[i]);
        }

        return retVal;
    }
}

/**
 * Implementation of a last-in-first-out (LIFO) data structure -
 * items are added to the top of the stack and removed from the top.
 */
export class Stack<T> {
    /*
        Derived from Queue.js by Kate Morley (http://code.iamkate.com)
        which was released under the terms of the CC0 1.0 Universal legal code:

        http://creativecommons.org/publicdomain/zero/1.0/legalcode
    */

    private arry: T[] = [];
    private offset: number = -1;

    /**
     * Returns the current length of the Stack
     */
    get Length() {
        return this.offset + 1;
    }

    /**
     * Returns true if the Stack is empty, false otherwise
     */
    get IsEmpty() {
        return this.offset === -1;
    }

    /**
     * Puts the specified item on the top of the Stack
     */
    public Push(item: T) {
        this.arry.push(item);
        this.offset++;
    }

    /**
     * Takes an item off the top of the Stack and returns it.  
     * If the Stack is empty, the value 'undefined' is returned.
     */
    public Pop(): T | undefined {
        // return immediately if the queue is empty
        if (this.IsEmpty) {
            return undefined;
        }

        const retVal = this.arry[this.offset];

        // increment the offset and remove free space if neccessary
        if (--this.offset * 2 >= this.arry.length) {
            this.arry = this.arry.slice(0, this.offset + 1);
        }

        return retVal;
    }

    /**
     * Returns the item at the front of the queue without dequeueing it.
     * If the queue is empty then 'undefined' is returned.
     */
    public Peek(): T | undefined {
        if (this.IsEmpty) {
            return undefined;
        }
        return this.arry[this.offset];
    }

    /**
     * Returns an array containing the items in the Stack.
     * 
     * By default, the items will be ordered with the top of the Stack at index 0
     * and the bottom of the Stack at index n.
     * 
     * If 'true' is passed in the reverse parameter, the items
     * will be ordered with the bottom of the Stack at index 0
     * and the top of the Stack at index n.
     * 
     * If the Stack is empty, an empty array will be returned.
     */
    public ToArray(reverse = false): T[] {
        if (this.IsEmpty) {
            return [];
        }

        if (reverse) {
            return this.arry.slice(0, this.offset + 1);
        }

        const retVal: T[] = [];
        for (let i = this.offset; i >= 0; i--) {
            retVal.push(this.arry[i]);
        }
        return retVal;
    }
}
