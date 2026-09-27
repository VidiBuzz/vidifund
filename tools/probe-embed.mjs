// Read meta.text_map from a real document to learn the inline text schema.
import { getDoc, Y } from './af-core.mjs';

const WS = 'd2ba6e62-8ebe-4289-b0dc-07ea5856651a';
const VIEW = process.argv[2] || '1c5caa6e-44cf-4feb-8ac1-1b738d0362fd';

const doc = await getDoc(WS, VIEW);
const document = doc.getMap('data').get('document');
const meta = document.get('meta');

const textMap = meta.get('text_map');
console.log(`meta.text_map: ${textMap?.constructor.name}`);
if (textMap instanceof Y.Map) {
  console.log('entries:', textMap.size);
  let i = 0;
  for (const [k, v] of textMap.entries()) {
    if (i++ > 6) break;
    const j = v instanceof Y.AbstractType ? v.toJSON() : v;
    console.log(`  ${k} [${v.constructor.name}] = ${JSON.stringify(j).slice(0, 300)}`);
  }
}

const childrenMap = meta.get('children_map');
console.log(`\nmeta.children_map: ${childrenMap?.constructor.name} size=${childrenMap?.size}`);
if (childrenMap instanceof Y.Map) {
  let i = 0;
  for (const [k, v] of childrenMap.entries()) {
    if (i++ > 3) break;
    const j = v instanceof Y.AbstractType ? v.toJSON() : v;
    console.log(`  ${k} = ${JSON.stringify(j).slice(0, 200)}`);
  }
}
