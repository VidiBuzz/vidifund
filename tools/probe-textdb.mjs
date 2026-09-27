// Show the readable structure of a text collab blob, byte by byte.
import { execFileSync } from 'node:child_process';

const DOCKER = 'C:\\Program Files\\Docker\\Docker\\resources\\bin\\docker.exe';
const oid = process.argv[2] || '3c0703fb-ee9c-4faf-83d7-84e7eeeec392';

const hex = execFileSync(DOCKER, [
  'exec', 'appflowy-cloud-postgres-1', 'psql', '-U', 'postgres',
  '-d', 'postgres', '-t', '-A', '-c',
  `select encode(blob,'hex') from af_collab where oid='${oid}';`,
], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }).trim();

const raw = Buffer.from(hex, 'hex');
console.log(`blob=${raw.length}\n`);

// Print printable runs of >=3 ASCII chars with their offset.
let run = '';
let start = 0;
for (let i = 0; i <= raw.length; i++) {
  const b = raw[i];
  const printable = b >= 32 && b < 127;
  if (printable) {
    if (!run) start = i;
    run += String.fromCharCode(b);
  } else {
    if (run.length >= 3) console.log(`  @${String(start).padStart(4)}  ${JSON.stringify(run)}`);
    run = '';
  }
}

console.log('\n--- hex with ascii, first 160 bytes ---');
for (let i = 0; i < Math.min(160, raw.length); i += 16) {
  const chunk = raw.subarray(i, i + 16);
  const h = [...chunk].map((b) => b.toString(16).padStart(2, '0')).join(' ').padEnd(47);
  const a = [...chunk].map((b) => (b >= 32 && b < 127 ? String.fromCharCode(b) : '.')).join('');
  console.log(`${i.toString(16).padStart(4, '0')}  ${h}  ${a}`);
}


