export interface TerminalFileLink {
  text: string;
  path: string;
  line?: number;
  col?: number;
  startX: number;
  endX: number;
}

const FILE_LINK_REGEX = /(?:^|[\s"'`(\[])((?:(?:[A-Za-z]:[\\/])|(?:\/)|(?:\.{1,2}[\\/]))?[A-Za-z0-9_.+-]+(?:[\\/][A-Za-z0-9_.+()\-]+)*\.[A-Za-z0-9_+-]+(?::\d+(?::\d+)?)?)(?=$|[\s"'`\)\]}>;,])/g;
const QUOTED_FILE_LINK_REGEX = /(["'`])((?:(?:[A-Za-z]:[\\/])|(?:\/)|(?:\.{1,2}[\\/]))?[^"'`\r\n]+?\.[A-Za-z0-9_+-]+(?::\d+(?::\d+)?)?)\1/g;

/** Finds file paths while preserving nested directories and Windows drive prefixes. */
export function parseTerminalFileLinks(lineText: string): TerminalFileLink[] {
  const links: TerminalFileLink[] = [];
  let match: RegExpExecArray | null;

  while ((match = QUOTED_FILE_LINK_REGEX.exec(lineText)) !== null) {
    const text = match[2];
    const startX = match.index + 2;
    const link = createLink(text, startX);
    if (!links.some((item) => item.startX <= link.endX && item.endX >= link.startX)) {
      links.push(link);
    }
  }

  while ((match = FILE_LINK_REGEX.exec(lineText)) !== null) {
    const link = createLink(match[1], match.index + match[0].length - match[1].length + 1);
    if (!links.some((item) => item.startX <= link.endX && item.endX >= link.startX)) {
      links.push(link);
    }
  }

  return links.sort((left, right) => left.startX - right.startX);
}

function createLink(text: string, startX: number): TerminalFileLink {
  const location = text.match(/:(\d+)(?::(\d+))?$/);
  const line = location ? Number(location[1]) : undefined;
  const col = location?.[2] ? Number(location[2]) : undefined;
  const filePath = location ? text.slice(0, location.index) : text;
  return {
    text,
    path: filePath,
    line,
    col,
    startX,
    endX: startX + text.length - 1
  };
}
