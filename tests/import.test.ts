import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setupTestDatabase, storedObjects } from './helpers/database.js';
import { importLocal } from '../apps/api/src/import-local.js';
import { one, db } from '../apps/api/src/db.js';

await test('local cutover preserves IDs, password hashes and image URLs; refuses a second import', async () => {
  process.env.NODE_ENV = 'test';
  await setupTestDatabase();
  const directory = mkdtempSync(join(tmpdir(), 'dellvit-import-'));
  const path = join(directory, 'old.sqlite');
  const uploads = join(directory, 'uploads');
  mkdirSync(uploads);
  const imageName = '11111111-1111-4111-8111-111111111111.webp';
  const image = readFileSync('apps/web/public/images/food.webp');
  writeFileSync(join(uploads, imageName), image);
  const legacy = new DatabaseSync(path);
  legacy.exec(`
    CREATE TABLE locations(id TEXT PRIMARY KEY,name TEXT,lat REAL,lng REAL);
    CREATE TABLE users(id TEXT PRIMARY KEY,name TEXT,email TEXT,password_hash TEXT,role TEXT,created_at TEXT);
    CREATE TABLE orders(id TEXT PRIMARY KEY);
    INSERT INTO locations VALUES('old-area','Old area',33.6,73.0);
    INSERT INTO users VALUES('old-user','Existing customer','old@example.test','original-scrypt-hash','customer','2026-01-01T00:00:00.000Z');
  `);
  legacy.close();
  const original = readFileSync(path);
  try {
    const result = await importLocal(path, uploads);
    assert.deepEqual(result, { rows: 2, files: 1 });
    assert.equal(
      (await one("SELECT password_hash FROM users WHERE id='old-user'"))!.password_hash,
      'original-scrypt-hash',
    );
    assert.deepEqual(storedObjects.get('images/' + imageName)!.body, image);
    assert.deepEqual(readFileSync(path), original);
    await assert.rejects(importLocal(path, uploads), /fresh Supabase schema/);
    assert.equal((await one('SELECT COUNT(*) n FROM users'))!.n, 1);
  } finally {
    await db.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
