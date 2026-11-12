export const SCAN_STAGES = [
  { id: 'collect', slot: 'tl', label: 'Collecting related events' },
  { id: 'correlate', slot: 'tr', label: 'Correlating timestamps' },
  { id: 'integrity', slot: 'bl', label: 'Checking evidence integrity' },
  { id: 'timeline', slot: 'br', label: 'Building incident timeline' },
];

export const CREATE_STAGES = [
  { id: 'auth', slot: 'tl', label: 'Authenticating analyst' },
  { id: 'validate', slot: 'tr', label: 'Validating case details' },
  { id: 'record', slot: 'bl', label: 'Opening case record' },
  { id: 'confirm', slot: 'br', label: 'Confirming ownership' },
];

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
