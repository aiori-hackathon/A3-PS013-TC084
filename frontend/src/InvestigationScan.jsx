import './styles/InvestigationScan.css';

/* The four stages are not decoration. They name operations that
   ask_about_investigation in backend/app/assistant.py genuinely performs, in
   the order it performs them:

     collect    get_linked_events() resolves this case's linked references
     correlate  the events are sorted by timestamp to order the incident
     integrity  each reference is checked against the stored evidence, and one
                that no longer resolves is dropped rather than answered from
     timeline   stable evidence IDs (E1..En) are assigned across that ordering

   All four run inside one request, so the browser cannot watch them finish
   one by one. That is why nothing here reports a stage as complete while the
   request is still in flight: a stage reads "working" until the response comes
   back, and only then resolves to what the response actually confirms. */
export const SCAN_STAGES = [
  { id: 'collect', slot: 'tl', label: 'Collecting related events' },
  { id: 'correlate', slot: 'tr', label: 'Correlating timestamps' },
  { id: 'integrity', slot: 'bl', label: 'Checking evidence integrity' },
  { id: 'timeline', slot: 'br', label: 'Building incident timeline' },
];

/* Opening a case is a different piece of work, so it gets its own stages
   rather than borrowing the assistant's. These four are what
   create_investigation in backend/app/investigations.py actually does, in the
   order it does them:

     current_user_id(request)   resolves the session to an account
     CreateInvestigation(...)   validates title, description and severity
     INSERT INTO investigations writes the case row
     get_owned_case(...)        reads it back, scoped to the owner

   It is a short operation - a single insert - so this is on screen briefly.
   It is not padded to look like more work than it is. */
export const CREATE_STAGES = [
  { id: 'auth', slot: 'tl', label: 'Authenticating analyst' },
  { id: 'validate', slot: 'tr', label: 'Validating case details' },
  { id: 'record', slot: 'bl', label: 'Opening case record' },
  { id: 'confirm', slot: 'br', label: 'Confirming ownership' },
];

const NOTE = {
  working: 'working',
  done: 'confirmed',
  empty: 'no evidence resolved',
  failed: 'did not complete',
};

/* Read the four outcomes off the real response. The assistant returns sources
   only when linked references resolved against stored evidence, so an empty
   sources array means the first three stages found nothing to work on - it
   does not mean they succeeded quietly. */
export function stagesFromResult(result) {
  const resolved = (result?.sources || []).length > 0;
  const answered = Boolean(result?.answer);
  const found = resolved ? 'done' : 'empty';
  return {
    collect: found,
    correlate: found,
    integrity: found,
    timeline: answered ? 'done' : 'failed',
  };
}

export const STAGES_WORKING = Object.fromEntries(SCAN_STAGES.map(s => [s.id, 'working']));
export const STAGES_FAILED = Object.fromEntries(SCAN_STAGES.map(s => [s.id, 'failed']));
export const CREATE_WORKING = Object.fromEntries(CREATE_STAGES.map(s => [s.id, 'working']));
export const CREATE_FAILED = Object.fromEntries(CREATE_STAGES.map(s => [s.id, 'failed']));
export const CREATE_DONE = Object.fromEntries(CREATE_STAGES.map(s => [s.id, 'done']));

export default function InvestigationScan({ states = STAGES_WORKING, stages = SCAN_STAGES }) {
  const settled = stages.every(s => states[s.id] && states[s.id] !== 'working');

  return (
    <div className="tp-scan" role="status" aria-live="polite" data-settled={settled || undefined}>
      {/* One sentence for anyone listening rather than looking. The radar
          itself carries no information a screen reader needs. */}
      <p className="tp-scan-sr">
        {settled
          ? stages.map(s => `${s.label}: ${NOTE[states[s.id]] || 'unknown'}`).join('. ')
          : 'Reviewing linked evidence. Four checks are running.'}
      </p>

      <div className="tp-scan-field" aria-hidden="true">
        <svg className="tp-scan-radar" viewBox="0 0 200 200">
          <circle className="tp-scan-ring" cx="100" cy="100" r="86" />
          <circle className="tp-scan-ring" cx="100" cy="100" r="58" />
          <circle className="tp-scan-ring" cx="100" cy="100" r="30" />
          <line className="tp-scan-cross" x1="100" y1="8" x2="100" y2="192" />
          <line className="tp-scan-cross" x1="8" y1="100" x2="192" y2="100" />

          <g className="tp-scan-sweep">
            <defs>
              <linearGradient id="tp-scan-wedge" x1="0" y1="0" x2="1" y2="0">
                <stop offset="0%" stopColor="var(--fx-signal)" stopOpacity="0.38" />
                <stop offset="100%" stopColor="var(--fx-signal)" stopOpacity="0" />
              </linearGradient>
            </defs>
            <path d="M100 100 L186 100 A86 86 0 0 0 139 25 Z" fill="url(#tp-scan-wedge)" />
            <line x1="100" y1="100" x2="186" y2="100" className="tp-scan-beam" />
          </g>

          <circle className="tp-scan-core" cx="100" cy="100" r="4" />
        </svg>

        {stages.map((stage, index) => (
          <span
            key={`signal-${stage.id}`}
            className="tp-scan-signal"
            data-slot={stage.slot}
            data-state={states[stage.id] || 'working'}
            style={{ '--tp-scan-order': index }}
          />
        ))}

        {stages.map((stage, index) => (
          <figure
            key={stage.id}
            className="tp-scan-label"
            data-slot={stage.slot}
            data-state={states[stage.id] || 'working'}
            style={{ '--tp-scan-order': index }}
          >
            <figcaption className="tp-scan-label-text">{stage.label}</figcaption>
            <span className="tp-scan-label-note">{NOTE[states[stage.id]] || 'working'}</span>
          </figure>
        ))}
      </div>
    </div>
  );
}
