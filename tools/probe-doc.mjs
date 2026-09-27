// Decode a real AppFlowy document via the v1 collab endpoint to learn the
// exact Yjs schema needed to author new documents.
//
// Usage: node probe-doc.mjs <workspace_id> <view_id>
import { readFileSync } from 'node:fs';
import * as Y from 'yjs';

const [ws, viewId] = process.argv.slice(2);
const base = 'http://127.0.0.1:4000';
const tok = readFileSync('./.appflowy_token', 'utf8').trim();

const res = await fetch(
  `${base}/api/workspace/v1/${ws}/collab/${viewId}?collab_type=0`,
  { headers: { Authorization: `Bearer ${tok}` } },
);
const json = await res.json();
const docState = Uint8Array.from(json.data.doc_state);
console.log(`doc_state = ${docState.length} bytes`);
console.log(`head: ${Buffer.from(docState.subarray(0, 16)).toString('hex')}`);

const doc = new Y.Doc();
Y.applyUpdate(doc, docState);
console.log('shared types:', JSON.stringify([...doc.share.keys()]));

const data = doc.getMap('data');
console.log('data keys:', JSON.stringify([...data.keys()]));

const document = data.get('document');
if (!document) { console.log('no document node'); process.exit(0); }

const blocks = document.get('blocks');
console.log(`\nblocks = ${blocks ? blocks.size : 0}`);
console.log('document node keys:', JSON.stringify([...document.keys()]));

let i = 0;
for (const [id, b] of blocks?.entries() || []) {
  if (i++ > 12) { console.log('  ...'); break; }
  const fields = b instanceof Y.Map
    ? [...b.entries()]
        .filter(([, v]) => !(v instanceof Y.AbstractType))
        .map(([k, v]) => `${k}=${JSON.stringify(v)?.slice(0, 90)}`)
    : ['<not a map>'];
  console.log(`  ${id.slice(0, 14)} :: ${fields.join(' | ')}`);
}
