'use client';
import { useState, useEffect, useCallback, useRef, type SetStateAction } from 'react';
import { api } from './api';

/**
 * The last response for each path. A page opened again shows it at once and refreshes it in the
 * background, so moving between portal tabs does not start from an empty screen.
 */
const cache = new Map<string, unknown>();
/** Requests under way, so components asking for the same path share one. */
const inflight = new Map<string, Promise<unknown>>();
/** Bumped when the cache is cleared; a response from before that is not stored. */
let generation = 0;
const CACHE_LIMIT = 80;

/** Forgets every cached response. Called when the signed-in user changes. */
export function clearDataCache() {
  cache.clear();
  inflight.clear();
  generation++;
}
function remember(path: string, value: unknown) {
  cache.delete(path);
  cache.set(path, value);
  // Paths with rolling time windows never repeat, so the oldest entries are dropped.
  if (cache.size > CACHE_LIMIT) cache.delete(cache.keys().next().value!);
}
/** Fetches a path. `fresh` skips a request already under way, which may predate a change. */
function load<T>(path: string, fresh: boolean): Promise<T> {
  const running = inflight.get(path);
  if (running && !fresh) return running as Promise<T>;
  const started = generation;
  const request = api<T>(path)
    .then((value) => {
      if (started === generation) remember(path, value);
      return value;
    })
    .finally(() => {
      if (inflight.get(path) === request) inflight.delete(path);
    });
  inflight.set(path, request);
  return request;
}

/**
 * Fetches `path`, polling every `poll` ms while the browser tab is visible. `loading` is true on the
 * first load and whenever `key` changes (a new filter), but not for background polls, `refresh()`
 * once data is on screen, or a path whose last response is cached.
 * `key` defaults to the path; pass a steadier key (e.g. from `useRange`) when the path also
 * changes on its own, such as a rolling "last 24 hours" window.
 */
export function useData<T>(path: string | null, poll = 0, key: string | null = path) {
  const [data, setState] = useState<T | null>(() => (path ? ((cache.get(path) as T) ?? null) : null));
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(!!path && !cache.has(path));
  const [version, setVersion] = useState(0);
  const fresh = useRef(false);
  const refresh = useCallback(() => {
    fresh.current = true;
    setVersion((n) => n + 1);
  }, []);
  /** Changes the data on screen, e.g. for an optimistic update, and what a reopened page shows. */
  const setData = useCallback(
    (value: SetStateAction<T | null>) =>
      setState((previous) => {
        const next = typeof value === 'function' ? (value as (p: T | null) => T | null)(previous) : value;
        if (path && next != null) remember(path, next);
        return next;
      }),
    [path],
  );
  const shown = useRef<{ key: string | null; has: boolean }>({
    key,
    has: !!path && cache.has(path),
  });
  useEffect(() => {
    if (!path) {
      setLoading(false);
      return;
    }
    let alive = true;
    if (cache.has(path)) {
      setState(cache.get(path) as T);
      setLoading(false);
      shown.current = { key, has: true };
    } else if (!shown.current.has || shown.current.key !== key) setLoading(true);
    async function fetchData(force = false) {
      try {
        const d = await load<T>(path!, force);
        if (alive) {
          setState(d);
          setError('');
          shown.current = { key, has: true };
        }
      } catch (e) {
        if (alive) setError((e as Error).message);
      } finally {
        if (alive) setLoading(false);
      }
    }
    fetchData(fresh.current);
    fresh.current = false;
    if (!poll)
      return () => {
        alive = false;
      };
    // A hidden tab does not poll; it catches up as soon as it is looked at again.
    const timer = setInterval(() => {
      if (!document.hidden) fetchData();
    }, poll);
    const onVisible = () => {
      if (!document.hidden) fetchData();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      alive = false;
      clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisible);
    };
    // `key` only decides whether a fetch shows as loading; `path` drives the fetch itself.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path, version, poll]);
  return { data, setData, error, loading, refresh };
}
