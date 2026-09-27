// AppFlowy Cloud client helpers for reading and writing documents.
//
// Schema (verified against live documents on this instance):
//   data.document.blocks = { <blockId>: { id, ty, parent, children, data,
//                                         external_id, external_type } }
//   data.document.page_id, data.document.meta
// `children` is a space-delimited list of child block ids ("" for a leaf).
// Text-bearing blocks set external_type="text" and external_id=<text collab id>.
//
// Write path: POST /api/workspace/v1/{ws}/collab/{viewId}/web-update
//   body: { collab_type, doc_state, state_vector }  (plain JSON byte arrays)
import { readFileSync } from 'node:fs';
import * as Y from 'yjs';

const BASE = process.env.AF_BASE || 'http://127.0.0.1:4000';
const TOKEN = readFileSync('./.appflowy_token', 'utf8').trim();

export async function api(path, opts = {}) {
  const res = await fetch(`${BASE}${path}`, {
    ...opts,
    headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
  });
  const t = await res.text();
  let j = null;
  try { j = t ? JSON.parse(t) : null; } catch { /* non-JSON */ }
  if (!res.ok) throw new Error(`${opts.method || 'GET'} ${path} -> ${res.status}: ${t.slice(0, 300)}`);
  return j?.data !== undefined ? j.data : j;
}

export async function getFolderTree(ws) {
  return api(`/api/workspace/${ws}/folder`);
}

/** Fetch a document collab and return its decoded Yjs doc. */
export async function getDoc(ws, viewId) {
  const d = await api(`/api/workspace/v1/${ws}/collab/${viewId}?collab_type=0`);
  const doc = new Y.Doc();
  Y.applyUpdate(doc, Uint8Array.from(d.doc_state));
  return doc;
}

const ID_CHARS = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
export function newBlockId() {
  let s = '';
  for (let i = 0; i < 10; i++) s += ID_CHARS[Math.floor(Math.random() * ID_CHARS.length)];
  return s;
}

/** POST a full Yjs doc state as a collab web-update. */
export async function writeCollab(ws, viewId, doc, collabType = 0) {
  const stateVector = Y.encodeStateVector(doc);
  const docState = Y.encodeStateAsUpdate(doc);
  return api(`/api/workspace/v1/${ws}/collab/${viewId}/web-update`, {
    method: 'POST',
    body: JSON.stringify({
      collab_type: collabType,
      doc_state: Array.from(docState),
      state_vector: Array.from(stateVector),
    }),
  });
}

/**
 * Build a Yjs document from AppFlowy block descriptors.
 *
 * Verified schema (from live documents on this instance):
 *   data.document.blocks[id] = { id, ty, parent, children, data, external_id, external_type }
 *   data.document.meta.text_map[external_id]    = Y.Text
 *   data.document.meta.children_map[blockId]    = Array of child ids
 *   data.document.page_id
 *
 * A block descriptor: { ty, data, text, children: [...] }
 * `data` is merged with the block type's defaults.
 */
export function buildDocument(blocks, pageId) {
  const doc = new Y.Doc();
  const data = doc.getMap('data');
  const document = new Y.Map();
  data.set('document', document);
  document.set('page_id', pageId);

  const meta = new Y.Map();
  const textMap = new Y.Map();
  const childrenMap = new Y.Map();
  meta.set('text_map', textMap);
  meta.set('children_map', childrenMap);
  document.set('meta', meta);

  const blocksMap = new Y.Map();
  document.set('blocks', blocksMap);

  const idFor = new Map();

  const assign = (node) => {
    idFor.set(node, newBlockId());
    for (const ch of node.children || []) assign(ch);
  };
  for (const b of blocks) assign(b);

  const write = (node, parentId) => {
    const id = idFor.get(node);
    const childIds = (node.children || []).map((c) => idFor.get(c));

    const m = new Y.Map();
    m.set('id', id);
    m.set('ty', node.ty);
    m.set('parent', parentId);
    m.set('children', childIds.join(' '));
    m.set('data', JSON.stringify(node.data || {}));

    if (node.text !== undefined && node.text !== null) {
      const textId = newBlockId();
      m.set('external_id', textId);
      m.set('external_type', 'text');
      const ytext = new Y.Text();
      ytext.insert(0, node.text);
      textMap.set(textId, ytext);
    } else {
      m.set('external_id', null);
      m.set('external_type', null);
    }

    const yKids = new Y.Array();
    yKids.push(childIds);
    childrenMap.set(id, yKids);

    blocksMap.set(id, m);
    for (const ch of node.children || []) write(ch, id);
  };

  const rootId = newBlockId();
  const root = new Y.Map();
  root.set('id', rootId);
  root.set('ty', 'page');
  root.set('parent', '');
  root.set('children', blocks.map((b) => idFor.get(b)).join(' '));
  root.set('data', '{}');
  root.set('external_id', null);
  root.set('external_type', null);
  blocksMap.set(rootId, root);
  const rootKids = new Y.Array();
  rootKids.push(blocks.map((b) => idFor.get(b)));
  childrenMap.set(rootId, rootKids);

  for (const b of blocks) write(b, rootId);
  return { doc, rootId, idFor };
}


export { BASE, TOKEN, Y };

