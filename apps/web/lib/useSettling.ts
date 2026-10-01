'use client';
import { useEffect, useRef, useState } from 'react';
/**
 * True for `ms` after `key` changes (not on first render). Filters that run on data already in the
 * browser use it to show the same loading placeholders as a server fetch, so a change is visible and
 * typing in a search box settles before results jump around.
 */
export function useSettling(key: string, ms = 150) {
  const [settling, setSettling] = useState(false);
  const last = useRef(key);
  useEffect(() => {
    if (last.current === key) return;
    last.current = key;
    setSettling(true);
    const t = setTimeout(() => setSettling(false), ms);
    return () => clearTimeout(t);
  }, [key, ms]);
  return settling;
}
