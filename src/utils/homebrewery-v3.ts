import { toStandard2eProse } from '@utils/foundry-text';

export const HOMEBREWERY_V3_URL = 'https://homebrewery.naturalcrit.com/';

export function sourceHasHomebreweryTable(source: string): boolean {
  if (!source) return false;
  if (/<table\b/i.test(source)) return true;
  const pipeRows = source.split(/\r?\n/).filter((line) => isPipeRow(line.trim()));
  return pipeRows.length >= 2;
}

export function toHomebreweryV3(source: string): string {
  if (!source?.trim()) return '';
  let text = toStandard2eProse(source);
  text = text.replace(/(\w)—(\w)/g, '$1 — $2');
  text = convertHtmlTables(text);
  text = convertRemainingHtml(text);
  text = isolatePipeTables(text);
  text = wrapWidePipeTables(text);
  text = attachPreambleToWideTables(text);
  return text.replace(/\n{3,}/g, '\n\n').trim() + '\n';
}

export async function copyMarkdownAndOpenHomebreweryV3(markdown: string): Promise<void> {
  const trimmed = markdown.trim();
  if (!trimmed) throw new Error('Nothing to copy for Homebrewery.');
  await navigator.clipboard.writeText(trimmed);
  window.open(HOMEBREWERY_V3_URL, '_blank', 'noopener,noreferrer');
}

type Align = 'left' | 'center' | 'right';

type Cell = {
  text: string;
  colspan: number;
  rowspan: number;
  align: Align;
  continuation?: boolean;
};

function convertHtmlTables(text: string): string {
  return text.replace(/<table\b[\s\S]*?<\/table>/gi, (html) => htmlTableToHomebrewery(html));
}

function htmlTableToHomebrewery(html: string): string {
  const classAttr = html.match(/^<table\b[^>]*\bclass=["']([^"']*)["']/i)?.[1] ?? '';
  const parsed = parseHtmlTable(html);
  if (!parsed) return '';
  const md = parsed.lines.join('\n');
  if (/\bwide\b/i.test(classAttr) && parsed.columnCount < 4) return `\n{{wide\n${md}\n}}\n`;
  return `\n${md}\n`;
}

function parseHtmlTable(html: string): { lines: string[]; columnCount: number } | null {
  const rowHtml = [...html.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)].map((m) => m[1]);
  if (rowHtml.length === 0) return null;

  const rawRows: Cell[][] = rowHtml.map((row) =>
    [...row.matchAll(/<(t[hd])\b([^>]*)>([\s\S]*?)<\/t[hd]>/gi)].map((m) => {
      const attrs = m[2];
      return {
        text: cellHtmlToMarkdown(m[3]),
        colspan: intAttr(attrs, 'colspan') || 1,
        rowspan: intAttr(attrs, 'rowspan') || 1,
        align: alignFromAttrs(attrs),
      };
    })
  );

  const columnCount = Math.max(
    0,
    ...rawRows.map((row) => row.reduce((sum, cell) => sum + cell.colspan, 0))
  );
  if (columnCount === 0) return null;

  type Slot = Cell | 'skip' | null;
  const occupancy: Slot[][] = rawRows.map(() => Array(columnCount).fill(null));

  const ensureRow = (r: number) => {
    while (occupancy.length <= r) occupancy.push(Array(columnCount).fill(null));
  };

  for (let r = 0; r < rawRows.length; r++) {
    ensureRow(r);
    let c = 0;
    for (const cell of rawRows[r]) {
      while (c < columnCount && occupancy[r][c] != null) c++;
      for (let rr = 0; rr < cell.rowspan; rr++) {
        ensureRow(r + rr);
        for (let cc = 0; cc < cell.colspan; cc++) {
          if (rr === 0 && cc === 0) occupancy[r + rr][c + cc] = cell;
          else if (cc === 0) occupancy[r + rr][c + cc] = { ...cell, text: '', continuation: true, rowspan: 1, colspan: 1 };
          else occupancy[r + rr][c + cc] = 'skip';
        }
      }
      c += cell.colspan;
    }
  }

  const rows = occupancy.filter((row) => row.some((slot) => slot && slot !== 'skip'));
  const headerAligns: Align[] = Array(columnCount).fill('left');
  const headerRow = rows[0];
  if (headerRow) {
    let col = 0;
    for (const slot of headerRow) {
      if (!slot || slot === 'skip' || slot.continuation) {
        col++;
        continue;
      }
      for (let i = 0; i < slot.colspan; i++) headerAligns[col + i] = slot.align;
      col += slot.colspan;
    }
  }

  const lines: string[] = [];
  for (let r = 0; r < rows.length; r++) {
    lines.push(emitRow(rows[r]));
    if (r === 0) lines.push(emitDivider(headerAligns));
  }
  return { lines, columnCount };
}

function emitRow(row: (Cell | 'skip' | null)[]): string {
  let line = '|';
  for (let c = 0; c < row.length; ) {
    const slot = row[c];
    if (slot === 'skip') {
      c++;
      continue;
    }
    if (!slot) {
      line += ' |';
      c++;
      continue;
    }
    if (slot.continuation) {
      line += ` ${slot.text} ^|`;
    } else {
      line += ` ${slot.text} |`;
    }
    if (slot.colspan > 1 && !slot.continuation) line += '|'.repeat(slot.colspan - 1);
    c += Math.max(1, slot.colspan);
  }
  return line;
}

function emitDivider(aligns: Align[]): string {
  return `| ${aligns.map(alignToken).join(' | ')} |`;
}

function alignToken(align: Align): string {
  if (align === 'center') return ':---:';
  if (align === 'right') return '---:';
  return '---';
}

function intAttr(attrs: string, name: string): number {
  const m = attrs.match(new RegExp(`\\b${name}\\s*=\\s*["']?(\\d+)`, 'i'));
  return m ? Number(m[1]) : 0;
}

function alignFromAttrs(attrs: string): Align {
  const align = attrs.match(/\balign\s*=\s*["']?(left|center|right)/i)?.[1]?.toLowerCase();
  const style = attrs.match(/text-align\s*:\s*(left|center|right)/i)?.[1]?.toLowerCase();
  const value = (align || style) as Align | undefined;
  return value === 'center' || value === 'right' ? value : 'left';
}

function cellHtmlToMarkdown(html: string): string {
  let text = html.replace(/<br\s*\/?>/gi, ' ');
  text = text.replace(/<a\s+[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi, (_full, href: string, inner: string) => {
    const label = inner.replace(/<[^>]+>/g, '').trim();
    return label ? `[${label}](${href.trim()})` : inner;
  });
  text = text.replace(/<\/?(strong|b)\b[^>]*>/gi, '**');
  text = text.replace(/<\/?(em|i)\b[^>]*>/gi, '*');
  text = text.replace(/<[^>]+>/g, '');
  text = text
    .replace(/&nbsp;/gi, ' ')
    .replace(/&mdash;|&#8212;/gi, '—')
    .replace(/&ndash;|&#8211;/gi, '–')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\|/g, '\\|');
  return text;
}

function convertRemainingHtml(text: string): string {
  let out = text.replace(/<h([1-6])\b[^>]*>([\s\S]*?)<\/h\1>/gi, (_full, level: string, inner: string) => {
    const heading = cellHtmlToMarkdown(inner);
    return heading ? `\n${'#'.repeat(Number(level))} ${heading}\n` : '';
  });
  out = out.replace(/<\/p>\s*<p\b[^>]*>/gi, '\n\n');
  out = out.replace(/<\/?p\b[^>]*>/gi, '\n');
  out = out.replace(/<br\s*\/?>/gi, '\n');
  out = out.replace(/<a\s+[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi, (_full, href: string, inner: string) => {
    const label = inner.replace(/<[^>]+>/g, '').trim();
    return label ? `[${label}](${href.trim()})` : inner;
  });
  out = out.replace(/<\/?(strong|b)\b[^>]*>/gi, '**');
  out = out.replace(/<\/?(em|i)\b[^>]*>/gi, '*');
  out = out.replace(/<\/?(ul|ol|li|div|span|thead|tbody)\b[^>]*>/gi, '\n');
  out = out.replace(/<[^>]+>/g, '');
  return out;
}

function isPipeRow(line: string): boolean {
  return /^\|.+\|\s*$/.test(line);
}

function isDelimiterRow(line: string): boolean {
  return /^\|[\s\-:|]+\|\s*$/.test(line);
}

function pipeColumnCount(row: string): number {
  return row.split('|').filter((part) => part.trim() !== '').length;
}

function isolatePipeTables(text: string): string {
  const lines = text.split(/\r?\n/);
  const out: string[] = [];
  let rows: string[] = [];

  const flush = () => {
    if (rows.length === 0) return;
    if (rows.length === 1 || !isDelimiterRow(rows[1])) {
      const cells = rows[0].split('|').filter((part) => part.trim() !== '');
      rows = [rows[0], `| ${cells.map(() => '---').join(' | ')} |`, ...rows.slice(1)];
    }
    if (out.length > 0 && out[out.length - 1].trim() !== '') out.push('');
    out.push(...rows, '');
    rows = [];
  };

  for (const raw of lines) {
    const trimmed = raw.trim();
    if (isPipeRow(trimmed)) {
      rows.push(trimmed);
      continue;
    }
    if (rows.length > 0 && trimmed === '') continue;
    flush();
    out.push(raw);
  }
  flush();
  return out.join('\n');
}

function wrapWidePipeTables(text: string): string {
  const blocks = splitMarkdownBlocks(text);
  const out: string[] = [];
  for (const block of blocks) {
    if (/^\{\{wide\b/.test(block)) {
      out.push(block);
      continue;
    }
    const lines = block.split('\n').filter((line) => isPipeRow(line.trim()));
    if (lines.length >= 2 && pipeColumnCount(lines[0]) >= 4) {
      out.push(`{{wide\n${block.trim()}\n}}`);
    } else {
      out.push(block);
    }
  }
  return `${out.join('\n\n')}\n`;
}

function splitMarkdownBlocks(markdown: string): string[] {
  const text = markdown.replace(/\r\n/g, '\n').trim();
  if (!text) return [];
  const blocks: string[] = [];
  let rest = text;
  while (rest.length) {
    if (rest.startsWith('{{')) {
      const close = rest.indexOf('\n}}');
      if (close === -1) {
        blocks.push(rest.trim());
        break;
      }
      blocks.push(rest.slice(0, close + 3).trim());
      rest = rest.slice(close + 3).replace(/^\n+/, '');
      continue;
    }
    const blankAt = rest.indexOf('\n\n');
    if (blankAt === -1) {
      blocks.push(rest.trim());
      break;
    }
    blocks.push(rest.slice(0, blankAt).trim());
    rest = rest.slice(blankAt).replace(/^\n+/, '');
  }
  return blocks.filter(Boolean);
}

function attachPreambleToWideTables(markdown: string): string {
  const blocks = splitMarkdownBlocks(markdown);
  if (blocks.length <= 1) return markdown;

  const out: string[] = [];
  for (const block of blocks) {
    if (!/^\{\{wide\b/.test(block)) {
      out.push(block);
      continue;
    }

    const preamble: string[] = [];
    if (out.length > 0) {
      const last = out[out.length - 1];
      if (
        !/^#{1,6}\s/.test(last) &&
        !last.startsWith('{{') &&
        !last.startsWith('|') &&
        !last.startsWith('\\') &&
        last.length < 900
      ) {
        preamble.unshift(out.pop()!);
      }
    }
    if (out.length > 0 && /^#{1,6}\s/.test(out[out.length - 1])) {
      preamble.unshift(out.pop()!);
    } else if (preamble.length === 1) {
      out.push(preamble.pop()!);
    }

    if (preamble.length === 0) {
      out.push(block);
      continue;
    }

    const inner = block.replace(/^\{\{wide[^\n]*\n/, '').replace(/\n\}\}\s*$/, '').trim();
    out.push(`{{wide\n${[...preamble, inner].join('\n\n')}\n}}`);
  }

  return `${out.join('\n\n')}\n`;
}
