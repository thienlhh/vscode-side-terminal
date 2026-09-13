const { readdirSync } = require('node:fs');
const { join } = require('node:path');
const { spawnSync } = require('node:child_process');

const directory = join(__dirname, '../test/unit');
const tests = readdirSync(directory).filter(name => name.endsWith('.test.cjs')).map(name => join(directory, name));
const result = spawnSync(process.execPath, ['--test', ...tests], { stdio: 'inherit' });
if (result.error) console.error(result.error);
process.exitCode = result.status ?? 1;
