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
const { outbox } = await import('../apps/api/src/mail.js');
/** The code in the latest verification email sent to an address. */
const emailedCode = (to: string) =>
  outbox
    .filter((m) => m.to === to && m.subject === 'Verification Code')
    .at(-1)!
    .text.match(/code is (\d{6})/)![1];
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
      (await request('GET', '/admin/attention', undefined, admin)).data.cancel_requests,
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
  await t.test('product form validates payment methods, area, SKU and order limit', async () => {
    const p = (await request('GET', '/products/product-2')).data;
    const save = (body: object) => request('PUT', '/manage/products/product-2', body, outlet);
    // At least one existing payment method is required; unknown ids are dropped.
    for (const payment_methods of [[], ['no-such-method']]) {
      const r = await save({ ...p, payment_methods });
      assert.equal(r.status, 400);
      assert.match(r.data.error, /payment method/);
    }
    const r = await save({
      ...p,
      payment_methods: ['cod', 'no-such-method', 'cod'],
      sku: 'BRG-FAM-4',
      includes: '',
      excludes: '',
      max_per_order: 3,
    });
    assert.equal(r.status, 200, JSON.stringify(r.data));
    assert.deepEqual(r.data.payment_methods, ['cod']);
    assert.equal(r.data.max_per_order, 3);
    const p1 = (await request('GET', '/products/product-1')).data;
    assert.equal(
      (await request('PUT', '/manage/products/product-1', { ...p1, sku: 'BRG-FAM-4' }, outlet))
        .status,
      409,
    );
    const over = await request(
      'POST',
      '/orders',
      { ...orderBody(), items: [{ product_id: 'product-2', quantity: 4 }] },
      customer,
    );
    assert.equal(over.status, 400);
    assert.match(over.data.error, /up to 3/);
    // The delivery area is chosen per product and must be a supported area.
    const moved = await save({ ...p, location_id: 'islamabad' });
    assert.equal(moved.status, 200, JSON.stringify(moved.data));
    assert.equal(moved.data.location_id, 'islamabad');
    assert.equal((await save({ ...p, location_id: 'no-such-area' })).status, 400);
    assert.equal((await save({ ...p, sku: '' })).status, 200);
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
  await t.test('rider profiles, dispatch switches and private notes', async () => {
    const riders = async () => (await request('GET', '/admin/riders', undefined, admin)).data;
    const profile = {
      name: 'Profile Rider',
      phone: '03001112225',
      location_id: 'rawalpindi',
      login_id: 'DRV-PROFILE',
      password: 'Dellvit@2026',
      vehicle_type: 'motorbike',
      vehicle_number: 'RIK-1234',
      cnic: '37405-1234567-1',
      emergency_name: 'Brother',
      emergency_phone: '03001112226',
      payout_method: 'wallet',
      payout_bank: 'JazzCash',
      payout_account: '03001112225',
      notes: 'Reliable on night shifts',
      capacity: 3,
      available: 0,
    };
    // Riders sign in with their ID, so no email or address is needed.
    const created = await request('POST', '/admin/riders', profile, admin);
    assert.equal(created.status, 200, JSON.stringify(created.data));
    let row = (await riders()).find((r: any) => r.login_id === 'DRV-PROFILE');
    assert.equal(row.email, '');
    assert.equal(row.vehicle_number, 'RIK-1234');
    assert.equal(row.payout_bank, 'JazzCash');
    assert.equal(row.capacity, 3);
    assert.equal(row.available, 0);
    assert.equal(row.balance, 0);
    assert.equal(row.cash_in_hand, 0);
    assert.equal(row.commission_type, 'fixed');

    const save = (extra: object) =>
      request('PUT', '/admin/riders/' + row.id, { ...profile, password: undefined, ...extra }, admin);
    assert.equal((await save({ cnic: '123' })).status, 400);
    assert.equal((await save({ vehicle_type: 'helicopter' })).status, 400);
    assert.equal((await save({ vehicle_type: 'car', email: 'profile@test.example' })).status, 200);

    const flip = (body: object, as = admin) =>
      request('PATCH', '/admin/riders/' + row.id, body, as);
    assert.equal((await flip({ available: 1 })).status, 200);
    assert.equal((await flip({ capacity: 7 })).status, 200);
    assert.equal((await flip({ capacity: 0 })).status, 400);
    assert.equal((await flip({ active: 0 }, rider)).status, 403);
    assert.equal((await request('PATCH', '/admin/riders/customer-1', { active: 0 }, admin)).status, 404);
    row = (await riders()).find((r: any) => r.login_id === 'DRV-PROFILE');
    assert.equal(row.email, 'profile@test.example');
    assert.equal(row.vehicle_type, 'car');
    assert.equal(row.available, 1);
    assert.equal(row.capacity, 7);
    assert.equal(row.notes, profile.notes);

    // The rider sees their commission, never the administrators' notes.
    await run("UPDATE rider_settings SET notes='Private' WHERE user_id='rider-1'");
    const own = await request('GET', '/rider/earnings', undefined, rider);
    assert.equal(own.status, 200);
    assert.equal(own.data.settings.commission_type, 'fixed');
    assert.equal(own.data.settings.notes, undefined);
  });
  await t.test('delivery area fees, minimums, hours and deletion', async () => {
    const areas = async () => (await request('GET', '/admin/area-settings', undefined, admin)).data;
    const pindi = (await areas()).find((a: any) => a.id === 'rawalpindi');
    assert.ok(pindi.outlets > 0 && pindi.riders > 0);
    assert.equal(typeof pindi.orders, 'number');
    const body = { name: pindi.name, lat: pindi.lat, lng: pindi.lng };
    const save = (extra: object) =>
      request('PUT', '/admin/locations/rawalpindi', { ...body, ...extra }, admin);
    const order = () => request('POST', '/orders', orderBody(), customer);
    const quote = async () =>
      (
        await request('POST', '/quote', {
          items: [{ product_id: 'product-1', quantity: 2 }],
          location_id: 'rawalpindi',
        })
      ).data;

    // Two of product-1 come to PKR 1,173.
    assert.equal((await quote()).delivery_fee, pindi.fee);
    assert.equal((await save({ free_delivery_over: 100000 })).status, 200);
    const free = await quote();
    assert.equal(free.delivery_fee, 0);
    assert.equal(free.total, free.subtotal);
    assert.equal((await save({ free_delivery_over: 200000 })).status, 200);
    assert.equal((await quote()).delivery_fee, pindi.fee);
    assert.equal((await save({ free_delivery_over: 0, minimum_order: 200000 })).status, 200);
    assert.match((await order()).data.error, /minimum order in this area/);
    assert.equal((await save({ minimum_order: 0 })).status, 200);

    const now = Number(
      new Intl.DateTimeFormat('en-GB', {
        timeZone: 'Asia/Karachi',
        hour: '2-digit',
        hourCycle: 'h23',
      }).format(new Date()),
    );
    const at = (offset: number) => String((now + offset) % 24).padStart(2, '0') + ':00';
    assert.equal((await save({ opens_at: at(2) })).status, 400, 'both times are required');
    assert.equal((await save({ opens_at: at(2), closes_at: at(3) })).status, 200);
    assert.match((await order()).data.error, /Delivery in this area runs from/);
    assert.equal((await save({ opens_at: '', closes_at: '' })).status, 200);

    // The table switch pauses an area and leaves every other setting alone.
    const flip = (active: boolean, token = admin) =>
      request('PATCH', '/admin/area-settings/rawalpindi', { active }, token);
    assert.equal((await flip(false)).status, 200);
    assert.ok(!(await request('GET', '/locations')).data.some((l: any) => l.id === 'rawalpindi'));
    assert.match((await order()).data.error, /paused in this area/);
    assert.equal((await flip(true, customer)).status, 403);
    assert.equal((await flip(true)).status, 200);
    const after = (await areas()).find((a: any) => a.id === 'rawalpindi');
    for (const key of ['active', 'radius', 'fee', 'minimum_order', 'free_delivery_over', 'opens_at'])
      assert.equal(after[key], pindi[key], key);

    // An area with live outlets or products cannot be deleted; an unused one can, in a single saved request.
    assert.equal(
      (await request('DELETE', '/admin/locations/rawalpindi', undefined, admin)).status,
      409,
    );
    const made = await request(
      'POST',
      '/admin/locations',
      { name: 'Temporary area', lat: 33.7, lng: 73.1, radius: 3, fee: 9000, active: false },
      admin,
    );
    assert.equal(made.status, 201, JSON.stringify(made.data));
    assert.equal(made.data.radius, 3);
    assert.equal(made.data.fee, 9000);
    assert.equal(made.data.active, 0);
    assert.equal(
      (await request('DELETE', '/admin/locations/' + made.data.id, undefined, admin)).status,
      200,
    );
    assert.ok(!(await areas()).some((a: any) => a.id === made.data.id));

    // An area whose outlets and products are all deleted goes too: it is hidden, its history
    // stays, and accounts in it are left without an area.
    const old = await request(
      'POST',
      '/admin/locations',
      { name: 'Old area', lat: 33.7, lng: 73.1 },
      admin,
    );
    const gone = () => request('DELETE', '/admin/locations/' + old.data.id, undefined, admin);
    const before = (await one('SELECT location_id FROM products WHERE id=?', 'product-3'))!;
    await run('UPDATE products SET location_id=? WHERE id=?', old.data.id, 'product-3');
    const home = (await one('SELECT location_id FROM users WHERE id=?', 'customer-1'))!.location_id;
    await run('UPDATE users SET location_id=? WHERE id=?', old.data.id, 'customer-1');
    const refused = await gone();
    assert.equal(refused.status, 409);
    assert.match(refused.data.error, /still has 1 product\./);
    assert.equal((await areas()).find((a: any) => a.id === old.data.id).all_products, 1);
    await run("UPDATE products SET active=0,deleted_at='2026-01-01' WHERE id=?", 'product-3');
    const closed = await gone();
    assert.equal(closed.status, 200, JSON.stringify(closed.data));
    assert.equal(closed.data.kept, true);
    assert.ok(!(await areas()).some((a: any) => a.id === old.data.id));
    assert.ok(!(await request('GET', '/locations')).data.some((l: any) => l.id === old.data.id));
    assert.ok((await one('SELECT deleted_at FROM locations WHERE id=?', old.data.id))!.deleted_at);
    assert.equal((await one('SELECT location_id FROM users WHERE id=?', 'customer-1'))!.location_id, null);
    assert.equal((await gone()).status, 404);
    await run('UPDATE products SET location_id=?,active=1,deleted_at=NULL WHERE id=?', before.location_id, 'product-3');
    await run('UPDATE users SET location_id=? WHERE id=?', home, 'customer-1');
    // The refused checkouts above must not use up the order limit the later tests rely on.
    await run("DELETE FROM rate_limits WHERE key LIKE 'write:%'");
  });
  await t.test('outlet ordering controls are enforced and private details stay private', async () => {
    const o = (await request('GET', '/admin/outlets', undefined, admin)).data.find(
      (x: any) => x.id === 'outlet-1',
    );
    assert.ok(o.products > 0);
    assert.equal(o.open, true);
    const save = (extra: object) =>
      request('PUT', '/admin/outlets/outlet-1', { ...o, ...extra }, admin);
    const order = () => request('POST', '/orders', orderBody(), customer);
    const shown = async () => (await request('GET', '/outlets/outlet-1')).data;

    assert.equal((await save({ minimum_order: 200000 })).status, 200);
    const small = await order();
    assert.equal(small.status, 400);
    assert.match(small.data.error, /minimum order for this outlet/);
    assert.equal((await shown()).minimum_order, 200000);
    assert.equal((await save({ minimum_order: 0 })).status, 200);

    // Opening hours are Pakistan time: a window starting two hours from now is closed.
    const now = Number(
      new Intl.DateTimeFormat('en-GB', {
        timeZone: 'Asia/Karachi',
        hour: '2-digit',
        hourCycle: 'h23',
      }).format(new Date()),
    );
    const at = (offset: number) => String((now + offset) % 24).padStart(2, '0') + ':00';
    assert.equal((await save({ opens_at: at(2) })).status, 400, 'both times are required');
    assert.equal((await save({ opens_at: at(2), closes_at: at(2) })).status, 400);
    assert.equal((await save({ opens_at: at(2), closes_at: at(3) })).status, 200);
    const closed = await order();
    assert.equal(closed.status, 400);
    assert.match(closed.data.error, /takes orders from/);
    assert.equal((await shown()).open, false);
    assert.equal((await save({ opens_at: at(23), closes_at: at(2) })).status, 200);
    assert.equal((await shown()).open, true);
    assert.equal((await save({ opens_at: '', closes_at: '' })).status, 200);

    assert.equal((await save({ accepting: 0, featured: 1 })).status, 200);
    assert.match((await order()).data.error, /not accepting orders/);
    assert.equal((await shown()).open, false);
    assert.equal((await request('GET', '/outlets?location=rawalpindi')).data[0].id, 'outlet-1');
    assert.equal((await save({ accepting: 1, featured: 0 })).status, 200);

    const secret = { notes: 'Pays late', payout_account: 'PK36SCBL0000001123456702' };
    assert.equal((await save({ ...secret, description: 'Burgers since 1998' })).status, 200);
    const own = (await request('GET', '/manage/outlet', undefined, outlet)).data;
    assert.equal(own.description, 'Burgers since 1998');
    const view = await shown();
    for (const seen of [own, view]) {
      assert.equal(seen.notes, undefined);
      assert.equal(seen.payout_account, undefined);
    }
    const saved = (await request('GET', '/admin/outlets', undefined, admin)).data.find(
      (x: any) => x.id === 'outlet-1',
    );
    assert.equal(saved.notes, secret.notes);
    assert.equal(saved.commission_rate, o.commission_rate);

    // The table switches change one flag and leave every other setting alone.
    const flip = (body: object, token = admin) =>
      request('PATCH', '/admin/outlets/outlet-1', body, token);
    const paused = await flip({ accepting: 0 });
    assert.equal(paused.status, 200, JSON.stringify(paused.data));
    assert.equal(paused.data.open, false);
    assert.match((await order()).data.error, /not accepting orders/);
    assert.equal((await flip({ accepting: 1 })).data.open, true);
    assert.equal((await flip({ active: 0 })).status, 200);
    assert.equal((await request('GET', '/outlets/outlet-1')).status, 404);
    assert.equal((await flip({ active: 1 })).status, 200);
    assert.equal((await flip({ active: 2 })).status, 400);
    assert.equal((await flip({ active: 0 }, outlet)).status, 403);
    assert.equal((await request('PATCH', '/admin/outlets/nope', { active: 0 }, admin)).status, 404);
    assert.equal((await request('GET', '/manage/outlet', undefined, outlet)).data.description, 'Burgers since 1998');
  });
  await t.test('category settings drive the home page, usage counts and new outlets', async () => {
    const categories = async () =>
      (await request('GET', '/admin/records/categories', undefined, admin)).data;
    const { id: foodId, ...food } = (await categories()).find((c: any) => c.name === 'Food');
    assert.ok(food.products > 0 && food.outlets > 0);
    const put = (id: string, body: object) =>
      request('PUT', '/admin/records/categories/' + id, body, admin);
    const homeFood = async () =>
      (await request('GET', '/home?location=rawalpindi')).data.categories.find(
        (c: any) => c.name === 'Food',
      );
    assert.ok((await homeFood()).products.length > 1);
    assert.equal((await put(foodId, { ...food, home_limit: 1 })).status, 200);
    assert.equal((await homeFood()).products.length, 1);
    assert.equal((await put(foodId, { ...food, home_limit: 25 })).status, 400);
    assert.equal((await put(foodId, { ...food, home_limit: 8 })).status, 200);

    const bakery = {
      name: 'Bakery',
      description: '',
      image: '',
      active: true,
      position: 9,
      show_in_filters: false,
      commission_rate: 17.5,
    };
    assert.equal((await put('bakery', bakery)).status, 200);
    const listed = (await request('GET', '/categories')).data.find((c: any) => c.name === 'Bakery');
    assert.equal(listed.show_in_filters, false);
    assert.equal(listed.commission_rate, undefined, 'commission is not public');
    const outletData = {
      name: 'Test bakery',
      phone: '03001112224',
      email: 'bakery@test.example',
      location_id: 'rawalpindi',
      address: 'Bakery on 6th Road',
      lat: 33.6442,
      lng: 73.0713,
      customer_id: 'DLV-BAKE',
      password: 'Dellvit@2026',
      image: '/images/food.webp',
      category: 'Bakery',
      active: 1,
    };
    const created = await request('POST', '/admin/outlets', outletData, admin);
    assert.equal(created.status, 200, JSON.stringify(created.data));
    assert.equal(created.data.commission_rate, 17.5);
    const counted = (await categories()).find((c: any) => c.name === 'Bakery');
    assert.equal(counted.outlets, 1);
    assert.equal(counted.products, 0);

    // The table switches save one flag without a full category save.
    const flip = await request(
      'PATCH',
      '/admin/records/categories/bakery',
      { show_in_filters: true, show_on_home: false },
      admin,
    );
    assert.equal(flip.status, 200, JSON.stringify(flip.data));
    const flipped = (await categories()).find((c: any) => c.name === 'Bakery');
    assert.equal(flipped.show_in_filters, true);
    assert.equal(flipped.show_on_home, false);
    assert.equal(flipped.commission_rate, 17.5);
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
    const loc = await request(
      'POST',
      '/admin/locations',
      { name: 'Test area', lat: 33.6, lng: 73.1 },
      admin,
    );
    assert.equal(loc.status, 201);
    assert.ok(await one('SELECT id FROM locations WHERE id=?', loc.data.id));
  });
  await t.test('advertising: several ads with places, areas, schedules, limits and counts', async () => {
    const ad = {
      name: 'Fresh picks',
      title: 'Fresh local picks',
      description: 'A new advertisement',
      label: 'SPONSORED',
      link: '/search',
      button: 'Explore',
      image: '/images/rider.webp',
      format: 'banner',
      theme: 'brand',
      placements: ['bottom', 'search', 'bottom'],
      active: true,
    };
    const putAd = (id: string, body: object, token = admin) =>
      request('PUT', '/admin/records/ads/' + id, body, token);
    const shown = async () => (await request('GET', '/site')).data.ads as any[];
    const isShown = async (id: string) => (await shown()).some((a) => a.id === id);
    assert.equal((await putAd('ad-1', ad, customer)).status, 403);
    const saved = await putAd('ad-1', { ...ad, advertiser: 'Acme', notes: 'Paid monthly', max_views: 2 });
    assert.equal(saved.status, 200, JSON.stringify(saved.data));
    for (const bad of [
      { link: 'javascript:alert(1)' },
      { link: 'http://insecure.example' },
      { placements: [] },
      { placements: ['sidebar'] },
      { format: 'image', image: '' },
      { format: 'cover', image: '' },
      { title: '' },
      { starts_at: '2030-02-01T00:00:00.000Z', ends_at: '2030-01-01T00:00:00.000Z' },
    ])
      assert.equal((await putAd('ad-x', { ...ad, ...bad })).status, 400, JSON.stringify(bad));
    // A second ad for other areas, on another page position, starting later.
    const later = await putAd('ad-2', {
      ...ad,
      name: 'Partner',
      title: 'Partner offer',
      link: 'https://partner.example/offer',
      format: 'card',
      placements: ['top'],
      location_ids: ['somewhere'],
      starts_at: new Date(Date.now() + 3600000).toISOString(),
    });
    assert.equal(later.status, 200, JSON.stringify(later.data));
    const mine = (await shown()).find((a) => a.id === 'ad-1');
    assert.deepEqual(mine.placements, ['bottom', 'search']);
    for (const hidden of ['name', 'advertiser', 'notes', 'max_views'])
      assert.equal(mine[hidden], undefined, hidden + ' stays in the admin panel');
    assert.equal(await isShown('ad-2'), false, 'not before its start');
    // Views and clicks are counted per day; unknown ads and repeats in one request are ignored.
    const track = (body: object) => request('POST', '/ads/track', body);
    assert.equal((await track({ views: ['ad-1', 'ad-1', 'missing'] })).status, 200);
    assert.equal((await track({ click: 'ad-1' })).status, 200);
    assert.equal((await track({ views: 'ad-1' })).status, 400);
    assert.equal((await one("SELECT COUNT(*) n FROM ad_stats WHERE ad_id='missing'"))!.n, 0);
    assert.equal((await request('GET', '/admin/ads', undefined, customer)).status, 403);
    const report = (await request('GET', '/admin/ads', undefined, admin)).data;
    const row = report.ads.find((a: any) => a.id === 'ad-1');
    assert.deepEqual(
      [row.views, row.clicks, row.views_range, row.clicks_range, row.advertiser],
      [1, 1, 1, 1, 'Acme'],
    );
    assert.deepEqual(
      [report.days.length, report.days[0].views, report.days[0].clicks],
      [1, 1, 1],
    );
    const old = (
      await request('GET', '/admin/ads?from=2020-01-01T00:00:00.000Z&to=2020-01-31T00:00:00.000Z', undefined, admin)
    ).data;
    assert.equal(old.ads.find((a: any) => a.id === 'ad-1').views_range, 0);
    assert.equal(old.ads.find((a: any) => a.id === 'ad-1').views, 1);
    // The ad ends at its view limit, and starts again when its counts are reset.
    await track({ views: ['ad-1'] });
    assert.equal(await isShown('ad-1'), false, 'the view limit ends the ad');
    assert.equal((await request('DELETE', '/admin/ads/ad-1/stats', undefined, admin)).status, 200);
    assert.equal(await isShown('ad-1'), true);
    assert.equal((await request('PATCH', '/admin/records/ads/ad-1', { active: false }, admin)).status, 200);
    assert.equal(await isShown('ad-1'), false);
    // Deleting an ad removes its counts too.
    await track({ views: ['ad-2'] });
    assert.equal((await request('DELETE', '/admin/records/ads/ad-2', undefined, admin)).status, 200);
    assert.equal((await one("SELECT COUNT(*) n FROM ad_stats WHERE ad_id='ad-2'"))!.n, 0);
  });
  await t.test('support chat: accounts and the support team exchange messages and files', async () => {
    await run("DELETE FROM rate_limits WHERE key LIKE 'write:%'");
    const badge = async (token: string) =>
      (await request('GET', '/notifications?limit=1', undefined, token)).data.support_unread;
    const multipart = (name: string, type: string, file: Buffer, text = '') => {
      const boundary = 'chat-boundary';
      return {
        headers: { 'content-type': 'multipart/form-data; boundary=' + boundary },
        payload: Buffer.concat([
          Buffer.from(
            `--${boundary}\r\nContent-Disposition: form-data; name="body"\r\n\r\n${text}\r\n--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${name}"\r\nContent-Type: ${type}\r\n\r\n`,
          ),
          file,
          Buffer.from(`\r\n--${boundary}--\r\n`),
        ]),
      };
    };
    const send = async (url: string, token: string, part: ReturnType<typeof multipart>) => {
      const r = await inject(app as any, {
        method: 'POST',
        url: '/api' + url,
        headers: { authorization: 'Bearer ' + token, ...part.headers },
        payload: part.payload,
      });
      return { status: r.statusCode, data: r.json() };
    };
    const open = async (id: string, token: string) =>
      inject(app as any, {
        method: 'GET',
        url: '/api/support/files/' + id,
        headers: { authorization: 'Bearer ' + token },
      });
    assert.equal((await request('GET', '/support')).status, 401);
    assert.equal((await request('GET', '/support', undefined, admin)).status, 403);
    assert.deepEqual((await request('GET', '/support', undefined, customer)).data, {
      thread: null,
      messages: [],
    });
    assert.equal((await request('POST', '/support/messages', { body: '  ' }, customer)).status, 400);
    const waiting = await badge(admin);
    const alerts = async () =>
      Number((await one("SELECT COUNT(*) n FROM notifications WHERE title='New support message'"))!.n);
    const alerted = await alerts();
    assert.equal(
      (await request('POST', '/support/messages', { body: 'Where is my order?' }, customer)).status,
      201,
    );
    await request('POST', '/support/messages', { body: 'It is late.' }, customer);
    assert.equal(await badge(admin), waiting + 2);
    assert.ok((await alerts()) > alerted, 'the support team is alerted');
    const perAdmin = (await alerts()) - alerted;
    await request('POST', '/support/messages', { body: 'Hello?' }, customer);
    assert.equal((await alerts()) - alerted, perAdmin, 'one alert until the conversation is read');
    // A rider attaches a picture.
    const picture = await send(
      '/support/messages',
      rider,
      multipart('bike.webp', 'image/webp', readFileSync(resolve('apps/web/public/images/food.webp')), 'My bike'),
    );
    assert.equal(picture.status, 201, JSON.stringify(picture.data));
    assert.equal(picture.data.file_type, 'image/webp');
    assert.equal(
      (await send('/support/messages', rider, multipart('x.exe', 'application/octet-stream', Buffer.from('MZ not a picture')))).status,
      400,
    );
    assert.equal((await open(picture.data.id, rider)).statusCode, 200);
    assert.equal((await open(picture.data.id, customer)).statusCode, 404, 'files are private');
    assert.equal((await open(picture.data.id, admin)).statusCode, 200);
    // The support team's inbox.
    assert.equal((await request('GET', '/admin/support', undefined, customer)).status, 403);
    const inbox = (await request('GET', '/admin/support', undefined, admin)).data;
    const mine = inbox.threads.find((x: any) => x.last_text === 'Hello?');
    assert.deepEqual([mine.staff_unread, mine.role, mine.status], [3, 'customer', 'open']);
    assert.equal(inbox.threads[0].role, 'rider', 'newest first');
    assert.ok(inbox.team.some((a: any) => a.id === inbox.me));
    const chat = (await request('GET', '/admin/support/' + mine.user_id, undefined, admin)).data;
    assert.equal(chat.messages.length, 3);
    assert.equal(chat.user.email, 'customer@dellvit.local');
    assert.equal(await badge(admin), waiting + 1, 'opening it marks it read; the rider still waits');
    // A reply with a PDF reaches the customer, and takes the conversation.
    const reply = await send(
      '/admin/support/' + mine.user_id + '/messages',
      admin,
      multipart('invoice.pdf', 'application/pdf', Buffer.from('%PDF-1.4 test'), 'Here is your invoice.'),
    );
    assert.equal(reply.status, 201, JSON.stringify(reply.data));
    // Receipts: sent, then delivered when the customer's device checks in, then seen.
    const receipt = async () =>
      (await request('GET', '/admin/support/' + mine.user_id, undefined, admin)).data.thread;
    const sent = await receipt();
    assert.ok(!(sent.delivered_at >= reply.data.created_at), 'not delivered yet');
    assert.ok(!(sent.seen_at >= reply.data.created_at), 'not seen yet');
    assert.equal(await badge(customer), 1);
    const delivered = await receipt();
    assert.ok(delivered.delivered_at >= reply.data.created_at, 'delivered once the device checked in');
    assert.ok(!(delivered.seen_at >= reply.data.created_at), 'delivered is not seen');
    const pdf = await open(reply.data.id, customer);
    assert.equal(pdf.statusCode, 200);
    assert.match(pdf.headers['content-disposition'] as string, /attachment/);
    const seen = (await request('GET', '/support', undefined, customer)).data;
    assert.equal(seen.messages.length, 4);
    assert.equal(seen.messages.at(-1).sender_name, undefined, 'staff names stay private');
    assert.ok((await receipt()).seen_at >= reply.data.created_at, 'seen once the customer opened the chat');
    assert.ok(seen.thread.seen_at >= seen.messages[0].created_at, 'the customer sees their own messages were read');
    assert.equal(await badge(customer), 0);
    const thread = async () => (await one('SELECT * FROM support_threads WHERE user_id=?', mine.user_id))!;
    assert.equal((await thread()).assigned_to, inbox.me);
    // Closing, and reopening by a new message.
    const patch = (body: object) => request('PATCH', '/admin/support/' + mine.user_id, body, admin);
    assert.equal((await patch({ status: 'closed', assigned_to: null })).status, 200);
    assert.deepEqual([(await thread()).status, (await thread()).assigned_to], ['closed', null]);
    assert.equal((await patch({ assigned_to: 'nobody' })).status, 400);
    await request('POST', '/support/messages', { body: 'One more thing' }, customer);
    assert.equal((await thread()).status, 'open');
    assert.equal(
      (await request('POST', '/admin/support/' + inbox.me + '/messages', { body: 'x' }, admin)).status,
      404,
      'administrators have no conversation',
    );
    // Deleting a conversation removes its files.
    const riderId = inbox.threads[0].user_id;
    assert.equal(storedObjects.size > 0 && [...storedObjects.keys()].some((k) => k.startsWith('support/')), true);
    assert.equal((await request('DELETE', '/admin/support/' + riderId, undefined, admin)).status, 200);
    assert.equal((await open(picture.data.id, admin)).statusCode, 404);
    // Contact form messages are worked through.
    const contact = (await request('GET', '/admin/messages', undefined, admin)).data[0];
    assert.equal(contact.status, 'new');
    const before = await badge(admin);
    assert.equal(
      (await request('PATCH', '/admin/messages/' + contact.id, { status: 'resolved', note: 'Called back' }, admin)).status,
      200,
    );
    assert.equal(await badge(admin), before - 1);
    assert.equal((await request('GET', '/admin/messages', undefined, admin)).data[0].note, 'Called back');
    await run("DELETE FROM rate_limits WHERE key LIKE 'write:%'");
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
    // These checks make many sign-in requests; the per-address request limit is not what they test.
    await run("DELETE FROM rate_limits WHERE key LIKE 'auth:%'");
    // Signing up opens no session: the account waits for the emailed code.
    const r = await request('POST', '/auth/register', p, undefined, { 'x-client': 'mobile' });
    assert.equal(r.status, 201, JSON.stringify(r.data));
    assert.equal(r.data.verify, true);
    assert.equal(r.data.user, undefined);
    assert.equal(r.data.token, undefined);
    assert.match(outbox.at(-1)!.html, /Confirm your email/);
    const signIn = () => request('POST', '/auth/login', { login: p.email, password: p.password });
    const early = await signIn();
    assert.equal(early.status, 403);
    assert.equal(early.data.code, 'verify_email');
    assert.equal(early.data.email, p.email);
    const again = await request('POST', '/auth/register', p);
    assert.equal(again.status, 409);
    assert.equal(again.data.code, 'verify_email');
    // The server enforces the wait between codes: nothing is sent and the first code stays valid.
    const mails = outbox.length;
    const resendCode = () => request('POST', '/auth/resend-code', { email: p.email });
    const resend = await resendCode();
    assert.equal(resend.status, 429);
    assert.ok(resend.data.retry_in > 0 && resend.data.retry_in <= 60);
    assert.match(resend.data.error, /Please wait/);
    assert.equal(outbox.length, mails);
    // Once the wait has passed another code goes out, up to five in the hour.
    const ago = (seconds: number) => new Date(Date.now() - seconds * 1000).toISOString();
    await run('UPDATE email_codes SET sent_at=?', ago(61));
    const second = await resendCode();
    assert.equal(second.status, 200, JSON.stringify(second.data));
    assert.equal(second.data.retry_in, 60);
    assert.equal(outbox.length, mails + 1);
    await run('UPDATE email_codes SET sent_at=?,sends=5', ago(61));
    const capped = await resendCode();
    assert.equal(capped.status, 429);
    assert.match(capped.data.error, /Too many codes requested/);
    assert.ok(capped.data.retry_in > 3000, 'the wait runs to the end of the hour');
    assert.equal((await signIn()).data.retry_in, capped.data.retry_in, 'signing in cannot get around it');
    assert.equal(outbox.length, mails + 1);
    // A new hour starts the count again.
    await run('UPDATE email_codes SET sent_at=?,window_at=?', ago(3700), ago(3700));
    assert.equal((await resendCode()).status, 200);
    assert.equal((await one('SELECT sends FROM email_codes'))!.sends, 1);
    const code = emailedCode(p.email);
    assert.equal(
      (await request('POST', '/auth/resend-code', { email: 'nobody@example.com' })).status,
      200,
      'unknown addresses get the same answer',
    );
    // These checks make many sign-in requests; the per-address request limit is not what they test.
    await run("DELETE FROM rate_limits WHERE key LIKE 'auth:%'");
    const verify = (value: string) =>
      request('POST', '/auth/verify-email', { email: p.email, code: value }, undefined, {
        'x-client': 'mobile',
      });
    const wrong = await verify(code === '000000' ? '000001' : '000000');
    assert.equal(wrong.status, 400);
    assert.match(wrong.data.error, /4 attempts left/);
    assert.equal((await one('SELECT attempts FROM email_codes'))!.attempts, 1);
    const verified = await verify(code);
    assert.equal(verified.status, 200, JSON.stringify(verified.data));
    assert.equal(verified.data.user.password_hash, undefined);
    assert.equal(verified.data.user.admin_notes, undefined);
    assert.ok(verified.data.user.email_verified_at);
    assert.equal(outbox.at(-1)!.subject, 'Welcome to Dellvit');
    assert.equal((await verify(code)).status, 409, 'a code cannot be used twice');
    assert.equal((await signIn()).status, 200);
    const token = verified.data.token;
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
    await run("DELETE FROM rate_limits WHERE key LIKE 'auth:%'");
  });
  await t.test('home page content: designs, schedules, areas and video links', async () => {
    const put = (id: string, body: object) =>
      request('PUT', '/admin/records/content/' + id, body, admin);
    const shown = async () => (await request('GET', '/site')).data.content;
    const day = 86400000;
    const at = (offset: number) => new Date(Date.now() + offset).toISOString();
    // A block saved with only the basics gets the default design, place and audience.
    const basic = { name: 'Weekend deals', type: 'section', active: true, position: 1 };
    const saved = await put('deals', basic);
    assert.equal(saved.status, 200, JSON.stringify(saved.data));
    assert.equal(saved.data.layout, 'image-right');
    assert.equal(saved.data.theme, 'light');
    assert.equal(saved.data.placement, 'after_outlets');
    assert.deepEqual(saved.data.location_ids, []);
    assert.ok((await shown()).some((c: any) => c.id === 'deals'));

    const styled = {
      ...basic,
      eyebrow: 'This week',
      layout: 'image-background',
      theme: 'dark',
      placement: 'top',
      devices: 'mobile',
      location_ids: ['rawalpindi'],
    };
    assert.equal((await put('deals', styled)).status, 200);
    const live = (await shown()).find((c: any) => c.id === 'deals');
    assert.equal(live.placement, 'top');
    assert.deepEqual(live.location_ids, ['rawalpindi']);
    assert.equal((await put('deals', { ...styled, layout: 'diagonal' })).status, 400);
    assert.equal((await put('deals', { ...styled, placement: 'footer' })).status, 400);

    // Blocks outside their schedule stay off the storefront but remain in the admin list.
    assert.equal((await put('deals', { ...styled, starts_at: at(day) })).status, 200);
    assert.ok(!(await shown()).some((c: any) => c.id === 'deals'), 'not started yet');
    assert.equal((await put('deals', { ...styled, starts_at: at(-2 * day), ends_at: at(-day) })).status, 200);
    assert.ok(!(await shown()).some((c: any) => c.id === 'deals'), 'already ended');
    assert.equal((await put('deals', { ...styled, starts_at: at(day), ends_at: at(-day) })).status, 400);
    assert.equal((await put('deals', { ...styled, starts_at: at(-day), ends_at: at(day) })).status, 200);
    assert.ok((await shown()).some((c: any) => c.id === 'deals'));
    const listed = (await request('GET', '/admin/records/content', undefined, admin)).data;
    assert.ok(listed.some((c: any) => c.id === 'deals'));

    // Video blocks take YouTube or Vimeo links only.
    const video = { name: 'How it works', type: 'embed', active: true, position: 2 };
    assert.equal((await put('video', video)).status, 400, 'a video block needs a link');
    assert.equal((await put('video', { ...video, embed_url: 'https://evil.example/watch?v=1' })).status, 400);
    assert.equal((await put('video', { ...video, embed_url: 'javascript:alert(1)' })).status, 400);
    assert.equal(
      (await put('video', { ...video, embed_url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ' })).status,
      200,
    );
    assert.equal((await put('video', { ...video, embed_url: 'https://vimeo.com/76979871' })).status, 200);
    assert.equal(
      (await put('bar', { name: 'Free delivery today', type: 'announcement', theme: 'brand', active: true, position: 0 })).status,
      200,
    );
    for (const id of ['deals', 'video', 'bar'])
      assert.equal((await request('DELETE', '/admin/records/content/' + id, undefined, admin)).status, 200);
    assert.deepEqual(await shown(), []);
  });
  await t.test('email settings are saved by administrators and never reveal the password', async () => {
    const view = async (token = admin) => request('GET', '/admin/email-settings', undefined, token);
    assert.equal((await view(customer)).status, 403);
    assert.equal((await view()).data.source, 'none');
    const smtp = { host: 'smtp.example.com', port: 587, secure: false, user: 'mailer', pass: 'app-password', from: 'Dellvit <no-reply@example.com>' };
    const save = (body: object) => request('PUT', '/admin/email-settings', body, admin);
    assert.equal((await save({ ...smtp, host: 'https://smtp.example.com' })).status, 400);
    assert.equal((await save({ ...smtp, port: 0 })).status, 400);
    const saved = await save(smtp);
    assert.equal(saved.status, 200, JSON.stringify(saved.data));
    assert.equal(saved.data.source, 'saved');
    assert.equal(saved.data.has_password, true);
    assert.equal(saved.data.pass, undefined);
    assert.ok(!JSON.stringify((await view()).data).includes('app-password'));
    // Saving without a password keeps the one already stored.
    assert.equal((await save({ ...smtp, pass: '', port: 465, secure: true })).data.has_password, true);
    assert.equal(JSON.parse((await one("SELECT value FROM settings WHERE key='smtp'"))!.value).pass, 'app-password');
    const mails = outbox.length;
    const test = await request('POST', '/admin/email-settings/test', { to: 'owner@example.com' }, admin);
    assert.equal(test.status, 200, JSON.stringify(test.data));
    assert.equal(outbox.length, mails + 1);
    assert.equal(outbox.at(-1)!.to, 'owner@example.com');
    assert.ok(!JSON.stringify((await request('GET', '/site')).data).includes('smtp.example.com'));
    await run("DELETE FROM rate_limits WHERE key LIKE 'auth:%'");
  });
  await t.test('administrators manage, verify and delete customer accounts', async () => {
    const list = async () => (await request('GET', '/admin/customers', undefined, admin)).data;
    assert.equal((await request('GET', '/admin/customers', undefined, customer)).status, 403);
    const fresh = (await list()).find((c: any) => c.email === 'fresh@example.com');
    assert.ok(fresh.email_verified_at && fresh.last_login_at);
    assert.equal(fresh.orders, 0);
    const seeded = (await list()).find((c: any) => c.id === 'customer-1');
    assert.ok(seeded.orders > 0 && seeded.email_verified_at);

    const walkIn = {
      name: 'Walk In',
      email: 'walkin@example.com',
      phone: '03001234568',
      password: 'Dellvit@2026',
      admin_notes: 'Signed up at the counter',
    };
    const made = await request('POST', '/admin/customers', { ...walkIn, verified: false }, admin);
    assert.equal(made.status, 201, JSON.stringify(made.data));
    const id = made.data.id;
    assert.match(emailedCode(walkIn.email), /^\d{6}$/);
    const signIn = (password = walkIn.password) =>
      request('POST', '/auth/login', { login: walkIn.email, password }, undefined, {
        'x-client': 'mobile',
      });
    const act = (method: string, path = '', body?: object) =>
      request(method, '/admin/customers/' + id + path, body, admin);
    assert.equal((await signIn()).data.code, 'verify_email');

    // An administrator can verify the account, or send the code again.
    const mails = outbox.length;
    assert.equal((await act('POST', '/send-code')).status, 200);
    assert.equal(outbox.length, mails + 1);
    assert.equal((await act('PATCH', '', { verified: true })).status, 200);
    assert.equal((await act('POST', '/send-code')).status, 400);
    const session = await signIn();
    assert.equal(session.status, 200);
    assert.equal(session.data.user.admin_notes, undefined);
    const mine = () => request('GET', '/orders', undefined, session.data.token);
    assert.equal((await mine()).status, 200);

    // Editing with a new password signs the customer out and replaces the old password.
    const edited = await act('PUT', '', {
      ...walkIn,
      name: 'Walk In Customer',
      password: 'Replacement@2026',
    });
    assert.equal(edited.status, 200, JSON.stringify(edited.data));
    assert.deepEqual((await mine()).data, [], 'the old session no longer sees the account');
    assert.equal((await signIn()).status, 401);
    const next = await signIn('Replacement@2026');
    assert.equal(next.status, 200);
    assert.equal(
      (await act('PUT', '', { ...walkIn, email: 'fresh@example.com' })).status,
      409,
      'an email in use cannot be taken',
    );
    assert.equal((await act('POST', '/sign-out')).data.sessions, 1);

    // Unverifying or blocking closes the door again.
    assert.equal((await act('PATCH', '', { verified: false })).status, 200);
    assert.equal((await signIn('Replacement@2026')).data.code, 'verify_email');
    assert.equal((await act('PATCH', '', { verified: true, active: false })).status, 200);
    assert.equal((await signIn('Replacement@2026')).status, 401);
    const row = (await list()).find((c: any) => c.id === id);
    assert.equal(row.name, 'Walk In Customer');
    assert.equal(row.admin_notes, walkIn.admin_notes);
    assert.equal(row.active, 0);

    // A customer with an order in progress cannot be deleted.
    await run("DELETE FROM rate_limits WHERE key LIKE 'write:%'");
    const placed = await request('POST', '/orders', orderBody(), customer);
    assert.equal(placed.status, 201, JSON.stringify(placed.data));
    assert.equal((await request('DELETE', '/admin/customers/customer-1', undefined, admin)).status, 409);
    assert.equal(
      (await request('PATCH', '/orders/' + placed.data.id + '/status', { status: 'cancelled', reason: 'Test' }, admin)).status,
      200,
    );

    // With no orders the account is removed outright and its email is free again.
    assert.equal((await act('DELETE')).data.erased, false);
    assert.equal((await one('SELECT id FROM users WHERE id=?', id)), undefined);
    assert.ok(!(await list()).some((c: any) => c.id === id));

    // With past orders the account is closed and its details erased; the order survives.
    const regular = await request('POST', '/admin/customers', walkIn, admin);
    assert.equal(regular.status, 201, JSON.stringify(regular.data));
    await run('UPDATE orders SET user_id=? WHERE id=?', regular.data.id, placed.data.id);
    const erased = await request('DELETE', '/admin/customers/' + regular.data.id, undefined, admin);
    assert.equal(erased.data.erased, true, JSON.stringify(erased.data));
    const ghost = (await one('SELECT * FROM users WHERE id=?', regular.data.id))!;
    assert.equal(ghost.name, 'Deleted customer');
    assert.equal(ghost.phone, '');
    assert.equal(ghost.active, 0);
    assert.ok(!(await list()).some((c: any) => c.id === regular.data.id));
    assert.equal((await one('SELECT name FROM orders WHERE id=?', placed.data.id))!.name, delivery.name);
    assert.equal((await request('POST', '/admin/customers', walkIn, admin)).status, 201);
    await run("DELETE FROM rate_limits WHERE key LIKE 'auth:%' OR key LIKE 'write:%'");
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
    await t.test('administrators are managed by super admins; the owner account is protected', async () => {
      await run("DELETE FROM rate_limits WHERE key LIKE 'auth:%'");
      const save = (id: string, body: object, token = admin) =>
        request('PUT', '/admin/staff/' + id, body, token);
      const signIn = (email: string) =>
        request('POST', '/auth/admin-login', { login: email, password: staff.password }, undefined, {
          'x-client': 'mobile',
        });
      const ownerId = randomUUID();
      const owner = { ...staff, name: 'Owner', email: 'dellvitsupport@gmail.com', super: true, title: 'Owner' };
      assert.equal((await save(ownerId, owner)).status, 200);
      const list = (await request('GET', '/admin/staff', undefined, admin)).data;
      const row = list.users.find((u: any) => u.id === ownerId);
      assert.deepEqual([row.is_owner, row.is_super_admin, row.title], [true, true, 'Owner']);
      assert.equal(list.me, 'admin-1');
      assert.equal(row.password_hash, undefined);
      // Nobody else can change, disable, sign out or delete the owner.
      for (const [method, path, body] of [
        ['PUT', '', { ...owner, active: false }],
        ['PATCH', '', { active: false }],
        ['POST', '/sign-out', {}],
        ['DELETE', '', undefined],
      ] as const)
        assert.equal(
          (await request(method, '/admin/staff/' + ownerId + path, body, admin)).status,
          403,
          method + ' on the owner',
        );
      assert.equal((await signIn(owner.email)).status, 200, 'the owner is untouched');
      // An administrator cannot remove or disable their own account either.
      assert.equal((await request('DELETE', '/admin/staff/admin-1', undefined, admin)).status, 403);
      assert.equal((await request('PATCH', '/admin/staff/admin-1', { active: false }, admin)).status, 403);
      // Customers are not administrators.
      const customerId = (await request('GET', '/session', undefined, customer)).data.user.id;
      assert.equal((await save(customerId, staff)).status, 403);
      assert.equal((await request('DELETE', '/admin/staff/' + customerId, undefined, admin)).status, 404);
      // Another super administrator: created, disabled, enabled again and deleted.
      const secondId = randomUUID();
      const second = { ...staff, email: 'second@example.com', super: true, permissions: ['products'], title: 'Manager' };
      assert.equal((await save(secondId, second)).status, 200);
      const token = (await signIn(second.email)).data.token;
      const seen = (await request('GET', '/admin/staff', undefined, token)).data.users.find(
        (u: any) => u.id === secondId,
      );
      assert.deepEqual([seen.is_super_admin, seen.permissions, seen.sessions], [true, [], 1]);
      assert.equal((await request('PATCH', '/admin/staff/' + secondId, { active: false }, admin)).status, 200);
      assert.equal((await request('GET', '/admin/staff', undefined, token)).status, 401);
      assert.equal((await signIn(second.email)).status, 401);
      assert.equal((await request('PATCH', '/admin/staff/' + secondId, { active: true }, admin)).status, 200);
      assert.equal((await request('DELETE', '/admin/staff/' + secondId, undefined, admin)).status, 200);
      assert.equal((await signIn(second.email)).status, 401);
      assert.equal((await request('DELETE', '/admin/staff/' + secondId, undefined, admin)).status, 404);
      await run("DELETE FROM rate_limits WHERE key LIKE 'auth:%'");
    });
    await t.test('store switches, signed-in devices and notification preferences', async () => {
      await run("DELETE FROM rate_limits WHERE key LIKE 'auth:%' OR key LIKE 'write:%'");
      const current = (await request('GET', '/site')).data.settings;
      const put = (extra: object) =>
        request('PUT', '/admin/records/settings/global', { ...current, ...extra }, admin);
      assert.equal((await put({ facebook_url: 'http://insecure.example' })).status, 400);
      assert.equal((await put({ whatsapp: 'call me' })).status, 400);
      const closed = await put({
        signup_enabled: false,
        contact_form_enabled: false,
        chat_enabled: false,
        notice_enabled: true,
        notice: 'Closed on Friday',
        whatsapp: '+92 300 1234567',
        facebook_url: 'https://facebook.com/dellvit',
      });
      assert.equal(closed.status, 200, JSON.stringify(closed.data));
      assert.equal((await request('GET', '/site')).data.settings.notice, 'Closed on Friday');
      const signup = await request('POST', '/auth/register', {
        name: 'Late Comer',
        email: 'closed@example.com',
        phone: '03001234567',
        password: 'Password@2026',
        address: 'House 9',
        location_id: 'rawalpindi',
      });
      assert.equal(signup.status, 403, JSON.stringify(signup.data));
      assert.equal(
        (await request('POST', '/contact', { name: 'A', email: 'a@example.com', message: 'Hello there' })).status,
        403,
      );
      assert.equal((await request('POST', '/support/messages', { body: 'Hello' }, customer)).status, 403);
      assert.equal((await put({})).status, 200);
      // Chat is for registered, verified accounts only.
      assert.equal((await request('POST', '/support/messages', { body: 'Hello' })).status, 401);
      await run("UPDATE users SET email_verified_at=NULL WHERE email='customer@dellvit.local'");
      assert.equal((await request('GET', '/support', undefined, customer)).status, 403);
      assert.equal((await request('POST', '/support/messages', { body: 'Hello' }, customer)).status, 403);
      await run("UPDATE users SET email_verified_at=created_at WHERE email='customer@dellvit.local'");
      assert.equal((await request('GET', '/support', undefined, customer)).status, 200);
      // Devices: the account sees its sessions and can sign the others out.
      const elsewhere = await login('customer@dellvit.local');
      const sessions = (await request('GET', '/profile/sessions', undefined, customer)).data;
      assert.ok(sessions.length >= 2);
      assert.equal(sessions.filter((x: any) => x.current).length, 1);
      assert.ok(!JSON.stringify(sessions).includes('token_hash'));
      assert.equal((await request('DELETE', '/profile/sessions/nope', undefined, customer)).status, 404);
      const one_ = sessions.find((x: any) => !x.current);
      assert.equal((await request('DELETE', '/profile/sessions/' + one_.id, undefined, customer)).status, 200);
      assert.equal((await request('DELETE', '/profile/sessions', undefined, customer)).status, 200);
      assert.equal((await request('GET', '/session', undefined, elsewhere)).data.user, null);
      assert.equal((await request('GET', '/profile/sessions', undefined, customer)).data.length, 1);
      // Staff accounts have no delivery address; customers must keep theirs.
      assert.equal((await request('PATCH', '/profile', { name: 'Dellvit Admin' }, admin)).status, 200);
      assert.equal((await request('PATCH', '/profile', { name: 'Customer' }, customer)).status, 400);
      // Notification preferences, a test notification and emptying the inbox.
      const prefs = (body: object) => request('PUT', '/notifications/preferences', body, customer);
      assert.deepEqual((await prefs({ muted: ['payout', 'payout'] })).data.muted, ['payout']);
      assert.deepEqual((await request('GET', '/session', undefined, customer)).data.user.notify_muted, ['payout']);
      assert.equal((await prefs({ muted: ['everything'] })).status, 400);
      assert.equal((await request('POST', '/notifications/test', {}, customer)).status, 200);
      const inbox = (await request('GET', '/notifications?limit=1', undefined, customer)).data;
      assert.equal(inbox.items[0].title, 'Test notification');
      assert.equal((await request('DELETE', '/notifications?all=1', undefined, customer)).status, 200);
      assert.equal((await request('GET', '/notifications', undefined, customer)).data.total, 0);
      await prefs({ muted: [] });
      await run("DELETE FROM rate_limits WHERE key LIKE 'auth:%' OR key LIKE 'write:%'");
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
        // A new method reaches checkout only on the products that select it.
        const offered = async (ids: string) =>
          (await request('GET', '/payments?products=' + ids)).data.map((m: any) => m.id);
        assert.ok(!(await offered('product-1')).includes('bank'));
        const unaccepted = await request(
          'POST',
          '/orders',
          { ...orderBody(), payment_method: 'bank', payment },
          customer,
        );
        assert.equal(unaccepted.status, 400);
        assert.match(unaccepted.data.error, /not accepted/);
        const p1 = (await request('GET', '/products/product-1')).data;
        assert.equal(
          (
            await request(
              'PUT',
              '/manage/products/product-1',
              { ...p1, payment_methods: [...p1.payment_methods, 'bank'] },
              admin,
            )
          ).status,
          200,
        );
        assert.ok((await offered('product-1')).includes('bank'));
        // A cart is offered only the methods all of its products accept.
        assert.ok(!(await offered('product-1,product-2')).includes('bank'));
        assert.ok((await offered('product-1,product-2')).includes('cod'));
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
        // Coupon rules: each refusal says why, and the rules are checked for the signed-in customer.
        const quote = (code: string, token?: string) =>
          request(
            'POST',
            '/quote',
            { items: body.items, location_id: delivery.location_id, coupon_code: code },
            token,
          );
        const putCoupon = (id: string, extra: object) =>
          request('PUT', '/admin/records/coupons/' + id, { ...coupon, limit: 0, ...extra }, admin);
        assert.match((await quote('SAVE15')).data.error, /fully redeemed/);
        assert.match((await quote('NOPE')).data.error, /not valid/);
        assert.equal((await putCoupon('bad', { code: 'BAD', value: 0 })).status, 400);
        assert.equal((await putCoupon('free', { code: 'FREESHIP', type: 'delivery', value: 0 })).status, 200);
        const free = await quote('FREESHIP');
        assert.equal(free.data.discount, 22000);
        assert.equal(free.data.total, free.data.subtotal);
        assert.equal((await putCoupon('first', { code: 'FIRST', first_order: true })).status, 200);
        assert.match((await quote('FIRST', customer)).data.error, /first order/);
        assert.equal((await quote('FIRST')).status, 200, 'a visitor sees the price before signing in');
        assert.equal((await putCoupon('once', { code: 'ONCE', per_customer: 1 })).status, 200);
        assert.equal((await quote('ONCE', customer)).status, 200);
        await putCoupon('cap', { code: 'CAP', value: 50, max_discount: 1000 });
        assert.equal((await quote('CAP')).data.discount, 1000);
        await putCoupon('min', { code: 'BIG', minimum: 100000000 });
        assert.match((await quote('BIG')).data.error, /more to use this coupon/);
        await putCoupon('area', { code: 'AREA', location_ids: ['elsewhere'], public: true });
        assert.match((await quote('AREA')).data.error, /delivery area/);
        await putCoupon('pub', { code: 'PUBLIC', public: true, description: 'Welcome offer' });
        await request('PUT', '/admin/records/coupons/save15', { ...coupon, public: true }, admin);
        const offers = (await request('GET', '/coupons?location=' + delivery.location_id)).data;
        assert.deepEqual(
          offers.map((o: any) => o.code),
          ['PUBLIC'],
          'only public coupons that still work here are offered',
        );
        assert.equal(offers[0].description, 'Welcome offer');
        assert.equal((await request('GET', '/admin/coupons', undefined, customer)).status, 403);
        const usage = (await request('GET', '/admin/coupons', undefined, admin)).data.find(
          (c: any) => c.id === 'save15',
        );
        assert.deepEqual(
          [usage.uses, usage.uses_range, usage.customers, usage.discount, usage.sales],
          [1, 1, 1, r.data.discount, r.data.total],
        );
        const redeemed = (await request('GET', '/admin/coupons/save15/orders', undefined, admin)).data;
        assert.deepEqual(
          redeemed.map((o: any) => [o.reference, o.discount]),
          [[r.data.reference, r.data.discount]],
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
        // Disabling hides the method on every product but keeps each product's choice.
        assert.ok(
          !(await request('GET', '/payments?products=product-1')).data.some(
            (m: any) => m.id === 'bank',
          ),
        );
        assert.ok(
          (await request('GET', '/products/product-1')).data.payment_methods.includes('bank'),
        );
        const listed = (await request('GET', '/admin/records/payments', undefined, admin)).data;
        assert.equal(listed.find((m: any) => m.id === 'bank').products, 1);
        assert.equal(
          (await request('DELETE', '/admin/records/payments/bank', undefined, admin)).status,
          200,
        );
        // Deleting removes it from the products that accepted it.
        assert.ok(
          !(await request('GET', '/products/product-1')).data.payment_methods.includes('bank'),
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
      'card payments are retired and payment methods have no display order',
      async () => {
        // The cleanup migration stripped the display order from the seeded cash method.
        const cod = JSON.parse(
          (await one("SELECT data FROM platform_records WHERE kind='payments' AND id='cod'"))!.data,
        );
        assert.equal('position' in cod, false);
        // New card methods are refused.
        assert.equal(
          (
            await request(
              'PUT',
              '/admin/records/payments/card',
              { name: 'Card payment', type: 'card', active: true },
              admin,
            )
          ).status,
          400,
        );
        // A card method saved before the migration never reaches checkout or the admin panel.
        await run(
          "INSERT INTO platform_records VALUES('payments','legacy-card',?)",
          JSON.stringify({
            name: 'Card payment',
            type: 'card',
            active: true,
            gateway: 'Safepay',
            secret_key: 'sk_live_secret',
          }),
        );
        for (const body of [
          (await request('GET', '/payments')).data,
          (await request('GET', '/site')).data,
          (await request('GET', '/admin/records/payments', undefined, admin)).data,
        ]) {
          assert.ok(!JSON.stringify(body).includes('legacy-card'));
          assert.ok(!JSON.stringify(body).includes('sk_live_secret'));
        }
        assert.equal(
          (await request('POST', '/orders', { ...orderBody(), payment_method: 'legacy-card' }, customer))
            .status,
          400,
        );
        // A display order sent by an older client is dropped, and checkout lists methods by type.
        const saved = await request(
          'PUT',
          '/admin/records/payments/raast-1',
          {
            name: 'Raast',
            type: 'raast',
            account_title: 'Dellvit',
            raast_id: '03001234567',
            active: true,
            position: 99,
          },
          admin,
        );
        assert.equal(saved.status, 200, JSON.stringify(saved.data));
        assert.equal('position' in saved.data, false);
        const types = (await request('GET', '/payments')).data.map((m: any) => m.type);
        const order = ['cod', 'bank', 'wallet', 'raast'];
        assert.deepEqual(
          types,
          [...types].sort((a: string, b: string) => order.indexOf(a) - order.indexOf(b)),
        );
        await run("DELETE FROM platform_records WHERE id IN ('legacy-card','raast-1')");
      },
    );
  });
});
