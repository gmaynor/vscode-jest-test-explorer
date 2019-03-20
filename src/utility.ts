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

export const DefaultPosition: vscode.Position = new vscode.Position(0.01, 0.01);
export const DefaultRange: vscode.Range = new vscode.Range(DefaultPosition, DefaultPosition);

export type TestNodeType = 'root' | 'describe' | 'it' | 'expect';
export const TestNodeTypes = {
  root: 'root',
  describe: 'describe',
  it: 'it',
  expect: 'expect'
};

export type TestStatus = 'pending' | 'passed' | 'failed' | 'skipped' | 'todo';

export class Utility {
    public static get codeLensEnabled(): boolean {
        return Utility.showCodeLens;
    }

    public static get codeLensFailed(): string {
        return Utility.failed;
    }

    public static get codeLensPassed(): string {
        return Utility.passed;
    }

    public static get codeLensSkipped(): string {
        return Utility.skipped;
    }

    public static get codeLensNotRun(): string {
        return Utility.notRun;
    }

    public static get defaultCollapsibleState(): vscode.TreeItemCollapsibleState {
        return Utility.autoExpandTree ? vscode.TreeItemCollapsibleState.Expanded : vscode.TreeItemCollapsibleState.Collapsed;
    }

    public static get pathForResultFile(): string {
        const pathForResultFile = Utility.getConfiguration().get<string>("pathForResultFile");
        return pathForResultFile ? this.resolvePath(pathForResultFile) : tmpdir();
    }

    public static get additionalArgumentsOption(): string {
        const testArguments = Utility.getConfiguration().get<string>("testArguments");
        return (testArguments && testArguments.length > 0) ? ` ${testArguments}` : "";
    }

    public static getConfiguration(): vscode.WorkspaceConfiguration {
        return vscode.workspace.getConfiguration("jest-test-explorer");
    }

    public static updateCache() {
        const configuration = Utility.getConfiguration();
        const osx = platform() === "darwin";

        Utility.showCodeLens = configuration.get<boolean>("showCodeLens", true);
        // Utility.failed = Utility.getLensText(configuration, "codeLensFailed", "\u274c"); // Cross Mark
        Utility.failed = Utility.getLensText(configuration, "codeLensFailed", "\u2715"); // Multiplication Sign
        Utility.passed = Utility.getLensText(configuration, "codeLensPassed", osx ? "\u2705" : "\u2714"); // White Heavy Check Mark / Heavy Check Mark
        Utility.skipped = Utility.getLensText(configuration, "codeLensSkipped", "\u26a0"); // Warning
        Utility.notRun = Utility.getLensText(configuration, "codeLensNotRun", "\u25cb"); // Open Circle
        Utility.autoExpandTree = configuration.get<boolean>("autoExpandTree", false);
    }

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
    public static resolvePath(dir: string): string {
        if (path.isAbsolute(dir)) {
            return dir;
        }
        const wsf = vscode.workspace.workspaceFolders ? vscode.workspace.workspaceFolders[0].uri.fsPath : "";
        return path.resolve(wsf, dir);
    }

    private static autoExpandTree: boolean;
    private static showCodeLens: boolean;
    private static failed: string;
    private static passed: string;
    private static skipped: string;
    private static notRun: string;

    private static getLensText(configuration: vscode.WorkspaceConfiguration, name: string, fallback: string): string {
        // This is an invisible character that indicates the previous character
        // should be displayed as an emoji, which in our case adds some colour
        const emojiVariation = "\ufe0f";

        const setting = configuration.get<string>(name);
        return setting ? setting : (fallback + emojiVariation);
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
