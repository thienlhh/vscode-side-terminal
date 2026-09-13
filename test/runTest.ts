import { promises as fs } from 'fs';
import * as os from 'os';
import * as path from 'path';
import { runTests } from '@vscode/test-electron';

async function main() {
  const extensionDevelopmentPath = path.resolve(__dirname, '../../');
  const extensionTestsPath = path.resolve(__dirname, './suite/index');
  const workspacePath = path.resolve(__dirname, '../../test/fixtures/workspace');
  // macOS Unix-domain socket paths must stay below 104 bytes.
  const testRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'st-'));

  // VS Code's Electron runner must start as Electron, even when this process
  // was itself launched with Electron's Node compatibility flag.
  delete process.env.ELECTRON_RUN_AS_NODE;

  try {
    const exitCode = await runTests({
      extensionDevelopmentPath,
      extensionTestsPath,
      launchArgs: [
        workspacePath,
        `--user-data-dir=${path.join(testRoot, 'user-data')}`,
        `--extensions-dir=${path.join(testRoot, 'extensions')}`,
        '--disable-extensions'
      ]
    });
    if (exitCode !== 0) process.exitCode = exitCode;
  } catch (err) {
    console.error('Failed to run tests', err);
    process.exitCode = 1;
  } finally {
    await fs.rm(testRoot, { recursive: true, force: true });
  }
}

main();
