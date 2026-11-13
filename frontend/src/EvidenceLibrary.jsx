import { useEvidenceTrustScores } from './useEvidenceTrustScores';
// TRACEPOINT_EVIDENCE_PHASE4

import { useEffect, useState } from "react";
import {
  CheckCircle2,
  XCircle,
  AlertTriangle,
  Fingerprint,
  Search,
  ShieldCheck,
  LoaderCircle,
  X,
  Copy,
} from "lucide-react";
import "./styles/Tracepoint.css";
import "./styles/Custody.css";
// TRACEPOINT_TRUST_SCORE_V1
import { TrustScoreBadge, TrustScoreDetails } from "./EvidenceTrustScore";

const formatDate = (value) => {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
};

const shortHash = (value) =>
  value ? `${value.slice(0, 16)}…${value.slice(-8)}` : "—";


function AnimatedEvidenceCount({ value }) {
  const [shown, setShown] = useState(0);

  useEffect(() => {
    const target = Math.max(0, Number(value) || 0);
    const duration = 2300;
    let start;
    let frame;

    const animate = now => {
      if (start === undefined) start = now;
      const progress = Math.min(1, (now - start) / duration);
      const eased = 1 - Math.pow(1 - progress, 3);
      setShown(Math.round(target * eased));

      if (progress < 1) {
        frame = requestAnimationFrame(animate);
      }
    };

    frame = requestAnimationFrame(animate);
    return () => cancelAnimationFrame(frame);
  }, [value]);

  return <>{shown.toLocaleString()}</>;
}

export default function EvidenceLibrary({ refreshSignal = 0 }) {
  const [batches, setBatches] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState(null);
  const [results, setResults] = useState({});
  const [verifying, setVerifying] = useState(null);
  const { scores, scoreError } = useEvidenceTrustScores(refreshSignal);
  // TRACEPOINT_CUSTODY_V1
  const [custody, setCustody] = useState(null);

  const keyFor = (batch) => `${batch.device_id}/${batch.batch_id}`;

  async function loadEvidence() {
    setLoading(true);
    setError("");

    try {
      const response = await fetch("/api/v1/evidence", {
        credentials: "same-origin",
      });

      if (!response.ok) throw new Error("Unable to load evidence records.");

      const data = await response.json();
      setBatches(data.items || []);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  async function loadCustody() {
    try {
      const response = await fetch("/api/v1/custody", { credentials: "same-origin" });
      if (!response.ok) throw new Error("Unable to load the custody record.");
      setCustody(await response.json());
    } catch {
      // The register is still usable without its handling record, so this
      // failure is shown in the panel rather than over the whole page.
      setCustody({ unavailable: true });
    }
  }

  useEffect(() => {
    loadEvidence();
    loadCustody();
  }, [refreshSignal]);

  async function verify(batch) {
    const key = keyFor(batch);
    setVerifying(key);

    try {
      const response = await fetch(
        `/api/v1/evidence/${encodeURIComponent(batch.device_id)}/${encodeURIComponent(batch.batch_id)}/verify`,
        {
          method: "POST",
          credentials: "same-origin",
        }
      );

      const result = await response.json();

      if (!response.ok) {
        throw new Error(result.detail || "Verification failed.");
      }

      setResults((previous) => ({
        ...previous,
        [key]: result,
      }));
    } catch (err) {
      setResults((previous) => ({
        ...previous,
        [key]: {
          status: "error",
          verified: false,
          detail: err.message,
        },
      }));
    } finally {
      setVerifying(null);
      // A verification is itself a handling event, so the panel below is
      // out of date the moment one finishes.
      loadCustody();
    }
  }

  const filtered = batches.filter((batch) =>
    [
      batch.device_id,
      batch.batch_id,
      batch.log_type,
      batch.sha256,
    ]
      .join(" ")
      .toLowerCase()
      .includes(search.toLowerCase())
  );

  const totalLines = batches.reduce(
    (sum, batch) => sum + (Number(batch.line_count) || 0),
    0
  );

  const verifiedCount = batches.filter(
    (batch) => results[keyFor(batch)]?.verified === true
  ).length;

  function statusFor(batch) {
    const key = keyFor(batch);
    const result = results[key];

    if (verifying === key) {
      return <span className="tp-ev-status pending">Checking…</span>;
    }

    if (!result) {
      return <span className="tp-ev-status neutral">Not checked</span>;
    }

    if (result.verified) {
      return (
        <span className="tp-ev-status success">
          <CheckCircle2 size={14} /> Verified
        </span>
      );
    }

    return (
      <span className="tp-ev-status danger">
        <XCircle size={14} /> {result.status === "mismatch" ? "Mismatch" : "Failed"}
      </span>
    );
  }

  return (
    <div className="tp-ev tp-evidence-console">
      <section className="tp-evidence-banner">
        <div><span className="tp-evidence-eyebrow">EVIDENCE / COLLECTION REGISTER</span>
          <h2>Collected evidence, accounted for.</h2>
          <p>Review collection metadata, verify SHA-256 fingerprints and inspect trust assessments.</p>
        </div>
        <div className="tp-evidence-banner-side"><span>COLLECTION REGISTER</span>
          <strong>{loading ? 'Loading…' : `${batches.length} batches`}</strong>
          <small>Integrity checks run on demand</small>
        </div>
      </section>
      <div className="tp-ev-stats tp-evidence-stats">
        <div className="tp-card tp-ev-stat">
          <span>Evidence batches</span>
          <strong><AnimatedEvidenceCount value={batches.length} /></strong>
          <small>Stored collection batches</small>
        </div>
        <div className="tp-card tp-ev-stat">
          <span>Evidence records</span>
          <strong><AnimatedEvidenceCount value={totalLines} /></strong>
          <small>Collected log lines</small>
        </div>
        <div className="tp-card tp-ev-stat">
          <span>Verified this session</span>
          <strong><AnimatedEvidenceCount value={verifiedCount} /></strong>
          <small>Passed SHA-256 comparison</small>
        </div>
      </div>

      <section className="tp-card tp-ev-card tp-evidence-register">
        <div className="tp-card-head">
          <div>
            <h2>Collection register</h2>
            <p>Stored batches, source devices and verification results</p>
          </div>
        </div>

        <div className="tp-toolbar">
          <label className="tp-search">
            <Search size={18} />
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search device, batch ID or SHA-256"
              aria-label="Search evidence"
            />
          </label>
        </div>

        {error && <div className="tp-error">{error}</div>}

        {loading ? (
          <div className="tp-ev-empty">
            <LoaderCircle size={22} className="tp-spin" /> Loading evidence…
          </div>
        ) : filtered.length === 0 ? (
          <div className="tp-ev-empty">No matching evidence batches found.</div>
        ) : (
          <div className="tp-ev-table-wrap">
            <table className="tp-ev-table tp-evidence-table">
              <thead>
                <tr>
                  <th>Evidence batch</th>
                  <th>Device</th>
                  <th>Records</th>
                  <th>Collected</th>
                  <th>Integrity</th>
                <th>Trust score</th>
                  <th>Action</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((batch) => {
                  const key = keyFor(batch);

                  return (
                    <tr key={key}>
                      <td>
                        <button
                          className="tp-ev-batch-link tp-evidence-batch"
                          onClick={() => setSelected(batch)}
                        >
                          <Fingerprint size={17} />
                          <span>
                            <strong>{batch.batch_id?.slice(0, 12)}…</strong>
                            <small>{batch.log_type || "Unknown log type"}</small>
                          </span>
                        </button>
                      </td>
                      <td className="tp-evidence-device">{batch.device_id}</td>
                      <td>{batch.line_count}</td>
                      <td className="tp-evidence-date">{formatDate(batch.received_at)}</td>
                      <td>{statusFor(batch)}</td>
                    <td><TrustScoreBadge result={scores[key]} /></td>
                      <td>
                        <button
                          className="tp-button tp-ev-verify"
                          onClick={() => verify(batch)}
                          disabled={verifying === key}
                        >
                          <ShieldCheck size={15} />
                          {verifying === key ? "Checking" : "Verify"}
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* TRACEPOINT_CUSTODY_V1 */}
      <section className="tp-card tp-ev-card tp-custody">
        <div className="tp-card-head">
          <div>
            <h3><ShieldCheck size={17}/> Chain of custody</h3>
            <p>
              Every ingest, verification, case link and export on this account,
              sealed so the record cannot be edited without showing it.
            </p>
          </div>
          {custody?.chain && (
            <span className={`tp-custody-seal ${custody.chain.intact ? "intact" : "broken"}`}>
              {custody.chain.intact ? <CheckCircle2 size={15}/> : <AlertTriangle size={15}/>}
              {custody.chain.intact
                ? `Chain intact · ${custody.chain.entries} entries`
                : `Chain broken at entry ${custody.chain.broken_at}`}
            </span>
          )}
        </div>

        {custody?.unavailable && (
          <p className="tp-custody-empty">The handling record could not be loaded.</p>
        )}

        {custody && !custody.unavailable && !custody.items?.length && (
          <p className="tp-custody-empty">
            No evidence has been handled on this account yet. Ingest a batch and
            it will be recorded here.
          </p>
        )}

        {!!custody?.items?.length && (
          <>
            <p className="tp-custody-detail">{custody.chain?.detail}</p>
            <ol className="tp-custody-list">
              {custody.items.map((entry) => {
                const detail = (() => {
                  try { return JSON.parse(entry.detail || "{}") || {}; }
                  catch { return {}; }
                })();
                const target = entry.batch_id
                  ? `${entry.device_id || "unknown device"} · ${entry.batch_id.slice(0, 8)}…`
                  : entry.case_id ? `case TP-${String(entry.case_id).padStart(4, "0")}` : "—";
                return (
                  <li key={entry.id} className={`tp-custody-entry ${entry.action}`}>
                    <span className="tp-custody-action">{entry.action}</span>
                    <span className="tp-custody-target">{target}</span>
                    <span className="tp-custody-meta">
                      {Object.entries(detail)
                        .map(([key, value]) => `${key.replaceAll("_", " ")}: ${value}`)
                        .join(" · ") || "—"}
                    </span>
                    <time className="tp-custody-time">{formatDate(entry.recorded_at)}</time>
                  </li>
                );
              })}
            </ol>
            <p className="tp-custody-caution">
              An intact chain shows these entries have not been altered since they
              were written. It does not show that the record is complete, and it
              does not independently establish who performed each action.
            </p>
          </>
        )}
      </section>

      {selected && (
        <div className="tp-overlay" onMouseDown={() => setSelected(null)}>
          <aside
            className="tp-drawer"
            role="dialog"
            aria-modal="true"
            aria-label="Evidence batch details"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <div className="tp-drawer-header">
              <div>
                <span>Evidence inspection</span>
                <h2>Batch details</h2>
                {statusFor(selected)}
              </div>
              <button
                onClick={() => setSelected(null)}
                aria-label="Close evidence details"
              >
                <X size={21} />
              </button>
            </div>

            <div className="tp-drawer-body">
              <h3>Collection metadata</h3>
              {[
                ["Batch ID", selected.batch_id],
                ["Source device", selected.device_id],
                ["Log type", selected.log_type],
                ["Records", selected.line_count],
                ["Received at", formatDate(selected.received_at)],
                ["Evidence file", selected.evidence_file],
              ].map(([label, value]) => (
                <div className="tp-detail" key={label}>
                  <span>{label}</span>
                  <strong>{value ?? "—"}</strong>
                </div>
              ))}

              <TrustScoreDetails result={scores[keyFor(selected)]} error={scoreError} />
            <h3>SHA-256 fingerprint</h3>
              <div className="tp-ev-hash">
                <code>{selected.sha256}</code>
                <button
                  aria-label="Copy SHA-256 hash"
                  title="Copy hash"
                  onClick={() => navigator.clipboard.writeText(selected.sha256)}
                >
                  <Copy size={17} />
                </button>
              </div>

              <button
                className="tp-button primary tp-ev-drawer-button"
                onClick={() => verify(selected)}
                disabled={verifying === keyFor(selected)}
              >
                <ShieldCheck size={17} />
                {verifying === keyFor(selected)
                  ? "Verifying…"
                  : "Verify integrity"}
              </button>

              {results[keyFor(selected)] && (
                <div className="tp-ev-result">
                  {results[keyFor(selected)].verified ? (
                    <CheckCircle2 size={19} />
                  ) : (
                    <AlertTriangle size={19} />
                  )}
                  <div>
                    <strong>
                      {results[keyFor(selected)].verified
                        ? "SHA-256 hashes match"
                        : "Integrity check did not pass"}
                    </strong>
                    <p>
                      {results[keyFor(selected)].verified
                        ? `Verified at ${formatDate(results[keyFor(selected)].verified_at)}`
                        : results[keyFor(selected)].detail ||
                          `Result: ${results[keyFor(selected)].status}`}
                    </p>
                    {results[keyFor(selected)].actual_sha256 && (
                      <p className="tp-ev-actual-hash">
                        Computed: {shortHash(results[keyFor(selected)].actual_sha256)}
                      </p>
                    )}
                  </div>
                </div>
              )}
            </div>
          </aside>
        </div>
      )}
    </div>
  );
}
