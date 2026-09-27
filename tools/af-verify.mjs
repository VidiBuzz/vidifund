// Verify imported documents by reading them back through the API and
// reconstructing plain text, so we can confirm content survived the round trip.
import { readFileSync } from 'node:fs';
import { getDoc, Y } from './af-core.mjs';

const WS = process.env.AF_WS || '2039dd7d-ed26-4d21-94ac-07c01c6aeec3';

const DOCS = [
  ['FortunaTrade Business Plan', 'a11403c3-d79c-4e08-87f3-df74d9f4a374'],
  ['Feature Inventory', '20dfb413-4bc1-4725-b85d-c0ae88cd3c89'],
  ['Library Research', 'd22b0880-35fe-42fe-aeeb-b704675f5f06'],
  ['Agent Workstream Briefs', '2195d796-a81e-4ca4-a4e8-6f9c5f848722'],
];

for (const [label, viewId] of DOCS) {
  console.log(`\n=== ${label} (${viewId}) ===`);
  try {
    const doc = await getDoc(WS, viewId);
    const document = doc.getMap('data').get('document');
    const blocks = document.get('blocks');
    const meta = document.get('meta');
    const textMap = meta.get('text_map');

    // Walk the tree from the page root.
    const root = [...blocks.values()].find((b) => b.get('ty') === 'page');
    const lines = [];

    const walk = (block, depth) => {
      const ty = block.get('ty');
      const data = JSON.parse(block.get('data') || '{}');
      const ext = block.get('external_id');
      const text = ext ? textMap.get(ext)?.toString() ?? '' : '';

      if (ty !== 'page') {
        const indent = '  '.repeat(Math.max(0, depth - 1));
        if (ty === 'divider') lines.push(`${indent}---`);
        else if (ty === 'heading') lines.push(`${indent}${'#'.repeat(data.level || 1)} ${text}`);
        else if (ty === 'bulleted_list') lines.push(`${indent}- ${text}`);
        else if (ty === 'numbered_list') lines.push(`${indent}1. ${text}`);
        else if (ty === 'todo_list') lines.push(`${indent}- [${data.checked ? 'x' : ' '}] ${text}`);
        else if (ty === 'code') lines.push(`${indent}\`\`\`${data.language || ''}\n${text}\n${indent}\`\`\``);
        else if (ty === 'callout' || ty === 'quote') lines.push(`${indent}> ${text}`);
        else lines.push(`${indent}${text}`);
      }

      const kids = (block.get('children') || '').split(' ').filter(Boolean);
      for (const k of kids) {
        const child = blocks.get(k);
        if (child) walk(child, depth + 1);
      }
    };
    walk(root, 0);

    console.log(`blocks=${blocks.size} textNodes=${textMap.size} renderedLines=${lines.length}`);
    console.log(`total characters: ${lines.join('\n').length}`);
    console.log('--- first 22 lines ---');
    console.log(lines.slice(0, 22).join('\n'));
  } catch (e) {
    console.log(`FAILED: ${e.message.slice(0, 200)}`);
  }
}
