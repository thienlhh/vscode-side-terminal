const assert = require('node:assert/strict');
const { test } = require('node:test');
const pty = require('node-pty');

test('real PTY supports resizing, Unicode, alternate-screen output and Ctrl+C', { timeout: 15000 }, async () => {
  const shell = process.platform === 'win32' ? 'powershell.exe' : '/bin/sh';
  const args = process.platform === 'win32' ? ['-NoProfile', '-NoLogo'] : ['-i'];
  const processHandle = pty.spawn(shell, args, {
    name: 'xterm-256color', cols: 92, rows: 27, cwd: process.cwd(),
    env: { ...process.env, ENV: '', BASH_ENV: '', PS1: '' }
  });
  let output = '';
  const subscription = processHandle.onData(chunk => { output = (output + chunk).slice(-65536); });
  async function expectOutput(expression) {
    const deadline = Date.now() + 5000;
    while (!expression.test(output)) {
      if (Date.now() > deadline) assert.fail(`PTY did not produce ${expression}: ${JSON.stringify(output.slice(-2000))}`);
      await new Promise(resolve => setTimeout(resolve, 10));
    }
  }
  try {
    if (process.platform === 'win32') {
      processHandle.write('Write-Output "__PTY_READY__"\r');
      await expectOutput(/__PTY_READY__\r?\n/);
      processHandle.resize(101, 33);
      processHandle.write('Start-Sleep -Seconds 20\r');
      await new Promise(resolve => setTimeout(resolve, 150));
      processHandle.write('\x03');
      processHandle.write('Write-Output "__ALIVE__"\r');
      await expectOutput(/__ALIVE__\r?\n/);
    } else {
      processHandle.write("stty -echo; printf '\\n__PTY_READY__\\n'; stty size\r");
      await expectOutput(/__PTY_READY__\r?\n27 92/);
      processHandle.resize(101, 33);
      processHandle.write("stty size; printf '\\033[?1049hUnicode: 日本語 🚀\\033[?1049l\\n'\r");
      await expectOutput(/33 101/);
      await expectOutput(/\x1b\[\?1049hUnicode: 日本語 🚀\x1b\[\?1049l/);
      processHandle.write('sleep 20\r');
      await new Promise(resolve => setTimeout(resolve, 100));
      processHandle.write('\x03');
      processHandle.write("printf '__ALIVE__\\n'\r");
      await expectOutput(/__ALIVE__\r?\n/);
    }
  } finally {
    subscription.dispose();
    processHandle.kill();
  }
});
