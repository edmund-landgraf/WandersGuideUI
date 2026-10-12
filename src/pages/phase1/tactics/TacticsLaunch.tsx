import { useEffect, useState } from 'react';

const OLLAMA_TAGS = 'http://127.0.0.1:11434/api/tags';

export function useOllamaUp(): boolean {
  const [up, setUp] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    void fetch(OLLAMA_TAGS, { signal: controller.signal })
      .then((response) => setUp(response.ok))
      .catch(() => setUp(false));
    return () => controller.abort();
  }, []);
  return up;
}

export function TacticsLaunchButton({ campaignId, encounterId }: { campaignId: number; encounterId: number }) {
  const up = useOllamaUp();
  if (!up) return null;
  return (
    <button
      type='button'
      className='toolbar-button'
      title='Open the GM tactics window'
      onClick={() => {
        window.open(`/tactics/${campaignId}/${encounterId}`, '_blank', 'noopener');
      }}
    >
      Launch
    </button>
  );
}
