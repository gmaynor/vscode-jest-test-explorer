import { commands, Event, EventEmitter } from "vscode";
import { Executor } from "./executor";
import Logger from "./logger";
import { TestDirectories, IJestDirectory } from "./testDirectories";
import { ITestNode, loadTests, getRootNode, parseTestResults } from './nodes';

export class TestCommands {
    private onTestDiscoveryStartedEmitter = new EventEmitter<string>();
    private onTestDiscoveryFinishedEmitter = new EventEmitter<ITestNode | undefined>();
    private onTestRunEmitter = new EventEmitter<ITestNode>();
    private onTestStoppedEmitter = new EventEmitter<void>();
    private onTestResultsUpdatedEmitter = new EventEmitter<ITestNode[]>();

    constructor(private testDirectories: TestDirectories) { 
    }

    public async discoverTests() {
        this.onTestDiscoveryStartedEmitter.fire();

        this.testDirectories.clearTestsForDirectory();

        try {
            await loadTests(this.testDirectories.getTestDirectories());

            this.onTestDiscoveryFinishedEmitter.fire(getRootNode());
        } catch (error) {
            this.onTestDiscoveryFinishedEmitter.fire();
        }
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

    private runTestCommand(test?: ITestNode): void {

        commands.executeCommand("workbench.view.extension.test", "workbench.view.extension.test");

        const testDirectories = test && !test.isContainer && test.jestTestFile ? [test.jestTestFile.jestDirectory] : this.testDirectories.getTestDirectories();

        // We want to make sure test runs across multiple directories are run in sequence to avoid excessive cpu usage
        const runSeq = async () => {
            try {
                for (let i = 0; i < testDirectories.length; i++) {
                    await this.runTestCommandForSpecificDirectory(testDirectories[i], test, i);
                }
            } catch (err) {
                Logger.error(`Error while executing test command: ${err}`);
                this.discoverTests();
            }
        };

        runSeq();
    }

    private runTestCommandForSpecificDirectory(jestDir: IJestDirectory, test: ITestNode | undefined, index: number): Promise<void> {
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
}
