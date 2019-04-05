"use strict";

import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import * as util from 'util';

interface ILogTarget {
    name: string;
	write(msg: string): void;
	dispose(): void;
}

export class OutputChannelTarget implements ILogTarget {

	private outputChannel: vscode.OutputChannel;

	constructor(private _name: string) {
		this.outputChannel = vscode.window.createOutputChannel(_name);
    }
        
    public get name() : string {
        return this._name;
	}
	
	public show() {
		this.outputChannel.show();
	}
    
	write(msg: string): void {
		this.outputChannel.appendLine(msg);
	}

	dispose(): void {
		this.outputChannel.dispose();
	}
}

export class FileTarget implements ILogTarget {

    private readonly writeStream: fs.WriteStream;
    private readonly _name: string;

	constructor(filename: string) {
        this._name = filename;
		this.writeStream = fs.createWriteStream(filename, { flags: 'a' });
		this.writeStream.on('error', (err: Error) => {
			vscode.window.showErrorMessage(`Couldn't write log file ${filename}: ${err}`);
		});
	}

    public get name() : string {
        return this._name;
    }
    
	write(msg: string): void {
		this.writeStream.write(msg + '\n');
	}

	dispose(): void {
		this.writeStream.end();
	}
}

/**
 * A simple logger for VS Code extensions that can log to a VS Code output channel(s) or a file(s)
 */
export class Log {

	private targets: ILogTarget[] = [];
	private nextInspectOptions: InspectOptions | undefined = undefined;

	/**
	 * Create a simple logger for VS Code extensions that can log to a VS Code output channel or a file
	 * @param workspaceFolder - the WorkspaceFolder (optional)
	 * @param outputChannelName - the name of the output channel
	 */
	constructor(
		private readonly outputChannelName: string,
		private inspectOptions: InspectOptions = {}
	) {
		this.configure();
	}

	get enabled() { return (this.targets.length > 0); }
	
	show() {
		const outChannel = this.targets.find(x => x instanceof OutputChannelTarget);
		if (outChannel) {
			(outChannel as OutputChannelTarget).show();
		}
	}
    
    addOutputChannelTarget(channelName: string) {
        if (this.targets.findIndex(x => x.name === channelName) >= 0) {
            console.log(`Logger can't add OutputChannel Target '${channelName}'.  It has already been added.`);
        }
        this.targets.push(new OutputChannelTarget(channelName));
    }

    addFileTarget(filePath: string) {
        filePath = path.normalize(path.resolve(filePath));
        if (this.targets.findIndex(x => x.name === filePath) >= 0) {
            console.log(`Logger can't add File Target '${filePath}'.  It has already been added.`);
        }
        this.targets.push(new FileTarget(filePath));
    }

	setDefaultInspectOptions(inspectOptions: InspectOptions) {
		this.inspectOptions = inspectOptions;
	}

	updateDefaultInspectOptions(inspectOptions: InspectOptions) {
		Object.assign(this.inspectOptions, inspectOptions);
	}

	setNextInspectOptions(inspectOptions: InspectOptions) {
		this.nextInspectOptions = inspectOptions;
	}

	updateNextInspectOptions(inspectOptions: InspectOptions) {
		if (this.nextInspectOptions !== undefined) {
            Object.assign(this.nextInspectOptions, inspectOptions);
        }
		else {
            this.nextInspectOptions = Object.assign(Object.assign({}, this.inspectOptions), inspectOptions);
        }
	}

	debug(...msg: any[]): void {
		this.log('DEBUG', msg);
	}

	info(...msg: any[]): void {
		this.log('INFO', msg);
	}

	warn(...msg: any[]): void {
		this.log('WARN', msg);
	}

	error(...msg: any[]): void {
		this.log('ERROR', msg);
	}

	dispose(): void {
		this.targets.forEach(target => target.dispose());
		this.targets = [];
	}

	private log(logLevel: string, msg: any[]) {
		if (this.targets.length > 0) {
			const dateString = new Date().toISOString().replace('T', ' ').replace('Z', '');

			const inspectOptions = this.nextInspectOptions !== undefined
				? this.nextInspectOptions
				: this.inspectOptions;

			let isPreviousNotString = false;

			for (let i = 0; i < msg.length; ++i) {
				try {
					if (typeof msg[i] !== 'string') {
						msg[i] = util.inspect(msg[i], inspectOptions)
							+ (isPreviousNotString ? ';' : '');
						isPreviousNotString = true;
					} else {
						isPreviousNotString = false;
					}
				} catch (e) {
					msg[i] = '<inspection error>';
				}
			}

			const logEntry = `[${dateString}] [${logLevel}] ` + msg.join(' ');
			this.targets.forEach(target => target.write(logEntry));
		}
		this.nextInspectOptions = undefined;
	}

	private configure() {

		this.targets.forEach(target => target.dispose());
        this.targets = [];
        
        if (this.outputChannelName && this.outputChannelName.trim() !== "") {
            this.targets.push(new OutputChannelTarget(this.outputChannelName));
        }
	}
}

export interface InspectOptions extends util.InspectOptions { }

const defaultOutput = "Jester";
const Logger = new Log(defaultOutput);

export default Logger;