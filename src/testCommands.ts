import { commands, Event, EventEmitter, Disposable, debug, workspace, WorkspaceFolder, Uri } from "vscode";
import { Executor } from "./executor";
import Logger from "./logger";
import { TestDirectories, IJestDirectory } from "./testDirectories";
import { DebugConfigurationProvider } from './debugConfigurationProvider';
import { ITestNode, loadTests, getRootNode, parseTestResults } from './nodes';

export class TestCommands {
    private onTestDiscoveryStartedEmitter = new EventEmitter<string>();
    private onTestDiscoveryFinishedEmitter = new EventEmitter<ITestNode | undefined>();
    private onTestRunEmitter = new EventEmitter<ITestNode>();
    private onTestStoppedEmitter = new EventEmitter<void>();
    private onTestResultsUpdatedEmitter = new EventEmitter<ITestNode[]>();
    private _debugConfigProvider: DebugConfigurationProvider | undefined;
    private _debugConfigDisposables: Disposable[] = [];

    constructor(private testDirectories: TestDirectories) { 
        testDirectories.onTestDirectorySearchCompleted(this.initializeDebugConfigProvider, this);
    }

    public async discoverTests() {
        this.onTestDiscoveryStartedEmitter.fire();

        let rootNode: ITestNode | undefined = undefined;
        try {
            rootNode = await loadTests(this.testDirectories.getTestDirectories());

            Logger.info(`${rootNode.itBlocks ? rootNode.itBlocks.length : 0} tests discovered.`);
        } catch (error) {
            Logger.error(`Error during test discovery: ${error}`);
        }
        this.onTestDiscoveryFinishedEmitter.fire(rootNode);
    }

    public get onTestDiscoveryStarted(): Event<string> {
        return this.onTestDiscoveryStartedEmitter.event;
    }

    public get onTestDiscoveryFinished(): Event<ITestNode | undefined> {
        return this.onTestDiscoveryFinishedEmitter.event;
    }

    public get onTestRun(): Event<ITestNode> {
        return this.onTestRunEmitter.event;
    }

    public get onTestStop(): Event<void> {
        return this.onTestStoppedEmitter.event;
    }

    public get onTestResultsUpdated(): Event<ITestNode[]> {
        return this.onTestResultsUpdatedEmitter.event;
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
        this.unregisterDebugConfigProvider();
    }

    private initializeDebugConfigProvider(dirs: IJestDirectory[]) {
        this.unregisterDebugConfigProvider();
        this._debugConfigProvider = new DebugConfigurationProvider(dirs, this.getJestCommand);
        // this provides the opportunity to inject test names into the DebugConfiguration
        this._debugConfigDisposables.push(debug.registerDebugConfigurationProvider('node', this._debugConfigProvider));
        // this provides the snippets generation
        this._debugConfigDisposables.push(debug.registerDebugConfigurationProvider('vscode-jest-tests', this._debugConfigProvider));
    }

    private getJestCommand(jestDir: IJestDirectory, test?: ITestNode): { command: string, commandArgs: string[] } {
        const command = jestDir.jestPath;
        const commandArgs: string[] = ["--ci", `--rootDir ${jestDir.projectPath} --json --testLocationInResults`];

        if (jestDir.configPath) {
            commandArgs.push(`-c ${jestDir.configPath}`);
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

        this.onTestRunEmitter.fire(test || getRootNode());

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
                    this.fireTestResultsUpdated();
                    return;
                }

                parseTestResults(stdout);
                this.fireTestResultsUpdated();

                resolve();
            }, jestDir.projectPath, true);
        });
    }

    private fireTestResultsUpdated() {
        const root = getRootNode();
        this.onTestResultsUpdatedEmitter.fire(root ? root.children : undefined);
    }

    private unregisterDebugConfigProvider() {
        while (this._debugConfigDisposables.length) {
            const disposable = this._debugConfigDisposables.pop();
            if (disposable) {
                disposable.dispose();
            }
        }
    }
}
