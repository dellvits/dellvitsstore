import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import inject from 'light-my-request';
const temp = mkdtempSync(join(tmpdir(), 'dellvit-test-'));
process.env.DATABASE_PATH = join(temp, 'test.sqlite');
process.env.UPLOAD_DIR = join(temp, 'uploads');
process.env.WEB_ORIGIN = 'http://localhost:3000';
const { app } = await import('../apps/api/src/app.js');
const { seed } = await import('../apps/api/src/seed.js');
const { db, one, run } = await import('../apps/api/src/db.js');
seed();
after(() => {
  db.close();
  rmSync(temp, { recursive: true, force: true });
});
async function request(
  method: string,
  url: string,
  body?: unknown,
  token?: string,
  headers: Record<string, string> = {},
) {
  const r = await inject(app as any, {
    method: method as any,
    url: '/api' + url,
    headers: {
      ...(body ? { 'content-type': 'application/json' } : {}),
      ...(token ? { authorization: 'Bearer ' + token } : {}),
      ...headers,
    },
    ...(body ? { payload: JSON.stringify(body) } : {}),
  });
  return { status: r.statusCode, data: r.json(), headers: r.headers };
}
async function login(login: string) {
  const r = await request('POST', '/auth/login', { login, password: 'Dellvit@2026' }, undefined, {
    'x-client': 'mobile',
  });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  return r.data.token as string;
}
const delivery = {
  name: 'Test Customer',
  email: 'test@example.com',
  phone: '03001234567',
  address: 'House 12, 6th Road, Rawalpindi',
  location_id: 'rawalpindi',
  lat: 33.6442,
  lng: 73.0713,
  notes: 'Call at the gate.',
};
const orderBody = () => ({
  items: [{ product_id: 'product-1', quantity: 2 }],
  delivery,
  payment_method: 'cod',
  idempotency_key: randomUUID(),
  total: 1,
});
await test('Dellvit delivery workflow and authorization', async (t) => {
  const customer = await login('customer@dellvit.local');
  const admin = await login('admin@dellvit.local');
  const outlet = await login('DLV-001');
  const rider = await login('DRV-001');
  const otherOutlet = await login('DLV-002');
  const otherRider = await login('DRV-002');
  let order: any;
  await t.test('catalogue filters actual product location and outlet', async () => {
    const a = await request('GET', '/products?location=rawalpindi');
    assert.equal(a.status, 200);
    assert.ok(a.data.length >= 5);
    assert.ok(a.data.every((p: any) => p.location_id === 'rawalpindi'));
    const b = await request('GET', '/products?location=islamabad&category=Food');
    assert.equal(b.data.length, 1);
    assert.equal(b.data[0].outlet_id, 'outlet-5');
    const c = await request('GET', '/products?q=burger&location=rawalpindi');
    assert.equal(c.data.length, 2);
  });
  await t.test('guest sessions remain private and customer profile is unchanged', async () => {
    const guest = await request('GET', '/session');
    const cookie = String(guest.headers['set-cookie']).split(';')[0];
    assert.match(cookie, /dellvit_session=/);
    const b = orderBody();
    b.items[0].quantity = 1;
    const r = await request('POST', '/orders', b, undefined, {
      cookie,
      origin: 'http://localhost:3000',
    });
    assert.equal(r.status, 201, JSON.stringify(r.data));
    assert.match(r.data.otp, /^\d{6}$/);
    assert.equal((await request('GET', '/orders/' + r.data.id)).status, 404);
    assert.equal(
      (await request('GET', '/orders/' + r.data.id, undefined, undefined, { cookie })).status,
      200,
    );
    assert.equal(
      (
        await request('POST', '/orders', orderBody(), undefined, {
          cookie,
          origin: 'https://evil.example',
        })
      ).status,
      403,
    );
  });
  await t.test(
    'server controls prices, stock, rider assignment and duplicate checkout',
    async () => {
      const before = one('SELECT stock FROM products WHERE id=?', 'product-1')!.stock;
      const body = orderBody();
      const r = await request('POST', '/orders', body, customer);
      assert.equal(r.status, 201, JSON.stringify(r.data));
      order = r.data;
      assert.equal(order.subtotal, 58650 * 2);
      assert.equal(order.total, 58650 * 2 + 15000);
      assert.equal(order.rider_id, 'rider-1');
      assert.equal(order.notes, 'Call at the gate.');
      assert.match(order.reference, /^DLV-/);
      assert.equal(one('SELECT stock FROM products WHERE id=?', 'product-1')!.stock, before - 2);
      const retry = await request('POST', '/orders', body, customer);
      assert.equal(retry.data.id, order.id);
      assert.equal(one('SELECT stock FROM products WHERE id=?', 'product-1')!.stock, before - 2);
      assert.equal(
        one('SELECT address FROM users WHERE id=?', 'customer-1')!.address,
        '6th Road, Rawalpindi',
      );
    },
  );
  await t.test(
    'rejects unavailable stock, mixed outlets, invalid areas and remote pins',
    async () => {
      const tooMany = orderBody();
      tooMany.items[0].quantity = 99;
      assert.equal((await request('POST', '/orders', tooMany, customer)).status, 409);
      const mixed = orderBody();
      mixed.items.push({ product_id: 'product-3', quantity: 1 });
      assert.equal((await request('POST', '/orders', mixed, customer)).status, 400);
      const wrong = orderBody();
      wrong.delivery = { ...delivery, location_id: 'islamabad' };
      assert.equal((await request('POST', '/orders', wrong, customer)).status, 400);
      const far = orderBody();
      far.delivery = { ...delivery, lat: 31 };
      assert.equal((await request('POST', '/orders', far, customer)).status, 400);
    },
  );
  await t.test(
    'blocks cross-user and cross-outlet access and conceals OTP from staff',
    async () => {
      assert.equal(
        (await request('GET', '/orders/' + order.id, undefined, otherOutlet)).status,
        404,
      );
      assert.equal(
        (await request('GET', '/orders/' + order.id, undefined, otherRider)).status,
        404,
      );
      for (const token of [admin, rider, outlet]) {
        const r = await request('GET', '/orders/' + order.id, undefined, token);
        assert.equal(r.status, 200);
        assert.equal(r.data.otp, undefined);
        assert.equal(r.data.guest_session, undefined);
      }
      const wrong = await request(
        'PATCH',
        '/orders/' + order.id + '/status',
        { status: 'confirmed' },
        customer,
      );
      assert.equal(wrong.status, 403);
      assert.equal(
        (
          await request(
            'POST',
            '/orders/' + order.id + '/verify',
            { otp: order.otp, cash_received: true },
            rider,
          )
        ).status,
        400,
      );
    },
  );
  await t.test(
    'runs the full preparation and rider delivery lifecycle with OTP lockout',
    async () => {
      for (const status of ['confirmed', 'preparing', 'ready']) {
        const r = await request('PATCH', '/orders/' + order.id + '/status', { status }, outlet);
        assert.equal(r.status, 200, JSON.stringify(r.data));
      }
      assert.equal(
        (await request('PATCH', '/orders/' + order.id + '/status', { status: 'picked_up' }, outlet))
          .status,
        403,
      );
      assert.equal(
        (await request('PATCH', '/orders/' + order.id + '/status', { status: 'picked_up' }, rider))
          .status,
        200,
      );
      for (let i = 0; i < 5; i++)
        assert.equal(
          (
            await request(
              'POST',
              '/orders/' + order.id + '/verify',
              { otp: '000000', cash_received: true },
              rider,
            )
          ).status,
          400,
        );
      assert.equal(
        (
          await request(
            'POST',
            '/orders/' + order.id + '/verify',
            { otp: order.otp, cash_received: true },
            rider,
          )
        ).status,
        429,
      );
      assert.equal(one('SELECT status FROM orders WHERE id=?', order.id)!.status, 'picked_up');
      run(
        'UPDATE orders SET otp_locked_until=? WHERE id=?',
        new Date(Date.now() - 1000).toISOString(),
        order.id,
      );
      assert.equal(
        (
          await request(
            'POST',
            '/orders/' + order.id + '/verify',
            { otp: order.otp, cash_received: false },
            rider,
          )
        ).status,
        400,
      );
      assert.equal(
        (
          await request(
            'POST',
            '/orders/' + order.id + '/verify',
            { otp: order.otp, cash_received: true },
            rider,
          )
        ).status,
        200,
      );
      const done = await request('GET', '/orders/' + order.id, undefined, customer);
      assert.equal(done.data.status, 'delivered');
      assert.equal(done.data.events.length, 6);
      assert.ok(done.data.delivered_at);
      assert.equal(
        (
          await request(
            'POST',
            '/orders/' + order.id + '/verify',
            { otp: order.otp, cash_received: true },
            rider,
          )
        ).status,
        400,
      );
    },
  );
  await t.test('cancellation restores stock exactly once', async () => {
    const before = one('SELECT stock FROM products WHERE id=?', 'product-1')!.stock;
    const created = await request('POST', '/orders', orderBody(), customer);
    const url = '/orders/' + created.data.id + '/status';
    assert.equal((await request('PATCH', url, { status: 'cancelled' }, customer)).status, 200);
    assert.equal(one('SELECT stock FROM products WHERE id=?', 'product-1')!.stock, before);
    assert.equal((await request('PATCH', url, { status: 'cancelled' }, customer)).status, 400);
    assert.equal(one('SELECT stock FROM products WHERE id=?', 'product-1')!.stock, before);
  });
  await t.test('outlet can manage only its own products, archive and restore', async () => {
    const p = (await request('GET', '/products/product-1')).data;
    assert.equal(
      (
        await request(
          'PUT',
          '/manage/products/product-1',
          { ...p, name: 'Updated classic meal' },
          otherOutlet,
        )
      ).status,
      403,
    );
    assert.equal(
      (
        await request(
          'PUT',
          '/manage/products/product-1',
          { ...p, name: 'Updated classic meal' },
          outlet,
        )
      ).status,
      200,
    );
    assert.equal(
      (await request('DELETE', '/manage/products/product-1', undefined, outlet)).status,
      200,
    );
    assert.equal((await request('GET', '/products/product-1')).status, 404);
    assert.equal(
      (await request('PUT', '/manage/products/product-1', { ...p, active: 1 }, outlet)).status,
      200,
    );
    const newP = { ...p, name: 'New test product' };
    const create = await request('POST', '/manage/products', newP, outlet);
    assert.equal(create.status, 200, JSON.stringify(create.data));
    assert.notEqual(create.data.id, p.id);
  });
  await t.test('admin creates outlet credentials and rider account', async () => {
    const data = {
      name: 'Test outlet',
      phone: '03001112222',
      email: 'shop@test.example',
      location_id: 'rawalpindi',
      address: 'New shop on 6th Road',
      lat: 33.6442,
      lng: 73.0713,
      customer_id: 'DLV-TEST',
      password: 'Dellvit@2026',
      image: '/images/food.webp',
      category: 'Food',
      active: 1,
    };
    const r = await request('POST', '/admin/outlets', data, admin);
    assert.equal(r.status, 200, JSON.stringify(r.data));
    const token = await login('DLV-TEST');
    assert.equal((await request('GET', '/manage/outlet', undefined, token)).data.id, r.data.id);
    const riderData = {
      name: 'New Rider',
      email: 'newrider@test.example',
      phone: '03001112223',
      address: '6th Road',
      location_id: 'rawalpindi',
      login_id: 'DRV-TEST',
      password: 'Dellvit@2026',
      active: 1,
    };
    assert.equal((await request('POST', '/admin/riders', riderData, admin)).status, 200);
    const riderToken = await login('DRV-TEST');
    assert.equal((await request('GET', '/admin/riders', undefined, riderToken)).status, 403);
  });
  await t.test('documents require admin even for the outlet owner', async () => {
    assert.equal(
      (await request('GET', '/admin/outlets/outlet-1/documents', undefined, outlet)).status,
      403,
    );
    assert.equal(
      (await request('GET', '/admin/outlets/outlet-1/documents', undefined, customer)).status,
      403,
    );
    assert.equal((await request('GET', '/admin/outlets/outlet-1/documents')).status, 401);
    const boundary = 'dellvit-test-boundary';
    const payload = Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="contract.pdf"\r\nContent-Type: application/pdf\r\n\r\n%PDF-1.4\nTest document\n%%EOF\r\n--${boundary}--\r\n`,
    );
    const r = await inject(app as any, {
      method: 'POST',
      url: '/api/admin/outlets/outlet-1/documents',
      headers: {
        authorization: 'Bearer ' + admin,
        'content-type': 'multipart/form-data; boundary=' + boundary,
      },
      payload,
    });
    assert.equal(r.statusCode, 201, r.body);
    const docId = r.json().id;
    const file = await inject(app as any, {
      method: 'GET',
      url: '/api/admin/documents/' + docId,
      headers: { authorization: 'Bearer ' + admin },
    });
    assert.equal(file.statusCode, 200);
    assert.match(file.headers['content-disposition'] as string, /attachment/);
    assert.equal((await request('GET', '/media/' + docId + '.pdf')).status, 404);
    assert.equal(
      (await request('DELETE', '/admin/documents/' + docId, undefined, admin)).status,
      200,
    );
  });
  await t.test('image uploads become usable WebP', async () => {
    const img = readFileSync(resolve('apps/web/public/images/food.webp'));
    const boundary = 'image-boundary';
    const payload = Buffer.concat([
      Buffer.from(
        `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="food.webp"\r\nContent-Type: image/webp\r\n\r\n`,
      ),
      img,
      Buffer.from(`\r\n--${boundary}--\r\n`),
    ]);
    const r = await inject(app as any, {
      method: 'POST',
      url: '/api/manage/images',
      headers: {
        authorization: 'Bearer ' + outlet,
        'content-type': 'multipart/form-data; boundary=' + boundary,
      },
      payload,
    });
    assert.equal(r.statusCode, 201, r.body);
    assert.match(r.json().url, /\.webp$/);
    const image = await inject(app as any, { method: 'GET', url: r.json().url });
    assert.equal(image.statusCode, 200);
    assert.equal(image.rawPayload.subarray(8, 12).toString(), 'WEBP');
  });
  await t.test('contact inbox, advertisement and areas persist behind admin access', async () => {
    assert.equal(
      (
        await request('POST', '/contact', {
          name: 'Client',
          email: 'client@example.com',
          message: 'Please call about a partnership.',
        })
      ).status,
      201,
    );
    assert.equal((await request('GET', '/admin/messages', undefined, admin)).data.length, 1);
    assert.equal((await request('GET', '/admin/messages', undefined, customer)).status, 403);
    const ad = {
      title: 'Fresh local picks',
      description: 'A new advertisement',
      label: 'SPONSORED',
      link: '/search',
      image: '/images/rider.webp',
      active: true,
    };
    assert.equal((await request('PUT', '/admin/ad', ad, admin)).status, 200);
    assert.equal((await request('GET', '/ad')).data.title, ad.title);
    assert.equal(
      (await request('PUT', '/admin/ad', { ...ad, link: 'javascript:alert(1)' }, admin)).status,
      400,
    );
    const loc = await request(
      'POST',
      '/admin/locations',
      { name: 'Test area', lat: 33.6, lng: 73.1 },
      admin,
    );
    assert.equal(loc.status, 201);
    assert.ok(one('SELECT id FROM locations WHERE id=?', loc.data.id));
  });
  await t.test('registration, profile updates and password rotation work', async () => {
    const p = {
      name: 'New Customer',
      email: 'fresh@example.com',
      phone: '03001234567',
      password: 'NewPassword@2026',
      address: 'House 1',
      location_id: 'rawalpindi',
    };
    const r = await request('POST', '/auth/register', p, undefined, { 'x-client': 'mobile' });
    assert.equal(r.status, 201, JSON.stringify(r.data));
    assert.equal(r.data.user.password_hash, undefined);
    const token = r.data.token;
    assert.equal(
      (
        await request(
          'PATCH',
          '/profile',
          { name: p.name, phone: p.phone, address: 'House 2', location_id: p.location_id },
          token,
        )
      ).data.address,
      'House 2',
    );
    assert.equal(
      (
        await request(
          'POST',
          '/auth/password',
          { current: p.password, password: 'Replacement@2026' },
          token,
        )
      ).status,
      200,
    );
    assert.equal(
      (await request('POST', '/auth/login', { login: p.email, password: p.password })).status,
      401,
    );
    assert.equal((await request('POST', '/auth/logout', undefined, token)).status, 200);
    assert.equal((await request('PATCH', '/profile', { name: 'No access' }, token)).status, 401);
  });
});
