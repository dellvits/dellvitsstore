import 'dotenv/config';
import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
const path = resolve(process.env.DATABASE_PATH || './data/dellvit.sqlite');
mkdirSync(dirname(path), { recursive: true });
export const db = new DatabaseSync(path);
db.exec(`PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;
CREATE TABLE IF NOT EXISTS locations(id TEXT PRIMARY KEY,name TEXT NOT NULL,lat REAL NOT NULL,lng REAL NOT NULL);
CREATE TABLE IF NOT EXISTS users(id TEXT PRIMARY KEY,name TEXT NOT NULL,email TEXT NOT NULL UNIQUE,phone TEXT NOT NULL DEFAULT '',address TEXT NOT NULL DEFAULT '',location_id TEXT REFERENCES locations(id),password_hash TEXT NOT NULL,role TEXT NOT NULL CHECK(role IN ('customer','admin','outlet','rider')),login_id TEXT UNIQUE,active INTEGER NOT NULL DEFAULT 1,created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS sessions(token_hash TEXT PRIMARY KEY,user_id TEXT REFERENCES users(id),expires_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS outlets(id TEXT PRIMARY KEY,name TEXT NOT NULL,phone TEXT NOT NULL,email TEXT NOT NULL,location_id TEXT NOT NULL REFERENCES locations(id),address TEXT NOT NULL,lat REAL NOT NULL,lng REAL NOT NULL,customer_id TEXT NOT NULL UNIQUE,user_id TEXT NOT NULL REFERENCES users(id),active INTEGER NOT NULL DEFAULT 1,image TEXT NOT NULL,category TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS products(id TEXT PRIMARY KEY,outlet_id TEXT NOT NULL REFERENCES outlets(id),name TEXT NOT NULL,description TEXT NOT NULL,category TEXT NOT NULL,price INTEGER NOT NULL CHECK(price>=0),stock INTEGER NOT NULL CHECK(stock>=0),unit TEXT NOT NULL,location_id TEXT NOT NULL REFERENCES locations(id),discount INTEGER NOT NULL DEFAULT 0 CHECK(discount BETWEEN 0 AND 90),deal TEXT NOT NULL DEFAULT '',images TEXT NOT NULL,includes TEXT NOT NULL,excludes TEXT NOT NULL,delivery_minutes INTEGER NOT NULL,active INTEGER NOT NULL DEFAULT 1);
CREATE TABLE IF NOT EXISTS orders(id TEXT PRIMARY KEY,reference TEXT NOT NULL UNIQUE,user_id TEXT REFERENCES users(id),guest_session TEXT, outlet_id TEXT NOT NULL REFERENCES outlets(id),rider_id TEXT REFERENCES users(id),name TEXT NOT NULL,email TEXT NOT NULL,phone TEXT NOT NULL,address TEXT NOT NULL,location_id TEXT NOT NULL REFERENCES locations(id),lat REAL NOT NULL,lng REAL NOT NULL,notes TEXT NOT NULL DEFAULT '',payment_method TEXT NOT NULL DEFAULT 'cod',subtotal INTEGER NOT NULL,delivery_fee INTEGER NOT NULL,total INTEGER NOT NULL,status TEXT NOT NULL,otp TEXT NOT NULL,otp_attempts INTEGER NOT NULL DEFAULT 0,otp_locked_until TEXT,created_at TEXT NOT NULL,deliver_by TEXT NOT NULL,delivered_at TEXT,idempotency_key TEXT NOT NULL UNIQUE);
CREATE TABLE IF NOT EXISTS order_items(id TEXT PRIMARY KEY,order_id TEXT NOT NULL REFERENCES orders(id),product_id TEXT NOT NULL REFERENCES products(id),name TEXT NOT NULL,quantity INTEGER NOT NULL,unit_price INTEGER NOT NULL,image TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS order_events(id TEXT PRIMARY KEY,order_id TEXT NOT NULL REFERENCES orders(id),status TEXT NOT NULL,created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS documents(id TEXT PRIMARY KEY,outlet_id TEXT NOT NULL REFERENCES outlets(id),name TEXT NOT NULL,filename TEXT NOT NULL,mime TEXT NOT NULL,created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS messages(id TEXT PRIMARY KEY,name TEXT NOT NULL,email TEXT NOT NULL,message TEXT NOT NULL,created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS settings(key TEXT PRIMARY KEY,value TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS idx_products_location ON products(location_id,active);
CREATE INDEX IF NOT EXISTS idx_products_outlet ON products(outlet_id);
CREATE INDEX IF NOT EXISTS idx_orders_customer ON orders(user_id,created_at);
CREATE INDEX IF NOT EXISTS idx_orders_rider ON orders(rider_id,status);
CREATE INDEX IF NOT EXISTS idx_orders_outlet ON orders(outlet_id,status);
CREATE INDEX IF NOT EXISTS idx_orders_guest ON orders(guest_session);
CREATE INDEX IF NOT EXISTS idx_items_order ON order_items(order_id);
CREATE INDEX IF NOT EXISTS idx_events_order ON order_events(order_id);
`);
export type Row = Record<string, any>;
export function one(sql: string, ...params: any[]): Row | undefined {
  return db.prepare(sql).get(...params) as Row | undefined;
}
export function all(sql: string, ...params: any[]): Row[] {
  return db.prepare(sql).all(...params) as Row[];
}
export function run(sql: string, ...params: any[]) {
  return db.prepare(sql).run(...params);
}
export function transaction<T>(fn: () => T): T {
  db.exec('BEGIN IMMEDIATE');
  try {
    const v = fn();
    db.exec('COMMIT');
    return v;
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
}
