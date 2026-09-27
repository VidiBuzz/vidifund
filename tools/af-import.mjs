// Import FortunaTrade markdown documents into the AppFlowy Cloud workspace.
//
// Usage:
//   node af-import.mjs                      import the default manifest
//   node af-import.mjs --dry-run            parse + convert, write nothing
//   node af-import.mjs --only business      import one file by key
//
// Env:
//   AF_WS      workspace id (default: the vidifund workspace)
//   AF_BASE    base url      (default: http://127.0.0.1:4000)
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, basename } from 'node:path';
import { randomUUID } from 'node:crypto';
import { buildDocument, writeCollab, getDoc, api, Y } from './af-core.mjs';
import { markdownToBlocks } from './af-markdown.mjs';

const WS = process.env.AF_WS || '2039dd7d-ed26-4d21-94ac-07c01c6aeec3';
const REPO = 'M:\\code\\vidifund';
const DRY = process.argv.includes('--dry-run');
const onlyIdx = process.argv.indexOf('--only');
const ONLY = onlyIdx > -1 ? process.argv[onlyIdx + 1] : null;

// name -> source path. Order becomes document order in the folder page.
const MANIFEST = [
  { key: 'business', title: 'FortunaTrade Business Plan & Go-Live Runbook', path: 'BUSINESS_PLAN.md' },
  { key: 'features', title: 'Feature Inventory', path: 'docs/FEATURE-INVENTORY.md' },
  { key: 'library', title: 'Library Research', path: 'docs/LIBRARY-RESEARCH.md' },
  { key: 'agents', title: 'Agent Workstream Briefs', path: 'docs/AGENTS.md' },
];

const FOLDER_VIEW_ID = process.env.AF_FOLDER || 'ab245d50-211b-49be-a5db-69dfbb0d4cc8'; // "General"

async function main() {
  const items = ONLY ? MANIFEST.filter((m) => m.key === ONLY) : MANIFEST;
  if (!items.length) {
    console.error(`no manifest entry for --only ${ONLY}`);
    process.exit(1);
  }

  console.log(`workspace: ${WS}`);
  console.log(`folder view: ${FOLDER_VIEW_ID}`);
  console.log(`mode: ${DRY ? 'DRY RUN (no writes)' : 'LIVE WRITE'}`);
  console.log(`documents: ${items.length}\n`);

  for (const item of items) {
    const src = join(REPO, item.path);
    let md;
    try {
      md = readFileSync(src, 'utf8');
    } catch {
      console.error(`  SKIP ${item.path} (not found)`);
      continue;
    }

    const blocks = markdownToBlocks(md);
    const byType = {};
    for (const b of blocks) byType[b.ty] = (byType[b.ty] || 0) + 1;

    console.log(`--- ${item.title}`);
    console.log(`    source : ${item.path} (${md.length} chars)`);
    console.log(`    blocks : ${blocks.length} -> ${JSON.stringify(byType)}`);

    if (DRY) { console.log(); continue; }

    const viewId = randomUUID();
    const { doc } = buildDocument(blocks, viewId);
    const bytes = Y.encodeStateAsUpdate(doc);
    console.log(`    doc    : ${viewId} (${bytes.length} bytes)`);

    await writeCollab(WS, viewId, doc, 0);
    console.log(`    write  : OK`);

    // Verify by reading it back.
    const back = await getDoc(WS, viewId);
    const d = back.getMap('data').get('document');
    const bm = d?.get('blocks');
    const tm = d?.get('meta')?.get('text_map');
    console.log(`    verify : ${bm?.size ?? 0} blocks, ${tm?.size ?? 0} text nodes`);
    console.log();
  }

  if (!DRY) {
    console.log('All documents written.');
    console.log('Next: register them in the folder view (parent_view_id) so they');
    console.log('appear in the AppFlowy sidebar under "General".');
  }
}

main().catch((e) => { console.error('FAILED:', e.message); process.exit(1); });
