import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync, createVerify } from 'node:crypto';

// A throwaway key stands in for the Firebase service account; Google is never contacted.
const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
process.env.FIREBASE_SERVICE_ACCOUNT = JSON.stringify({
  project_id: 'dellvit-test',
  client_email: 'push@dellvit-test.iam.gserviceaccount.com',
  // Written out on one line, the way it often arrives in a hosting setting.
  private_key: privateKey.export({ type: 'pkcs8', format: 'pem' }).toString().replace(/\n/g, '\\n'),
});
const { sendToDevices, pushConfigured } = await import('../apps/api/src/fcm.js');

test('phone notifications are signed for Firebase and sent to each phone', async () => {
  assert.equal(pushConfigured(), true);
  const calls: { url: string; init: any }[] = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = (async (url: string, init: any) => {
    calls.push({ url: String(url), init });
    if (String(url).includes('oauth2')) return new Response(JSON.stringify({ access_token: 'ya29.test', expires_in: 3600 }));
    const message = JSON.parse(init.body).message;
    if (message.token === 'gone-token') return new Response('{"error":{"status":"NOT_FOUND","message":"UNREGISTERED"}}', { status: 404 });
    return new Response('{"name":"projects/dellvit-test/messages/1"}');
  }) as typeof fetch;
  try {
    const dead = await sendToDevices(['good-token', 'gone-token'], {
      id: 'n1',
      type: 'order',
      title: 'Order on its way',
      body: 'Your rider has picked up DLV-1.',
      link: '/orders/o1',
    });
    assert.deepEqual(dead, ['gone-token'], 'a removed app is reported so its token is forgotten');

    // The sign-in: a JWT signed with the service account key, for the messaging scope.
    const signIn = calls.find((c) => c.url === 'https://oauth2.googleapis.com/token')!;
    const assertion = new URLSearchParams(signIn.init.body.toString()).get('assertion')!;
    const [head, claims, signature] = assertion.split('.');
    const verify = createVerify('RSA-SHA256').update(head + '.' + claims);
    assert.ok(verify.verify(publicKey, Buffer.from(signature, 'base64url')));
    const c = JSON.parse(Buffer.from(claims, 'base64url').toString());
    assert.equal(c.iss, 'push@dellvit-test.iam.gserviceaccount.com');
    assert.equal(c.scope, 'https://www.googleapis.com/auth/firebase.messaging');

    // The message: shown by Android on the Dellvit channel, opening the link when tapped.
    const send = calls.find((c) => c.url.endsWith('/projects/dellvit-test/messages:send'))!;
    assert.equal(send.init.headers.authorization, 'Bearer ya29.test');
    const m = JSON.parse(send.init.body).message;
    assert.deepEqual(m.notification, { title: 'Order on its way', body: 'Your rider has picked up DLV-1.' });
    assert.deepEqual(m.data, { id: 'n1', type: 'order', link: '/orders/o1' });
    assert.equal(m.android.notification.channel_id, 'dellvit_alerts');
    assert.equal(m.android.priority, 'HIGH');

    // The access token is reused for the next notification.
    calls.length = 0;
    await sendToDevices(['good-token'], { id: 'n2', type: 'order', title: 'Delivered', body: '', link: '' });
    assert.equal(calls.filter((c) => c.url.includes('oauth2')).length, 0);
    assert.equal(JSON.parse(calls[0].init.body).message.notification.body, undefined, 'no empty body is sent');
  } finally {
    globalThis.fetch = realFetch;
  }
});
