import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import inject from 'light-my-request';
import sharp from 'sharp';
process.env.WEB_ORIGIN = 'http://localhost:3000';
process.env.NODE_ENV = 'test';
const { setupTestDatabase, storedObjects } = await import('./helpers/database.js');
await setupTestDatabase();
const { app } = await import('../apps/api/src/app.js');
const { seed } = await import('../apps/api/src/seed.js');
const { db, one, all, run } = await import('../apps/api/src/db.js');
await seed();
after(async () => {
  await new Promise((resolve) => setImmediate(resolve));
  await db.close();
});
async function request(method: string, url: string, body?: unknown, token?: string) {
  const r = await inject(app as any, {
    method: method as any,
    url: '/api' + url,
    headers: {
      'x-client': 'mobile',
      ...(body ? { 'content-type': 'application/json' } : {}),
      ...(token ? { authorization: 'Bearer ' + token } : {}),
    },
    ...(body ? { payload: JSON.stringify(body) } : {}),
  });
  return { status: r.statusCode, data: r.json() };
}
async function login(login: string) {
  const r = await request(
    'POST',
    login === 'admin@dellvit.local' ? '/auth/admin-login' : '/auth/login',
    { login, password: 'Dellvit@2026' },
  );
  assert.equal(r.status, 200, JSON.stringify(r.data));
  return r.data.token as string;
}
async function upload(url: string, token: string, file: Buffer, name = 'photo.png') {
  const boundary = '----dellvit' + randomUUID();
  const payload = Buffer.concat([
    Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${name}"\r\nContent-Type: application/octet-stream\r\n\r\n`,
    ),
    file,
    Buffer.from(`\r\n--${boundary}--\r\n`),
  ]);
  return await inject(app as any, {
    method: 'POST',
    url,
    headers: { authorization: 'Bearer ' + token, 'content-type': 'multipart/form-data; boundary=' + boundary },
    payload,
  });
}
const delivery = {
  name: 'Test Customer',
  email: 'test@example.com',
  phone: '03001234567',
  address: 'House 12, 6th Road, Rawalpindi',
  location_id: 'rawalpindi',
  lat: 33.6442,
  lng: 73.0713,
  notes: '',
};
const productBody = (extra: object = {}) => ({
  name: 'Blue running shoes',
  description: 'Light blue running shoes for daily runs.',
  category: 'More',
  price: 450000,
  stock: 10,
  max_per_order: 5,
  unit: '1 pair',
  location_id: 'rawalpindi',
  discount: 0,
  deal: '',
  images: ['/images/essentials.webp'],
  delivery_minutes: 60,
  payment_methods: ['cod'],
  outlet_id: 'outlet-4',
  active: 1,
  ...extra,
});

await test('new storefront features', async (t) => {
  const admin = await login('admin@dellvit.local');
  const customer = await login('customer@dellvit.local');

  await t.test('one checkout can hold products from several outlets', async () => {
    const items = [
      { product_id: 'product-1', quantity: 1 },
      { product_id: 'product-3', quantity: 1 },
    ];
    const quote = await request('POST', '/quote', { items, location_id: 'rawalpindi' }, customer);
    assert.equal(quote.status, 200, JSON.stringify(quote.data));
    assert.equal(quote.data.outlets, 2);
    const key = randomUUID();
    const body = { items, delivery, payment_method: 'cod', idempotency_key: key };
    const r = await request('POST', '/orders', body, customer);
    assert.equal(r.status, 201, JSON.stringify(r.data));
    assert.equal(r.data.checkout.length, 2);
    const orders = await all('SELECT * FROM orders WHERE checkout_id=?', r.data.checkout_id);
    assert.equal(orders.length, 2);
    assert.deepEqual(new Set(orders.map((o) => o.outlet_id)), new Set(['outlet-1', 'outlet-2']));
    assert.equal(
      orders.reduce((s, o) => s + o.delivery_fee, 0),
      quote.data.delivery_fee,
    );
    // Retrying the same checkout returns the same orders.
    const again = await request('POST', '/orders', body, customer);
    assert.equal(again.status, 201);
    assert.equal(again.data.checkout.length, 2);
    assert.equal(Number((await one('SELECT COUNT(*) n FROM orders WHERE checkout_id=?', r.data.checkout_id))!.n), 2);
  });

  await t.test('products can be Nation Wide or sold in chosen areas', async () => {
    const wide = await request('POST', '/manage/products', productBody({ nationwide: 1, name: 'Steel water bottle' }), admin);
    assert.equal(wide.status, 200, JSON.stringify(wide.data));
    assert.equal(wide.data.nationwide, 1);
    const inIslamabad = await request('GET', '/products?location=islamabad');
    assert.ok(inIslamabad.data.some((p: any) => p.id === wide.data.id));
    const some = await request(
      'POST',
      '/manage/products',
      productBody({ name: 'Garden hose', location_ids: ['islamabad', 'satellite-town'] }),
      admin,
    );
    assert.equal(some.status, 200, JSON.stringify(some.data));
    assert.deepEqual(new Set(some.data.location_ids), new Set(['islamabad', 'satellite-town']));
    assert.ok(!(await request('GET', '/products?location=rawalpindi')).data.some((p: any) => p.id === some.data.id));
    assert.ok((await request('GET', '/products?location=satellite-town')).data.some((p: any) => p.id === some.data.id));
    const none = await request('POST', '/manage/products', productBody({ location_ids: [] }), admin);
    assert.equal(none.status, 400);
  });

  await t.test('Find my product matches existing and newly added products', async () => {
    const r = await request('POST', '/wishes', { name: 'Burger meal', max_price: 100000 }, customer);
    assert.equal(r.status, 201, JSON.stringify(r.data));
    assert.ok(r.data.found >= 1);
    assert.ok(r.data.matches.some((p: any) => p.id === 'product-1'));
    const later = await request('POST', '/wishes', { name: 'Red cricket bat', color: 'red' }, customer);
    assert.equal(later.data.found, 0);
    const bat = await request(
      'POST',
      '/manage/products',
      productBody({ name: 'Cricket bat', description: 'English willow cricket bat, red grip.' }),
      admin,
    );
    assert.equal(bat.status, 200);
    await new Promise((resolve) => setTimeout(resolve, 50));
    const mine = (await request('GET', '/wishes', undefined, customer)).data;
    assert.ok(mine.find((w: any) => w.id === later.data.id).matches.some((p: any) => p.id === bat.data.id));
    const told = await one(
      "SELECT * FROM notifications WHERE type='wish' AND link=? ORDER BY created_at DESC",
      '/products/' + bat.data.id,
    );
    assert.ok(told);
    const list = await request('GET', '/admin/wishes', undefined, admin);
    assert.equal(list.status, 200);
    assert.ok(list.data.top.some((x: any) => x.word === 'burger'));
    assert.equal((await request('GET', '/wishes', undefined, admin)).status, 403);
  });

  await t.test('blog posts are cleaned, listed, commented on and in the sitemap', async () => {
    const id = randomUUID();
    const save = await request(
      'PUT',
      '/admin/blog/' + id,
      {
        title: 'Five quick dinners',
        content: '<h2>Start</h2><p onclick="x()">Hello <script>alert(1)</script><a href="https://example.com">link</a></p><iframe src="https://evil.example/x"></iframe>',
        status: 'published',
        category: 'Food',
        tags: ['recipes'],
      },
      admin,
    );
    assert.equal(save.status, 200, JSON.stringify(save.data));
    assert.equal(save.data.slug, 'five-quick-dinners');
    assert.ok(!/script|onclick|evil/.test(save.data.content));
    assert.match(save.data.content, /rel="noopener noreferrer nofollow"/);
    const list = await request('GET', '/blog');
    assert.equal(list.data.posts[0].slug, 'five-quick-dinners');
    const post = await request('GET', '/blog/five-quick-dinners');
    assert.equal(post.status, 200);
    assert.equal((await request('POST', '/blog/five-quick-dinners/comments', { body: 'Nice' })).status, 401);
    const c = await request('POST', '/blog/five-quick-dinners/comments', { body: 'Lovely ideas' }, customer);
    assert.equal(c.data.status, 'pending');
    assert.equal((await request('GET', '/blog/five-quick-dinners')).data.comments.length, 0);
    await request('PATCH', '/admin/blog/comments/' + c.data.id, { status: 'approved' }, admin);
    assert.equal((await request('GET', '/blog/five-quick-dinners')).data.comments.length, 1);
    const map = await request('GET', '/site/sitemap');
    assert.ok(map.data.blog.some((b: any) => b.slug === 'five-quick-dinners'));
    const draft = await request('PUT', '/admin/blog/' + randomUUID(), { title: 'Secret plans' }, admin);
    assert.equal(draft.status, 200);
    assert.equal((await request('GET', '/blog/secret-plans')).status, 404);
  });

  await t.test('categories and home page sections can be put in any order', async () => {
    const cats = (await request('GET', '/admin/records/categories', undefined, admin)).data;
    const food = cats.find((c: any) => c.name === 'Food');
    const others = cats.filter((c: any) => c.name !== 'Food').reverse();
    const r = await request('POST', '/admin/records/categories/order', { ids: [...others, food].map((c: any) => c.id) }, admin);
    assert.equal(r.status, 200);
    const now = (await request('GET', '/categories')).data.map((c: any) => c.name);
    assert.equal(now.at(-1), 'Food');
    await request('POST', '/admin/records/categories/order', { ids: [food.id] }, admin);
    assert.equal((await request('GET', '/categories')).data[0].name, 'Food');
    if (!(await one("SELECT id FROM platform_records WHERE kind='settings'")))
      await run(
        "INSERT INTO platform_records VALUES('settings','global',?)",
        JSON.stringify({ name: 'Dellvit', active: true }),
      );
    const s = await request('PUT', '/admin/home-sections', { sections: ['outlets', 'nearby'] }, admin);
    assert.equal(s.status, 200, JSON.stringify(s.data));
    assert.deepEqual(s.data.sections.slice(0, 2), ['outlets', 'nearby']);
    assert.equal(s.data.sections.length, 8);
  });

  await t.test('checkout shows a dynamic payment QR with the exact total', async () => {
    const { crc16, parseTlv } = await import('../apps/api/src/emvqr.js');
    const f = (t: string, v: string) => t + String(v.length).padStart(2, '0') + v;
    let qr =
      f('00', '01') + f('01', '11') + f('26', f('00', 'com.example.wallet') + f('01', '03001234567')) +
      f('52', '5411') + f('53', '586') + f('58', 'PK') + f('59', 'DELLVIT STORE') + f('60', 'RAWALPINDI') + '6304';
    qr += crc16(qr);
    const read = await request('POST', '/admin/payments/qr-read', { payload: qr }, admin);
    assert.equal(read.status, 200, JSON.stringify(read.data));
    assert.equal(read.data.valid, true);
    const saved = await request(
      'PUT',
      '/admin/records/payments/qr-wallet',
      { name: 'JazzCash QR', type: 'wallet', provider: 'JazzCash', account_title: 'Dellvit', mobile_number: '03001234567', qr_payload: qr, active: true },
      admin,
    );
    assert.equal(saved.status, 200, JSON.stringify(saved.data));
    const items = [{ product_id: 'product-1', quantity: 1 }];
    const q = await request('POST', '/quote', { items, location_id: 'rawalpindi', payment_method: 'qr-wallet', reference: 'ab12' }, customer);
    assert.equal(q.status, 200, JSON.stringify(q.data));
    assert.equal(q.data.qr.dynamic, true);
    assert.equal(q.data.qr.merchant_name, 'DELLVIT STORE');
    assert.match(q.data.qr.image, /^data:image\/png;base64,/);
    const tags = Object.fromEntries(parseTlv(q.data.qr.payload)!.map((x) => [x.tag, x.value]));
    assert.equal(tags['01'], '12');
    assert.equal(tags['54'], (q.data.total / 100).toFixed(2));
    assert.equal((await request('POST', '/quote', { items, location_id: 'rawalpindi' }, customer)).data.qr, null);
  });

  await t.test('any picture is stored as WebP; videos keep their type', async () => {
    const png = await sharp({ create: { width: 40, height: 30, channels: 3, background: '#e8243c' } }).png().toBuffer();
    const r = await upload('/api/uploads/images', customer, png);
    assert.equal(r.statusCode, 201, r.body);
    const key = 'images/' + r.json().url.split('/').pop();
    assert.equal(storedObjects.get(key)?.contentType, 'image/webp');
    assert.equal((await sharp(storedObjects.get(key)!.body).metadata()).format, 'webp');
    const tiff = await sharp({ create: { width: 10, height: 10, channels: 3, background: '#000' } }).tiff().toBuffer();
    assert.equal((await upload('/api/uploads/preview', customer, tiff)).statusCode, 200);
    assert.equal((await upload('/api/uploads/images', customer, Buffer.from('not a picture'))).statusCode, 400);
    const mp4 = Buffer.concat([Buffer.from([0, 0, 0, 24]), Buffer.from('ftypisom'), Buffer.alloc(64)]);
    const v = await upload('/api/manage/videos', admin, mp4, 'clip.mp4');
    assert.equal(v.statusCode, 201, v.body);
    const part = await inject(app as any, { method: 'GET', url: v.json().url, headers: { range: 'bytes=0-9' } });
    assert.equal(part.statusCode, 206);
    assert.equal(part.rawPayload.length, 10);
  });
});
