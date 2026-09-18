import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import inject from 'light-my-request';
import { setupTestDatabase, storedObjects } from './helpers/database.js';
import { one, run, transaction, afterCommit, db, postgresQuery } from '../apps/api/src/db.js';
import { PostgresRateLimitStore } from '../apps/api/src/rate-limit-store.js';
import { hashPassword } from '../apps/api/src/security.js';

process.env.NODE_ENV = 'test';
process.env.WEB_ORIGIN = 'http://localhost:3000';
await setupTestDatabase();
const { app } = await import('../apps/api/src/app.js');
const { seed } = await import('../apps/api/src/seed.js');
await seed();
after(() => db.close());

async function login(email: string, admin = false) {
  const response = await inject(app, {
    method: 'POST',
    url: admin ? '/api/auth/admin-login' : '/api/auth/login',
    headers: { 'x-client': 'mobile' },
    payload: { login: email, password: 'Dellvit@2026' },
  });
  assert.equal(response.statusCode, 200, response.body);
  return response.json().token as string;
}
const customer = await login('customer@dellvit.local');
const admin = await login('admin@dellvit.local', true);
function checkout(key = randomUUID()) {
  return inject(app, {
    method: 'POST',
    url: '/api/orders',
    headers: { authorization: 'Bearer ' + customer },
    payload: {
      items: [{ product_id: 'product-1', quantity: 2 }],
      delivery: {
        name: 'Customer',
        email: 'customer@dellvit.local',
        phone: '03001234567',
        address: 'House 12, Rawalpindi',
        location_id: 'rawalpindi',
        lat: 33.6442,
        lng: 73.0713,
        notes: '',
      },
      payment_method: 'cod',
      idempotency_key: key,
    },
  });
}
function upload(url: string, token: string, data: Buffer, name = 'receipt.webp') {
  const boundary = 'cloud-test-boundary';
  return inject(app, {
    method: 'POST',
    url,
    headers: {
      authorization: 'Bearer ' + token,
      'content-type': 'multipart/form-data; boundary=' + boundary,
    },
    payload: Buffer.concat([
      Buffer.from(
        `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${name}"\r\nContent-Type: image/webp\r\n\r\n`,
      ),
      data,
      Buffer.from(`\r\n--${boundary}--\r\n`),
    ]),
  });
}

await test('Cloud persistence and concurrent requests', async (t) => {
  await t.test(
    'PostgreSQL parameters preserve quoted question marks and private table names',
    () => {
      assert.equal(
        postgresQuery("SELECT '?' value FROM settings WHERE key=? AND value='FROM users?'"),
        "SELECT '?' value FROM dellvit.settings WHERE key=$1 AND value='FROM users?'",
      );
    },
  );
  await t.test(
    'nested writes roll back together and post-commit work only runs after commit',
    async () => {
      let effects = 0;
      await assert.rejects(
        transaction(async () => {
          await run("INSERT INTO settings VALUES('rollback-test','1')");
          await transaction(async () => {
            await run("UPDATE settings SET value='2' WHERE key='rollback-test'");
          });
          await afterCommit(async () => {
            effects++;
          });
          throw new Error('rollback');
        }),
        /rollback/,
      );
      assert.equal(await one("SELECT * FROM settings WHERE key='rollback-test'"), undefined);
      assert.equal(effects, 0);
      await transaction(async () => {
        await run("INSERT INTO settings VALUES('commit-test','ok')");
        await afterCommit(async () => {
          assert.equal(
            (await one("SELECT value FROM settings WHERE key='commit-test'"))!.value,
            'ok',
          );
          effects++;
        });
      });
      assert.equal(effects, 1);
    },
  );
  await t.test('separate limiter instances share atomic PostgreSQL counters', async () => {
    const first = new PostgresRateLimitStore('test:');
    const second = new PostgresRateLimitStore('test:');
    const results = await Promise.all([first.increment('client'), second.increment('client')]);
    assert.deepEqual(results.map((r) => r.totalHits).sort(), [1, 2]);
    await first.resetKey('client');
    assert.equal((await second.increment('client')).totalHits, 1);
  });
  await t.test('concurrent checkouts cannot oversell the last two items', async () => {
    await run("UPDATE products SET stock=2 WHERE id='product-1'");
    const results = await Promise.all([checkout(), checkout()]);
    assert.deepEqual(results.map((r) => r.statusCode).sort(), [201, 409]);
    assert.equal((await one("SELECT stock FROM products WHERE id='product-1'"))!.stock, 0);
  });
  await t.test('concurrent retries create one order and decrement stock once', async () => {
    await run("UPDATE products SET stock=2 WHERE id='product-1'");
    const key = randomUUID();
    const results = await Promise.all([checkout(key), checkout(key)]);
    assert.ok(
      results.every((r) => r.statusCode === 201),
      results.map((r) => r.body).join('\n'),
    );
    assert.equal(results[0].json().id, results[1].json().id);
    assert.equal((await one('SELECT COUNT(*) n FROM orders WHERE idempotency_key=?', key))!.n, 1);
    assert.equal((await one("SELECT stock FROM products WHERE id='product-1'"))!.stock, 0);
  });
  await t.test(
    'R2 receipts stay private and cannot be fetched through the public image route',
    async () => {
      const result = await upload(
        '/api/payment-proofs',
        customer,
        readFileSync('apps/web/public/images/food.webp'),
      );
      assert.equal(result.statusCode, 201, result.body);
      const { id, url } = result.json();
      assert.ok(storedObjects.has('proofs/' + id + '.webp'));
      for (const token of [customer, admin]) {
        const response = await inject(app, {
          method: 'GET',
          url,
          headers: { authorization: 'Bearer ' + token },
        });
        assert.equal(response.statusCode, 200, response.body);
        assert.equal(response.headers['cache-control'], 'private, no-store');
        assert.equal(response.rawPayload.subarray(8, 12).toString(), 'WEBP');
      }
      await run(
        "INSERT INTO users(id,name,email,password_hash,role,created_at) VALUES(?,'Other',?,?,'customer',?)",
        'other-customer',
        'other@example.test',
        hashPassword('Dellvit@2026'),
        new Date().toISOString(),
      );
      const other = await login('other@example.test');
      assert.equal(
        (await inject(app, { method: 'GET', url, headers: { authorization: 'Bearer ' + other } }))
          .statusCode,
        404,
      );
      assert.equal((await inject(app, { method: 'GET', url })).statusCode, 401);
      assert.equal(
        (await inject(app, { method: 'GET', url: '/api/media/' + id + '.webp' })).statusCode,
        404,
      );
    },
  );
  await t.test('uploads larger than 4 MiB are rejected before reaching storage', async () => {
    const before = storedObjects.size;
    const result = await upload('/api/payment-proofs', customer, Buffer.alloc(4 * 1024 * 1024 + 1));
    assert.equal(result.statusCode, 400);
    assert.match(result.json().error, /4 MB/);
    assert.equal(storedObjects.size, before);
  });
});
