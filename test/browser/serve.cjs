// Local QA fixture: runs the shipped frontend with a deterministic VS Code bridge.
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '../..');
const html = `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'self' 'nonce-qa'; style-src 'self' 'unsafe-inline'; font-src 'self';">
<link rel="stylesheet" href="/dist/xterm.css"><link rel="stylesheet" href="/media/style.css">
<style>body{--vscode-editor-background:#181818;--vscode-foreground:#ddd;--vscode-terminal-foreground:#ddd;--vscode-font-family:system-ui}#qa{display:flex;gap:8px;padding:8px}#qa-status{font-size:12px}</style>
<title>Side Terminal QA</title></head><body class="vscode-dark">
<div id="qa"><button id="stress">Start output stress test</button><button id="agents">Add agent monitors</button><button id="paste">Paste sample</button><span id="qa-status" role="status">Ready</span></div>
<div id="header-bar"><div id="tab-list" role="tablist" aria-label="Terminal tabs"></div><div id="header-actions">
<button id="new-tab-btn" class="header-action-btn" title="New Terminal" aria-label="New Terminal">+</button>
<button id="open-editor-btn" class="header-action-btn" title="Create Editor Terminal" aria-label="Create Editor Terminal">&#x2922;</button>
<button id="clear-tab-btn" class="header-action-btn" title="Clear Terminal" aria-label="Clear Terminal">&#x2298;</button></div></div>
<div id="terminal-container"></div><script nonce="qa" src="/bridge.js"></script><script src="/dist/webview.js"></script></body></html>`;

const bridge = `
const qa = window.__qa = { messages: [], inputs: [], acknowledged: 0, sent: 0, complete: false, maxFrameGapMs: 0, maxInFlight: 0, elapsedMs: 0 };
let nextTab = 1, nextSeq = 1, pendingStress = null;
function deliver(message) { window.dispatchEvent(new MessageEvent('message', { data: message })); }
function data(tabId, text) { deliver({ type: 'data', tabId, data: text, seq: nextSeq++ }); }
window.acquireVsCodeApi = () => ({ getState() {}, setState() {}, postMessage(message) {
  qa.messages.push(message); if (qa.messages.length > 1000) qa.messages.shift();
  if (message.type === 'ready') queueMicrotask(() => {
    deliver({ type: 'config', config: { cursorBlink: false, cursorStyle: 'block', fontFamily: 'monospace', fontSize: 14, lineHeight: 1, scrollback: 1000 } });
    deliver({ type: 'addTab', id: 'local-1', title: 'Terminal 1', isAgent: false });
    data('local-1', 'Side Terminal QA\\r\\nUnicode: 日本語 🚀\\r\\nsrc/provider/terminalViewProvider.ts:42:5\\r\\nC:\\\\project\\\\src\\\\file.ts:12:3\\r\\n日本語 🚀 src/main.ts:00012:00003\\r\\n$ ');
  });
  if (message.type === 'createTab') {
    const id = 'local-' + (++nextTab);
    deliver({ type: 'addTab', id, title: 'Terminal ' + nextTab, isAgent: false });
    data(id, '$ ');
  }
  if (message.type === 'input') {
    qa.inputs.push(message); if (qa.inputs.length > 100) qa.inputs.shift();
  }
  if (message.type === 'copy') qa.copiedSelection = message.data;
  if (message.type === 'paste') deliver({ type: 'paste', tabId: message.tabId, data: 'clipboard QA sample' });
  if (message.type === 'closeTab') deliver({ type: 'removeTab', tabId: message.tabId });
  if (message.type === 'outputAck' && pendingStress && message.seq === pendingStress.seq) {
    qa.acknowledged += pendingStress.size;
    pendingStress = null;
    if (qa.acknowledged >= 8 * 1024 * 1024) {
      qa.complete = true; qa.elapsedMs = performance.now() - qa.startedAt;
      document.getElementById('qa-status').textContent = 'Stress complete: ' + qa.acknowledged + ' units';
    } else queueMicrotask(pump);
  }
} });
function pump() {
  const text = 'output 日本語 0123456789\\r\\n'.repeat(2048).slice(0, Math.min(32768, 8 * 1024 * 1024 - qa.sent));
  const seq = nextSeq++;
  pendingStress = { seq, size: text.length };
  qa.sent += text.length; qa.maxInFlight = Math.max(qa.maxInFlight, text.length);
  deliver({ type: 'data', tabId: 'local-1', data: text, seq });
}
document.getElementById('stress').onclick = () => {
  qa.sent = qa.acknowledged = 0; qa.complete = false; qa.maxFrameGapMs = 0; qa.startedAt = performance.now();
  deliver({ type: 'selectTab', tabId: 'local-1' });
  document.getElementById('qa-status').textContent = 'Streaming output'; pump();
};
document.getElementById('agents').onclick = () => {
  for (let i = 1; i <= 2; i++) {
    deliver({ type: 'addTab', id: 'agent-' + i, title: '🤖 Claude', isAgent: true });
    data('agent-' + i, 'Read-only agent monitor ' + i + '\\r\\n');
  }
};
document.getElementById('paste').onclick = () => {
  deliver({ type: 'selectTab', tabId: 'local-1' });
  qa.inputs = [];
  const sample = 'a'.repeat(65535) + '🚀' + '日本語'.repeat(32768);
  const clipboard = new DataTransfer(); clipboard.setData('text/plain', sample);
  document.querySelector('.terminal-instance[style*="block"] textarea').dispatchEvent(new ClipboardEvent('paste', { clipboardData: clipboard, bubbles: true, cancelable: true }));
  qa.largePasteCorrect = qa.inputs.map(message => message.data).join('') === sample;
  qa.largePasteChunks = qa.inputs.map(message => message.data.length);
  qa.largePasteHasBrokenSurrogates = qa.inputs.some(message => /[\\uD800-\\uDBFF]$/.test(message.data) || /^[\\uDC00-\\uDFFF]/.test(message.data));
};
let lastFrame = performance.now();
function frame(time) { if (pendingStress) qa.maxFrameGapMs = Math.max(qa.maxFrameGapMs, time - lastFrame); lastFrame = time; requestAnimationFrame(frame); }
requestAnimationFrame(frame);
`;

const server = http.createServer((request, response) => {
  const route = new URL(request.url, 'http://127.0.0.1').pathname;
  if (route === '/') {
    const reader = new URL(request.url, 'http://127.0.0.1').searchParams.has('reader');
    response.setHeader('Content-Type', 'text/html; charset=utf-8');
    response.end(reader ? html.replace('class="vscode-dark"', 'class="vscode-dark vscode-using-screen-reader"') : html);
    return;
  }
  if (route === '/bridge.js') { response.setHeader('Content-Type', 'text/javascript; charset=utf-8'); response.end(bridge); return; }
  if (route === '/favicon.ico') { response.writeHead(204); response.end(); return; }
  const assets = { '/dist/webview.js': 'text/javascript', '/dist/xterm.css': 'text/css', '/media/style.css': 'text/css' };
  if (!assets[route]) { response.writeHead(404); response.end(); return; }
  response.setHeader('Content-Type', assets[route]);
  fs.createReadStream(path.join(root, route)).on('error', () => { response.writeHead(404); response.end(); }).pipe(response);
});
server.listen(0, '127.0.0.1', () => console.log('Side Terminal QA: http://127.0.0.1:' + server.address().port));
process.once('SIGINT', () => server.close());
process.once('SIGTERM', () => server.close());
