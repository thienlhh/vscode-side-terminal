import { Terminal, ITheme, ILink } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { parseTerminalFileLinks } from './linkParser';
import type { TerminalConfig } from '../provider/terminalConfig';

declare function acquireVsCodeApi(): {
  postMessage(message: unknown): void;
  getState(): unknown;
  setState(state: unknown): void;
};

const vscode = acquireVsCodeApi();
const savedState = vscode.getState() as { activeTabId?: unknown } | undefined;

let currentConfig: TerminalConfig = {
  cursorBlink: true,
  cursorStyle: 'block',
  fontSize: 12,
  fontFamily: "Menlo, Monaco, 'Courier New', monospace, Consolas",
  lineHeight: 1.2,
  scrollback: 5000
};

interface Tab {
  id: string;
  title: string;
  isAgent: boolean;
  restoreWrites: number;
  term: Terminal;
  fitAddon: FitAddon;
  element: HTMLElement;
}

const tabs: Map<string, Tab> = new Map();
let activeTabId: string | null = null;
let preferredTabId = typeof savedState?.activeTabId === 'string' ? savedState.activeTabId : null;

const tabListEl = document.getElementById('tab-list') as HTMLElement;
const terminalContainerEl = document.getElementById('terminal-container') as HTMLElement;
const newTabBtn = document.getElementById('new-tab-btn') as HTMLElement;
const openEditorBtn = document.getElementById('open-editor-btn') as HTMLElement;
const clearTabBtn = document.getElementById('clear-tab-btn') as HTMLElement;

newTabBtn?.addEventListener('click', () => {
  vscode.postMessage({ type: 'createTab' });
});

openEditorBtn?.addEventListener('click', () => {
  vscode.postMessage({ type: 'openEditorTerminal' });
});

clearTabBtn?.addEventListener('click', () => {
  if (activeTabId && tabs.has(activeTabId)) {
    tabs.get(activeTabId)!.term.clear();
    vscode.postMessage({ type: 'clearTab', tabId: activeTabId });
  }
});

function getTerminalTheme(): ITheme {
  const isLight = document.body.classList.contains('vscode-light');
  const style = getComputedStyle(document.body);
  const getProp = (varName: string, fallback: string) => style.getPropertyValue(varName).trim() || fallback;

  const bg = getProp(
    '--vscode-terminal-background',
    getProp('--vscode-editor-background', isLight ? '#ffffff' : '#1e1e1e')
  );
  const fg = getProp(
    '--vscode-terminal-foreground',
    getProp('--vscode-editor-foreground', isLight ? '#222222' : '#cccccc')
  );
  const cursor = getProp(
    '--vscode-terminalCursor-foreground',
    isLight ? '#000000' : '#ffffff'
  );
  const selection = getProp(
    '--vscode-terminal-selectionBackground',
    isLight ? 'rgba(0, 0, 0, 0.18)' : 'rgba(255, 255, 255, 0.2)'
  );

  return {
    background: bg,
    foreground: fg,
    cursor,
    selectionBackground: selection,
    black: getProp('--vscode-terminal-ansiBlack', '#000000'),
    red: getProp('--vscode-terminal-ansiRed', '#cd3131'),
    green: getProp('--vscode-terminal-ansiGreen', '#0dbc79'),
    yellow: getProp('--vscode-terminal-ansiYellow', '#e5e510'),
    blue: getProp('--vscode-terminal-ansiBlue', '#2472c8'),
    magenta: getProp('--vscode-terminal-ansiMagenta', '#bc3fbc'),
    cyan: getProp('--vscode-terminal-ansiCyan', '#11a8cd'),
    white: getProp('--vscode-terminal-ansiWhite', '#e5e5e5'),
    brightBlack: getProp('--vscode-terminal-ansiBrightBlack', '#666666'),
    brightRed: getProp('--vscode-terminal-ansiBrightRed', '#f14c4c'),
    brightGreen: getProp('--vscode-terminal-ansiBrightGreen', '#23d18b'),
    brightYellow: getProp('--vscode-terminal-ansiBrightYellow', '#f5f543'),
    brightBlue: getProp('--vscode-terminal-ansiBrightBlue', '#3b8eea'),
    brightMagenta: getProp('--vscode-terminal-ansiBrightMagenta', '#d670d6'),
    brightCyan: getProp('--vscode-terminal-ansiBrightCyan', '#29b8db'),
    brightWhite: getProp('--vscode-terminal-ansiBrightWhite', '#ffffff')
  };
}

function updateAllThemes() {
  const currentTheme = getTerminalTheme();
  const bg = currentTheme.background || (document.body.classList.contains('vscode-light') ? '#ffffff' : '#1e1e1e');
  terminalContainerEl.style.backgroundColor = bg;
  const screenReaderMode = document.body.classList.contains('vscode-using-screen-reader');

  tabs.forEach((tab) => {
    tab.term.options.theme = currentTheme;
    tab.term.options.screenReaderMode = screenReaderMode;
    tab.element.style.backgroundColor = bg;
    if (tab.term.element) {
      tab.term.element.style.backgroundColor = bg;
    }
  });
}

function applyConfigToAll(config: TerminalConfig) {
  currentConfig = config;
  tabs.forEach((tab) => {
    tab.term.options.cursorBlink = config.cursorBlink;
    tab.term.options.cursorStyle = config.cursorStyle;
    tab.term.options.fontSize = config.fontSize;
    tab.term.options.fontFamily = config.fontFamily;
    tab.term.options.lineHeight = config.lineHeight;
    tab.term.options.scrollback = config.scrollback;
    tab.fitAddon.fit();
  });
}

// Watch for VS Code theme changes via DOM classes on <body>
const themeObserver = new MutationObserver(() => {
  updateAllThemes();
});
themeObserver.observe(document.body, { attributes: true, attributeFilter: ['class', 'style'] });

interface LogicalLine {
  text: string;
  charMapX: number[];
  charMapY: number[];
  startY: number;
  endY: number;
}

function getLogicalLine(term: Terminal, bufferLineNumber: number): LogicalLine | null {
  const lineIndex = bufferLineNumber - 1;
  const targetLine = term.buffer.active.getLine(lineIndex);
  if (!targetLine) return null;

  let startY = lineIndex;
  while (startY > 0 && term.buffer.active.getLine(startY)?.isWrapped) {
    startY--;
  }

  let endY = lineIndex;
  while (endY + 1 < term.buffer.active.length && term.buffer.active.getLine(endY + 1)?.isWrapped) {
    endY++;
  }

  const nullCell = term.buffer.active.getNullCell();
  const charMapX: number[] = [];
  const charMapY: number[] = [];
  let logicalText = '';

  for (let y = startY; y <= endY; y++) {
    const line = term.buffer.active.getLine(y);
    if (!line) continue;

    const isLastWrappedLine = y === endY;
    const lineStr = line.translateToString(isLastWrappedLine);

    let textOffset = 0;
    for (let cellIndex = 0; cellIndex < line.length; cellIndex++) {
      const cell = line.getCell(cellIndex, nullCell);
      if (!cell) continue;
      const chars = cell.getChars() || (cell.getWidth() > 0 ? ' '.repeat(cell.getWidth()) : '');
      if (!chars) continue;

      if (textOffset >= lineStr.length) break;

      const takeChars = Math.min(chars.length, lineStr.length - textOffset);
      const posX = cellIndex + 1;
      const posY = y + 1;
      for (let ci = 0; ci < takeChars; ci++) {
        charMapX.push(posX);
        charMapY.push(posY);
      }
      textOffset += chars.length;
    }
    logicalText += lineStr;
  }

  return {
    text: logicalText,
    charMapX,
    charMapY,
    startY: startY + 1,
    endY: endY + 1
  };
}

function rangesOverlap(a: { start: { x: number; y: number }; end: { x: number; y: number } }, b: { start: { x: number; y: number }; end: { x: number; y: number } }, cols: number): boolean {
  const aStart = a.start.y * cols + a.start.x;
  const aEnd = a.end.y * cols + a.end.x;
  const bStart = b.start.y * cols + b.start.x;
  const bEnd = b.end.y * cols + b.end.x;
  return aStart <= bEnd && aEnd >= bStart;
}

function registerCustomLinkProvider(term: Terminal) {
  term.registerLinkProvider({
    provideLinks(bufferLineNumber: number, callback: (links: ILink[] | undefined) => void) {
      const logical = getLogicalLine(term, bufferLineNumber);
      if (!logical || !logical.text) {
        callback(undefined);
        return;
      }

      const { text: lineText, charMapX, charMapY } = logical;
      const links: ILink[] = [];
      const cols = Math.max(1, term.cols);
      const totalChars = charMapX.length;

      const toRange = (startIndex: number, length: number) => {
        const endIndex = startIndex + length - 1;
        if (startIndex < 0 || endIndex >= totalChars) return null;
        const start = { x: charMapX[startIndex], y: charMapY[startIndex] };
        const end = { x: charMapX[endIndex], y: charMapY[endIndex] };
        if (bufferLineNumber < start.y || bufferLineNumber > end.y) return null;
        return { start, end };
      };

      // 1. Detect Web URLs (http:// or https://)
      const urlRegex = /(https?:\/\/[^\s"'`<>()[\]{}]+)/g;
      let match: RegExpExecArray | null;
      while ((match = urlRegex.exec(lineText)) !== null) {
        const url = match[1];
        const range = toRange(match.index, url.length);
        if (!range) continue;

        links.push({
          text: url,
          range,
          decorations: {
            pointerCursor: true,
            underline: true
          },
          activate(_event: MouseEvent, text: string) {
            vscode.postMessage({ type: 'openUrl', url: text });
          }
        });
      }

      // 2. Detect file paths with optional line/col coordinates
      for (const fileLink of parseTerminalFileLinks(lineText)) {
        const range = toRange(fileLink.startX - 1, fileLink.text.length);
        if (!range) continue;
        if (links.some((existing) => rangesOverlap(existing.range, range, cols))) continue;

        links.push({
          text: fileLink.text,
          range,
          decorations: {
            pointerCursor: true,
            underline: true
          },
          activate(_event: MouseEvent, _text: string) {
            vscode.postMessage({
              type: 'openFile',
              path: fileLink.path,
              line: fileLink.line,
              col: fileLink.col
            });
          }
        });
      }

      callback(links.length > 0 ? links : undefined);
    }
  });
}

function createTab(id: string, title: string, isAgent: boolean, select = true): Tab {
  const initialTheme = getTerminalTheme();
  const bg = initialTheme.background || (document.body.classList.contains('vscode-light') ? '#ffffff' : '#1e1e1e');

  const termEl = document.createElement('div');
  termEl.className = 'terminal-instance';
  termEl.style.display = 'none';
  termEl.style.backgroundColor = bg;
  terminalContainerEl.appendChild(termEl);

  const term = new Terminal({
    cursorBlink: currentConfig.cursorBlink,
    cursorStyle: currentConfig.cursorStyle,
    fontFamily: currentConfig.fontFamily,
    fontSize: currentConfig.fontSize,
    lineHeight: currentConfig.lineHeight,
    scrollback: currentConfig.scrollback,
    disableStdin: isAgent,
    screenReaderMode: document.body.classList.contains('vscode-using-screen-reader'),
    theme: initialTheme
  });

  // Intercept DECSCUSR (CSI Ps SP q) to protect user cursor configuration
  term.parser.registerCsiHandler({ intermediates: " ", final: "q" }, (params) => {
    const raw = params[0];
    const param = (typeof raw === "number" ? raw : (Array.isArray(raw) ? raw[0] : 0)) || 0;

    if (param === 0) {
      // Reset to user defaults
      term.options.cursorStyle = currentConfig.cursorStyle;
      term.options.cursorBlink = currentConfig.cursorBlink;
      return true;
    }

    switch (param) {
      case 1:
      case 2:
        term.options.cursorStyle = "block";
        break;
      case 3:
      case 4:
        term.options.cursorStyle = "underline";
        break;
      case 5:
      case 6:
        term.options.cursorStyle = "bar";
        break;
    }

    if (!currentConfig.cursorBlink) {
      term.options.cursorBlink = false;
    } else {
      term.options.cursorBlink = param % 2 === 1;
    }
    return true;
  });

  // Intercept DEC private mode 12 (start blinking cursor)
  term.parser.registerCsiHandler({ prefix: "?", final: "h" }, (params) => {
    const hasMode12 = params.some((p) => (typeof p === "number" ? p === 12 : Array.isArray(p) && p.includes(12)));
    if (hasMode12 && !currentConfig.cursorBlink) {
      if (params.length === 1) {
        return true;
      }
    }
    return false;
  });

  const fitAddon = new FitAddon();
  term.loadAddon(fitAddon);
  registerCustomLinkProvider(term);
  term.open(termEl);
  if (term.element) {
    term.element.style.backgroundColor = bg;
  }
  if (isAgent && term.textarea) {
    term.textarea.readOnly = true;
    term.textarea.setAttribute('aria-label', 'Read-only agent output');
  }
  term.onRender(() => {
    if (!currentConfig.cursorBlink && term.options.cursorBlink) term.options.cursorBlink = false;
  });

  term.onData((data) => {
    if (!isAgent && tab.restoreWrites === 0) {
      for (let offset = 0; offset < data.length;) {
        let end = Math.min(offset + 64 * 1024, data.length);
        if (end < data.length && /[\uD800-\uDBFF]/.test(data[end - 1]) && /[\uDC00-\uDFFF]/.test(data[end])) end--;
        vscode.postMessage({ type: 'input', tabId: id, data: data.slice(offset, end) });
        offset = end;
      }
    }
  });

  term.onResize(({ cols, rows }) => {
    vscode.postMessage({ type: 'resize', tabId: id, cols, rows });
  });

  const tab: Tab = {
    id,
    title,
    isAgent,
    restoreWrites: 0,
    term,
    fitAddon,
    element: termEl
  };

  tabs.set(id, tab);
  renderTabBar();
  if (select) switchTab(id);

  return tab;
}

function switchTab(id: string) {
  if (!tabs.has(id)) return;
  activeTabId = id;
  preferredTabId = id;
  vscode.setState({ activeTabId: id });

  tabs.forEach((tab, tabId) => {
    if (tabId === id) {
      tab.element.style.display = 'block';
      requestAnimationFrame(() => {
        if (activeTabId !== id || !tabs.has(id)) return;
        try {
          tab.fitAddon.fit();
          tab.term.focus();
          vscode.postMessage({
            type: 'resize',
            tabId: id,
            cols: tab.term.cols,
            rows: tab.term.rows
          });
        } catch {
          // Ignore
        }
      });
    } else {
      tab.element.style.display = 'none';
    }
  });

  renderTabBar();
}

function disposeTab(id: string, notifyHost: boolean) {
  const tab = tabs.get(id);
  if (!tab) return;

  try { tab.fitAddon.dispose(); } catch { /* ignore */ }
  tab.term.dispose();
  tab.element.remove();
  tabs.delete(id);

  if (notifyHost) {
    vscode.postMessage({ type: 'closeTab', tabId: id });
  }

  if (activeTabId === id) {
    const nextId = tabs.keys().next().value;
    if (nextId) {
      switchTab(nextId);
    } else {
      activeTabId = null;
      preferredTabId = null;
      vscode.setState({ activeTabId: null });
      renderTabBar();
    }
  } else {
    renderTabBar();
  }
}

function closeTab(id: string) {
  disposeTab(id, true);
}

function renderTabBar() {
  tabListEl.innerHTML = '';

  tabs.forEach((tab, id) => {
    const tabEl = document.createElement('div');
    tabEl.className = `tab-item ${id === activeTabId ? 'active' : ''} ${tab.isAgent ? 'agent' : ''}`;
    tabEl.setAttribute('role', 'tab');
    tabEl.setAttribute('aria-label', tab.title);
    tabEl.title = tab.isAgent ? `${tab.title}: read-only monitor. Use the source terminal for input.` : tab.title;
    tabEl.setAttribute('aria-selected', String(id === activeTabId));
    tabEl.tabIndex = id === activeTabId ? 0 : -1;
    tabEl.addEventListener('click', () => switchTab(id));
    tabEl.addEventListener('keydown', (event) => {
      if (event.target !== tabEl) return;
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        switchTab(id);
      }
    });

    const titleSpan = document.createElement('span');
    titleSpan.className = 'tab-title';
    titleSpan.textContent = tab.title;
    titleSpan.title = tab.title;
    tabEl.appendChild(titleSpan);

    const closeBtn = document.createElement('button');
    closeBtn.type = 'button';
    closeBtn.className = 'tab-close';
    closeBtn.textContent = '×';
    closeBtn.title = `Close ${tab.title}`;
    closeBtn.setAttribute('aria-label', `Close ${tab.title}`);
    closeBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      closeTab(id);
    });
    tabEl.appendChild(closeBtn);

    tabListEl.appendChild(tabEl);
  });
}

// Keyboard navigation for tabs (Alt+[ / Alt+] or Alt+Left / Alt+Right)
window.addEventListener('keydown', (e) => {
  const tab = activeTabId ? tabs.get(activeTabId) : undefined;
  const key = e.key.toLowerCase();
  if (tab && terminalContainerEl.contains(document.activeElement) && e.metaKey && !e.ctrlKey && !e.altKey && !e.shiftKey && key === 'a') {
    e.preventDefault();
    e.stopPropagation();
    tab.term.selectAll();
    return;
  }
  const clipboardShortcut = !e.altKey && ((e.metaKey && !e.ctrlKey && (key === 'v' || !e.shiftKey)) || (e.ctrlKey && e.shiftKey && !e.metaKey));
  if (tab && terminalContainerEl.contains(document.activeElement) && clipboardShortcut && (key === 'c' || key === 'v')) {
    e.preventDefault();
    e.stopPropagation();
    if (key === 'c') {
      const selection = tab.term.getSelection();
      if (selection) vscode.postMessage({ type: 'copy', tabId: tab.id, data: selection });
    } else if (!tab.isAgent) {
      vscode.postMessage({ type: 'paste', tabId: tab.id });
    }
    return;
  }
  if (e.altKey && (e.key === '[' || e.key === 'ArrowLeft' || e.key === ']' || e.key === 'ArrowRight')) {
    const tabIds = Array.from(tabs.keys());
    if (tabIds.length <= 1 || !activeTabId) return;
    const currentIndex = tabIds.indexOf(activeTabId);
    if (currentIndex === -1) return;

    const offset = (e.key === '[' || e.key === 'ArrowLeft') ? -1 : 1;
    const targetIndex = (currentIndex + offset + tabIds.length) % tabIds.length;
    switchTab(tabIds[targetIndex]);
    e.preventDefault();
    e.stopPropagation();
  }
}, true);

// Window and container resize listeners
let resizeRaf: number | null = null;
function scheduleFit(): void {
  if (resizeRaf !== null) cancelAnimationFrame(resizeRaf);
  resizeRaf = requestAnimationFrame(() => {
    resizeRaf = null;
    if (activeTabId && tabs.has(activeTabId)) {
      const active = tabs.get(activeTabId)!;
      try {
        active.fitAddon.fit();
      } catch {
        // Ignore
      }
    }
  });
}

window.addEventListener('resize', scheduleFit);
if (typeof ResizeObserver !== 'undefined' && terminalContainerEl) {
  const containerObserver = new ResizeObserver(scheduleFit);
  containerObserver.observe(terminalContainerEl);
}

// Listen for messages from extension host
window.addEventListener('message', (event) => {
  const msg = event.data;
  if (!msg || typeof msg !== 'object') return;
  switch (msg.type) {
    case 'config': {
      if (msg.config) {
        applyConfigToAll(msg.config);
      }
      break;
    }
    case 'addTab': {
      if (!tabs.has(msg.id)) {
        createTab(msg.id, msg.title, !!msg.isAgent, !msg.isAgent);
      }
      break;
    }
    case 'restoreTabs': {
      const restoredTabs = Array.isArray(msg.tabs) ? msg.tabs : [];
      const restoredIds = new Set(
        restoredTabs.filter((item: any) => item && typeof item.id === 'string').map((item: any) => item.id)
      );
      for (const id of tabs.keys()) {
        if (!restoredIds.has(id)) disposeTab(id, false);
      }
      for (const item of restoredTabs) {
        if (!item || typeof item.id !== 'string') continue;
        const isAgent = item.isAgent === true;
        const tab = tabs.get(item.id) ?? createTab(item.id, String(item.title ?? item.id), isAgent, false);
        const snapshot = typeof item.snapshot === 'string' ? item.snapshot : item.data;
        if (typeof snapshot === 'string' && snapshot.length > 0) {
          tab.restoreWrites++;
          tab.term.write(snapshot, () => { tab.restoreWrites--; });
        }
      }
      const selectedId = preferredTabId && tabs.has(preferredTabId)
        ? preferredTabId
        : tabs.keys().next().value;
      if (selectedId) switchTab(selectedId);
      break;
    }
    case 'data': {
      const tab = tabs.get(msg.tabId);
      if (tab) {
        tab.term.write(msg.data, () => {
          if (Number.isSafeInteger(msg.seq)) {
            vscode.postMessage({ type: 'outputAck', tabId: msg.tabId, seq: msg.seq });
          }
        });
      }
      break;
    }
    case 'updateTitle': {
      if (typeof msg.tabId === 'string' && typeof msg.title === 'string') {
        const tab = tabs.get(msg.tabId);
        if (tab && tab.title !== msg.title) {
          tab.title = msg.title;
          renderTabBar();
        }
      }
      break;
    }
    case 'clearTab': {
      tabs.get(msg.tabId)?.term.clear();
      break;
    }
    case 'paste': {
      const tab = tabs.get(msg.tabId);
      if (tab && !tab.isAgent && typeof msg.data === 'string') tab.term.paste(msg.data);
      break;
    }
    case 'removeTab': {
      disposeTab(msg.tabId, false);
      break;
    }
    case 'selectTab': {
      switchTab(msg.tabId);
      break;
    }
    case 'themeChanged': {
      updateAllThemes();
      break;
    }
    case 'viewVisible': {
      if (activeTabId && tabs.has(activeTabId)) {
        const tab = tabs.get(activeTabId)!;
        requestAnimationFrame(() => {
          if (activeTabId !== tab.id || !tabs.has(tab.id)) return;
          try {
            tab.fitAddon.fit();
            tab.term.focus();
          } catch {
            // Ignore
          }
        });
      }
      break;
    }
  }
});

// Initial theme apply
updateAllThemes();

// Notify extension host that webview is ready
vscode.postMessage({ type: 'ready' });
