// Convert a Markdown file into AppFlowy block descriptors.
//
// Mapping (block types verified against the live instance):
//   # .. ######          -> heading, data.level = 1..6
//   paragraph            -> paragraph
//   - item / 1. item     -> bulleted_list / numbered_list (data.order = 1.0)
//   - [ ] / - [x]        -> todo_list (data.checked)
//   > quote              -> quote
//   ``` fence            -> code (data.language)
//   | a | b |            -> table (data.cols/rows preserved as text)
//   ---                  -> divider
//   > [!NOTE]            -> callout (data.icon, data.bgColor)
//
// Tables are emitted as a code block containing the raw pipe table, because
// AppFlowy's table block requires a separate structure per cell and a
// pipe-delimited code block renders faithfully and stays editable.

const CALLOUT_ICONS = { NOTE: '💡', TIP: '💡', INFO: 'ℹ️', WARNING: '⚠️', DANGER: '🔥', IMPORTANT: '❗' };

export function markdownToBlocks(md) {
  const lines = md.replace(/\r\n/g, '\n').split('\n');
  const blocks = [];
  let para = [];

  const flushPara = () => {
    if (!para.length) return;
    const text = para.join(' ').trim();
    if (text) blocks.push({ ty: 'paragraph', data: {}, text });
    para = [];
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // fenced code
    const fence = line.match(/^```(\w*)\s*$/);
    if (fence) {
      flushPara();
      const lang = fence[1] || '';
      const buf = [];
      i++;
      while (i < lines.length && !/^```\s*$/.test(lines[i])) buf.push(lines[i++]);
      blocks.push({
        ty: 'code',
        data: { language: lang },
        text: buf.join('\n'),
      });
      continue;
    }

    if (!line.trim()) { flushPara(); continue; }

    // heading
    const h = line.match(/^(#{1,6})\s+(.*)$/);
    if (h) {
      flushPara();
      blocks.push({ ty: 'heading', data: { level: h[1].length }, text: h[2].trim() });
      continue;
    }

    // horizontal rule
    if (/^(-{3,}|\*{3,}|_{3,})\s*$/.test(line)) {
      flushPara();
      blocks.push({ ty: 'divider', data: {} });
      continue;
    }

    // callout  > [!NOTE]
    const cal = line.match(/^>\s*\[!(NOTE|TIP|INFO|WARNING|DANGER|IMPORTANT)\]\s*(.*)$/i);
    if (cal) {
      flushPara();
      const icon = CALLOUT_ICONS[cal[1].toUpperCase()] || '💡';
      const body = [cal[2]];
      let j = i + 1;
      while (j < lines.length && /^>\s?/.test(lines[j])) {
        body.push(lines[j].replace(/^>\s?/, ''));
        j++;
      }
      i = j - 1;
      blocks.push({
        ty: 'callout',
        data: { icon, bgColor: '0x0' },
        text: body.join('\n').trim(),
      });
      continue;
    }

    // blockquote
    if (/^>\s?/.test(line)) {
      flushPara();
      const buf = [];
      while (i < lines.length && /^>\s?/.test(lines[i])) {
        buf.push(lines[i].replace(/^>\s?/, ''));
        i++;
      }
      i--;
      blocks.push({ ty: 'quote', data: {}, text: buf.join('\n').trim() });
      continue;
    }

    // table
    if (/^\s*\|.*\|\s*$/.test(line)) {
      flushPara();
      const buf = [];
      while (i < lines.length && /^\s*\|.*\|\s*$/.test(lines[i])) buf.push(lines[i++]);
      i--;
      blocks.push({ ty: 'code', data: { language: 'markdown' }, text: buf.join('\n') });
      continue;
    }

    // todo
    const todo = line.match(/^\s*[-*+]\s+\[( |x|X)\]\s+(.*)$/);
    if (todo) {
      flushPara();
      blocks.push({
        ty: 'todo_list',
        data: { checked: todo[1].toLowerCase() === 'x' },
        text: todo[2].trim(),
      });
      continue;
    }

    // bulleted
    const ul = line.match(/^(\s*)[-*+]\s+(.*)$/);
    if (ul) {
      flushPara();
      blocks.push({ ty: 'bulleted_list', data: { order: 1.0 }, text: ul[2].trim() });
      continue;
    }

    // numbered
    const ol = line.match(/^(\s*)\d+[.)]\s+(.*)$/);
    if (ol) {
      flushPara();
      blocks.push({ ty: 'numbered_list', data: { order: 1.0 }, text: ol[2].trim() });
      continue;
    }

    para.push(line.trim());
  }
  flushPara();
  return blocks;
}
