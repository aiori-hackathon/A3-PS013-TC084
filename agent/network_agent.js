#!/usr/bin/env node
/**
 * Forward network lab evidence to a Tracepoint workspace.
 *
 * The lab records evidence locally whether or not anything is listening.
 * This agent copies those sessions to Tracepoint, where they become
 * evidence like any other collection: hashed on arrival, owned by the
 * account the API key belongs to, and recorded in the chain of custody.
 *
 * Sending is safe to repeat. The server claims a session identifier once,
 * so a re-run reports what it already holds instead of duplicating or
 * overwriting it. Nothing here deletes or edits local evidence.
 *
 * Configure with environment variables or flags:
 *
 *     TRACEPOINT_SERVER     e.g. https://api.tracepoint.example
 *     TRACEPOINT_API_KEY    an agent key from the workspace
 *     TRACEPOINT_DEVICE_ID  defaults to "mininet-lab"
 *     TRACEPOINT_EVIDENCE_DIR  defaults to ./evidence beside this script
 *
 * Examples:
 *
 *     ./network_agent.js --list
 *     ./network_agent.js                      # send everything not yet held
 *     ./network_agent.js network_evidence_20261115_113508.json
 */

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function expandHome(p) {
  if (!p) return p;
  if (p.startsWith('~/') || p === '~') {
    return path.join(os.homedir(), p.slice(1));
  }
  return p;
}

const BASE_DIR = __dirname;
export const EVIDENCE_NAME = /^network_evidence_(\d{8}_\d{6})\.json$/;
export const TIMEOUT_SECONDS = 30;

export function getEvidenceDir() {
  const envDir = process.env.TRACEPOINT_EVIDENCE_DIR;
  if (envDir) {
    return path.resolve(expandHome(envDir));
  }
  return path.join(BASE_DIR, 'evidence');
}

export function sessionIdFor(fileName) {
  const base = path.basename(fileName);
  const match = base.match(EVIDENCE_NAME);
  return match ? 'lab-' + match[1] : null;
}

export function evidenceFiles(evidenceDir, names = null) {
  if (!fs.existsSync(evidenceDir) || !fs.statSync(evidenceDir).isDirectory()) {
    return [];
  }
  if (names && names.length > 0) {
    const chosen = [];
    for (const name of names) {
      const p = path.join(evidenceDir, path.basename(name));
      if (!fs.existsSync(p) || !fs.statSync(p).isFile()) {
        console.log(`  skipped ${name}: no such evidence file`);
        continue;
      }
      chosen.push(p);
    }
    return chosen;
  }
  return fs.readdirSync(evidenceDir)
    .filter(f => EVIDENCE_NAME.test(f))
    .sort()
    .map(f => path.join(evidenceDir, f));
}

export function readObservations(filePath) {
  const content = fs.readFileSync(filePath, 'utf-8');
  let records;
  try {
    records = JSON.parse(content);
  } catch (err) {
    throw new Error(`invalid JSON in evidence: ${err.message}`);
  }
  if (!Array.isArray(records) || records.length === 0) {
    throw new Error('evidence must be a non-empty list of observations');
  }
  return records;
}

export async function send(url, apiKey, payload) {
  const target = url.replace(/\/+$/, '') + '/api/v1/network/ingest';
  try {
    const res = await fetch(target, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-API-Key': apiKey,
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(TIMEOUT_SECONDS * 1000),
    });

    let body = {};
    try {
      body = await res.json();
    } catch {}

    return { status: res.status, body };
  } catch (error) {
    return {
      status: 0,
      body: { detail: `could not reach Tracepoint: ${error.message || error}` },
    };
  }
}

export function describe(status, body) {
  if (status === 201 && body?.duplicate) {
    return ['already held', true];
  }
  if (status === 201) {
    const sha = (body?.sha256 || '').slice(0, 12);
    return [`sent (${body?.observations} observations, sha ${sha})`, true];
  }
  if (status === 401) {
    return ['rejected: the API key is not valid for this workspace', false];
  }
  if (status === 409) {
    return ['refused: a different session is already stored under this id', false];
  }
  if (status === 0) {
    return [body?.detail || 'unreachable', false];
  }
  return [`failed (HTTP ${status}): ${body?.detail || 'unknown error'}`, false];
}

export async function main() {
  const evidenceDir = getEvidenceDir();

  const options = {
    url: { type: 'string' },
    'api-key': { type: 'string' },
    'device-id': { type: 'string', default: 'mininet-lab' },
    list: { type: 'boolean', default: false },
    help: { type: 'boolean', default: false },
  };

  let parsed;
  try {
    parsed = parseArgs({ options, allowPositionals: true });
  } catch (err) {
    console.error(`Error: ${err.message}`);
    process.exit(2);
  }

  const { values, positionals } = parsed;

  if (values.help) {
    console.log(`Forward network lab evidence to a Tracepoint workspace.

Usage:
  ./network_agent.js [options] [evidence_files...]

Options:
  --url <url>           Tracepoint API base URL
  --api-key <key>       Agent API key for destination workspace
  --device-id <id>      Device identifier (default: "mininet-lab")
  --list                Show local evidence sessions and exit
  --help                Show this help message
`);
    process.exit(0);
  }

  const files = evidenceFiles(evidenceDir, positionals);
  if (!files || files.length === 0) {
    console.log('No evidence sessions found in', evidenceDir);
    return 0;
  }

  if (values.list) {
    console.log(`${files.length} evidence session(s) in ${evidenceDir}:`);
    for (const p of files) {
      try {
        const records = readObservations(p);
        const phases = records.map(r => r.phase || '?').join('/');
        const hasTopology = records.some(r => r.topology);
        const topology = hasTopology ? 'topology' : 'no topology';
        const id = sessionIdFor(p) || path.basename(p);
        console.log(`  ${id.padEnd(22)} ${String(records.length).padStart(2)} obs  ${phases.padEnd(28)} ${topology}`);
      } catch (err) {
        console.log(`  ${path.basename(p)}: unreadable (${err.message})`);
      }
    }
    return 0;
  }

  const targetUrl = values.url || process.env.TRACEPOINT_SERVER || process.env.TRACEPOINT_URL;
  const apiKey = values['api-key'] || process.env.TRACEPOINT_API_KEY;
  const deviceId = values['device-id'] || process.env.TRACEPOINT_DEVICE_ID || 'mininet-lab';

  if (!targetUrl || !apiKey) {
    console.error('Error: set TRACEPOINT_SERVER and TRACEPOINT_API_KEY (or pass --url and --api-key)');
    process.exit(2);
  }

  console.log(`Sending ${files.length} session(s) to ${targetUrl}`);
  let failures = 0;

  for (const p of files) {
    const identifier = sessionIdFor(p);
    if (!identifier) {
      console.log(`  ${path.basename(p)}: skipped, unrecognised evidence filename`);
      continue;
    }

    let observations;
    try {
      observations = readObservations(p);
    } catch (err) {
      console.log(`  ${identifier}: skipped, ${err.message}`);
      failures++;
      continue;
    }

    const { status, body } = await send(targetUrl, apiKey, {
      session_id: identifier,
      device_id: deviceId,
      source: path.basename(p),
      observations,
    });

    const [message, ok] = describe(status, body);
    console.log(`  ${identifier.padEnd(22)} ${message}`);
    if (!ok) {
      failures++;
    }
  }

  if (failures > 0) {
    console.log(`\n${failures} session(s) were not accepted. Local evidence is unchanged.`);
    return 1;
  }

  console.log('\nAll sessions accepted.');
  return 0;
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname)) {
  main().then(code => {
    if (code !== 0) process.exit(code);
  }).catch(error => {
    console.error(error.message || error);
    process.exit(1);
  });
}
