#!/usr/bin/env node
/*
 * Count every stored evidence line against its distinct set, per device.
 *
 * The ingest endpoint rejects a batch whose SHA-256 it has already seen, which
 * catches an identical batch sent twice. It does not catch two batches that
 * overlap only partially -- which is exactly what two agents sharing one state
 * file produce. This checks the stored lines themselves.
 *
 * Reads only; it never modifies or deletes evidence.
 *
 *   node scripts/check-duplicates.mjs          # summary
 *   node scripts/check-duplicates.mjs --show   # also print the repeated lines
 *
 * Exits 1 if any duplicate is found, so it can gate a deploy.
 */
import fs from 'node:fs';
import path from 'node:path';
import { getEvidenceDir } from '../src/evidence.js';

const show = process.argv.includes('--show');
const usersRoot = path.join(getEvidenceDir(), 'users');

if (!fs.existsSync(usersRoot)) {
  console.error(`No evidence directory at ${usersRoot}`);
  process.exit(2);
}

const counts = new Map(); // device -> Map(line -> occurrences)
const batchesRead = new Map(); // device -> batch file count
let total = 0;
let unreadable = 0;

for (const user of fs.readdirSync(usersRoot)) {
  const userDir = path.join(usersRoot, user);
  if (!fs.statSync(userDir).isDirectory()) continue;

  for (const device of fs.readdirSync(userDir)) {
    const deviceDir = path.join(userDir, device);
    if (!fs.statSync(deviceDir).isDirectory()) continue;

    for (const file of fs.readdirSync(deviceDir)) {
      if (!file.endsWith('.json') || file.endsWith('.meta.json')) continue;

      let batch;
      try {
        batch = JSON.parse(fs.readFileSync(path.join(deviceDir, file), 'utf8'));
      } catch {
        unreadable += 1;
        continue;
      }

      batchesRead.set(device, (batchesRead.get(device) || 0) + 1);
      if (!counts.has(device)) counts.set(device, new Map());
      const seen = counts.get(device);

      for (const line of batch.lines || []) {
        total += 1;
        seen.set(line, (seen.get(line) || 0) + 1);
      }
    }
  }
}

let distinct = 0;
let extra = 0;
const rows = [];

for (const [device, seen] of counts) {
  let deviceTotal = 0;
  let deviceExtra = 0;
  for (const n of seen.values()) {
    deviceTotal += n;
    deviceExtra += n - 1;
  }
  distinct += seen.size;
  extra += deviceExtra;
  rows.push({ device, batches: batchesRead.get(device) || 0, lines: deviceTotal, distinct: seen.size, extra: deviceExtra });
}

console.log(`evidence dir : ${getEvidenceDir()}`);
console.log(`lines stored : ${total}`);
console.log(`distinct     : ${distinct}`);
console.log(`extra copies : ${extra}`);
if (unreadable) console.log(`unreadable   : ${unreadable} batch file(s)`);
console.log('');

for (const r of rows.sort((a, b) => b.lines - a.lines)) {
  console.log(`  ${r.device.padEnd(24)} batches=${String(r.batches).padStart(4)}  lines=${String(r.lines).padStart(6)}  distinct=${String(r.distinct).padStart(6)}  extra=${r.extra}`);
}

if (extra > 0 && show) {
  console.log('\nrepeated lines:');
  for (const [device, seen] of counts) {
    for (const [line, n] of seen) {
      if (n > 1) console.log(`  x${n}  ${device}  ${line.slice(0, 120)}`);
    }
  }
}

if (extra > 0) {
  console.log(`\n${extra} duplicate line(s). Re-run with --show to see them.`);
  process.exit(1);
}

console.log('\nNo duplicates.');
