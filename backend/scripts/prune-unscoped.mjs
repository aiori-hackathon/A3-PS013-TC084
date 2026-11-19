#!/usr/bin/env node
/*
 * Remove evidence batches collected before a collection scope was in force.
 *
 * When the agent runs unscoped it collects every line in the log; once
 * TRACEPOINT_USER_FILTER / TRACEPOINT_EVENT_FILTER are set it collects only
 * what they allow. The filter governs new collection only -- it does not reach
 * back -- so a register can hold both, and the earlier, wider batches are what
 * make unrelated accounts appear in the timeline.
 *
 * This removes those earlier batches. That is a deletion of real evidence, so:
 *   - it reports before it acts, and does nothing at all without --delete
 *   - every removal is written to the hash-chained custody log, so the register
 *     records that it was pruned rather than quietly becoming smaller
 *
 *   node scripts/prune-unscoped.mjs                          # report only
 *   node scripts/prune-unscoped.mjs --user 1 --device aws-ec2-host-01 --delete
 */
import fs from 'node:fs';
import path from 'node:path';
import { getEvidenceDir } from '../src/evidence.js';
import { parseLog } from '../src/parser.js';
import * as custody from '../src/custody.js';

const argv = process.argv.slice(2);
const flag = name => {
  const i = argv.indexOf(`--${name}`);
  return i === -1 ? null : argv[i + 1];
};
const doDelete = argv.includes('--delete');
const onlyUser = flag('user');
const onlyDevice = flag('device');

if (doDelete && (!onlyUser || !onlyDevice)) {
  console.error('Refusing to delete without an explicit --user and --device.');
  console.error('Run without --delete first to see what would be removed.');
  process.exit(2);
}

const usersRoot = path.join(getEvidenceDir(), 'users');
if (!fs.existsSync(usersRoot)) {
  console.error(`No evidence directory at ${usersRoot}`);
  process.exit(2);
}

const candidates = [];

for (const user of fs.readdirSync(usersRoot)) {
  if (onlyUser && user !== String(onlyUser)) continue;
  const userDir = path.join(usersRoot, user);
  if (!fs.statSync(userDir).isDirectory()) continue;

  for (const device of fs.readdirSync(userDir)) {
    if (onlyDevice && device !== onlyDevice) continue;
    const deviceDir = path.join(userDir, device);
    if (!fs.statSync(deviceDir).isDirectory()) continue;

    for (const file of fs.readdirSync(deviceDir)) {
      if (!file.endsWith('.meta.json')) continue;

      const metaPath = path.join(deviceDir, file);
      let meta;
      try {
        meta = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
      } catch {
        continue;
      }

      // Collected under a scope: keep. Missing or null: collected before.
      if (meta.collection_filter) continue;

      const evidencePath = path.join(deviceDir, file.replace(/\.meta\.json$/, '.json'));
      let batch = { lines: [] };
      try {
        batch = JSON.parse(fs.readFileSync(evidencePath, 'utf8'));
      } catch {
        // metadata without readable evidence still counts as a candidate
      }

      candidates.push({
        user, device, metaPath, evidencePath,
        batchId: meta.batch_id,
        receivedAt: meta.received_at,
        lines: batch.lines || [],
      });
    }
  }
}

if (candidates.length === 0) {
  console.log('No unscoped batches found. Every batch was collected under a scope.');
  process.exit(0);
}

const users = new Map();
const types = new Map();
let lineTotal = 0;
let earliest = null;
let latest = null;

for (const c of candidates) {
  lineTotal += c.lines.length;
  if (c.receivedAt) {
    if (!earliest || c.receivedAt < earliest) earliest = c.receivedAt;
    if (!latest || c.receivedAt > latest) latest = c.receivedAt;
  }
  for (const line of c.lines) {
    const ev = parseLog(line, c.device, c.batchId, 'auth');
    const u = ev.username || '(none)';
    users.set(u, (users.get(u) || 0) + 1);
    types.set(ev.event_type, (types.get(ev.event_type) || 0) + 1);
  }
}

console.log(doDelete ? 'REMOVING these batches:' : 'Would remove these batches (dry run):');
console.log(`  batches   : ${candidates.length}`);
console.log(`  lines     : ${lineTotal}`);
console.log(`  received  : ${earliest} .. ${latest}`);
console.log('\n  by account:');
for (const [u, n] of [...users].sort((a, b) => b[1] - a[1])) {
  console.log(`    ${String(u).padEnd(16)} ${n}`);
}
console.log('\n  by event type:');
for (const [t, n] of [...types].sort((a, b) => b[1] - a[1])) {
  console.log(`    ${String(t).padEnd(24)} ${n}`);
}

if (!doDelete) {
  console.log('\nNothing was changed. To remove them:');
  console.log(`  node scripts/prune-unscoped.mjs --user ${onlyUser || '<id>'} --device ${onlyDevice || '<device>'} --delete`);
  process.exit(0);
}

let removed = 0;
for (const c of candidates) {
  custody.record(Number(onlyUser), 'prune', {
    device_id: c.device,
    batch_id: c.batchId,
    reason: 'collected before a collection scope was in force',
    line_count: c.lines.length,
    received_at: c.receivedAt,
  });

  for (const target of [c.evidencePath, c.metaPath]) {
    try {
      fs.unlinkSync(target);
    } catch (err) {
      if (err.code !== 'ENOENT') throw err;
    }
  }
  removed += 1;
}

console.log(`\nRemoved ${removed} batch(es); ${removed} custody entries written.`);
console.log('Verify the chain is still intact from the Evidence page, or re-run check-duplicates.mjs.');
