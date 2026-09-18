import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { setTestDatabase, type Connection } from '../../apps/api/src/db.js';
import { setTestStorage, type StoredObject } from '../../apps/api/src/storage.js';

export const storedObjects = new Map<string, StoredObject>();
export async function setupTestDatabase() {
  const postgres = new PGlite();
  await postgres.exec(
    readFileSync(resolve('supabase/migrations/202609180001_initial.sql'), 'utf8'),
  );
  function connection(engine: Pick<PGlite, 'query'>): Connection {
    return {
      async query(sql, params) {
        const result = await engine.query<Record<string, any>>(sql, params).catch((error) => {
          if (['42601', '42803'].includes(error.code))
            console.error('Invalid SQL:', sql, error.message);
          throw error;
        });
        return { rows: result.rows, rowCount: result.affectedRows ?? result.rows.length };
      },
    };
  }
  setTestDatabase({
    ...connection(postgres),
    transaction: (fn) => postgres.transaction((tx) => fn(connection(tx))),
    close: () => postgres.close(),
  });
  setTestStorage({
    async put(key, body, contentType) {
      storedObjects.set(key, { body: Buffer.from(body), contentType });
    },
    async get(key) {
      return storedObjects.get(key);
    },
    async delete(key) {
      storedObjects.delete(key);
    },
  });
}
