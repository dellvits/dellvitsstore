'use client';
import { useEffect, useRef } from 'react';
import { usePathname } from 'next/navigation';

/** The Meta Pixel counts the first page itself; this reports each later page change in the app. */
export default function PixelPageViews() {
  const path = usePathname();
  const first = useRef(true);
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    (window as { fbq?: (...args: unknown[]) => void }).fbq?.('track', 'PageView');
  }, [path]);
  return null;
}
