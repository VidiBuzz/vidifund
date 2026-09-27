// Decode the external "text" collab for a block to learn how text is stored.
// Text collabs use non-UUID object ids, so go through collab_list.
// Usage: node probe-text.mjs <workspace_id> <text_collab_id>
import { readFileSync } from 'node:fs';
import * as Y from 'yjs';

const [ws, textId] = process.argv.slice(2);
const base = 'http://127.0.0.1:4000';
const tok = readFileSync('./.appflowy_token', 'utf8').trim();

const res = await fetch(`${base}/api/workspace/${ws}/collab_list`, {
  method: 'POST',
  headers: { Authorization: `Bearer ${tok}`, 'Content-Type': 'application/json' },
  body: JSON.stringify([{ object_id: textId, collab_type: 1 }]),
});
const json = await res.json();
const entry = json.data?.[textId];
console.log('entry keys:', JSON.stringify(Object.keys(entry || {})));
const enc = entry?.Success?.encode_collab_v1;
if (!enc) { console.log('no collab returned'); process.exit(1); }

const bytes = Uint8Array.from(Buffer.from(enc, 'base64'));
console.log(`encoded_collab_v1 = ${bytes.length} bytes`);

// This payload is the yrs update, possibly with a small frame header.
// Try a few offsets to find the one Yjs accepts.
for (const off of [0, 4, 8]) {
  const doc = new Y.Doc();
  try {
    Y.applyUpdate(doc, bytes.subarray(off));
    const data = doc.getMap('data');
    console.log(`\noffset ${off}: OK  dataKeys=${JSON.stringify([...data.keys()])}`);
    const text = data.get('text');
    if (text instanceof Y.Map) {
      console.log('text map keys:', JSON.stringify([...text.keys()]));
      for (const [k, v] of text.entries()) {
        const j = v instanceof Y.AbstractType ? v.toJSON() : v;
        console.log(`  ${k} (${v.constructor.name}) = ${JSON.stringify(j).slice(0, 400)}`);
      }
    } else if (text) {
      console.log('text node:', text.constructor.name, JSON.stringify(text.toJSON()).slice(0, 400));
    }
    break;
  } catch (e) {
    console.log(`offset ${off}: ${e.message.slice(0, 60)}`);
  }
}

