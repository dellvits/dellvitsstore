import type { RequestHandler } from 'express';
import { randomUUID } from 'node:crypto';
import { run, transaction } from './db.js';
import type { AuthRequest } from './security.js';

/** Serialize a complete write action, including its validation reads, across instances.
 * Buffer the JSON response until COMMIT succeeds. Upload middleware runs beforehand.
 * Checkout manages its own transaction so card gateway calls happen after commit.
 */
export function atomicRoute(handler: RequestHandler): RequestHandler {
  return async (req: AuthRequest, res, next) => {
    const end = res.end;
    const headers = res.getHeaders();
    let pending: any[] | undefined;
    res.end = function (...args: any[]) {
      pending = args;
      return res;
    } as typeof res.end;
    try {
      await transaction(async () => {
        await handler(req, res, (error?: any) => {
          throw error || new Error('Atomic handler must complete its response.');
        });
        if (res.statusCode < 400 && res.locals.auditTarget && req.user) {
          await run(
            'INSERT INTO audit_log VALUES(?,?,?,?,?)',
            randomUUID(),
            req.user.id,
            req.method,
            res.locals.auditTarget,
            new Date().toISOString(),
          );
        }
      });
      res.end = end;
      if (pending) (end as Function).apply(res, pending);
    } catch (error) {
      res.end = end;
      for (const name of res.getHeaderNames()) res.removeHeader(name);
      for (const [name, value] of Object.entries(headers))
        if (value !== undefined) res.setHeader(name, value);
      next(error);
    }
  };
}
