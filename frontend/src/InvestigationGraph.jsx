import { useEvidenceTrustScores } from './useEvidenceTrustScores';
import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { Activity, AlertTriangle, ArrowRight, Fingerprint, GitBranch, RefreshCw, ShieldAlert, ChevronDown, ChevronUp, Database, CheckCircle2 } from 'lucide-react';
import './styles/InvestigationGraph.css';
import './styles/investigations.css';
import './styles/TracepointInteractionPolish.css';

const EMPTY_GRAPH_LIST = [];
import { TrustScoreDetails } from './EvidenceTrustScore'; // GRAPH_TRUST_SCORE_V1


function AnimatedMetricCount({ value }) {
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

export default function InvestigationGraph() {
  const pageTheme = document.querySelector('.tp-app')?.getAttribute('data-theme') || 'light'; // TRACEPOINT_GRAPH_PORTAL_THEME_V3
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState(null);
  const [edgeLimit, setEdgeLimit] = useState(10);
  const [gapLimit, setGapLimit] = useState(10);
  const { scores: trustScores, scoreError: trustScoreError } = useEvidenceTrustScores();
  async function load() {
    setLoading(true);
    setError('');
    try {
      const response = await fetch('/api/v1/graph', { credentials: 'same-origin' });
      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        throw new Error(typeof body.detail === 'string' ? body.detail : `Unable to load graph (${response.status})`);
      }
      const body = await response.json();
      setData({ nodes: Array.isArray(body.nodes) ? body.nodes : [], edges: Array.isArray(body.edges) ? body.edges : [], truncated: !!body.truncated });
    } catch (err) {
      setError(err.message || 'Unable to load graph');
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    let active = true;

    fetch('/api/v1/graph', { credentials: 'same-origin' })
      .then(async response => {
        if (!response.ok) {
          const body = await response.json().catch(() => ({}));
          throw new Error(typeof body.detail === 'string' ? body.detail : `Unable to load graph (${response.status})`);
        }
        return response.json();
      })
      .then(body => {
        if (active) {
          setData({
            nodes: Array.isArray(body.nodes) ? body.nodes : [],
            edges: Array.isArray(body.edges) ? body.edges : [],
            truncated: !!body.truncated
          });
        }
      })
      .catch(err => {
        if (active) setError(err.message || 'Unable to load graph');
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, []);
  const nodes = data?.nodes || EMPTY_GRAPH_LIST;
  const edges = data?.edges || EMPTY_GRAPH_LIST;
  const lookup = useMemo(
    () => new Map(nodes.map(node => [node.id, node])),
    [nodes]
  );

  const gaps = nodes.filter(node => node.parse_status === 'partial' || !node.timestamp_utc);
  return <section className="tp-graph-root tp-graph-phase5">
    {error && <div className="tp-error" role="alert">{error}</div>}

    <div className="tp-graph-stats tp-scroll-reveal tp-stagger-parent">
      <div className="tp-card tp-stat-card tp-stat-emerald" title="Evidence-linked event count">
        <div className="tp-stat-glow-bar bar-emerald" />
        <div className="tp-stat-top">
          <span className="tp-stat-label">Evidence-Linked Events</span>
          <div className="tp-stat-icon-wrap icon-emerald">
            <Fingerprint size={18} />
          </div>
        </div>
        <div className="tp-stat-middle">
          <strong className="tp-stat-value">
            <AnimatedMetricCount value={nodes.length} />
          </strong>
          <span className="tp-stat-badge badge-emerald">
            <span className="tp-stat-pulse-dot dot-emerald" />
            INDEXED
          </span>
        </div>
        <small className="tp-stat-hint">Event records in loaded graph</small>
      </div>

      <div className="tp-card tp-stat-card tp-stat-cyan" title="Potential connections">
        <div className="tp-stat-glow-bar bar-cyan" />
        <div className="tp-stat-top">
          <span className="tp-stat-label">Potential Connections</span>
          <div className="tp-stat-icon-wrap icon-cyan">
            <GitBranch size={18} />
          </div>
        </div>
        <div className="tp-stat-middle">
          <strong className="tp-stat-value">
            <AnimatedMetricCount value={edges.length} />
          </strong>
          <span className="tp-stat-badge badge-cyan">
            <span className="tp-stat-pulse-dot dot-cyan" />
            CORRELATED
          </span>
        </div>
        <small className="tp-stat-hint">Inferred sequence relationships</small>
      </div>

      <div className="tp-card tp-stat-card tp-stat-violet" title="Parsing or timestamp gaps">
        <div className="tp-stat-glow-bar bar-violet" />
        <div className="tp-stat-top">
          <span className="tp-stat-label">Parsing & Timing Gaps</span>
          <div className="tp-stat-icon-wrap icon-violet">
            <AlertTriangle size={18} />
          </div>
        </div>
        <div className="tp-stat-middle">
          <strong className="tp-stat-value">
            <AnimatedMetricCount value={gaps.length} />
          </strong>
          <span className="tp-stat-badge badge-violet">
            <span className="tp-stat-pulse-dot dot-violet" />
            REVIEW NEEDED
          </span>
        </div>
        <small className="tp-stat-hint">Partial parse or missing timestamp</small>
      </div>
    </div>

    <div className="tp-card tp-ev-card tp-graph-panel tp-graph-phase5-panel tp-scroll-reveal">
      <div className="tp-card-head">
        <div>
          <h3>Authentication sequences</h3>
          <p>Failed logins followed by successful logins for the same username within 30 minutes.</p>
        </div>
        <span className="tp-graph-legend"><i/> Tentative cross-device link</span>
      </div>
      {!loading && !edges.length && (
        <div className="tp-graph-empty">
          <img src="/icons/3d/error-folder.png" alt="" className="tp-3d-empty-icon" aria-hidden="true" />
          <strong>No correlated authentication sequences found</strong>
          <p>Try ingesting a sequence of failed and successful logins for the same user with valid timestamps.</p>
        </div>
      )}
      <div className="tp-graph-sequences">{edges.slice(0, edgeLimit).map((edge, index) => {
        const source = lookup.get(edge.source), target = lookup.get(edge.target);
        if (!source || !target) return null;
        return <div className="tp-graph-sequence" key={`${edge.source}-${edge.target}-${index}`}>
          <button
            className="tp-graph-node failure"
            aria-label={`Inspect failed authentication for ${source.username || 'unknown user'}`}
            onClick={() => setSelected(source)}
          ><span>Failed authentication</span><strong>{source.username || 'Unknown user'}</strong><small>{source.device_id} · {source.timestamp_utc || source.timestamp}</small></button>
          <div className={`tp-graph-edge ${edge.confidence === 'tentative' ? 'tentative' : ''}`} title={edge.reason}><ArrowRight size={21}/><span>{edge.confidence === 'tentative' ? 'Tentative' : 'Same device'}</span></div>
          <button
            className="tp-graph-node success"
            aria-label={`Inspect successful login for ${target.username || 'unknown user'}`}
            onClick={() => setSelected(target)}
          ><span>Successful login</span><strong>{target.username || 'Unknown user'}</strong><small>{target.device_id} · {target.timestamp_utc || target.timestamp}</small></button>
          <p className="tp-graph-reason">{edge.reason}</p>
        </div>;
      })}</div>

      {edges.length > 10 && (
        <div className="tp-see-more-bar" role="navigation" aria-label="Authentication sequences pagination controls">
          <div className="tp-see-more-actions">
            <button
              type="button"
              className="tp-button tp-see-more-btn"
              onClick={() => setEdgeLimit(prev => prev >= edges.length ? 10 : prev + 10)}
            >
              {edgeLimit >= edges.length ? (
                <>
                  <ChevronUp size={15} /> Show fewer sequences
                </>
              ) : (
                <>
                  <ChevronDown size={15} /> See more (+{Math.min(10, edges.length - edgeLimit)})
                </>
              )}
            </button>
            {edgeLimit < edges.length && edges.length - edgeLimit > 10 && (
              <button
                type="button"
                className="tp-button tp-see-all-btn"
                onClick={() => setEdgeLimit(edges.length)}
              >
                See all ({edges.length})
              </button>
            )}
            {edgeLimit > 10 && edgeLimit < edges.length && (
              <button
                type="button"
                className="tp-button tp-show-less-btn"
                onClick={() => setEdgeLimit(10)}
              >
                <ChevronUp size={15} /> Show 10
              </button>
            )}
          </div>
          <span className="tp-see-more-count">
            Showing {Math.min(edgeLimit, edges.length)} of {edges.length} authentication sequences
          </span>
        </div>
      )}
    </div>

    <div className="tp-card tp-ev-card tp-graph-gaps tp-graph-phase5-gaps tp-scroll-reveal">
      <div className="tp-card-head" style={{ padding: '0 0 16px' }}>
        <div>
          <h3>
            <img src="/icons/3d/document-error.png" alt="" className="tp-3d-heading-icon" aria-hidden="true" />
            Evidence requiring review
          </h3>
          <p>Incomplete or un-timestamped events are preserved but cannot establish reliable temporal connections.</p>
        </div>
      </div>
      {gaps.length ? gaps.slice(0, gapLimit).map(node => <button key={node.id} onClick={() => setSelected(node)}><span>{node.device_id} · line {node.line_number}</span><small>{(node.parse_warnings || []).join(', ') || 'Timestamp unavailable'}</small><ArrowRight size={15}/></button>) : <div className="tp-graph-no-gaps">No parsing or timestamp gaps among loaded events.</div>}

      {gaps.length > 10 && (
        <div className="tp-see-more-bar" role="navigation" aria-label="Review gaps pagination controls" style={{ margin: '14px -22px -22px' }}>
          <div className="tp-see-more-actions">
            <button
              type="button"
              className="tp-button tp-see-more-btn"
              onClick={() => setGapLimit(prev => prev >= gaps.length ? 10 : prev + 10)}
            >
              {gapLimit >= gaps.length ? (
                <>
                  <ChevronUp size={15} /> Show fewer items
                </>
              ) : (
                <>
                  <ChevronDown size={15} /> See more (+{Math.min(10, gaps.length - gapLimit)})
                </>
              )}
            </button>
            {gapLimit < gaps.length && gaps.length - gapLimit > 10 && (
              <button
                type="button"
                className="tp-button tp-see-all-btn"
                onClick={() => setGapLimit(gaps.length)}
              >
                See all ({gaps.length})
              </button>
            )}
            {gapLimit > 10 && gapLimit < gaps.length && (
              <button
                type="button"
                className="tp-button tp-show-less-btn"
                onClick={() => setGapLimit(10)}
              >
                <ChevronUp size={15} /> Show 10
              </button>
            )}
          </div>
          <span className="tp-see-more-count">
            Showing {Math.min(gapLimit, gaps.length)} of {gaps.length} review items
          </span>
        </div>
      )}
    </div>

    {data?.truncated && <p className="tp-graph-caution">Graph limited to the first 1,500 timeline events. Results are not exhaustive.</p>}
    <p className="tp-graph-caution">Correlations are investigative leads, not proof of compromise. No AI is used.</p>
    {selected && createPortal(<div className="tp-overlay tp-graph-modal-overlay" data-theme={pageTheme} onMouseDown={() => setSelected(null)}><aside className="tp-drawer tp-graph-event-modal" role="dialog" aria-modal="true" aria-label="Graph event details" onMouseDown={e => e.stopPropagation()}><div className="tp-drawer-header"><div><span>Evidence-linked event</span><h2>{(selected.event_type || 'Unknown event').replaceAll('_', ' ')}</h2></div><button onClick={() => setSelected(null)} aria-label="Close details">✕</button></div><div className="tp-drawer-body"><h3><Fingerprint size={16}/> Evidence reference</h3>{[['Device', selected.device_id], ['Batch ID', selected.batch_id], ['Line number', selected.line_number], ['UTC timestamp', selected.timestamp_utc || 'Unavailable'], ['Username', selected.username || 'Unavailable'], ['Parse status', selected.parse_status || 'Unknown']].map(([label, value]) => <div className="tp-detail" key={label}><span>{label}</span><strong>{value}</strong></div>)}<TrustScoreDetails
      result={trustScores[`${selected.device_id}/${selected.batch_id}`]}
      error={trustScoreError}
    /><h3>Original log</h3><pre>{selected.raw_log || 'No raw log available'}</pre>{selected.parse_warnings?.length > 0 && <p className="tp-graph-caution">Warnings: {selected.parse_warnings.join('; ')}</p>}</div></aside></div>, document.body)}
  </section>;
}
