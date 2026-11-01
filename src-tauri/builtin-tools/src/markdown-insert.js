export function headingEdit(text, start, end, level) {
  if (!Number.isInteger(level) || level < 0 || level > 6) throw new Error('标题级别无效。');
  if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || end < start || end > text.length) throw new Error('选区已变化。');
  const from = start === 0 ? 0 : text.lastIndexOf('\n', start - 1) + 1;
  const effectiveEnd = end > start && text[end - 1] === '\n' ? end - 1 : end;
  const next = text.indexOf('\n', effectiveEnd), to = next < 0 ? text.length : next;
  const lines = text.slice(from, to).split('\n'), multiple = lines.length > 1;
  const transformed = lines.map(line => {
    if (multiple && !line.trim()) return { text: line, oldPrefix: 0, newPrefix: 0 };
    const match = /^([ \t]*)(#{1,6})[ \t]+([\s\S]*)$/.exec(line);
    const body = match ? match[3] : line.replace(/^[ \t]*/, '');
    if (!level && !match) return { text: line, oldPrefix: 0, newPrefix: 0 };
    const prefix = level ? '#'.repeat(level) + ' ' : match[1];
    return { text: prefix + body, oldPrefix: line.length - body.length, newPrefix: prefix.length };
  });
  const insert = transformed.map(line => line.text).join('\n');
  const position = value => {
    if (value > to) return value + insert.length - (to - from);
    let oldOffset = from, newOffset = from;
    for (let i = 0; i < lines.length; i++) {
      if (value <= oldOffset + lines[i].length) return newOffset + Math.min(transformed[i].text.length, transformed[i].newPrefix + Math.max(0, value - oldOffset - transformed[i].oldPrefix));
      oldOffset += lines[i].length + 1; newOffset += transformed[i].text.length + 1;
    }
    return newOffset;
  };
  return { start: from, end: to, insert, selectionStart: position(start), selectionEnd: position(end) };
}

export function tableMarkdown(rows, columns) {
  if (!Number.isInteger(rows) || rows < 1 || rows > 100) throw new Error('内容行数需为 1～100 的整数。');
  if (!Number.isInteger(columns) || columns < 1 || columns > 20) throw new Error('列数需为 1～20 的整数。');
  const header = '| ' + Array.from({ length: columns }, (_, i) => '列 ' + (i + 1)).join(' | ') + ' |';
  const rule = '| ' + Array(columns).fill('---').join(' | ') + ' |';
  const row = '| ' + Array(columns).fill('').join(' | ') + ' |';
  return [header, rule, ...Array(rows).fill(row)].join('\n') + '\n';
}
