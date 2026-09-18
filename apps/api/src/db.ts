import 'dotenv/config';
import { AsyncLocalStorage } from 'node:async_hooks';
import pg from 'pg';

export type Row = Record<string, any>;
export type QueryResult = { rows: Row[]; rowCount: number | null };
export type Connection = { query(sql: string, params?: any[]): Promise<QueryResult> };
export type DatabaseAdapter = Connection & {
  transaction<T>(fn: (connection: Connection) => Promise<T>): Promise<T>;
  close(): Promise<void>;
};
type TransactionContext = { connection: Connection; afterCommit: (() => Promise<void>)[] };
const context = new AsyncLocalStorage<TransactionContext>();
let adapter: DatabaseAdapter | undefined;

// Preserve the numeric API contract for COUNT and SUM without rounding int8 values.
pg.types.setTypeParser(20, (value) => {
  const number = Number(value);
  if (!Number.isSafeInteger(number)) throw new Error('Database integer exceeds safe range.');
  return number;
});

function database(): DatabaseAdapter {
  if (adapter) return adapter;
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString)
    throw new Error('DATABASE_URL is required. Configure the Supabase PostgreSQL connection.');
  const url = new URL(connectionString);
  const local = ['localhost', '127.0.0.1', '::1', '[::1]'].includes(url.hostname);
  // URL sslmode options must not disable certificate verification.
  for (const key of ['sslmode', 'sslcert', 'sslkey', 'sslrootcert']) url.searchParams.delete(key);
  const pool = new pg.Pool({
    connectionString: url.toString(),
    ssl: local
      ? false
      : {
          rejectUnauthorized: true,
          ...(process.env.DATABASE_SSL_CA
            ? { ca: process.env.DATABASE_SSL_CA.replace(/\\n/g, '\n') }
            : {}),
        },
    max: 3,
    idleTimeoutMillis: 10_000,
    connectionTimeoutMillis: 10_000,
    allowExitOnIdle: true,
  });
  pool.on('error', () => console.error('An idle database connection failed.'));
  adapter = {
    query: (sql, params) => pool.query(sql, params),
    async transaction(fn) {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        await client.query("SET LOCAL statement_timeout = '30s'");
        // Preserve SQLite's serialized writers across Vercel instances for stock,
        // coupon limits, idempotency, workflow transitions and account balances.
        await client.query('SELECT pg_advisory_xact_lock(73288001)');
        const result = await fn(client);
        await client.query('COMMIT');
        return result;
      } catch (error) {
        await client.query('ROLLBACK').catch(() => {});
        throw error;
      } finally {
        client.release();
      }
    },
    close: () => pool.end(),
  };
  return adapter;
}

/** Inject a PostgreSQL engine only in isolated tests; never fall back to local storage. */
export function setTestDatabase(value: DatabaseAdapter) {
  if (process.env.NODE_ENV !== 'test' || adapter)
    throw new Error('Test database cannot be configured here.');
  adapter = value;
}

export const applicationTables =
  'locations users sessions outlets products orders order_items order_events documents messages settings admin_access platform_records area_settings rider_state audit_log order_details coupon_uses notifications push_subscriptions rider_settings rider_earnings rider_payouts payout_requests order_flow payment_proofs outlet_settings order_settlements cod_deposits rate_limits'.split(
    ' ',
  );
const tables = new Set(applicationTables);

/** Bind positional queries and keep application tables in a private schema. */
export function postgresQuery(sql: string) {
  let index = 0;
  let expectTable = false;
  return sql.replace(/'(?:''|[^'])*'|"(?:""|[^"])*"|\?|\b[a-z_][a-z_0-9]*\b/gi, (token) => {
    if (token.startsWith("'") || token.startsWith('"')) {
      expectTable = false;
      return token;
    }
    if (token === '?') return '$' + ++index;
    if (expectTable) {
      expectTable = false;
      if (tables.has(token.toLowerCase())) return 'dellvit.' + token;
    }
    expectTable = /^(from|join|update|into)$/i.test(token);
    return token;
  });
}
async function query(sql: string, params: any[]) {
  return (context.getStore()?.connection || database()).query(postgresQuery(sql), params);
}
export async function one(sql: string, ...params: any[]): Promise<Row | undefined> {
  return (await query(sql, params)).rows[0];
}
export async function all(sql: string, ...params: any[]): Promise<Row[]> {
  return (await query(sql, params)).rows;
}
export async function run(sql: string, ...params: any[]) {
  return { changes: (await query(sql, params)).rowCount || 0 };
}
export async function transaction<T>(fn: () => Promise<T>): Promise<T> {
  if (context.getStore()) return fn();
  const afterCommit: (() => Promise<void>)[] = [];
  const result = await database().transaction((connection) =>
    context.run({ connection, afterCommit }, fn),
  );
  for (const effect of afterCommit) {
    try {
      await effect();
    } catch {
      console.error('A post-commit operation failed.');
    }
  }
  return result;
}
export async function afterCommit(effect: () => Promise<void>) {
  const active = context.getStore();
  if (active) active.afterCommit.push(effect);
  else await effect();
}
export const db = {
  async exec(sql: string) {
    await (context.getStore()?.connection || database()).query(sql);
  },
  async close() {
    if (adapter) await adapter.close();
  },
};
