// Physical line offsets keep ignored lines and untouched text outside a hunk.
export function physicalLines(text) {
  const lines = [], breaks = /\r\n|\r|\n/g;
  let start = 0, match;
  while ((match = breaks.exec(text))) {
    lines.push({ start, end: match.index + match[0].length, text: text.slice(start, match.index), no: lines.length + 1 });
    start = match.index + match[0].length;
  }
  if (start < text.length) lines.push({ start, end: text.length, text: text.slice(start), no: lines.length + 1 });
  return lines;
}

export function lineSpan(text, numbers, beforeLine) {
  const lines = physicalLines(text);
  if (!Array.isArray(numbers) || numbers.some((number, i) => !Number.isInteger(number) || number < 1 || (i > 0 && number <= numbers[i - 1]))) throw new Error('差异位置已变化，请重新对比。');
  if (!numbers.length) {
    const offset = beforeLine == null ? text.length : lines[beforeLine - 1]?.start;
    if (!Number.isInteger(offset)) throw new Error('差异位置已变化，请重新对比。');
    return { start: offset, end: offset, text: '' };
  }
  const first = lines[numbers[0] - 1], last = lines[numbers[numbers.length - 1] - 1];
  if (!first || !last || first.start > last.end) throw new Error('差异位置已变化，请重新对比。');
  return { start: first.start, end: last.end, text: text.slice(first.start, last.end) };
}

export function planLineMerge(target, source, targetLines, sourceLines, targetBefore, sourceBefore) {
  if (!targetLines.length && !sourceLines.length) throw new Error('没有可合并的差异内容。');
  const range = lineSpan(target, targetLines, targetBefore), donor = lineSpan(source, sourceLines, sourceBefore);
  const eol = target.match(/\r\n|\r|\n/)?.[0] || source.match(/\r\n|\r|\n/)?.[0] || '\n';
  let start = range.start, insert = donor.text.replace(/\r\n|\r|\n/g, eol);
  if (insert && start === target.length && start > 0 && !/[\r\n]$/.test(target)) insert = eol + insert;
  // Deleting an unterminated last line also removes its preceding separator.
  if (!insert && range.end === target.length && start > 0 && !/[\r\n]$/.test(source)) {
    const ending = target.slice(0, start).match(/(?:\r\n|\r|\n)$/);
    if (ending) start -= ending[0].length;
  }
  return { start, end: range.end, insert, removed: target.slice(start, range.end) };
}
