import { commands, Event, EventEmitter, Disposable, debug, workspace, WorkspaceFolder, Uri } from "vscode";
import { Executor } from "./executor";
import Logger from "./logger";
import { TestDirectories } from "./testDirectories";
import { DebugConfigurationProvider } from './debugConfigurationProvider';
import { ITestNode } from './nodes';
import TestNodeManager  from './testNodeManager';
import { DisposableManager } from "./disposableManager";
import { Config, IJestDirectory } from "./utility";

export class TestCommands {
    private onTestDiscoveryStartedEmitter = new EventEmitter<string>();
    private onTestRunEmitter = new EventEmitter<ITestNode>();
    private onTestStoppedEmitter = new EventEmitter<void>();
    private _debugConfigProvider: DebugConfigurationProvider | undefined;
    private _disposables: DisposableManager = new DisposableManager();

    constructor(private testDirectories: TestDirectories) { 
        this._disposables.addDisposble("directorySearch", testDirectories.onTestDirectorySearchCompleted(this.initializeDebugConfigProvider, this));
    }

    public async discoverTests() {
        this.onTestDiscoveryStartedEmitter.fire();

        let rootNode: ITestNode | undefined = undefined;
        try {
            await TestNodeManager.LoadTests(this.testDirectories.getTestDirectories());

            rootNode = TestNodeManager.RootNode;

            Logger.info(`${(!!rootNode && !!rootNode.itBlocks) ? rootNode.itBlocks.length : 0} tests discovered.`);
        } catch (error) {
            Logger.error(`Error during test discovery: ${error}`);
        }
    }

    public get onTestDiscoveryStarted(): Event<string> {
        return this.onTestDiscoveryStartedEmitter.event;
    }

    public get onTestRun(): Event<ITestNode> {
        return this.onTestRunEmitter.event;
    }

    public get onTestStop(): Event<void> {
        return this.onTestStoppedEmitter.event;
    }

    public runAllTests(): void {
        this.runTestCommand();
    }

    public runTest(test: ITestNode): void {
        this.runTestCommand(test);
    }

    public stopTests(): void {
        if (Executor.stop()) {
            this.onTestStoppedEmitter.fire();
        }
    }

    public async debugTest(test: ITestNode): Promise<void> {
        if (!this._debugConfigProvider) {
            Logger.warn('Unable to debug tests at this time.');
            return;
        }

        this.stopTests();

        this._debugConfigProvider.prepareTestRun(test);

        const handle = debug.onDidTerminateDebugSession(() => {
            handle.dispose();
            this.stopTests();
        }, this);

        let workspaceFolder: WorkspaceFolder | undefined;
        if (test.jestTestFile) {
            workspaceFolder = workspace.getWorkspaceFolder(Uri.parse(test.jestTestFile.jestDirectory.projectPath));
        }
        else if (workspace.workspaceFolders) {
            workspaceFolder = workspace.workspaceFolders[0];
        }

        try {
          // try to run the debug configuration from launch.json
          await debug.startDebugging(workspaceFolder, 'vscode-jest-tests');
        } catch {
          // if that fails, there (probably) isn't any debug configuration (at least no correctly named one)
          // therefore debug the test using the default configuration
          const debugConfiguration = this._debugConfigProvider.provideDebugConfigurations(workspaceFolder)[0];
          await debug.startDebugging(workspaceFolder, debugConfiguration);
        }
    }

    public dispose() {
        this._disposables.dispose();
    }

    private initializeDebugConfigProvider(dirs: IJestDirectory[]) {
        this._disposables.removeDisposable("nodeDebugConfig");
        this._disposables.removeDisposable("debugConfig");

        this._debugConfigProvider = new DebugConfigurationProvider(dirs, this.getJestCommand);
        // this provides the opportunity to inject test names into the DebugConfiguration
        this._disposables.addDisposble("nodeDebugConfig", debug.registerDebugConfigurationProvider('node', this._debugConfigProvider));
        // this provides the snippets generation
        this._disposables.addDisposble("debugConfig", debug.registerDebugConfigurationProvider('vscode-jest-tests', this._debugConfigProvider));
    }

    private getJestCommand(jestDir: IJestDirectory, test?: ITestNode): { command: string, commandArgs: string[] } {
        const command = jestDir.jestPath;
        const commandArgs: string[] = ["--ci", `--rootDir ${jestDir.projectPath}`, '--json', '--testLocationInResults'];

        if (jestDir.configPath) {
            commandArgs.push(`-c ${jestDir.configPath}`);
        }

        if (Config.collectCoverageEnabled && (!test || test.isContainer)) {
            commandArgs.push('--coverage');
        }
        else {
            commandArgs.push('--no-coverage');
        }

        if (test) {
            let testName = (test.fqName || '').replace(/:/gi, ' ');
            if (!test.isContainer) {
                testName += '$';
            }
            commandArgs.push(` -t "${testName}"`);
        }

        return { command, commandArgs };
    }

    private runTestCommand(test?: ITestNode): void {

        commands.executeCommand("workbench.view.extension.test", "workbench.view.extension.test");

        const testDirectories = test && !test.isContainer && test.jestTestFile ? [test.jestTestFile.jestDirectory] : this.testDirectories.getTestDirectories();

        // We want to make sure test runs across multiple directories are run in sequence to avoid excessive cpu usage
        const runSeq = async () => {
            try {
                for (let i = 0; i < testDirectories.length; i++) {
                    await this.runTestCommandForSpecificDirectory(testDirectories[i], test);
                }
            } catch (err) {
                Logger.error(`Error while executing test command: ${err}`);
                this.discoverTests();
            }
        };

        runSeq();
    }

    private runTestCommandForSpecificDirectory(jestDir: IJestDirectory, test: ITestNode | undefined): Promise<void> {
        const { command, commandArgs } = this.getJestCommand(jestDir, test);

        this.onTestRunEmitter.fire(test || TestNodeManager.RootNode);

        return new Promise((resolve, reject) => {
            const cmd = `${command} ${commandArgs.join(' ')}`;
            Logger.debug(`Executing "${cmd}" in ${jestDir.projectPath}`);
            Executor.exec(cmd, (err: Error, stdout: string, stderr: string) => {
                if (err && !err.message.includes("FAIL")) {
                    if (!(<any>err).killed) {
                        Logger.error(`Error while executing "${cmd}": ${err.message}`);
                        reject(err);
                    }
                    else {
                        Logger.info('Test execution stopped.');
                    }
                    return;
                }

                TestNodeManager.ParseTestResults(stdout);

                resolve();
            }, jestDir.projectPath, true);
        });
    }
}
