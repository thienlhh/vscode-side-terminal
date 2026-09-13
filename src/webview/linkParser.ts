export interface TerminalFileLink {
  text: string;
  path: string;
  line?: number;
  col?: number;
  startX: number;
  endX: number;
}

const KNOWN_EXTENSIONLESS_FILES = 'Makefile|Dockerfile|Containerfile|Procfile|Gemfile|Rakefile|CMakeLists\\.txt|LICENSE';
const EXTENSIONLESS_FILE_REGEX = new RegExp(`^(?:${KNOWN_EXTENSIONLESS_FILES})$`, 'i');

const FILE_LINK_REGEX = new RegExp(
  `(?:^|[\\s"'\`(\\[])((?:(?:[A-Za-z]:[\\\\/])|(?:\\/)|(?:~[\\\\/])|(?:\\.{1,2}[\\\\/]))?(?:[A-Za-z0-9_.+()-]+[\\\\/])*(?:[A-Za-z0-9_.+()-]*\\.[A-Za-z0-9_+-]+|${KNOWN_EXTENSIONLESS_FILES})(?::\\d+(?::\\d+)?:?|\\(\\d+(?:,\\s*\\d+)?\\):?|#L\\d+(?:C\\d+)?|#L\\d+-L\\d+)?)(\\b|(?=[,\\s"'\`\\)\\]}>;:]|$))`,
  'gi'
);

const QUOTED_FILE_LINK_REGEX = /(["'`])((?:[A-Za-z]:[\\/]|\\\\|\/|~[\\/]|(?:\.{1,2}[\\/]))?[^"'`\r\n]+?)\1(?:(?::\d+(?::\d+)?:?|\(\d+(?:,\s*\d+)?\):?|#L\d+(?:C\d+)?|#L\d+-L\d+)?|(?:,\s*line\s+\d+))?/g;

const COORD_PATTERNS = [
  /:(\d+):(\d+)$/,
  /:(\d+)$/,
  /\((\d+)(?:,\s*(\d+))?\)$/,
  /#L(\d+)(?:C(\d+)|-L\d+)?$/,
  /,\s*line\s+(\d+)$/i
];

const INVALID_FILE_PATHS = new Set(['.', '..', '/', '\\']);

/** Finds file paths while preserving nested directories, Windows drive prefixes, and coordinates. */
export function parseTerminalFileLinks(lineText: string): TerminalFileLink[] {
  QUOTED_FILE_LINK_REGEX.lastIndex = 0;
  FILE_LINK_REGEX.lastIndex = 0;
  const links: TerminalFileLink[] = [];

  const addLink = (link: TerminalFileLink | null) => {
    if (!link) return;
    const overlaps = links.some((item) => item.startX <= link.endX && item.endX >= link.startX);
    if (!overlaps) {
      links.push(link);
    }
  };

  let match: RegExpExecArray | null;
  while ((match = QUOTED_FILE_LINK_REGEX.exec(lineText)) !== null) {
    const rawPath = match[2];
    if (!rawPath.includes('/') && !rawPath.includes('\\') && !rawPath.includes('.') && !EXTENSIONLESS_FILE_REGEX.test(rawPath)) {
      continue;
    }
    const fullMatched = match[0];
    const quote = match[1];
    const afterQuote = fullMatched.slice(fullMatched.lastIndexOf(quote) + 1);
    const textToParse = rawPath + afterQuote;
    const startX = match.index + 2;
    addLink(createLink(textToParse, startX));
  }

  while ((match = FILE_LINK_REGEX.exec(lineText)) !== null) {
    const text = match[1];
    if (!text) continue;
    const startX = match.index + match[0].indexOf(text) + 1;
    addLink(createLink(text, startX));
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

  for (const pattern of COORD_PATTERNS) {
    const match = cleanText.match(pattern);
    if (match) {
      filePath = cleanText.slice(0, match.index);
      line = Number(match[1]);
      if (match[2]) col = Number(match[2]);
      break;
    }
  }

  if (!filePath || INVALID_FILE_PATHS.has(filePath)) {
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

