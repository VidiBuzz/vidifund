# FortunaTrade tooling

## AppFlowy Cloud import (`af-*.mjs`)

Imports FortunaTrade Markdown documents into the self-hosted AppFlowy Cloud
instance at `http://127.0.0.1:4000`.

```bash
cd tools
npm install                       # yjs
node af-import.mjs --dry-run      # parse + convert, write nothing
node af-import.mjs                # import the manifest
node af-verify.mjs                # read back and render as text
```

### Files

| File | Purpose |
|---|---|
| `af-core.mjs` | REST client, `buildDocument()`, `writeCollab()`, `getDoc()` |
| `af-markdown.mjs` | Markdown → AppFlowy block descriptors |
| `af-import.mjs` | Reads the manifest and imports each document |
| `af-verify.mjs` | Reads documents back and renders them as text |
| `appflowy_auth.py` | Mints an admin JWT and resets an account password |
| `probe-*.mjs`, `smoke-*.mjs` | Schema discovery scripts (kept for reference) |

### Credentials

`tools/.appflowy_token` holds a GoTrue access token (gitignored).
Regenerate with:

```bash
curl -X POST 'http://127.0.0.1:4000/gotrue/token?grant_type=password' \
  -H 'Content-Type: application/json' \
  -d '{"email":"vidifund@gmail.com","password":"<password>"}'
```

## Document schema (reverse-engineered, verified against live data)

AppFlowy stores each document as a Yjs/yrs CRDT. The REST API exposes it at:

```
GET  /api/workspace/v1/{workspace_id}/collab/{view_id}?collab_type=0
POST /api/workspace/v1/{workspace_id}/collab/{view_id}/web-update
```

Both take/return plain JSON: `{ doc_state: [...], state_vector: [...] }`.

```
data.document.blocks[blockId] = {
  id, ty, parent, children, data, external_id, external_type
}
data.document.meta.text_map[external_id]   = Y.Text   (the block's text)
data.document.meta.children_map[blockId]   = Y.Array  (child ids)
data.document.page_id
```

- `children` is a **space-delimited** string of child block ids.
- `data` is a JSON **string**, e.g. `{"level":2}` for an H2.
- Text-bearing blocks set `external_type: "text"` and point `external_id` at
  an entry in `meta.text_map`. Blocks like `divider` have both set to `null`.
- Block ids are 10-character alphanumeric strings, not UUIDs.
- `view_id` (the route parameter) **is** a UUID and is generated per document.

### Block types used by the importer

| Markdown | `ty` | `data` |
|---|---|---|
| `#`…`######` | `heading` | `{"level":1..6}` |
| paragraph | `paragraph` | `{}` |
| `- item` | `bulleted_list` | `{"order":1.0}` |
| `1. item` | `numbered_list` | `{"order":1.0}` |
| `- [x]` | `todo_list` | `{"checked":bool}` |
| `> quote` | `quote` | `{}` |
| ` ``` ` | `code` | `{"language":"js"}` |
| `---` | `divider` | `{}` |
| `> [!NOTE]` | `callout` | `{"icon":"💡","bgColor":"0x0"}` |

Pipe tables are emitted as a `code` block with `language: "markdown"`, which
renders faithfully and stays editable.

### Storage note

Documents are persisted to **MinIO/S3**, not Postgres `af_collab`. Postgres
only holds small collabs (folders, small views). A new document may therefore
be readable through the API before it appears in `af_collab` — that is expected,
not a failed write. Always verify with `af-verify.mjs`.
