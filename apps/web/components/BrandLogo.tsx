'use client';
import { useId, type CSSProperties } from 'react';
import { logoBox, logoLayers as L } from '@/lib/logoPaths';

/** The height of the logo box without the tagline: just below the arrow. */
const markHeight = 915;
/** How soft the arrow's leading edge is while it draws, in logo units. */
const feather = 140;

/**
 * The Dellvit wordmark as vector shapes, sharp at any size; the app draws the same ones.
 * With `animate`, it plays the launch intro: the name fades in, the leaves pop up, the arrow draws
 * itself from left to right and the tagline rises in last. The animation lives in globals.css.
 */
export function AnimatedLogo({
  className = '',
  tagline = true,
  animate = true,
}: {
  className?: string;
  tagline?: boolean;
  animate?: boolean;
}) {
  const id = useId().replace(/:/g, '');
  const a = L.arrow.box;
  const sweep = a.width + feather;
  return (
    <svg
      className={`brand-logo${animate ? ' is-animated' : ''} ${className}`}
      viewBox={`0 0 ${logoBox.width} ${tagline ? logoBox.height : markHeight}`}
      role="img"
      aria-label="Dellvit"
    >
      <defs>
        {/* White shows the arrow; the band slides right, its soft end leading. */}
        <linearGradient id={`${id}-fade`}>
          <stop offset={a.width / sweep} stopColor="#fff" />
          <stop offset={1} stopColor="#000" />
        </linearGradient>
        <mask id={`${id}-draw`} maskUnits="userSpaceOnUse" x={a.x - 20} y={a.y - 20} width={sweep + 40} height={a.height + 40}>
          <rect
            className="brand-logo-sweep"
            x={a.x}
            y={a.y - 20}
            width={sweep}
            height={a.height + 40}
            fill={`url(#${id}-fade)`}
            style={{ '--sweep': `${-sweep}px` } as CSSProperties}
          />
        </mask>
      </defs>
      <g className="brand-logo-name">
        <path fill={L.dell.color} fillRule="evenodd" d={L.dell.d} />
        <path fill={L.vit.color} fillRule="evenodd" d={L.vit.d} />
      </g>
      <path className="brand-logo-leaf small" fill={L.leafSmall.color} fillRule="evenodd" d={L.leafSmall.d} />
      <path className="brand-logo-leaf big" fill={L.leafBig.color} fillRule="evenodd" d={L.leafBig.d} />
      <path fill={L.arrow.color} fillRule="evenodd" d={L.arrow.d} mask={`url(#${id}-draw)`} />
      {tagline && <path className="brand-logo-tagline" fillRule="evenodd" d={L.tagline.d} />}
    </svg>
  );
}

/** "Powered By" and the Intelloplex logo, in the right colours for the theme. */
export function PoweredBy({ className = '' }: { className?: string }) {
  return (
    <span className={'powered-by ' + className}>
      Powered By <span className="powered-mark" role="img" aria-label="Intelloplex" />
    </span>
  );
}
