import { Router } from 'express';
import PDFDocument from 'pdfkit';
import { getDb } from './db.js';
import { currentUser } from './auth.js';
import { getOwnedCase, filterOwnedEventRows } from './investigations.js';
import {
  loadOwnedEvidenceMetadata,
  verifyEvidenceForOwner,
  SAFE_ID_REGEX,
} from './evidence.js';
import * as custody from './custody.js';

export const router = Router();
const PURPLE = '#6652C8';

export function evidenceForReport(events, ownerUserId) {
  const batches = new Map();
  for (const item of events) {
    let event;
    try {
      event = JSON.parse(item.event_reference);
    } catch {
      continue;
    }
    if (!event || typeof event !== 'object') continue;
    const deviceId = event.device_id;
    const batchId = event.batch_id;
    if (
      typeof deviceId !== 'string' ||
      typeof batchId !== 'string' ||
      !SAFE_ID_REGEX.test(deviceId) ||
      !SAFE_ID_REGEX.test(batchId)
    ) {
      continue;
    }
    batches.set(`${deviceId}:${batchId}`, { deviceId, batchId });
  }

  const results = [];
  const sortedKeys = [...batches.keys()].sort();
  for (const key of sortedKeys) {
    const { deviceId, batchId } = batches.get(key);
    try {
      const metadata = loadOwnedEvidenceMetadata(ownerUserId, deviceId, batchId);
      const verification = verifyEvidenceForOwner(deviceId, batchId, ownerUserId);
      results.push({
        device_id: deviceId,
        batch_id: batchId,
        sha256: metadata.sha256,
        received_at: metadata.received_at,
        line_count: metadata.line_count,
        status: verification.status || 'unknown',
      });
    } catch {
      results.push({
        device_id: deviceId,
        batch_id: batchId,
        sha256: null,
        received_at: null,
        line_count: null,
        status: 'not_available_to_account',
      });
    }
  }
  return results;
}

router.get('/:case_id/report', (req, res) => {
  const user = currentUser(req);
  if (!user) {
    return res.status(401).json({ detail: 'Sign in required' });
  }

  const caseId = Number.parseInt(req.params.case_id, 10);
  if (Number.isNaN(caseId)) {
    return res.status(404).json({ detail: 'Investigation not found' });
  }

  const db = getDb();
  let caseObj;
  try {
    caseObj = getOwnedCase(db, caseId, user.id);
  } catch (err) {
    return res.status(err.status || 500).json({ detail: err.message });
  }

  const eventStmt = db.prepare(
    'SELECT * FROM investigation_events WHERE investigation_id = ? ORDER BY linked_at ASC'
  );
  const rawEvents = eventStmt.all(caseId);

  const noteStmt = db.prepare(
    'SELECT * FROM investigation_notes WHERE investigation_id = ? ORDER BY created_at ASC'
  );
  const notes = noteStmt.all(caseId);

  const events = filterOwnedEventRows(rawEvents, user.id);
  const evidenceBatches = evidenceForReport(events, user.id);
  const chain = custody.verifyChain(user.id);
  const custodyEntries = custody.entriesForUser(user.id, 25);

  const caseTag = `TP-${String(caseId).padStart(4, '0')}`;

  const doc = new PDFDocument({
    size: 'A4',
    margin: 40,
    bufferPages: true,
  });

  const buffers = [];
  doc.on('data', (chunk) => buffers.push(chunk));
  doc.on('end', () => {
    const pdfData = Buffer.concat(buffers);

    custody.record(user.id, 'export', {
      case_id: caseId,
      format: 'pdf',
      linked_events: events.length,
    });

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="Tracepoint_${caseTag}.pdf"`
    );
    res.setHeader('Content-Length', pdfData.length);
    return res.send(pdfData);
  });

  // Header
  doc
    .font('Helvetica-Bold')
    .fontSize(22)
    .fillColor(PURPLE)
    .text('TRACEPOINT', { align: 'center' });

  doc
    .font('Helvetica')
    .fontSize(10)
    .fillColor('#605A70')
    .text('DIGITAL FORENSIC INVESTIGATION REPORT', { align: 'center' });

  doc.moveDown(1.5);

  // Section: Investigation Overview
  doc
    .font('Helvetica-Bold')
    .fontSize(13)
    .fillColor(PURPLE)
    .text('Investigation Overview');

  doc.moveDown(0.5);
  doc.font('Helvetica').fontSize(9).fillColor('#1F1E24');

  const metaRows = [
    ['Case ID', caseTag],
    ['Title', caseObj.title || 'Untitled'],
    ['Status', (caseObj.status || 'open').toUpperCase()],
    ['Severity', (caseObj.severity || 'medium').toUpperCase()],
    ['Created', caseObj.created_at || '—'],
    ['Last Updated', caseObj.updated_at || '—'],
    ['Description', caseObj.description || 'No description provided.'],
  ];

  for (const [k, v] of metaRows) {
    doc.font('Helvetica-Bold').text(`${k}: `, { continued: true });
    doc.font('Helvetica').text(v);
  }

  doc.moveDown(1);

  // Section: Linked Events
  doc
    .font('Helvetica-Bold')
    .fontSize(13)
    .fillColor(PURPLE)
    .text(`Linked Events (${events.length})`);

  doc.moveDown(0.5);
  if (events.length === 0) {
    doc.font('Helvetica').fontSize(9).fillColor('#555').text('No events linked to this investigation.');
  } else {
    for (let i = 0; i < events.length; i++) {
      let ref = {};
      try {
        ref = JSON.parse(events[i].event_reference);
      } catch {
        // ignore
      }
      doc.font('Helvetica-Bold').fontSize(9).fillColor('#1F1E24').text(`[E${i + 1}] `, { continued: true });
      doc.font('Helvetica').text(
        `${ref.timestamp || '—'} | ${ref.device_id || '—'} | ${ref.event_type || '—'} | user: ${ref.username || '—'}`
      );
      if (ref.message) {
        doc.font('Helvetica-Oblique').fontSize(8).fillColor('#444').text(`     "${ref.message}"`);
      }
      doc.moveDown(0.3);
    }
  }

  doc.moveDown(1);

  // Section: Analyst Notes
  doc
    .font('Helvetica-Bold')
    .fontSize(13)
    .fillColor(PURPLE)
    .text(`Analyst Notes (${notes.length})`);

  doc.moveDown(0.5);
  if (notes.length === 0) {
    doc.font('Helvetica').fontSize(9).fillColor('#555').text('No notes recorded.');
  } else {
    for (const note of notes) {
      doc
        .font('Helvetica-Bold')
        .fontSize(8)
        .fillColor('#605A70')
        .text(`${note.created_at || '—'}`);
      doc.font('Helvetica').fontSize(9).fillColor('#1F1E24').text(note.content);
      doc.moveDown(0.4);
    }
  }

  doc.moveDown(1);

  // Section: Evidence Batches
  doc
    .font('Helvetica-Bold')
    .fontSize(13)
    .fillColor(PURPLE)
    .text(`Evidence Batches (${evidenceBatches.length})`);

  doc.moveDown(0.5);
  for (let idx = 0; idx < evidenceBatches.length; idx++) {
    const b = evidenceBatches[idx];
    doc.font('Helvetica-Bold').fontSize(9).fillColor('#1F1E24').text(`Evidence Batch ${idx + 1}`);
    doc.font('Helvetica').fontSize(8).fillColor('#333');
    doc.text(`Device: ${b.device_id} | Batch ID: ${b.batch_id}`);
    doc.text(`Received: ${b.received_at || '—'} | Lines: ${b.line_count ?? '—'}`);
    doc.text(`SHA-256: ${b.sha256 || '—'}`);
    doc.font('Helvetica-Bold').text(`Verification: ${(b.status || 'UNKNOWN').toUpperCase()}`);
    doc.moveDown(0.4);
  }

  doc.font('Helvetica').fontSize(8).fillColor('#555').text(
    'Verification method: SHA-256 was recalculated from each available evidence file during report generation and compared with its recorded metadata hash.'
  );

  doc.moveDown(1);

  // Section: Chain of Custody
  doc
    .font('Helvetica-Bold')
    .fontSize(13)
    .fillColor(PURPLE)
    .text('Chain of Custody');

  doc.moveDown(0.5);
  const chainText = chain.intact
    ? 'The chain is intact: every entry matches its seal and follows the one before it.'
    : `THE CHAIN IS BROKEN at entry ${chain.broken_at}. ${chain.detail}`;

  doc
    .font('Helvetica')
    .fontSize(8)
    .fillColor('#1F1E24')
    .text(`Handling record: ${chain.entries} entries. ${chainText}`);

  doc.moveDown(0.4);
  for (const entry of custodyEntries) {
    const target = entry.batch_id || (entry.case_id ? `case TP-${String(entry.case_id).padStart(4, '0')}` : '—');
    doc
      .font('Helvetica')
      .fontSize(7.5)
      .fillColor('#444')
      .text(`${entry.recorded_at} — ${entry.action} — ${target} ${entry.detail}`);
  }

  doc.moveDown(0.4);
  doc.font('Helvetica').fontSize(8).fillColor('#555').text(
    'What this shows: entries above are sealed with SHA-256 over the preceding entry. An intact chain shows the record has not been edited.'
  );

  doc.moveDown(1);

  // Report Disclaimer
  doc
    .font('Helvetica-Bold')
    .fontSize(10)
    .fillColor(PURPLE)
    .text('Report Disclaimer');
  doc.font('Helvetica').fontSize(8).fillColor('#555').text(
    'This report is generated from investigation records stored in Tracepoint. Event references and analyst notes should be interpreted alongside the original evidence files.'
  );

  // Footers on all pages
  const range = doc.bufferedPageRange();
  for (let i = 0; i < range.count; i++) {
    doc.switchToPage(i);
    const bottomY = doc.page.height - 35;

    doc
      .strokeColor('#E7E3F2')
      .lineWidth(0.5)
      .moveTo(40, bottomY - 6)
      .lineTo(doc.page.width - 40, bottomY - 6)
      .stroke();

    doc
      .font('Helvetica')
      .fontSize(8)
      .fillColor('#817B91')
      .text(`TRACEPOINT  |  ${caseTag}`, 40, bottomY, {
        align: 'left',
      });

    doc
      .font('Helvetica')
      .fontSize(8)
      .fillColor('#817B91')
      .text(`Page ${i + 1} of ${range.count}`, doc.page.width - 140, bottomY, {
        align: 'right',
        width: 100,
      });
  }

  doc.end();
});
