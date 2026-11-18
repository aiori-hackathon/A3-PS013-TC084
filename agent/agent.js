#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import os from 'node:os';

function expandHome(p) {
  if (!p) return p;
  if (p.startsWith('~/') || p === '~') {
    return path.join(os.homedir(), p.slice(1));
  }
  return p;
}

export function saveJsonAtomic(targetPath, data) {
  const dir = path.dirname(targetPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  const tempPath = targetPath + '.tmp';
  const content = JSON.stringify(data);
  const fd = fs.openSync(tempPath, 'w');
  try {
    fs.writeSync(fd, content, null, 'utf-8');
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
  fs.renameSync(tempPath, targetPath);
}

export function loadState(stateFile, logFile) {
  if (fs.existsSync(stateFile)) {
    try {
      return JSON.parse(fs.readFileSync(stateFile, 'utf-8'));
    } catch {
      // ignore
    }
  }

  if (process.env.TRACEPOINT_START_AT_END === '1' && fs.existsSync(logFile)) {
    const size = fs.statSync(logFile).size;
    console.log(`Starting at the end of the file (${size} bytes already present)`);
    const state = { offset: size };
    saveJsonAtomic(stateFile, state);
    return state;
  }

  return { offset: 0 };
}

export async function sendPendingBatch(serverUrl, pendingFile, stateFile, apiKey) {
  if (!fs.existsSync(pendingFile)) {
    return true;
  }

  let pending;
  try {
    pending = JSON.parse(fs.readFileSync(pendingFile, 'utf-8'));
  } catch (err) {
    console.log(`Failed to read pending batch: ${err.message}`);
    return false;
  }

  try {
    const res = await fetch(serverUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-API-Key': apiKey,
      },
      body: JSON.stringify(pending.payload),
      signal: AbortSignal.timeout(10000),
    });

    if (!res.ok) {
      throw new Error(`Server returned HTTP ${res.status}`);
    }

    const result = await res.json();
    if (result.status !== 'accepted' && result.status !== 'duplicate') {
      throw new Error('Unexpected server response');
    }

    saveJsonAtomic(stateFile, { offset: pending.next_offset });

    try {
      fs.unlinkSync(pendingFile);
    } catch {
      // ignore
    }

    console.log(`Batch ${result.status}: ${pending.payload.lines.length} lines`);
    return true;
  } catch (error) {
    console.log(`Delivery failed; will retry: ${error.message || error}`);
    return false;
  }
}

export function readNewLines(filePath, offset, maxLines = 100) {
  const fd = fs.openSync(filePath, 'r');
  try {
    const stat = fs.fstatSync(fd);
    let currentOffset = offset;
    if (stat.size < currentOffset) {
      console.log('Log file was truncated; restarting at offset 0');
      currentOffset = 0;
    }

    const lines = [];
    const CHUNK_SIZE = 64 * 1024;
    const buf = Buffer.alloc(CHUNK_SIZE);
    let chunkPos = currentOffset;
    let pendingBuffer = Buffer.alloc(0);

    while (lines.length < maxLines && chunkPos < stat.size) {
      const bytesToRead = Math.min(CHUNK_SIZE, stat.size - chunkPos);
      const bytesRead = fs.readSync(fd, buf, 0, bytesToRead, chunkPos);
      if (bytesRead === 0) break;

      const currentChunk = Buffer.concat([pendingBuffer, buf.subarray(0, bytesRead)]);
      let lineStart = 0;
      let newlineIdx = currentChunk.indexOf(0x0a);

      while (newlineIdx !== -1 && lines.length < maxLines) {
        let lineBuf = currentChunk.subarray(lineStart, newlineIdx);
        if (lineBuf.length > 0 && lineBuf[lineBuf.length - 1] === 0x0d) {
          lineBuf = lineBuf.subarray(0, lineBuf.length - 1);
        }
        lines.push(lineBuf.toString('utf-8'));
        lineStart = newlineIdx + 1;
        newlineIdx = currentChunk.indexOf(0x0a, lineStart);
      }

      currentOffset += (lineStart - pendingBuffer.length);
      chunkPos += bytesRead;
      pendingBuffer = currentChunk.subarray(lineStart);

      if (lines.length >= maxLines) break;
    }

    return { lines, nextOffset: currentOffset };
  } finally {
    fs.closeSync(fd);
  }
}

export function collectNewLines({
  logFile,
  stateFile,
  pendingFile,
  deviceId,
  logType,
  sourceTimezone,
  maxLines,
}) {
  if (!fs.existsSync(logFile)) {
    console.log(`Log file not found: ${logFile}`);
    return;
  }

  const state = loadState(stateFile, logFile);
  const { lines, nextOffset } = readNewLines(logFile, state.offset || 0, maxLines);

  if (!lines || lines.length === 0) {
    return;
  }

  const payload = {
    device_id: deviceId,
    batch_id: crypto.randomUUID(),
    log_type: logType,
    source_timezone: sourceTimezone,
    lines,
  };

  saveJsonAtomic(pendingFile, {
    payload,
    next_offset: nextOffset,
  });

  console.log(`Collected ${lines.length} new log lines`);
}

export function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

export async function main() {
  const apiKey = process.env.AGENT_API_KEY;
  if (!apiKey) {
    throw new Error('AGENT_API_KEY is not configured');
  }

  const serverBase = (process.env.TRACEPOINT_SERVER || 'http://127.0.0.1:8000').replace(/\/+$/, '');
  const serverUrl = `${serverBase}/api/v1/ingest`;
  const deviceId = process.env.TRACEPOINT_DEVICE_ID || 'macbook-01';
  const logType = process.env.TRACEPOINT_LOG_TYPE || 'auth';
  const sourceTimezone = process.env.TRACEPOINT_TIMEZONE || 'Asia/Kolkata';

  const rawLogFile = process.env.TRACEPOINT_LOG_FILE || 'sample.log';
  const logFile = path.resolve(expandHome(rawLogFile));

  const stateKeyInput = `${deviceId}|${logFile}`;
  const stateKey = crypto.createHash('sha256').update(stateKeyInput, 'utf-8').digest('hex').slice(0, 12);

  const rawStateDir = process.env.TRACEPOINT_STATE_DIR || '.';
  const stateDir = path.resolve(expandHome(rawStateDir));
  const stateFile = path.join(stateDir, `agent-state-${stateKey}.json`);
  const pendingFile = path.join(stateDir, `pending-batch-${stateKey}.json`);

  const pollInterval = parseInt(process.env.TRACEPOINT_POLL_SECONDS || '5', 10);
  const maxLines = parseInt(process.env.TRACEPOINT_MAX_LINES || '100', 10);

  console.log('The Missing Links Agent started');
  console.log(`Watching:  ${logFile}`);
  console.log(`Device:    ${deviceId}`);
  console.log(`Server:    ${serverUrl}`);
  console.log(`Timezone:  ${sourceTimezone}`);
  console.log(`State:     ${stateFile}`);
  console.log(`Polling every ${pollInterval} seconds`);

  let running = true;
  const onStop = () => {
    console.log('\nAgent stopped');
    running = false;
    process.exit(0);
  };
  process.on('SIGINT', onStop);
  process.on('SIGTERM', onStop);

  while (running) {
    try {
      if (fs.existsSync(pendingFile)) {
        await sendPendingBatch(serverUrl, pendingFile, stateFile, apiKey);
      } else {
        collectNewLines({
          logFile,
          stateFile,
          pendingFile,
          deviceId,
          logType,
          sourceTimezone,
          maxLines,
        });
      }
    } catch (error) {
      console.log(`Agent error: ${error.message || error}`);
    }

    await sleep(pollInterval * 1000);
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname)) {
  main().catch(error => {
    console.error(error.message || error);
    process.exit(1);
  });
}
