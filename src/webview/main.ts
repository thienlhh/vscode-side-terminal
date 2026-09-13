import { Terminal, ITheme, ILink } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';

declare function acquireVsCodeApi(): {
  postMessage(message: unknown): void;
  getState(): unknown;
  setState(state: unknown): void;
};

const vscode = acquireVsCodeApi();

interface TerminalConfig {
  cursorBlink: boolean;
  cursorStyle: 'block' | 'underline' | 'bar';
  fontSize: number;
  fontFamily: string;
  lineHeight: number;
  scrollback: number;
}

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
  term: Terminal;
  fitAddon: FitAddon;
  element: HTMLElement;
}

const tabs: Map<string, Tab> = new Map();
let activeTabId: string | null = null;

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
  }
});

function getComputedColor(varName: string, fallback: string): string {
  const val = getComputedStyle(document.body).getPropertyValue(varName).trim();
  return val || fallback;
}

function getTerminalTheme(): ITheme {
  const isLight = document.body.classList.contains('vscode-light');

  const bg = getComputedColor(
    '--vscode-terminal-background',
    getComputedColor('--vscode-editor-background', isLight ? '#ffffff' : '#181818')
  );
  const fg = getComputedColor(
    '--vscode-terminal-foreground',
    getComputedColor('--vscode-editor-foreground', isLight ? '#222222' : '#cccccc')
  );
  const cursor = getComputedColor(
    '--vscode-terminalCursor-foreground',
    isLight ? '#000000' : '#ffffff'
  );
  const selection = getComputedColor(
    '--vscode-terminal-selectionBackground',
    isLight ? 'rgba(0, 0, 0, 0.18)' : 'rgba(255, 255, 255, 0.2)'
  );

  return {
    background: bg,
    foreground: fg,
    cursor,
    selectionBackground: selection,
    black: getComputedColor('--vscode-terminal-ansiBlack', isLight ? '#000000' : '#000000'),
    red: getComputedColor('--vscode-terminal-ansiRed', '#cd3131'),
    green: getComputedColor('--vscode-terminal-ansiGreen', '#0dbc79'),
    yellow: getComputedColor('--vscode-terminal-ansiYellow', '#e5e510'),
    blue: getComputedColor('--vscode-terminal-ansiBlue', '#2472c8'),
    magenta: getComputedColor('--vscode-terminal-ansiMagenta', '#bc3fbc'),
    cyan: getComputedColor('--vscode-terminal-ansiCyan', '#11a8cd'),
    white: getComputedColor('--vscode-terminal-ansiWhite', isLight ? '#e5e5e5' : '#e5e5e5'),
    brightBlack: getComputedColor('--vscode-terminal-ansiBrightBlack', '#666666'),
    brightRed: getComputedColor('--vscode-terminal-ansiBrightRed', '#f14c4c'),
    brightGreen: getComputedColor('--vscode-terminal-ansiBrightGreen', '#23d18b'),
    brightYellow: getComputedColor('--vscode-terminal-ansiBrightYellow', '#f5f543'),
    brightBlue: getComputedColor('--vscode-terminal-ansiBrightBlue', '#3b8eea'),
    brightMagenta: getComputedColor('--vscode-terminal-ansiBrightMagenta', '#d670d6'),
    brightCyan: getComputedColor('--vscode-terminal-ansiBrightCyan', '#29b8db'),
    brightWhite: getComputedColor('--vscode-terminal-ansiBrightWhite', '#ffffff')
  };
}

function updateAllThemes() {
  const currentTheme = getTerminalTheme();
  terminalContainerEl.style.backgroundColor = currentTheme.background || '#181818';

  tabs.forEach((tab) => {
    tab.term.options.theme = currentTheme;
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

function registerCustomLinkProvider(term: Terminal) {
  term.registerLinkProvider({
    provideLinks(bufferLineNumber: number, callback: (links: ILink[] | undefined) => void) {
      const line = term.buffer.active.getLine(bufferLineNumber - 1);
      if (!line) {
        callback(undefined);
        return;
      }
      const lineText = line.translateToString(true);
      if (!lineText) {
        callback(undefined);
        return;
      }

      const links: ILink[] = [];

      // 1. Detect Web URLs (http:// or https://)
      const urlRegex = /(https?:\/\/[^\s"'`<>()[\]{}]+)/g;
      let match: RegExpExecArray | null;
      while ((match = urlRegex.exec(lineText)) !== null) {
        const url = match[1];
        const startX = match.index + 1;
        const endX = match.index + url.length;

        links.push({
          text: url,
          range: {
            start: { x: startX, y: bufferLineNumber },
            end: { x: endX, y: bufferLineNumber }
          },
          decorations: {
            pointerCursor: true,
            underline: true
          },
          activate(_event: MouseEvent, text: string) {
            vscode.postMessage({ type: 'openUrl', url: text });
          }
        });
      }

      // 2. Detect File Paths with optional :line[:col]
      // Matches path patterns like src/index.ts:12:5, ./README.md:20, /abs/path.js, SPEC.md
      const fileRegex = /(?:^|[\s"'`(\[])((?:[a-zA-Z]:[\\\/]|\/|\.{1,2}[\\\/]|[a-zA-Z0-9_.-]+[\\\/])?[a-zA-Z0-9_.-]+\.[a-zA-Z0-9_+-]+(?::(\d+)(?::(\d+))?)?)/g;
      while ((match = fileRegex.exec(lineText)) !== null) {
        const fullMatch = match[1];
        const lineNum = match[2] ? parseInt(match[2], 10) : undefined;
        const colNum = match[3] ? parseInt(match[3], 10) : undefined;

        const colonIdx = fullMatch.indexOf(':');
        const rawPath = colonIdx !== -1 ? fullMatch.substring(0, colonIdx) : fullMatch;

        const matchStart = match.index + (match[0].length - fullMatch.length);
        const startX = matchStart + 1;
        const endX = matchStart + fullMatch.length;

        const overlaps = links.some(
          (l) => (startX >= l.range.start.x && startX <= l.range.end.x) ||
                 (endX >= l.range.start.x && endX <= l.range.end.x)
        );
        if (overlaps) continue;

        links.push({
          text: fullMatch,
          range: {
            start: { x: startX, y: bufferLineNumber },
            end: { x: endX, y: bufferLineNumber }
          },
          decorations: {
            pointerCursor: true,
            underline: true
          },
          activate(_event: MouseEvent, _text: string) {
            vscode.postMessage({
              type: 'openFile',
              path: rawPath,
              line: lineNum,
              col: colNum
            });
          }
        });
      }

      callback(links.length > 0 ? links : undefined);
    }
  });
}

function createTab(id: string, title: string, isAgent: boolean): Tab {
  const termEl = document.createElement('div');
  termEl.className = 'terminal-instance';
  termEl.style.display = 'none';
  terminalContainerEl.appendChild(termEl);

  const term = new Terminal({
    cursorBlink: currentConfig.cursorBlink,
    cursorStyle: currentConfig.cursorStyle,
    fontFamily: currentConfig.fontFamily,
    fontSize: currentConfig.fontSize,
    lineHeight: currentConfig.lineHeight,
    scrollback: currentConfig.scrollback,
    theme: getTerminalTheme()
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

  // Safety net on optionsService: enforce cursorBlink: false whenever configured
  const core = (term as any)._core;
  if (core && core.optionsService) {
    core.optionsService.onOptionChange((prop: string) => {
      if (prop === "cursorBlink" && !currentConfig.cursorBlink && term.options.cursorBlink) {
        term.options.cursorBlink = false;
      }
    });
  }

  const fitAddon = new FitAddon();
  term.loadAddon(fitAddon);
  registerCustomLinkProvider(term);
  term.open(termEl);

  term.onData((data) => {
    vscode.postMessage({ type: 'input', tabId: id, data });
  });

  term.onResize(({ cols, rows }) => {
    vscode.postMessage({ type: 'resize', tabId: id, cols, rows });
  });

  const tab: Tab = {
    id,
    title,
    isAgent,
    term,
    fitAddon,
    element: termEl
  };

  tabs.set(id, tab);
  renderTabBar();
  switchTab(id);

  return tab;
}

function switchTab(id: string) {
  if (!tabs.has(id)) return;
  activeTabId = id;

  tabs.forEach((tab, tabId) => {
    if (tabId === id) {
      tab.element.style.display = 'block';
      setTimeout(() => {
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
      }, 50);
    } else {
      tab.element.style.display = 'none';
    }
  });

  renderTabBar();
}

function closeTab(id: string) {
  const tab = tabs.get(id);
  if (!tab) return;

  tab.term.dispose();
  tab.element.remove();
  tabs.delete(id);

  vscode.postMessage({ type: 'closeTab', tabId: id });

  if (activeTabId === id) {
    const nextId = tabs.keys().next().value;
    if (nextId) {
      switchTab(nextId);
    } else {
      activeTabId = null;
      renderTabBar();
    }
  } else {
    renderTabBar();
  }
}

function renderTabBar() {
  tabListEl.innerHTML = '';

  tabs.forEach((tab, id) => {
    const tabEl = document.createElement('div');
    tabEl.className = `tab-item ${id === activeTabId ? 'active' : ''} ${tab.isAgent ? 'agent' : ''}`;

    const titleSpan = document.createElement('span');
    titleSpan.className = 'tab-title';
    titleSpan.textContent = tab.title;
    titleSpan.title = tab.title;
    titleSpan.addEventListener('click', () => switchTab(id));
    tabEl.appendChild(titleSpan);

    const closeBtn = document.createElement('span');
    closeBtn.className = 'tab-close';
    closeBtn.innerHTML = '&times;';
    closeBtn.title = 'Close Tab';
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
  if (e.altKey && (e.key === '[' || e.key === 'ArrowLeft' || e.key === ']' || e.key === 'ArrowRight')) {
    const tabIds = Array.from(tabs.keys());
    if (tabIds.length <= 1 || !activeTabId) return;
    const currentIndex = tabIds.indexOf(activeTabId);
    if (currentIndex === -1) return;

    if (e.key === '[' || e.key === 'ArrowLeft') {
      const prevIndex = (currentIndex - 1 + tabIds.length) % tabIds.length;
      switchTab(tabIds[prevIndex]);
      e.preventDefault();
    } else {
      const nextIndex = (currentIndex + 1) % tabIds.length;
      switchTab(tabIds[nextIndex]);
      e.preventDefault();
    }
  }
});

// Window resize listener
window.addEventListener('resize', () => {
  if (activeTabId && tabs.has(activeTabId)) {
    const active = tabs.get(activeTabId)!;
    active.fitAddon.fit();
  }
});

// Listen for messages from extension host
window.addEventListener('message', (event) => {
  const msg = event.data;
  switch (msg.type) {
    case 'config': {
      if (msg.config) {
        applyConfigToAll(msg.config);
      }
      break;
    }
    case 'addTab': {
      if (!tabs.has(msg.id)) {
        createTab(msg.id, msg.title, !!msg.isAgent);
      }
      break;
    }
    case 'data': {
      const tab = tabs.get(msg.tabId);
      if (tab) {
        tab.term.write(msg.data);
      }
      break;
    }
    case 'removeTab': {
      closeTab(msg.tabId);
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
        setTimeout(() => {
          try {
            tab.fitAddon.fit();
            tab.term.focus();
          } catch {
            // Ignore
          }
        }, 50);
      }
      break;
    }
  }
});

// Initial theme apply
updateAllThemes();

// Notify extension host that webview is ready
vscode.postMessage({ type: 'ready' });
