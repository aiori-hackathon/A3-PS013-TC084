import { useEffect, useState } from 'react';

export function useEvidenceTrustScores(refreshSignal = 0) {
  const [scores, setScores] = useState({});
  const [scoreError, setScoreError] = useState('');
  useEffect(() => {
    let active = true;
    fetch('/api/v1/evidence/trust-scores', { credentials: 'same-origin' })
      .then(async response => { if (!response.ok) throw new Error(`Trust score API returned ${response.status}`); return response.json(); })
      .then(data => { if (active) setScores(Object.fromEntries((data.items || []).map(item => [`${item.device_id}/${item.batch_id}`, item]))); })
      .catch(error => { if (active) setScoreError(error.message); });
    return () => { active = false; };
  }, [refreshSignal]);
  return { scores, scoreError };
}
