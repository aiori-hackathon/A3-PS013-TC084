import { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertTriangle, CircleSlash, Network, RefreshCw } from 'lucide-react';
import './styles/NetworkLab.css';

const PHASE_ORDER = ['normal', 'fault', 'recovered'];

function failureMessage(status) {
  if (status === 401) return 'Session expired. Please sign in again.';
  // A 404 here means the API being talked to has no network routes at all,
  // which is what you get pointing a dev server at a backend that predates
  // this feature — not a missing session.
  if (status === 404) {
    return 'This workspace API does not provide network sessions yet. '
      + 'The backend serving it needs the network investigation routes.';
  }
  return `Could not load network sessions (HTTP ${status}).`;
}

const NODE_W = 132;
const NODE_H = 88;
const VIEW_W = 860;
const VIEW_H = 262;

/** Hosts to the sides, switches down the middle. */
function layout(devices) {
  const centreX = VIEW_W / 2;
  const centreY = VIEW_H / 2 - 4;
  const hosts = devices.filter(d => d.type === 'host');
  const switches = devices.filter(d => d.type !== 'host');
  const position = {};

  switches.forEach((item, index) => {
    const span = (switches.length - 1) * 250;
    position[item.id] = { x: centreX - span / 2 + index * 250, y: centreY };
  });

  const half = Math.ceil(hosts.length / 2);
  hosts.forEach((host, index) => {
    const onLeft = index < half;
    const offset = onLeft ? index : index - half;
    const count = onLeft ? half : hosts.length - half;
    const top = centreY - ((count - 1) * 150) / 2;
    position[host.id] = { x: onLeft ? 112 : VIEW_W - 112, y: top + offset * 150 };
  });

  return position;
}

function deviceState(device) {
  const interfaces = device.interfaces || [];
  const anyDown = interfaces.some(i => i.operstate === 'DOWN');
  const anyUp = interfaces.some(i => i.operstate === 'UP');
  // Some interfaces down is degraded, not failed. Calling a switch DOWN
  // because one port dropped would blame the device for a link fault.
  if (interfaces.length && !anyUp && anyDown) return ['down', 'DOWN'];
  if (anyDown) return ['degraded', 'DEGRADED'];
  if (anyUp) return ['up', 'UP'];
  return ['idle', 'UNKNOWN'];
}

function DeviceGlyph({ type }) {
  if (type === 'host') {
    return (
      <g className="nl-glyph" transform="translate(-11,-8)">
        <rect x="0" y="0" width="22" height="15" rx="2" />
        <line x1="7" y1="19" x2="15" y2="19" />
      </g>
    );
  }
  return (
    <g className="nl-glyph" transform="translate(-11,-8)">
      <rect x="0" y="0" width="22" height="16" rx="2" />
      <line x1="5" y1="6" x2="17" y2="6" />
      <line x1="5" y1="11" x2="17" y2="11" />
    </g>
  );
}

function Topology({ topology }) {
  const devices = useMemo(() => topology?.devices || [], [topology]);
  const links = topology?.links || [];
  const position = useMemo(() => layout(devices), [devices]);

  if (!devices.length) {
    return (
      <div className="nl-empty">
        No topology was recorded for this observation.
      </div>
    );
  }

  return (
    <svg
      className="nl-topology"
      viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}
      preserveAspectRatio="xMidYMid meet"
      role="img"
      aria-label="Network topology for the selected phase"
    >
      {links.map(link => {
        const a = position[link.source_device];
        const b = position[link.target_device];
        if (!a || !b) return null;

        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const length = Math.hypot(dx, dy) || 1;
        const ux = dx / length;
        const uy = dy / length;
        const midX = (a.x + b.x) / 2;
        const midY = (a.y + b.y) / 2;
        const labelOffset = NODE_W / 2 + 24;
        const down = link.state === 'DOWN';
        const gap = 30;

        return (
          <g key={link.id}>
            {down ? (
              <>
                <line className="nl-link down" x1={a.x} y1={a.y} x2={midX - ux * gap} y2={midY - uy * gap} />
                <line className="nl-link down" x1={midX + ux * gap} y1={midY + uy * gap} x2={b.x} y2={b.y} />
                <g className="nl-break" transform={`translate(${midX},${midY})`}>
                  <line x1="-10" y1="-10" x2="10" y2="10" />
                  <line x1="10" y1="-10" x2="-10" y2="10" />
                </g>
                <text className="nl-downlabel" x={midX} y={midY - 26}>LINK DOWN</text>
              </>
            ) : (
              <>
                <line
                  className={`nl-link ${link.state === 'UP' ? 'up' : 'unknown'}`}
                  x1={a.x} y1={a.y} x2={b.x} y2={b.y}
                />
                {link.state === 'UP' && (
                  <line className="nl-flow" x1={a.x} y1={a.y} x2={b.x} y2={b.y} />
                )}
              </>
            )}
            <text
              className="nl-iflabel"
              x={a.x + ux * labelOffset + uy * 15}
              y={a.y + uy * labelOffset - ux * 15 + 4}
            >
              {link.source_interface}
            </text>
            <text
              className="nl-iflabel"
              x={b.x - ux * labelOffset + uy * 15}
              y={b.y - uy * labelOffset - ux * 15 + 4}
            >
              {link.target_interface}
            </text>
          </g>
        );
      })}

      {devices.map(device => {
        const point = position[device.id];
        if (!point) return null;
        const [tone, chip] = deviceState(device);
        const interfaces = device.interfaces || [];
        const address = interfaces.map(i => i.ip).filter(Boolean)[0];
        const ports = interfaces.map(i => i.port_number).filter(n => n !== undefined && n !== null);
        const caption = address || (ports.length ? `port ${ports.join(' / ')}` : '');

        return (
          <g key={device.id} className={`nl-node ${tone}`}>
            <circle className="nl-halo" cx={point.x} cy={point.y} r="58" />
            <g transform={`translate(${point.x - NODE_W / 2},${point.y - NODE_H / 2})`}>
              <rect className="nl-box" width={NODE_W} height={NODE_H} rx="3" />
              <g transform={`translate(${NODE_W / 2},26)`}>
                <DeviceGlyph type={device.type} />
              </g>
              <text className="nl-name" x={NODE_W / 2} y="62">{device.name}</text>
              <text className="nl-chip" x={NODE_W / 2} y="78">{chip}</text>
            </g>
            {caption && (
              <text className="nl-caption" x={point.x} y={point.y + NODE_H / 2 + 20}>{caption}</text>
            )}
          </g>
        );
      })}
    </svg>
  );
}

function EvidenceList({ title, items, tone }) {
  if (!items || !items.length) return null;
  return (
    <>
      <div className="nl-evhead">{title}</div>
      {items.map((item, index) => (
        <div className={`nl-ev ${tone}`} key={`${tone}-${index}`}>{item}</div>
      ))}
    </>
  );
}

function Hypothesis({ hypothesis }) {
  const level = (hypothesis.confidence || '').toLowerCase();
  return (
    <div className="nl-hyp">
      <div className="nl-hyp-head">
        <span className="nl-hyp-name">{hypothesis.hypothesis}</span>
        <span className={`nl-badge ${level}`}>{hypothesis.confidence}</span>
        <span className="nl-badge">{hypothesis.status}</span>
      </div>
      <EvidenceList title="Supporting evidence" items={hypothesis.supporting_evidence} tone="support" />
      <EvidenceList title="Contradicting evidence" items={hypothesis.contradicting_evidence} tone="against" />
      <EvidenceList title="Missing evidence" items={hypothesis.missing_evidence} tone="missing" />
      <EvidenceList title="Suggested verification" items={hypothesis.verification_steps} tone="verify" />
    </div>
  );
}

export default function NetworkLab() {
  const [sessions, setSessions] = useState([]);
  const [selected, setSelected] = useState(null);
  const [detail, setDetail] = useState(null);
  const [phase, setPhase] = useState('fault');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  // No state is set before the first await: this runs from an effect, and a
  // synchronous setState there cascades an extra render. The Refresh button
  // sets the pending state itself, where doing so is an event, not an effect.
  const loadSessions = useCallback(async () => {
    try {
      const response = await fetch('/api/v1/network/sessions', { credentials: 'same-origin' });
      if (!response.ok) throw new Error(failureMessage(response.status));
      const data = await response.json();
      const items = data.sessions || [];
      setSessions(items);
      setSelected(current => current || items[0]?.session_id || null);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  // The first load is inlined rather than calling loadSessions, so no state
  // is set synchronously from the effect body.
  useEffect(() => {
    let active = true;
    fetch('/api/v1/network/sessions', { credentials: 'same-origin' })
      .then(async response => {
        if (!response.ok) throw new Error(failureMessage(response.status));
        return response.json();
      })
      .then(data => {
        if (!active) return;
        const items = data.sessions || [];
        setSessions(items);
        setSelected(current => current || items[0]?.session_id || null);
        setLoading(false);
      })
      .catch(err => {
        if (!active) return;
        setError(err.message);
        setLoading(false);
      });
    return () => { active = false; };
  }, []);

  // Clearing the previous session is the click handler's job, not this
  // effect's: setting state synchronously here would cascade a second
  // render on every selection.
  useEffect(() => {
    if (!selected) return undefined;
    let active = true;
    fetch(`/api/v1/network/sessions/${encodeURIComponent(selected)}`, { credentials: 'same-origin' })
      .then(async response => {
        if (!response.ok) throw new Error(`Could not open this session (HTTP ${response.status}).`);
        return response.json();
      })
      .then(data => {
        if (!active) return;
        setDetail(data);
        const phases = (data.observations || []).map(o => o.phase);
        setPhase(phases.includes('fault') ? 'fault' : phases[0] || 'normal');
      })
      .catch(err => { if (active) setError(err.message); });
    return () => { active = false; };
  }, [selected]);

  const observations = detail?.observations || [];
  const observation = observations.find(o => o.phase === phase) || observations[0];
  const rca = detail?.rca;
  const phases = PHASE_ORDER.filter(name => observations.some(o => o.phase === name));

  return (
    <div className="nl-root">
      <div className="nl-intro">
        <Network size={20} />
        <p>
          Network investigation sessions collected by a monitoring agent. Topology,
          interface state and packet loss are recorded as observations;
          root-cause findings are derived from that evidence on every read and are
          never stored alongside it.
        </p>
      </div>

      {error && <div className="tp-error" role="alert">{error}</div>}

      <div className="nl-sessionbar">
        <h3>Investigation sessions</h3>
        <button
          type="button"
          className="tp-button"
          disabled={loading}
          onClick={() => { setLoading(true); setError(''); loadSessions(); }}
        >
          <RefreshCw size={16} className={loading ? 'tp-spin' : ''} /> Refresh
        </button>
      </div>

      {loading && !sessions.length && <div className="nl-empty">Loading sessions…</div>}

      {!loading && !sessions.length && !error && (
        <div className="nl-empty">
          <CircleSlash size={18} />
          <span>
            No network sessions have been collected yet. A monitoring agent posts
            them to <code>/api/v1/network/ingest</code>.
          </span>
        </div>
      )}

      {sessions.length > 0 && (
        <div className="nl-sessions">
          {sessions.map(item => (
            <button
              type="button"
              key={item.session_id}
              className={`nl-session ${item.session_id === selected ? 'selected' : ''}`}
              onClick={() => { setDetail(null); setSelected(item.session_id); }}
            >
              <span className="nl-session-id">{item.session_id}</span>
              <span className="nl-session-meta">{item.device_id}</span>
              <span className="nl-session-meta">
                {item.observations} observations · {(item.phases || []).join(' / ').toUpperCase()}
              </span>
              {!item.topology_available && (
                <span className="nl-session-warn"><AlertTriangle size={12} /> no topology</span>
              )}
            </button>
          ))}
        </div>
      )}

      {selected && detail && (
        <>
          <div className="nl-phasebar">
            {phases.map(name => (
              <button
                type="button"
                key={name}
                className={`nl-phase ${name} ${name === phase ? 'selected' : ''}`}
                onClick={() => setPhase(name)}
              >
                {name.toUpperCase()}
              </button>
            ))}
            {observation && (
              <span className="nl-phase-detail">
                packet loss {observation.packet_loss_percent ?? '—'}% · {observation.timestamp_utc}
              </span>
            )}
          </div>

          <Topology topology={observation?.topology} />

          <div className="nl-rca">
            <h3>Root-cause analysis</h3>
            <p className="nl-note">
              Observed facts are supported directly by collected evidence. Hypotheses
              are proposed explanations that require verification. No hypothesis below
              is a confirmed cause.
            </p>

            {!rca?.topology_available ? (
              <>
                <div className="nl-empty">
                  Topology-aware analysis is not available for this session.
                </div>
                {(rca?.limitations || []).map((item, index) => (
                  <div className="nl-limit" key={index}>{item}</div>
                ))}
              </>
            ) : (
              <>
                <div className="nl-section">
                  <div className="nl-evhead">Fault localisation</div>
                  <div className="nl-line">
                    Affected: {(rca.fault_localisation?.affected_links || []).join(', ') || 'none'}
                  </div>
                  <div className="nl-line">
                    Unaffected: {(rca.fault_localisation?.unaffected_links || []).join(', ') || 'none'}
                  </div>
                </div>

                {rca.observed_facts?.length > 0 && (
                  <div className="nl-section">
                    <div className="nl-evhead">Observed facts</div>
                    {rca.observed_facts.map((fact, index) => (
                      <div className="nl-line" key={index}>{fact}</div>
                    ))}
                  </div>
                )}

                {rca.impact && (
                  <div className="nl-section">
                    <div className="nl-evhead">Impact</div>
                    {(rca.impact.unreachable_host_pairs || []).map((pair, index) => (
                      <div className="nl-line" key={`pair-${index}`}>No path between {pair.join(' and ')}.</div>
                    ))}
                    {(rca.impact.severed_hosts || []).map(host => (
                      <div className="nl-line" key={`sev-${host}`}>{host} — all own interfaces DOWN (at the fault).</div>
                    ))}
                    {(rca.impact.stranded_hosts || []).map(host => (
                      <div className="nl-line" key={`str-${host}`}>{host} — interfaces UP but cut off by a fault elsewhere.</div>
                    ))}
                  </div>
                )}

                <div className="nl-section">
                  <div className="nl-evhead">Ranked hypotheses — none confirmed</div>
                  {(rca.hypotheses || []).map((item, index) => (
                    <Hypothesis hypothesis={item} key={index} />
                  ))}
                </div>

                {rca.recovery?.assessment && (
                  <div className="nl-section">
                    <div className="nl-evhead">Recovery verification</div>
                    <div className="nl-line">{rca.recovery.assessment}</div>
                  </div>
                )}

                <div className="nl-section">
                  <div className="nl-evhead">Investigation limitations</div>
                  {(rca.limitations || []).map((item, index) => (
                    <div className="nl-limit" key={index}>{item}</div>
                  ))}
                </div>
              </>
            )}
          </div>
        </>
      )}
    </div>
  );
}
