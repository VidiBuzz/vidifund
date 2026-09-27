// Smoke test 2: write an external text collab and read it back.
//
// Text collabs are stored under data.text as a map of delta -> string.
// object ids are 10-char block-style ids, not UUIDs, so they go through the
// collab_list batch endpoint rather than the v1 single-collab route.
import { newBlockId } from './af-core.mjs';
import { api, Y } from './af-core.mjs';

const WS = '2039dd7d-ed26-4d21-94ac-07c01c6aeec3';
const textId = newBlockId();
console.log(`textId=${textId}`);

const doc = new Y.Doc();
const data = doc.getMap('data');
const text = new Y.Map();
data.set('text', text);
text.set('delta', 'Hello from FortunaTrade.');

console.log('update bytes:', Y.encodeStateAsUpdate(doc).length);

// Try the v1 web-update route first (may reject a non-UUID object id).
try {
  await api(`/api/workspace/v1/${WS}/collab/${textId}/web-update`, {
    method: 'POST',
    body: JSON.stringify({
      collab_type: 1,
      doc_state: Array.from(Y.encodeStateAsUpdate(doc)),
      state_vector: Array.from(Y.encodeStateVector(doc)),
    }),
  });
  console.log('write via v1 web-update: OK');
} catch (e) {
  console.log('v1 web-update failed:', e.message.slice(0, 200));
  console.log('trying batch route...');
  try {
    await api(`/api/workspace/v1/${WS}/collab/web-update`, {
      method: 'POST',
      body: JSON.stringify([{
        object_id: textId,
        collab_type: 1,
        doc_state: Array.from(Y.encodeStateAsUpdate(doc)),
        state_vector: Array.from(Y.encodeStateVector(doc)),
      }]),
    });
    console.log('write via batch: OK');
  } catch (e2) {
    console.log('batch failed:', e2.message.slice(0, 300));
  }
}
