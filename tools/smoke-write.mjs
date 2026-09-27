// Smoke test: write a minimal document into the vidifund workspace and read
// it back, proving the write path before importing real content.
import { randomUUID } from 'node:crypto';
import { buildDocument, writeCollab, getDoc, Y } from './af-core.mjs';

const WS = '2039dd7d-ed26-4d21-94ac-07c01c6aeec3';
const viewId = randomUUID();

const blocks = [
  { ty: 'heading', data: { level: 1 }, textId: 'txt-title' },
  { ty: 'paragraph', data: {}, textId: 'txt-body' },
  { ty: 'divider', data: {} },
];

const { doc } = buildDocument(blocks, viewId);
const bytes = Y.encodeStateAsUpdate(doc);
console.log(`built document: ${blocks.length} blocks, update=${bytes.length} bytes`);
console.log(`viewId=${viewId}`);

console.log('writing...');
await writeCollab(WS, viewId, doc, 0);
console.log('write OK');

console.log('reading back...');
const back = await getDoc(WS, viewId);
const document = back.getMap('data').get('document');
const blocksMap = document?.get('blocks');
console.log(`read back: blocks=${blocksMap ? blocksMap.size : 0}`);

if (blocksMap) {
  for (const [id, b] of blocksMap.entries()) {
    const f = [...b.entries()].filter(([, v]) => !(v instanceof Y.AbstractType));
    console.log(`  ${id} :: ${f.map(([k, v]) => `${k}=${JSON.stringify(v)}`).join(' | ')}`);
  }
}
