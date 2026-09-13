export interface TerminalFileLink {
  text: string;
  path: string;
  line?: number;
  col?: number;
  startX: number;
  endX: number;
}

const KNOWN_EXTENSIONLESS_FILES = 'Makefile|Dockerfile|Containerfile|Procfile|Gemfile|Rakefile|CMakeLists\\.txt|LICENSE';

const FILE_LINK_REGEX = new RegExp(
  `(?:^|[\\s"'\`(\\[])((?:(?:[A-Za-z]:[\\\\/])|(?:\\/)|(?:~[\\\\/])|(?:\\.{1,2}[\\\\/]))?(?:[A-Za-z0-9_.+()-]+[\\\\/])*(?:[A-Za-z0-9_.+()-]*\\.[A-Za-z0-9_+-]+|${KNOWN_EXTENSIONLESS_FILES})(?::\\d+(?::\\d+)?:?|\\(\\d+(?:,\\s*\\d+)?\\):?|#L\\d+(?:C\\d+)?|#L\\d+-L\\d+)?)(\\b|(?=[,\\s"'\`\\)\\]}>;:]|$))`,
  'gi'
);

const QUOTED_FILE_LINK_REGEX = /(["'`])((?:[A-Za-z]:[\\/]|\\\\|\/|~[\\/]|(?:\.{1,2}[\\/]))?[^"'`\r\n]+?)\1(?:(?::\d+(?::\d+)?:?|\(\d+(?:,\s*\d+)?\):?|#L\d+(?:C\d+)?|#L\d+-L\d+)?|(?:,\s*line\s+\d+))?/g;

/** Finds file paths while preserving nested directories, Windows drive prefixes, and coordinates. */
export function parseTerminalFileLinks(lineText: string): TerminalFileLink[] {
  const links: TerminalFileLink[] = [];
  let match: RegExpExecArray | null;

  while ((match = QUOTED_FILE_LINK_REGEX.exec(lineText)) !== null) {
    const rawPath = match[2];
    if (!rawPath.includes('/') && !rawPath.includes('\\') && !rawPath.includes('.') && !new RegExp(`^(?:${KNOWN_EXTENSIONLESS_FILES})$`, 'i').test(rawPath)) {
      continue;
    }
    const fullMatched = match[0];
    const quote = match[1];
    const afterQuote = fullMatched.slice(fullMatched.lastIndexOf(quote) + 1);
    const textToParse = rawPath + afterQuote;
    const startX = match.index + 2;
    const link = createLink(textToParse, startX);
    if (link && !links.some((item) => item.startX <= link.endX && item.endX >= link.startX)) {
      links.push(link);
    }
  }

  while ((match = FILE_LINK_REGEX.exec(lineText)) !== null) {
    const text = match[1];
    if (!text) continue;
    const startX = match.index + match[0].indexOf(text) + 1;
    const link = createLink(text, startX);
    if (link && !links.some((item) => item.startX <= link.endX && item.endX >= link.startX)) {
      links.push(link);
    }
  }

  return links.sort((left, right) => left.startX - right.startX);
}

function createLink(text: string, startX: number): TerminalFileLink | null {
  let cleanText = text.trim();
  if (cleanText.endsWith(':') && !cleanText.endsWith('::')) {
    cleanText = cleanText.slice(0, -1);
  }

  let line: number | undefined;
  let col: number | undefined;
  let filePath = cleanText;

  let m = cleanText.match(/:(\d+):(\d+)$/);
  if (m) {
    line = Number(m[1]);
    col = Number(m[2]);
    filePath = cleanText.slice(0, m.index);
  } else if ((m = cleanText.match(/:(\d+)$/))) {
    line = Number(m[1]);
    filePath = cleanText.slice(0, m.index);
  } else if ((m = cleanText.match(/\((\d+)(?:,\s*(\d+))?\)$/))) {
    line = Number(m[1]);
    if (m[2]) col = Number(m[2]);
    filePath = cleanText.slice(0, m.index);
  } else if ((m = cleanText.match(/#L(\d+)(?:C(\d+)|-L\d+)?$/))) {
    line = Number(m[1]);
    if (m[2]) col = Number(m[2]);
    filePath = cleanText.slice(0, m.index);
  } else if ((m = cleanText.match(/,\s*line\s+(\d+)$/i))) {
    line = Number(m[1]);
    filePath = cleanText.slice(0, m.index);
  }

  if (!filePath || filePath === '.' || filePath === '..' || filePath === '/' || filePath === '\\') {
    return null;
  }

  return {
    text: cleanText,
    path: filePath,
    line,
    col,
    startX,
    endX: startX + cleanText.length - 1
  };
}

