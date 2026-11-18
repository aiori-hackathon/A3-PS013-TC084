import React from 'react';

/* ===========================================================================
   TRACEPOINT FORENSIC EMBLEMS & BESPOKE TELEMETRY MARKS
   ---------------------------------------------------------------------------
   Hand-crafted, crisp SVG forensic emblems replacing generic template icons.
   Optimized for high-density forensic dashboards with Light Pista theme.
   =========================================================================== */

// 1. Log Ingestion Lab — Terminal Console & Telemetry Stream Prompt
export function EmblemIngestion({ size = 32, className = '' }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 32 32"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      aria-hidden="true"
    >
      {/* Console frame */}
      <rect x="2" y="4" width="28" height="24" rx="5" fill="#132A1E" stroke="#2D6A4F" strokeWidth="1.5" />
      {/* Console header bar */}
      <path d="M 2 11 L 30 11" stroke="#234E39" strokeWidth="1.2" />
      {/* Status dots */}
      <circle cx="6.5" cy="7.5" r="1.5" fill="#FF851B" />
      <circle cx="11.5" cy="7.5" r="1.5" fill="#52B788" />
      <circle cx="16.5" cy="7.5" r="1.5" fill="#74C69D" opacity="0.6" />
      {/* Terminal prompt symbol >_ */}
      <path d="M 7 16 L 11.5 19.5 L 7 23" stroke="#74C69D" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      {/* Blinking telemetry cursor block */}
      <rect x="14" y="21" width="6" height="2.2" rx="0.5" fill="#52B788" />
      {/* Packet stream hash ticks */}
      <path d="M 23 16 L 27 16 M 21 19.5 L 27 19.5" stroke="#40916C" strokeWidth="1.5" strokeLinecap="round" opacity="0.8" />
    </svg>
  );
}

// 2. Event Timeline — Chronometer Radar & Waveform Frequency
export function EmblemTimeline({ size = 32, className = '' }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 32 32"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      aria-hidden="true"
    >
      {/* Outer chronometer dial */}
      <circle cx="16" cy="16" r="13" fill="#132A1E" stroke="#2D6A4F" strokeWidth="1.5" />
      <circle cx="16" cy="16" r="9.5" stroke="#234E39" strokeWidth="1" strokeDasharray="2 3" />
      {/* Hour ticks at 12, 3, 6, 9 */}
      <line x1="16" y1="4.5" x2="16" y2="6.5" stroke="#74C69D" strokeWidth="1.5" strokeLinecap="round" />
      <line x1="27.5" y1="16" x2="25.5" y2="16" stroke="#74C69D" strokeWidth="1.5" strokeLinecap="round" />
      <line x1="16" y1="27.5" x2="16" y2="25.5" stroke="#74C69D" strokeWidth="1.5" strokeLinecap="round" />
      <line x1="4.5" y1="16" x2="6.5" y2="16" stroke="#74C69D" strokeWidth="1.5" strokeLinecap="round" />
      {/* Telemetry waveform frequency line */}
      <path
        d="M 6.5 16 L 10.5 16 L 13 11 L 16 21 L 19 13.5 L 21.5 16 L 25.5 16"
        stroke="#52B788"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      {/* Active pulse origin dot */}
      <circle cx="19" cy="13.5" r="2" fill="#FF9933" />
    </svg>
  );
}

// 3. Evidence Register — Cryptographic SHA-256 Tamper-Evident Seal
export function EmblemEvidence({ size = 32, className = '' }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 32 32"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      aria-hidden="true"
    >
      {/* Shield container */}
      <path
        d="M 16 3 L 27 7.5 V 15 C 27 22.5 16 28.5 16 28.5 C 16 28.5 5 22.5 5 15 V 7.5 L 16 3 Z"
        fill="#132A1E"
        stroke="#2D6A4F"
        strokeWidth="1.5"
      />
      {/* Inner shield contour */}
      <path
        d="M 16 6 L 24 9.5 V 14.5 C 24 20.2 16 25 16 25 C 16 25 8 20.2 8 14.5 V 9.5 L 16 6 Z"
        stroke="#234E39"
        strokeWidth="1"
        fill="rgba(45, 106, 79, 0.15)"
      />
      {/* Cryptographic Keyhole Lock */}
      <rect x="12" y="14" width="8" height="7" rx="1.5" fill="#52B788" />
      <path
        d="M 13.5 14 V 11.5 C 13.5 10.1 14.6 9 16 9 C 17.4 9 18.5 10.1 18.5 11.5 V 14"
        stroke="#74C69D"
        strokeWidth="1.6"
        strokeLinecap="round"
      />
      <circle cx="16" cy="17" r="1.2" fill="#132A1E" />
      <path d="M 16 18 V 19.5" stroke="#132A1E" strokeWidth="1.2" strokeLinecap="round" />
    </svg>
  );
}

// 4. Investigation Graph — Attack Path & Incident Topology Graph
export function EmblemGraph({ size = 32, className = '' }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 32 32"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      aria-hidden="true"
    >
      {/* Dark background capsule */}
      <rect x="2" y="3" width="28" height="26" rx="6" fill="#132A1E" stroke="#2D6A4F" strokeWidth="1.5" />
      {/* Topology link lines */}
      <path d="M 8.5 10.5 L 16 16 L 23.5 9.5" stroke="#40916C" strokeWidth="1.5" />
      <path d="M 16 16 L 12 23.5" stroke="#40916C" strokeWidth="1.5" />
      <path d="M 16 16 L 22.5 22.5" stroke="#FF9933" strokeWidth="1.6" strokeDasharray="2 2" />
      {/* Graph Nodes */}
      <circle cx="8.5" cy="10.5" r="3.5" fill="#1E4430" stroke="#74C69D" strokeWidth="1.5" />
      <circle cx="23.5" cy="9.5" r="3" fill="#1E4430" stroke="#74C69D" strokeWidth="1.5" />
      <circle cx="12" cy="23.5" r="3" fill="#1E4430" stroke="#52B788" strokeWidth="1.5" />
      {/* Root Cause / Correlated Node */}
      <circle cx="16" cy="16" r="4.5" fill="#52B788" stroke="#FFFFFF" strokeWidth="1.5" />
      {/* Attack Incident Flagged Node */}
      <circle cx="22.5" cy="22.5" r="3.5" fill="#D9381E" stroke="#FFFFFF" strokeWidth="1.2" />
    </svg>
  );
}

// 5. Reports & Export — Statutory Forensic Dossier & Seal
export function EmblemReports({ size = 32, className = '' }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 32 32"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      aria-hidden="true"
    >
      {/* Document page with folded corner */}
      <path
        d="M 6 4 C 6 2.9 6.9 2 8 2 H 18 L 26 10 V 27 C 26 28.1 25.1 29 24 29 H 8 C 6.9 29 6 28.1 6 27 V 4 Z"
        fill="#132A1E"
        stroke="#2D6A4F"
        strokeWidth="1.5"
      />
      {/* Folded page corner */}
      <path d="M 18 2 V 10 H 26" fill="#1E4430" stroke="#2D6A4F" strokeWidth="1.5" />
      {/* Audit text lines */}
      <line x1="10" y1="13" x2="21" y2="13" stroke="#74C69D" strokeWidth="1.5" strokeLinecap="round" />
      <line x1="10" y1="17" x2="22" y2="17" stroke="#40916C" strokeWidth="1.5" strokeLinecap="round" />
      <line x1="10" y1="21" x2="16" y2="21" stroke="#40916C" strokeWidth="1.5" strokeLinecap="round" />
      {/* Verification Stamp Rosette */}
      <circle cx="20.5" cy="23.5" r="3.5" fill="#138808" stroke="#52B788" strokeWidth="1" />
      <path d="M 19 23.5 L 20.2 24.5 L 22 22.5" stroke="#FFFFFF" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

// ---------------------------------------------------------------------------
// METRICS EMBLEMS (FOR THE 4 SUMMARY CARDS)
// ---------------------------------------------------------------------------

// A. Collected Events — Telemetry Stream Signal Pulse
export function EmblemMetricCollected({ size = 24, className = '' }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" className={className} aria-hidden="true">
      <rect width="24" height="24" rx="6" fill="#E8F5EB" stroke="#BFE3C7" strokeWidth="1" />
      <path
        d="M 4 12 H 7.5 L 9.5 7 L 12.5 17 L 14.5 10 L 16.5 12 H 20"
        stroke="#138808"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle cx="12.5" cy="17" r="1.5" fill="#138808" />
    </svg>
  );
}

// B. Authentication Failures — Incident Alert Radar Shield
export function EmblemMetricFailures({ size = 24, className = '' }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" className={className} aria-hidden="true">
      <rect width="24" height="24" rx="6" fill="#FDF0ED" stroke="#F8C9BE" strokeWidth="1" />
      <path
        d="M 12 3 L 18.5 5.5 V 11 C 18.5 15.5 12 19 12 19 C 12 19 5.5 15.5 5.5 11 V 5.5 L 12 3 Z"
        fill="rgba(217, 56, 30, 0.12)"
        stroke="#D9381E"
        strokeWidth="1.5"
      />
      <line x1="12" y1="8" x2="12" y2="12" stroke="#D9381E" strokeWidth="1.6" strokeLinecap="round" />
      <circle cx="12" cy="14.5" r="1" fill="#D9381E" />
    </svg>
  );
}

// C. Source Devices — Telemetry Network Node Cluster
export function EmblemMetricDevices({ size = 24, className = '' }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" className={className} aria-hidden="true">
      <rect width="24" height="24" rx="6" fill="#EAF3EC" stroke="#CFE2D4" strokeWidth="1" />
      <rect x="5" y="6" width="14" height="10" rx="2" stroke="#2D6A4F" strokeWidth="1.5" />
      <line x1="8" y1="19" x2="16" y2="19" stroke="#2D6A4F" strokeWidth="1.5" strokeLinecap="round" />
      <line x1="12" y1="16" x2="12" y2="19" stroke="#2D6A4F" strokeWidth="1.5" />
      <circle cx="12" cy="11" r="2" fill="#52B788" />
    </svg>
  );
}

// D. Users Observed — Credential Identity Security Token
export function EmblemMetricUsers({ size = 24, className = '' }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" className={className} aria-hidden="true">
      <rect width="24" height="24" rx="6" fill="#EAF3EC" stroke="#CFE2D4" strokeWidth="1" />
      <circle cx="12" cy="8.5" r="3.2" stroke="#2D6A4F" strokeWidth="1.5" />
      <path
        d="M 6.5 17.5 C 6.5 14.5 9 13.5 12 13.5 C 15 13.5 17.5 14.5 17.5 17.5"
        stroke="#2D6A4F"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
    </svg>
  );
}
