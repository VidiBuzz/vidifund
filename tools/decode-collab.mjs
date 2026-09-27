// Decode an AppFlowy collab blob from Postgres.
//
// Blob layout (verified against live data):
//   [u32 LE header_len][header_len bytes of header][zstd-compressed yrs update]
// The header is JSON describing the collab; the body is a zstd frame holding a
// Yjs/yrs CRDT update.
//
// Usage: node decode-collab.mjs <collab_oid>
import { execFileSync } from 'node:child_process';
import * as Y from 'yjs';
import { decompress } from 'fzstd';

const DOCKER = 'C:\\Program Files\\Docker\\Docker\\resources\\bin\\docker.exe';
const oid = process.argv[2];

const hex = execFileSync(DOCKER, [
  'exec', 'appflowy-cloud-postgres-1', 'psql', '-U', 'postgres',
  '-d', 'postgres', '-t', '-A', '-c',
  `select encode(blob,'hex') from af_collab where oid='${oid}';`,
], { encoding: 'utf8', maxBuffer: 128 * 1024 * 1024 }).trim();

if (!hex) { console.error('no blob for', oid); process.exit(1); }
const raw = Buffer.from(hex, 'hex');
console.log(`blob=${raw.length} bytes`);

const headerLen = raw.readUInt32LE(0);
console.log(`header_len=${headerLen}`);
const headerBytes = raw.subarray(4, 4 + headerLen);
const body = raw.subarray(4 + headerLen);
console.log(`header: ${headerBytes.toString('utf8').slice(0, 300)}`);
console.log(`body=${body.length}  magic=${body.subarray(0, 4).toString('hex')}`);

const update = Buffer.from(decompress(new Uint8Array(body)));
console.log(`decompressed update=${update.length}  head=${update.subarray(0, 12).toString('hex')}`);

const doc = new Y.Doc();
Y.applyUpdate(doc, new Uint8Array(update));
console.log('shared types:', JSON.stringify([...doc.share.keys()]));

const data = doc.getMap('data');
console.log('data keys:', JSON.stringify([...data.keys()]));

const document = data.get('document');
if (document) {
  const blocks = document.get('blocks');
  console.log(`\nblocks=${blocks ? blocks.size : 0}`);
  let i = 0;
  for (const [id, b] of blocks?.entries() || []) {
    if (i++ > 8) break;
    const fields = b instanceof Y.Map
      ? [...b.entries()].filter(([, v]) => !(v instanceof Y.AbstractType))
          .map(([k, v]) => `${k}=${JSON.stringify(String(v)).slice(0, 70)}`)
      : [];
    console.log(`  ${id} :: ${fields.join(' | ')}`);
  }
}



