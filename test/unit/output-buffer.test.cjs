const assert = require('node:assert/strict');
const { test } = require('node:test');
const os = require('node:os');
const path = require('node:path');
const { buildSync } = require('esbuild');

function loadSource(relativePath, exportName) {
  const outfile = path.join(os.tmpdir(), `secondary-terminal-${process.pid}-${exportName}.cjs`);
  buildSync({
    entryPoints: [path.resolve(__dirname, '..', '..', relativePath)],
    bundle: true,
    format: 'cjs',
    platform: 'node',
    outfile,
    logLevel: 'silent'
  });
  return require(outfile)[exportName];
}

const { OutputBuffer } = { OutputBuffer: loadSource('src/provider/outputBuffer.ts', 'OutputBuffer') };
const { parseTerminalFileLinks } = { parseTerminalFileLinks: loadSource('src/webview/linkParser.ts', 'parseTerminalFileLinks') };

test('output buffer batches output and advances only after the matching ACK', () => {
  const messages = [];
  const buffer = new OutputBuffer((message) => { messages.push(message); }, {
    maxQueuedBytes: 32,
    maxBatchBytes: 4,
    flushDelayMs: 1000
  });

  buffer.append('term-1', 'abcdef');
  buffer.flush('term-1');
  assert.equal(messages.length, 1);
  assert.equal(messages[0].data, 'abcd');

  buffer.flush('term-1');
  assert.equal(messages.length, 1, 'only one batch may be in flight');
  buffer.ack('term-1', messages[0].seq + 1);
  assert.equal(messages.length, 1, 'stale ACK must not release the batch');
  buffer.ack('term-1', messages[0].seq);
  assert.equal(messages.length, 2);
  assert.equal(messages[1].data, 'ef');
  buffer.dispose();
});

test('output buffer bounds queued data and reports backpressure', () => {
  const messages = [];
  const pressure = [];
  const buffer = new OutputBuffer((message) => { messages.push(message); }, {
    maxQueuedBytes: 64,
    maxBatchBytes: 16,
    highWaterBytes: 32,
    lowWaterBytes: 16,
    flushDelayMs: 1000,
    onBackpressureChange: (_tabId, backpressured) => pressure.push(backpressured)
  });

  buffer.append('term-1', '1234567890'.repeat(8));
  assert.equal(buffer.getPendingBytes('term-1'), 64);
  assert.ok(buffer.getDroppedBytes('term-1') > 0);
  assert.deepEqual(pressure, [true]);

  buffer.flush('term-1');
  for (let i = 0; i < 4; i++) buffer.ack('term-1', messages[messages.length - 1].seq);
  assert.deepEqual(pressure, [true, false]);
  assert.ok(messages.every(message => message.data.length <= 16), 'overflow markers must obey the batch limit too');
  assert.match(messages.map(message => message.data).join(''), /output truncated while terminal was busy/);
  buffer.dispose();
});

test('output buffer retains a failed send until the transport is resumed', async () => {
  const messages = [];
  let fail = true;
  const buffer = new OutputBuffer((message) => {
    messages.push(message);
    return fail ? Promise.reject(new Error('webview detached')) : Promise.resolve(true);
  }, { flushDelayMs: 1000 });

  buffer.append('term-1', 'hello');
  buffer.flush('term-1');
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(buffer.getPendingBytes('term-1'), 5);
  assert.equal(messages.length, 1);

  buffer.flush('term-1');
  assert.equal(messages.length, 1, 'failed transport must not retry in a loop');
  fail = false;
  buffer.resume('term-1');
  assert.equal(messages.length, 2);
  buffer.ack('term-1', messages[1].seq);
  buffer.dispose();
});

test('output buffer eventually emits a truncation marker after an exact-full queue', () => {
  const messages = [];
  const buffer = new OutputBuffer((message) => { messages.push(message); }, {
    maxQueuedBytes: 64,
    maxBatchBytes: 32,
    flushDelayMs: 1000
  });
  buffer.append('term-1', 'x'.repeat(64));
  buffer.append('term-1', 'overflow');
  buffer.flush('term-1');
  for (let i = 0; i < 3; i++) buffer.ack('term-1', messages[messages.length - 1].seq);
  assert.match(messages.map(message => message.data).join(''), /output truncated while terminal was busy/);
  buffer.dispose();
});

test('output buffer detaches and replays an unacknowledged batch after view recreation', () => {
  const messages = [];
  const buffer = new OutputBuffer((message) => { messages.push(message); }, { flushDelayMs: 1000 });
  buffer.append('term-1', 'screen state');
  buffer.flush('term-1');
  const pending = buffer.getPendingBytes('term-1');
  buffer.detach();
  assert.equal(buffer.getPendingBytes('term-1'), pending);
  buffer.flush('term-1');
  assert.equal(messages.length, 1);
  buffer.attach();
  assert.equal(messages.length, 2);
  assert.equal(messages[1].data, 'screen state');
  buffer.dispose();
});

test('real PTY drains sustained output with bounded queues and no dropped data', { timeout: 15000 }, async t => {
  const { spawn } = require('node-pty');
  const total = 8 * 1024 * 1024;
  const windows = process.platform === 'win32';
  const shell = spawn(windows ? 'powershell.exe' : '/bin/sh', windows
    ? ['-NoProfile', '-NoLogo', '-Command', `[Console]::Out.Write('x' * ${total})`]
    : ['-c', `head -c ${total} /dev/zero | tr '\\000' 'x'`], {
      name: 'xterm-256color', cols: 80, rows: 25, cwd: process.cwd(), env: process.env
    });
  let parsed = 0, peak = 0, pauses = 0, exitCode;
  const acknowledgments = new Set();
  const buffer = new OutputBuffer(message => {
    const timer = setTimeout(() => {
      acknowledgments.delete(timer);
      for (const char of message.data) if (char === 'x') parsed++;
      buffer.ack(message.tabId, message.seq);
    }, 4);
    acknowledgments.add(timer);
  }, { onBackpressureChange: (_id, paused) => { if (paused) { pauses++; shell.pause(); } else shell.resume(); } });
  const data = shell.onData(chunk => { buffer.append('stress', chunk); peak = Math.max(peak, buffer.getPendingBytes('stress')); });
  const exit = shell.onExit(event => { exitCode = event.exitCode; });
  const started = Date.now();
  try {
    while (exitCode === undefined || buffer.getPendingBytes('stress') > 0) {
      assert.ok(Date.now() - started < 10000, 'sustained output must finish draining');
      await new Promise(resolve => setTimeout(resolve, 10));
    }
    assert.equal(exitCode, 0);
    assert.equal(parsed, total);
    assert.equal(buffer.getDroppedBytes('stress'), 0);
    assert.ok(peak <= 288 * 1024);
    assert.ok(pauses > 0, 'the fast producer must be paused while its consumer catches up');
    t.diagnostic(`8 MiB drained in ${Date.now() - started} ms; peak queued ${peak} UTF-16 units; ${pauses} pauses; zero dropped`);
  } finally {
    for (const timer of acknowledgments) clearTimeout(timer);
    buffer.dispose(); data.dispose(); exit.dispose(); shell.kill();
  }
});

test('file links preserve nested POSIX paths and line/column suffixes', () => {
  const links = parseTerminalFileLinks('error at packages/app/src/main.ts:42:7');
  assert.equal(links.length, 1);
  assert.equal(links[0].path, 'packages/app/src/main.ts');
  assert.equal(links[0].line, 42);
  assert.equal(links[0].col, 7);
});

test('file links preserve Windows drive prefixes', () => {
  const links = parseTerminalFileLinks(String.raw`at C:\repo\src\main.ts:42:7`);
  assert.equal(links.length, 1);
  assert.equal(links[0].path, String.raw`C:\repo\src\main.ts`);
  assert.equal(links[0].line, 42);
  assert.equal(links[0].col, 7);
});

test('file links preserve leading-zero coordinates and quoted spaces', () => {
  const links = parseTerminalFileLinks(String.raw`"src/my app/main.ts:00012:00003"`);
  assert.equal(links.length, 1);
  assert.equal(links[0].path, 'src/my app/main.ts');
  assert.equal(links[0].line, 12);
  assert.equal(links[0].col, 3);
});

test('file links handle compiler errors with trailing colons and parenthesized coordinates', () => {
  const colonError = parseTerminalFileLinks('src/main.ts:42:7: error TS1234');
  assert.equal(colonError.length, 1);
  assert.equal(colonError[0].path, 'src/main.ts');
  assert.equal(colonError[0].line, 42);
  assert.equal(colonError[0].col, 7);

  const tscError = parseTerminalFileLinks('src/main.ts(42,7): error TS1234');
  assert.equal(tscError.length, 1);
  assert.equal(tscError[0].path, 'src/main.ts');
  assert.equal(tscError[0].line, 42);
  assert.equal(tscError[0].col, 7);

  const lineOnlyError = parseTerminalFileLinks('src/main.ts:42: error TS1234');
  assert.equal(lineOnlyError.length, 1);
  assert.equal(lineOnlyError[0].path, 'src/main.ts');
  assert.equal(lineOnlyError[0].line, 42);
  assert.equal(lineOnlyError[0].col, undefined);
});

test('file links detect extensionless build files, dotfiles, and GitHub anchors', () => {
  const makefile = parseTerminalFileLinks('Makefile:15: *** missing separator');
  assert.equal(makefile.length, 1);
  assert.equal(makefile[0].path, 'Makefile');
  assert.equal(makefile[0].line, 15);

  const dotfile = parseTerminalFileLinks('.gitignore:5: ignored');
  assert.equal(dotfile.length, 1);
  assert.equal(dotfile[0].path, '.gitignore');
  assert.equal(dotfile[0].line, 5);

  const githubAnchor = parseTerminalFileLinks('src/main.ts#L42C7');
  assert.equal(githubAnchor.length, 1);
  assert.equal(githubAnchor[0].path, 'src/main.ts');
  assert.equal(githubAnchor[0].line, 42);
  assert.equal(githubAnchor[0].col, 7);

  const pythonTrace = parseTerminalFileLinks('File "/path/to/script.py", line 42, in run');
  assert.equal(pythonTrace.length, 1);
  assert.equal(pythonTrace[0].path, '/path/to/script.py');
  assert.equal(pythonTrace[0].line, 42);
});

test('output buffer preserves surrogate pairs across batch chunking', () => {
  const messages = [];
  const buffer = new OutputBuffer((message) => { messages.push(message); }, {
    maxQueuedBytes: 64,
    maxBatchBytes: 4,
    flushDelayMs: 1000
  });
  // 'abc' is 3 UTF-16 code units. '🚀' is 2 UTF-16 code units (D83D DE80).
  // If maxBatchBytes is 4, batch 1 must NOT split '🚀' into high surrogate; it should send 'abc' first.
  buffer.append('term-1', 'abc🚀def');
  buffer.flush('term-1');
  assert.equal(messages[0].data, 'abc');
  buffer.ack('term-1', messages[0].seq);
  assert.equal(messages[1].data, '🚀de');
  buffer.ack('term-1', messages[1].seq);
  assert.equal(messages[2].data, 'f');
  buffer.dispose();
});

