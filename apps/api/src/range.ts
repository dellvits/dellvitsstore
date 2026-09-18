import type { Request } from 'express';
import { z } from 'zod';

const iso = z.union([z.iso.datetime({ offset: true }), z.literal('')]).optional();
/** Optional ?from=&to= ISO bounds from the query string. Missing bounds are open-ended. */
export function range(req: Request) {
  const q = z.object({ from: iso, to: iso }).parse(req.query);
  return {
    from: q.from ? new Date(q.from).toISOString() : '0000',
    to: q.to ? new Date(q.to).toISOString() : '9999',
  };
}
/** SQL condition for a column inside a range; bind `from` then `to`. */
export const between = (col: string) => `${col}>=? AND ${col}<=?`;
