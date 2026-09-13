'use client';
import { useState, useEffect, useCallback } from 'react';
import { api } from './api';
export function useData<T>(path: string | null, poll = 0) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(!!path);
  const [version, setVersion] = useState(0);
  const refresh = useCallback(() => setVersion((n) => n + 1), []);
  useEffect(() => {
    if (!path) {
      setLoading(false);
      return;
    }
    let alive = true;
    setLoading(true);
    async function fetchData() {
      try {
        const d = await api<T>(path!);
        if (alive) {
          setData(d);
          setError('');
        }
      } catch (e) {
        if (alive) setError((e as Error).message);
      } finally {
        if (alive) setLoading(false);
      }
    }
    fetchData();
    const timer = poll ? setInterval(fetchData, poll) : null;
    return () => {
      alive = false;
      if (timer) clearInterval(timer);
    };
  }, [path, version, poll]);
  return { data, setData, error, loading, refresh };
}
