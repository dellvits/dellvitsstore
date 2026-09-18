import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import inject from 'light-my-request';
process.env.WEB_ORIGIN = 'http://localhost:3000';
process.env.NODE_ENV = 'test';
const { setupTestDatabase, storedObjects } = await import('./helpers/database.js');
await setupTestDatabase();
const { app } = await import('../apps/api/src/app.js');
const { seed } = await import('../apps/api/src/seed.js');
const { db, one, run } = await import('../apps/api/src/db.js');
await seed();
after(async () => {
  await new Promise((resolve) => setImmediate(resolve));
  await db.close();
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
  const r = await request(
    'POST',
    login === 'admin@dellvit.local' ? '/auth/admin-login' : '/auth/login',
    { login, password: 'Dellvit@2026' },
    undefined,
    {
      'x-client': 'mobile',
    },
  );
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
  await t.test('guests must sign in before ordering; foreign origins are rejected', async () => {
    const guest = await request('GET', '/session');
    const cookie = String(guest.headers['set-cookie']).split(';')[0];
    assert.match(cookie, /dellvit_session=/);
    const r = await request('POST', '/orders', orderBody(), undefined, {
      cookie,
      origin: 'http://localhost:3000',
    });
    assert.equal(r.status, 401, JSON.stringify(r.data));
    assert.equal((await one('SELECT COUNT(*) n FROM orders'))!.n, 0);
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
  await t.test('home feed is scoped to the selected area and home categories', async () => {
    const home = await request('GET', '/home?location=rawalpindi');
    assert.equal(home.status, 200);
    assert.ok(home.data.nearby.length > 0 && home.data.nearby.length <= 8);
    assert.ok(home.data.nearby.every((p: any) => p.location_id === 'rawalpindi'));
    assert.ok(home.data.categories.some((c: any) => c.name === 'Food'));
    assert.ok(home.data.outlets.every((o: any) => o.location_id === 'rawalpindi'));
    assert.deepEqual((await request('GET', '/home')).data.nearby, []);
  });
  await t.test(
    'server controls prices, stock, rider assignment and duplicate checkout',
    async () => {
      const before = (await one('SELECT stock FROM products WHERE id=?', 'product-1'))!.stock;
      const body = orderBody();
      const r = await request('POST', '/orders', body, customer);
      assert.equal(r.status, 201, JSON.stringify(r.data));
      order = r.data;
      assert.equal(order.subtotal, 58650 * 2);
      assert.equal(order.total, 58650 * 2 + 15000);
      // Riders are chosen by an administrator, never automatically.
      assert.equal(order.rider_id, null);
      assert.equal(order.status, 'placed');
      assert.ok(order.flow.payment_verified_at, 'cash on delivery is verified automatically');
      assert.ok(order.events.some((e: any) => e.status === 'payment_verified'));
      assert.equal(order.notes, 'Call at the gate.');
      assert.match(order.reference, /^DLV-/);
      assert.equal(
        (await one('SELECT stock FROM products WHERE id=?', 'product-1'))!.stock,
        before - 2,
      );
      const retry = await request('POST', '/orders', body, customer);
      assert.equal(retry.data.id, order.id);
      assert.equal(
        (await one('SELECT stock FROM products WHERE id=?', 'product-1'))!.stock,
        before - 2,
      );
      assert.equal(
        (await one('SELECT address FROM users WHERE id=?', 'customer-1'))!.address,
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
      // Outlets and riders see nothing until the order is sent to them.
      assert.equal((await request('GET', '/orders/' + order.id, undefined, outlet)).status, 404);
      assert.equal(
        (await request('POST', '/admin/orders/' + order.id + '/dispatch', {}, admin)).status,
        400,
        'a rider is required',
      );
      assert.equal(
        (
          await request(
            'POST',
            '/admin/orders/' + order.id + '/dispatch',
            { rider_id: 'rider-2' },
            admin,
          )
        ).status,
        400,
        'riders from another area are refused',
      );
      const sent = await request(
        'POST',
        '/admin/orders/' + order.id + '/dispatch',
        { rider_id: 'rider-1' },
        admin,
      );
      assert.equal(sent.status, 200, JSON.stringify(sent.data));
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
        { status: 'preparing' },
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
      const url = '/orders/' + order.id;
      assert.equal(
        (await request('PATCH', url + '/status', { status: 'confirmed' }, admin)).status,
        400,
        'confirmation cannot be forced',
      );
      assert.equal(
        (await request('POST', url + '/outlet-response', { decision: 'accept' }, outlet)).status,
        200,
      );
      assert.equal((await request('GET', url, undefined, admin)).data.status, 'placed');
      assert.equal(
        (await request('POST', url + '/rider-response', { decision: 'accept' }, otherRider)).status,
        404,
      );
      assert.equal(
        (await request('POST', url + '/rider-response', { decision: 'accept' }, rider)).status,
        200,
      );
      assert.equal((await request('GET', url, undefined, admin)).data.status, 'confirmed');
      assert.equal(
        (await request('PATCH', url + '/status', { status: 'preparing' }, admin)).status,
        403,
        'only the outlet prepares',
      );
      assert.equal(
        (await request('POST', '/admin/orders/' + order.id + '/remind', {}, admin)).status,
        200,
      );
      for (const status of ['preparing', 'ready']) {
        const r = await request('PATCH', url + '/status', { status }, outlet);
        assert.equal(r.status, 200, JSON.stringify(r.data));
      }
      assert.equal(
        (await request('POST', '/admin/orders/' + order.id + '/remind', {}, admin)).status,
        400,
      );
      assert.equal(
        (await request('PATCH', url + '/status', { status: 'picked_up' }, admin)).status,
        403,
        'only the rider confirms pickup',
      );
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
      assert.equal(
        (await one('SELECT status FROM orders WHERE id=?', order.id))!.status,
        'picked_up',
      );
      await run(
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
      assert.deepEqual(
        done.data.events.map((e: any) => e.status).filter((s: string) => !['reminder'].includes(s)),
        [
          'placed',
          'payment_verified',
          'sent',
          'outlet_accepted',
          'rider_accepted',
          'confirmed',
          'preparing',
          'ready',
          'picked_up',
          'delivered',
        ],
      );
      assert.ok(done.data.delivered_at);
      assert.equal(done.data.locked, true);
      assert.equal(done.data.can_cancel, false);
      for (const [method, path, body, token] of [
        ['PATCH', url + '/status', { status: 'cancelled', reason: 'Too late' }, admin],
        ['PATCH', url + '/status', { status: 'cancelled' }, customer],
        ['PATCH', '/admin/orders/' + order.id + '/assign', { rider_id: 'rider-1' }, admin],
      ] as const)
        assert.equal((await request(method, path, body, token)).status, 400, path);
      const summary = await request('GET', '/admin/summary', undefined, admin);
      assert.equal(summary.data.delivered, 1);
      assert.equal(summary.data.sales, order.total);
      assert.equal(summary.data.rider_commission, 10000);
      assert.equal(summary.data.outlet_deducted, order.subtotal - Math.round(order.subtotal * 0.1));
      assert.equal(
        summary.data.store_sales,
        order.total - summary.data.outlet_deducted - summary.data.rider_commission,
      );
      const future = new Date(Date.now() + 86400000).toISOString();
      assert.equal(
        (
          await request(
            'GET',
            '/admin/summary?from=' + encodeURIComponent(future),
            undefined,
            admin,
          )
        ).data.orders,
        0,
      );
      const outletSummary = await request('GET', '/manage/outlet/summary', undefined, outlet);
      assert.equal(outletSummary.status, 200, JSON.stringify(outletSummary.data));
      assert.equal(outletSummary.data.delivered, 1);
      assert.equal(outletSummary.data.top_products[0].product_id, 'product-1');
      const earnings = await request('GET', '/rider/earnings', undefined, rider);
      assert.equal(earnings.status, 200);
      assert.equal(earnings.data.earnings.length, 1);
      assert.equal(earnings.data.earnings[0].amount, 10000);
      assert.equal(earnings.data.balance, 10000);
      assert.equal(earnings.data.cash_collected, order.total);
      const inbox = await request('GET', '/notifications', undefined, customer);
      assert.ok(inbox.data.items.some((n: any) => n.title === 'Delivered'));
      assert.ok(inbox.data.unread > 0);
      assert.equal((await request('POST', '/notifications/read-all', {}, customer)).status, 200);
      assert.equal((await request('GET', '/notifications', undefined, customer)).data.unread, 0);
      const outletInbox = await request('GET', '/notifications', undefined, outlet);
      assert.ok(outletInbox.data.items.some((n: any) => n.title === 'New order request'));
      assert.equal(
        (await request('GET', '/notifications', undefined, rider)).data.items.every(
          (n: any) => n.user_id === 'rider-1',
        ),
        true,
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
        400,
      );
    },
  );
  await t.test('cancellation restores stock exactly once', async () => {
    const before = (await one('SELECT stock FROM products WHERE id=?', 'product-1'))!.stock;
    const created = await request('POST', '/orders', orderBody(), customer);
    const url = '/orders/' + created.data.id + '/status';
    assert.equal((await request('PATCH', url, { status: 'cancelled' }, customer)).status, 200);
    assert.equal((await one('SELECT stock FROM products WHERE id=?', 'product-1'))!.stock, before);
    assert.equal((await request('PATCH', url, { status: 'cancelled' }, customer)).status, 400);
    assert.equal((await one('SELECT stock FROM products WHERE id=?', 'product-1'))!.stock, before);
  });
  await t.test('outlet rejection cancels; rider rejection only unassigns', async () => {
    const before = (await one('SELECT stock FROM products WHERE id=?', 'product-1'))!.stock;
    const a = (await request('POST', '/orders', orderBody(), customer)).data;
    const dispatch = (id: string, rider_id = 'rider-1') =>
      request('POST', '/admin/orders/' + id + '/dispatch', { rider_id }, admin);
    assert.equal((await dispatch(a.id)).status, 200);
    const rejected = await request(
      'POST',
      '/orders/' + a.id + '/outlet-response',
      { decision: 'reject', note: 'Out of buns tonight' },
      outlet,
    );
    assert.equal(rejected.status, 200);
    const seen = (await request('GET', '/orders/' + a.id, undefined, customer)).data;
    assert.equal(seen.status, 'cancelled');
    assert.equal(seen.flow.cancel_reason, 'Out of buns tonight');
    assert.equal(seen.flow.cancelled_by, 'outlet');
    assert.equal((await one('SELECT stock FROM products WHERE id=?', 'product-1'))!.stock, before);
    const inbox = (await request('GET', '/notifications', undefined, customer)).data.items;
    assert.ok(inbox.some((n: any) => n.body.includes('Out of buns tonight')));

    const b = (await request('POST', '/orders', orderBody(), customer)).data;
    assert.equal((await dispatch(b.id)).status, 200);
    assert.equal(
      (
        await request(
          'POST',
          '/orders/' + b.id + '/outlet-response',
          { decision: 'accept' },
          outlet,
        )
      ).status,
      200,
    );
    assert.equal(
      (
        await request(
          'POST',
          '/orders/' + b.id + '/rider-response',
          { decision: 'reject', note: 'Bike puncture' },
          rider,
        )
      ).status,
      200,
    );
    let view = (await request('GET', '/orders/' + b.id, undefined, admin)).data;
    assert.equal(view.status, 'placed', 'a rider rejection never cancels');
    assert.equal(view.rider_id, null);
    assert.equal(view.flow.rider_status, 'rejected');
    assert.equal((await request('GET', '/orders/' + b.id, undefined, rider)).status, 404);
    // Off-duty riders cannot be assigned.
    await request('PUT', '/admin/rider-controls/rider-1', { available: false, capacity: 5 }, admin);
    const offDuty = await request(
      'PATCH',
      '/admin/orders/' + b.id + '/assign',
      { rider_id: 'rider-1' },
      admin,
    );
    assert.equal(offDuty.status, 400);
    assert.match(offDuty.data.error, /off duty/);
    const pool = (await request('GET', '/admin/orders/' + b.id + '/riders', undefined, admin)).data;
    assert.match(pool.find((r: any) => r.id === 'rider-1').problem, /off duty/);
    await request('PUT', '/admin/rider-controls/rider-1', { available: true, capacity: 5 }, admin);
    assert.equal(
      (await request('PATCH', '/admin/orders/' + b.id + '/assign', { rider_id: 'rider-1' }, admin))
        .status,
      200,
    );
    view = (await request('GET', '/orders/' + b.id, undefined, admin)).data;
    assert.equal(view.flow.rider_status, 'pending');
    assert.equal(
      (await request('POST', '/orders/' + b.id + '/rider-response', { decision: 'accept' }, rider))
        .status,
      200,
    );
    assert.equal(
      (await request('GET', '/orders/' + b.id, undefined, admin)).data.status,
      'confirmed',
    );
    // While preparing, only an administrator can cancel; the outlet may ask.
    const status = (s: string, token: string, reason = '') =>
      request('PATCH', '/orders/' + b.id + '/status', { status: s, reason }, token);
    assert.equal((await status('preparing', outlet)).status, 200);
    assert.equal((await status('cancelled', customer)).status, 400);
    assert.equal((await status('cancelled', outlet)).status, 403);
    assert.equal(
      (
        await request(
          'POST',
          '/orders/' + b.id + '/cancel-request',
          { reason: 'Oven broke' },
          outlet,
        )
      ).status,
      200,
    );
    assert.equal(
      (await request('GET', '/admin/summary', undefined, admin)).data.attention.cancel_requests,
      1,
    );
    assert.equal((await status('cancelled', admin)).status, 400, 'admins must give a reason');
    assert.equal(
      (
        await request(
          'POST',
          '/admin/orders/' + b.id + '/cancel-request',
          { decision: 'approve', note: '' },
          admin,
        )
      ).status,
      200,
    );
    view = (await request('GET', '/orders/' + b.id, undefined, customer)).data;
    assert.equal(view.status, 'cancelled');
    assert.equal(view.flow.cancel_reason, 'Oven broke');
    assert.equal(view.flow.cancel_request, '');
    assert.ok(
      !view.events.some((e: any) => e.status === 'cancel_requested'),
      'internal events hidden',
    );
  });
  await t.test('riders hand over COD cash and request payouts for admin review', async () => {
    const cash = (await request('GET', '/rider/cash', undefined, rider)).data;
    assert.equal(cash.in_hand, order.total);
    assert.equal(
      (
        await request(
          'POST',
          '/rider/cash/deposits',
          { amount: cash.in_hand + 1, method: 'cash_handover' },
          rider,
        )
      ).status,
      400,
    );
    assert.equal(
      (await request('POST', '/rider/cash/deposits', { amount: 5000, method: 'bank' }, rider))
        .status,
      400,
      'transfers need a transaction ID',
    );
    const dep = await request(
      'POST',
      '/rider/cash/deposits',
      { amount: cash.in_hand, method: 'bank', reference: 'TXN-7788' },
      rider,
    );
    assert.equal(dep.status, 201, JSON.stringify(dep.data));
    assert.equal(dep.data.in_hand, 0);
    assert.equal(dep.data.pending, order.total);
    assert.equal((await request('GET', '/admin/cash', undefined, rider)).status, 403);
    assert.equal(
      (await request('PATCH', '/admin/cash/deposits/' + dep.data.id, { decision: 'reject' }, admin))
        .status,
      400,
    );
    assert.equal(
      (
        await request(
          'PATCH',
          '/admin/cash/deposits/' + dep.data.id,
          { decision: 'approve' },
          admin,
        )
      ).status,
      200,
    );
    const after = (await request('GET', '/rider/cash', undefined, rider)).data;
    assert.deepEqual(
      [after.in_hand, after.approved, after.submitted_range],
      [0, order.total, order.total],
    );

    const statement = (await request('GET', '/rider/earnings', undefined, rider)).data;
    assert.equal(statement.available, 10000);
    assert.equal(
      (await request('POST', '/rider/payout-requests', { amount: 10001, method: 'cash' }, rider))
        .status,
      400,
    );
    const req1 = await request(
      'POST',
      '/rider/payout-requests',
      { amount: 4000, method: 'wallet', account: '03001234567' },
      rider,
    );
    assert.equal(req1.status, 201, JSON.stringify(req1.data));
    assert.equal((await request('GET', '/rider/earnings', undefined, rider)).data.available, 6000);
    const approve = await request(
      'POST',
      '/admin/payouts/requests/' + req1.data.id,
      { decision: 'approve', method: 'wallet', reference: 'EP-55' },
      admin,
    );
    assert.equal(approve.status, 200, JSON.stringify(approve.data));
    const paid = (await request('GET', '/rider/earnings', undefined, rider)).data;
    assert.equal(paid.balance, 6000);
    assert.equal(paid.payouts[0].type, 'request');
    assert.equal(paid.payouts[0].method, 'wallet');
    assert.equal(paid.payouts[0].issued_by, 'Dellvit Admin');
    assert.equal(paid.requests[0].status, 'approved');
    const admins = (await request('GET', '/admin/payouts', undefined, admin)).data;
    assert.equal(admins.payouts[0].reference, 'EP-55');
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
    const riders = (await request('GET', '/admin/riders', undefined, admin)).data;
    const created = riders.find((r: any) => r.login_id === 'DRV-TEST');
    assert.equal(created.commission_type, 'fixed');
    const update = await request(
      'PUT',
      '/admin/riders/' + created.id,
      { ...riderData, commission_type: 'percent', commission_value: 150 },
      admin,
    );
    assert.equal(update.status, 400);
    assert.equal(
      (
        await request(
          'PUT',
          '/admin/riders/' + created.id,
          { ...riderData, commission_type: 'percent', commission_value: 75 },
          admin,
        )
      ).status,
      200,
    );
    const r1 = (await request('GET', '/admin/riders', undefined, admin)).data.find(
      (r: any) => r.id === 'rider-1',
    );
    assert.equal(
      (
        await request(
          'POST',
          '/admin/riders/rider-1/payouts',
          { amount: r1.balance + 1, note: '' },
          admin,
        )
      ).status,
      400,
    );
    const payout = await request(
      'POST',
      '/admin/riders/rider-1/payouts',
      { amount: r1.balance, note: 'Weekly settlement' },
      admin,
    );
    assert.equal(payout.status, 201, JSON.stringify(payout.data));
    assert.equal(payout.data.balance, 0);
    assert.equal(
      (await request('POST', '/admin/riders/rider-1/payouts', { amount: 1, note: '' }, riderToken))
        .status,
      403,
    );
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
    assert.ok(storedObjects.has('documents/' + docId + '.pdf'));
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
    assert.equal(storedObjects.has('documents/' + docId + '.pdf'), false);
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
    assert.ok(await one('SELECT id FROM locations WHERE id=?', loc.data.id));
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

  await t.test('Platform administration, payments and tracking boundaries', async (t) => {
    const admin = await login('admin@dellvit.local');
    const customer = await login('customer@dellvit.local');
    const rider = await login('DRV-001');
    const staffId = randomUUID();
    const staff = {
      name: 'Limited operator',
      email: 'limited@example.com',
      password: 'LimitedAccess@2026',
      active: true,
      permissions: ['products'],
    };
    let limited = '';
    await t.test(
      'separate login rejects the wrong account type and anonymous admin access',
      async () => {
        assert.equal(
          (
            await request('POST', '/auth/login', {
              login: 'admin@dellvit.local',
              password: 'Dellvit@2026',
            })
          ).status,
          403,
        );
        assert.equal(
          (
            await request('POST', '/auth/admin-login', {
              login: 'customer@dellvit.local',
              password: 'Dellvit@2026',
            })
          ).status,
          403,
        );
        assert.equal((await request('GET', '/admin/staff')).status, 401);
        assert.equal((await request('GET', '/admin/staff', undefined, customer)).status, 403);
      },
    );
    await t.test(
      'super admin grants modules; permissions are enforced on every API path',
      async () => {
        assert.equal((await request('PUT', '/admin/staff/' + staffId, staff, admin)).status, 200);
        const r = await request(
          'POST',
          '/auth/admin-login',
          { login: staff.email, password: staff.password },
          undefined,
          { 'x-client': 'mobile' },
        );
        assert.equal(r.status, 200);
        limited = r.data.token;
        assert.equal((await request('GET', '/manage/products', undefined, limited)).status, 200);
        for (const url of [
          '/orders',
          '/admin/staff',
          '/admin/summary',
          '/admin/riders',
          '/admin/records/payments',
          '/admin/customers',
          '/admin/audit',
        ])
          assert.equal((await request('GET', url, undefined, limited)).status, 403, url);
        assert.equal(
          (await request('PUT', '/admin/staff/' + randomUUID(), staff, limited)).status,
          403,
        );
        assert.equal((await request('PUT', '/admin/staff/admin-1', staff, admin)).status, 403);
        assert.equal(
          (await request('PUT', '/admin/staff/' + staffId, { ...staff, permissions: [] }, admin))
            .status,
          200,
        );
        assert.equal((await request('GET', '/manage/products', undefined, limited)).status, 401);
      },
    );
    await t.test(
      'categories and homepage content persist; hidden records and unsafe links stay private',
      async () => {
        const c = {
          name: 'Household care',
          description: 'Real inventory category',
          image: '',
          active: true,
          position: 2,
        };
        assert.equal(
          (await request('PUT', '/admin/records/categories/household', c, admin)).status,
          200,
        );
        assert.ok((await request('GET', '/categories')).data.some((x: any) => x.name === c.name));
        assert.equal(
          (
            await request(
              'PUT',
              '/admin/records/content/banner',
              {
                name: 'Offer',
                type: 'banner',
                description: '',
                image: '',
                link: 'javascript:alert(1)',
                button: 'Open',
                active: true,
                position: 0,
              },
              admin,
            )
          ).status,
          400,
        );
        assert.equal(
          (
            await request(
              'PUT',
              '/admin/records/categories/household',
              { ...c, active: false },
              admin,
            )
          ).status,
          200,
        );
        assert.ok(!(await request('GET', '/categories')).data.some((x: any) => x.name === c.name));
      },
    );
    let manualOrder: any;
    await t.test('store settings control checkout and public support information', async () => {
      const settings = {
        name: 'Real store',
        support_email: 'support@example.com',
        support_phone: '+923001234567',
        support_address: 'Support office',
        about_title: 'About our store',
        about_description: 'Our delivery service.',
        checkout_enabled: false,
        minimum_order: 0,
        show_trust: true,
        show_categories: true,
        show_nearby: true,
        show_how: true,
        show_why: true,
        show_ad: true,
        active: true,
        position: 0,
      };
      assert.equal(
        (await request('PUT', '/admin/records/settings/global', settings, admin)).status,
        200,
      );
      assert.equal(
        (await request('GET', '/site')).data.settings.support_email,
        settings.support_email,
      );
      assert.equal((await request('POST', '/orders', orderBody(), customer)).status, 400);
      assert.equal(
        (
          await request(
            'PUT',
            '/admin/records/settings/global',
            { ...settings, checkout_enabled: true, minimum_order: 10000000 },
            admin,
          )
        ).status,
        200,
      );
      assert.equal((await request('POST', '/orders', orderBody(), customer)).status, 400);
      assert.equal(
        (
          await request(
            'PUT',
            '/admin/records/settings/global',
            { ...settings, checkout_enabled: true },
            admin,
          )
        ).status,
        200,
      );
    });
    await t.test(
      'checkout enforces coupon limits, configured fees and disabled payment methods',
      async () => {
        await run(
          "UPDATE products SET active=1,stock=100,location_id='rawalpindi' WHERE id='product-1'",
        );
        await run("UPDATE outlets SET active=1 WHERE id='outlet-1'");
        const coupon = {
          name: 'Test campaign',
          code: 'SAVE15',
          type: 'percent',
          value: 15,
          minimum: 0,
          limit: 1,
          starts_at: '',
          ends_at: '',
          active: true,
          position: 0,
        };
        assert.equal(
          (await request('PUT', '/admin/records/coupons/save15', coupon, admin)).status,
          200,
        );
        assert.equal(
          (
            await request(
              'PUT',
              '/admin/area-settings/rawalpindi',
              { active: true, radius: 2, fee: 22000 },
              admin,
            )
          ).status,
          200,
        );
        const bank = {
          name: 'Bank transfer',
          type: 'bank',
          bank_name: 'Meezan Bank',
          account_title: 'Real Store',
          account_number: '0123456789',
          iban: 'PK36 MEZN 0000 0001 2345 6789',
          instructions: 'Transfer the total and enter the TID.',
          active: true,
          position: 1,
        };
        assert.equal(
          (await request('PUT', '/admin/records/payments/bank', { ...bank, iban: 'PK12' }, admin))
            .status,
          400,
        );
        assert.equal(
          (
            await request(
              'PUT',
              '/admin/records/payments/wallet',
              {
                name: 'JazzCash',
                type: 'wallet',
                provider: 'JazzCash',
                account_title: 'Store',
                mobile_number: '12345',
              },
              admin,
            )
          ).status,
          400,
        );
        const saved = await request('PUT', '/admin/records/payments/bank', bank, admin);
        assert.equal(saved.status, 200, JSON.stringify(saved.data));
        assert.equal(saved.data.iban, 'PK36MEZN0000000123456789');
        const publicBank = (await request('GET', '/payments')).data.find(
          (m: any) => m.id === 'bank',
        );
        assert.equal(publicBank.account_title, 'Real Store');
        const payment = {
          transaction_id: 'TID-100200',
          payer_name: 'Ayesha Khan',
          payer_account: '0300',
        };
        assert.equal(
          (await request('POST', '/orders', { ...orderBody(), payment_method: 'bank' }, customer))
            .status,
          400,
        );
        const body = { ...orderBody(), coupon_code: 'SAVE15', payment_method: 'bank', payment };
        const q = await request('POST', '/quote', {
          items: body.items,
          location_id: delivery.location_id,
          coupon_code: 'SAVE15',
        });
        assert.equal(q.status, 200);
        assert.equal(q.data.delivery_fee, 22000);
        const r = await request('POST', '/orders', body, customer);
        assert.equal(r.status, 201, JSON.stringify(r.data));
        manualOrder = r.data;
        assert.equal(r.data.total, q.data.total);
        assert.equal(r.data.discount, Math.round(r.data.subtotal * 0.15));
        assert.equal(r.data.payment_status, 'submitted');
        assert.equal(r.data.transaction_id, 'TID-100200');
        assert.equal(r.data.payment_details.bank_name, 'Meezan Bank');
        assert.equal((await request('POST', '/orders', body, customer)).data.id, r.data.id);
        assert.equal(
          (await one('SELECT COUNT(*) n FROM coupon_uses WHERE coupon_id=?', 'save15'))!.n,
          1,
        );
        assert.equal(
          (await request('POST', '/orders', { ...body, idempotency_key: randomUUID() }, customer))
            .status,
          400,
        );
        assert.equal(
          (
            await request(
              'POST',
              '/orders',
              { ...orderBody(), payment_method: 'unconfigured' },
              customer,
            )
          ).status,
          400,
        );
        assert.equal(
          (
            await request(
              'PUT',
              '/admin/area-settings/rawalpindi',
              { active: false, radius: 2, fee: 22000 },
              admin,
            )
          ).status,
          200,
        );
        assert.equal((await request('POST', '/orders', orderBody(), customer)).status, 400);
        assert.equal(
          (
            await request(
              'PUT',
              '/admin/area-settings/rawalpindi',
              { active: true, radius: 8, fee: 15000 },
              admin,
            )
          ).status,
          200,
        );
      },
    );
    await t.test(
      'manual payment requires confirmation; rider location is scoped and terminal orders hide it',
      async () => {
        await run('UPDATE orders SET rider_id=? WHERE id=?', 'rider-1', manualOrder.id);
        const upload = await request(
          'POST',
          '/rider/location',
          { lat: 33.644, lng: 73.071, accuracy: 12 },
          rider,
        );
        assert.equal(upload.status, 200, JSON.stringify(upload.data));
        assert.equal(
          (
            await request(
              'POST',
              '/rider/location',
              { lat: 33.644, lng: 73.071, accuracy: 12 },
              customer,
            )
          ).status,
          403,
        );
        assert.equal(
          (await request('GET', '/orders/' + manualOrder.id, undefined, customer)).data
            .rider_location.accuracy,
          12,
        );
        const outsider = await request('GET', '/orders/' + manualOrder.id);
        assert.equal(outsider.status, 404);
        const outletToken = await login('DLV-001');
        const accept = () =>
          request(
            'PATCH',
            '/orders/' + manualOrder.id + '/status',
            { status: 'confirmed' },
            outletToken,
          );
        assert.equal((await accept()).status, 404, 'unsent orders are invisible to the outlet');
        const early = await request(
          'POST',
          '/admin/orders/' + manualOrder.id + '/dispatch',
          { rider_id: 'rider-1' },
          admin,
        );
        assert.equal(early.status, 400);
        assert.match(early.data.error, /Verify the payment/);
        const outletView = await request(
          'GET',
          '/orders/' + manualOrder.id,
          undefined,
          outletToken,
        );
        assert.equal(outletView.data.transaction_id, undefined);
        assert.equal(
          (
            await request(
              'PATCH',
              '/admin/payments/' + manualOrder.id + '/verify',
              { decision: 'reject' },
              admin,
            )
          ).status,
          400,
        );
        assert.equal(
          (
            await request(
              'PATCH',
              '/admin/payments/' + manualOrder.id + '/verify',
              { decision: 'reject', note: 'No transfer found for this TID.' },
              admin,
            )
          ).status,
          200,
        );
        const rejected = await request('GET', '/orders/' + manualOrder.id, undefined, customer);
        assert.equal(rejected.data.payment_status, 'rejected');
        assert.equal(rejected.data.payment_note, 'No transfer found for this TID.');
        const resubmit = await request(
          'POST',
          '/orders/' + manualOrder.id + '/payment',
          { transaction_id: 'TID-100201', payer_name: 'Ayesha Khan', payer_account: '' },
          customer,
        );
        assert.equal(resubmit.status, 200, JSON.stringify(resubmit.data));
        assert.equal(
          (await request('GET', '/orders/' + manualOrder.id, undefined, customer)).data
            .payment_status,
          'submitted',
        );
        await run("UPDATE orders SET status='picked_up' WHERE id=?", manualOrder.id);
        const verify = { otp: manualOrder.otp, cash_received: true };
        assert.equal(
          (await request('POST', '/orders/' + manualOrder.id + '/verify', verify, rider)).status,
          400,
        );
        assert.equal(
          (
            await request(
              'PATCH',
              '/admin/payments/' + manualOrder.id + '/confirm',
              undefined,
              customer,
            )
          ).status,
          403,
        );
        assert.equal(
          (
            await request(
              'PATCH',
              '/admin/payments/' + manualOrder.id + '/confirm',
              undefined,
              admin,
            )
          ).status,
          200,
        );
        assert.equal(
          (await request('POST', '/orders/' + manualOrder.id + '/verify', verify, rider)).status,
          200,
        );
        assert.equal(
          (await request('GET', '/orders/' + manualOrder.id, undefined, customer)).data
            .rider_location,
          null,
        );
      },
    );
    await t.test(
      'dispatch respects rider availability and capacity; audit log records successful edits',
      async () => {
        const riders = await request('GET', '/admin/tracking', undefined, admin);
        for (const r of riders.data.filter((r: any) => r.location_id === 'rawalpindi'))
          assert.equal(
            (
              await request(
                'PUT',
                '/admin/rider-controls/' + r.id,
                { available: false, capacity: 1 },
                admin,
              )
            ).status,
            200,
          );
        const o = await request('POST', '/orders', orderBody(), customer);
        assert.equal(o.status, 201);
        assert.equal(o.data.rider_id, null);
        const audit = await request('GET', '/admin/audit', undefined, admin);
        assert.ok(audit.data.some((a: any) => a.target.includes('/staff/')));
        assert.ok(!JSON.stringify(audit.data).includes(staff.password));
      },
    );
    await t.test(
      'payment methods can be disabled and deleted; used categories cannot be deleted',
      async () => {
        assert.equal(
          (await request('PATCH', '/admin/records/payments/bank', { active: false }, admin)).status,
          200,
        );
        assert.ok(!(await request('GET', '/payments')).data.some((m: any) => m.id === 'bank'));
        assert.equal(
          (await request('DELETE', '/admin/records/payments/bank', undefined, admin)).status,
          200,
        );
        assert.equal(
          (await request('GET', '/admin/records/payments', undefined, admin)).data.some(
            (m: any) => m.id === 'bank',
          ),
          false,
        );
        assert.equal(
          (await request('DELETE', '/admin/records/categories/Food', undefined, admin)).status,
          409,
        );
        assert.equal(
          (await request('DELETE', '/admin/records/payments/cod', undefined, customer)).status,
          403,
        );
      },
    );
    await t.test(
      'card gateway: secrets stay private, one card method, charges go through the adapter',
      async () => {
        const card = {
          name: 'Card payment',
          type: 'card',
          gateway: 'TestPay',
          environment: 'sandbox',
          public_key: 'pk_test_123',
          secret_key: 'sk_test_secret',
          webhook_secret: 'whsec_secret',
          card_networks: ['Visa', 'Mastercard'],
          active: true,
          position: 5,
        };
        assert.equal(
          (await request('PUT', '/admin/records/payments/card', { ...card, secret_key: '' }, admin))
            .status,
          400,
        );
        const saved = await request('PUT', '/admin/records/payments/card', card, admin);
        assert.equal(saved.status, 200, JSON.stringify(saved.data));
        assert.equal(saved.data.secret_key, '');
        assert.equal(saved.data.secret_key_set, true);
        assert.equal(saved.data.gateway_connected, false);
        // Saving again with blank secrets keeps the stored ones.
        const resaved = await request(
          'PUT',
          '/admin/records/payments/card',
          { ...card, secret_key: '', webhook_secret: '', name: 'Debit / credit card' },
          admin,
        );
        assert.equal(resaved.status, 200, JSON.stringify(resaved.data));
        assert.equal(resaved.data.secret_key_set, true);
        for (const body of [
          (await request('GET', '/payments')).data,
          (await request('GET', '/site')).data,
          (await request('GET', '/admin/records/payments', undefined, admin)).data,
        ]) {
          assert.ok(!JSON.stringify(body).includes('sk_test_secret'));
          assert.ok(!JSON.stringify(body).includes('whsec_secret'));
        }
        assert.equal(
          (await request('PUT', '/admin/records/payments/card-2', card, admin)).status,
          409,
        );
        const cardOrder = (extra = {}) => ({
          ...orderBody(),
          payment_method: 'card',
          payment: { card_token: 'tok_123' },
          ...extra,
        });
        // No adapter registered for this gateway yet: nothing is created or charged.
        const before = (await one('SELECT COUNT(*) n FROM orders'))!.n;
        assert.equal((await request('POST', '/orders', cardOrder(), customer)).status, 503);
        assert.equal((await one('SELECT COUNT(*) n FROM orders'))!.n, before);

        const { cardGateways } = await import('../apps/api/src/cards.js');
        const charges: any[] = [];
        cardGateways.TestPay = {
          async charge(c) {
            charges.push(c);
            return c.token === 'tok_decline'
              ? { status: 'failed', message: 'Card declined by issuer.' }
              : { status: 'paid', transaction_id: 'ch_' + c.reference };
          },
        };
        assert.equal(
          (await request('POST', '/orders', cardOrder({ payment: {} }), customer)).status,
          400,
        );
        const stock = (await one("SELECT stock FROM products WHERE id='product-1'"))!.stock;
        const paid = await request('POST', '/orders', cardOrder(), customer);
        assert.equal(paid.status, 201, JSON.stringify(paid.data));
        assert.equal(paid.data.payment_status, 'paid');
        assert.equal(paid.data.transaction_id, 'ch_' + paid.data.reference);
        assert.equal(charges.at(-1).method.secret_key, 'sk_test_secret');
        assert.equal(charges.at(-1).amount, paid.data.total);
        assert.ok(!JSON.stringify(paid.data.payment_details).includes('sk_test'));
        assert.equal(
          (await request('PATCH', '/admin/payments/' + paid.data.id + '/verify', {}, admin)).status,
          400,
        );

        const declined = await request(
          'POST',
          '/orders',
          cardOrder({ payment: { card_token: 'tok_decline' } }),
          customer,
        );
        assert.equal(declined.status, 402);
        assert.equal(declined.data.error, 'Card declined by issuer.');
        const failed = (await one(
          "SELECT o.status,d.payment_status FROM orders o JOIN order_details d ON d.order_id=o.id WHERE d.payment_note='Card declined by issuer.'",
        ))!;
        assert.deepEqual({ ...failed }, { status: 'cancelled', payment_status: 'failed' });
        assert.equal(
          (await one("SELECT stock FROM products WHERE id='product-1'"))!.stock,
          stock - 2,
        );
        delete cardGateways.TestPay;
      },
    );
  });
});
