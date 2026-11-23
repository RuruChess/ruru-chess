import { useEffect, useState } from 'react';
import { api } from '../api.ts';

/** Ανανέωση όσο η καρτέλα φαίνεται (και το παράθυρο δεν είναι κρυμμένο)· error = κωδικός του server (βλ. liveError). */
export function usePoll<T>(url: string | null, every: number, active: boolean): { data: T | null; error: string | null; reload: () => void } {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [seq, setSeq] = useState(0);
  useEffect(() => {
    if (!url || !active) return;
    let stop = false;
    const load = () => {
      if (document.hidden) return;
      api
        .get<T>(url)
        .then((d) => {
          if (stop) return;
          setData(d);
          setError(null);
        })
        .catch((e) => !stop && setError((e as Error)?.message ?? 'net'));
    };
    load();
    const t = setInterval(load, every);
    const vis = () => !document.hidden && load();
    document.addEventListener('visibilitychange', vis);
    return () => {
      stop = true;
      clearInterval(t);
      document.removeEventListener('visibilitychange', vis);
    };
  }, [url, every, active, seq]);
  return { data, error, reload: () => setSeq((x) => x + 1) };
}
