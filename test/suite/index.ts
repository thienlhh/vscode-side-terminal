import * as path from 'path';
import * as fs from 'fs';
import Mocha from 'mocha';

function findTestFiles(dir: string): string[] {
  let results: string[] = [];
  const list = fs.readdirSync(dir, { withFileTypes: true });

  for (const item of list) {
    const fullPath = path.resolve(dir, item.name);
    if (item.isDirectory()) {
      results = results.concat(findTestFiles(fullPath));
    } else if (item.isFile() && item.name.endsWith('.test.js')) {
      results.push(fullPath);
    }
  }

  return results;
}

export function run(): Promise<void> {
  const mocha = new Mocha({
    ui: 'tdd',
    color: true,
    timeout: 15000
  });

  const testsRoot = path.resolve(__dirname, '.');

  return new Promise((resolve, reject) => {
    try {
      const files = findTestFiles(testsRoot);
      for (const file of files) {
        mocha.addFile(file);
      }

      mocha.run((failures: number) => {
        if (failures > 0) {
          reject(new Error(`${failures} tests failed.`));
        } else {
          resolve();
        }
      });
    } catch (err) {
      reject(err);
    }
  });
}
