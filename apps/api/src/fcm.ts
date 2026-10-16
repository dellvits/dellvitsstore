import { createSign } from 'node:crypto';

/**
 * Push to the mobile app through Firebase Cloud Messaging (the HTTP v1 API).
 *
 * FIREBASE_SERVICE_ACCOUNT holds the service account key from the Firebase console (Project
 * settings, Service accounts, Generate new private key): the JSON as it is, or base64 of it.
 * Without it nothing is sent and everything else keeps working.
 */
type Account = { project_id: string; client_email: string; private_key: string };

function account(): Account | null {
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT?.trim();
  if (!raw) return null;
  try {
    const a = JSON.parse(raw.startsWith('{') ? raw : Buffer.from(raw, 'base64').toString('utf8'));
    if (!a.project_id || !a.client_email || !a.private_key) return null;
    // Keys pasted into a single-line setting arrive with "\n" written out.
    return { ...a, private_key: String(a.private_key).replace(/\\n/g, '\n') };
  } catch {
    return null;
  }
}

export const pushConfigured = () => account() !== null;

let cached: { token: string; until: number } | null = null;

/** A short-lived Google access token, signed with the service account's key and kept for reuse. */
async function accessToken(a: Account) {
  if (cached && cached.until > Date.now() + 60_000) return cached.token;
  const now = Math.floor(Date.now() / 1000);
  const part = (o: object) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const unsigned = `${part({ alg: 'RS256', typ: 'JWT' })}.${part({
    iss: a.client_email,
    scope: 'https://www.googleapis.com/auth/firebase.messaging',
    aud: 'https://oauth2.googleapis.com/token',
    iat: now,
    exp: now + 3600,
  })}`;
  const signature = createSign('RSA-SHA256').update(unsigned).sign(a.private_key, 'base64url');
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: `${unsigned}.${signature}`,
    }),
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) throw new Error(`Firebase sign-in failed (${res.status}): ${await res.text()}`);
  const body = (await res.json()) as { access_token: string; expires_in: number };
  cached = { token: body.access_token, until: Date.now() + body.expires_in * 1000 };
  return cached.token;
}

export type DevicePush = { id: string; type: string; title: string; body: string; link: string };

/**
 * Sends one notification to each phone. Android shows it in the notification centre with the
 * Dellvit icon on the "Dellvit alerts" channel; tapping it opens `link` in the app.
 * Returns the tokens Firebase no longer accepts, for the caller to forget.
 */
export async function sendToDevices(tokens: string[], m: DevicePush): Promise<string[]> {
  return sendEach(tokens.map((token) => ({ token, message: m })));
}

/**
 * Like sendToDevices, with its own message for each phone. Firebase takes one phone per request,
 * so they go 100 at a time: an announcement to thousands of phones does not open thousands of
 * connections at once.
 */
export async function sendEach(
  pushes: { token: string; message: DevicePush }[],
): Promise<string[]> {
  const a = account();
  if (!a || !pushes.length) return [];
  const access = await accessToken(a);
  const project = a.project_id;
  const dead: string[] = [];
  for (let i = 0; i < pushes.length; i += 100)
    await Promise.all(pushes.slice(i, i + 100).map(({ token, message: m }) => send(token, m)));
  return dead;

  async function send(token: string, m: DevicePush) {
    try {
      const res = await fetch(
        `https://fcm.googleapis.com/v1/projects/${project}/messages:send`,
        {
          method: 'POST',
          headers: { authorization: `Bearer ${access}`, 'content-type': 'application/json' },
          body: JSON.stringify({
            message: {
              token,
              notification: { title: m.title, ...(m.body ? { body: m.body } : {}) },
              // Data values must be strings.
              data: { id: m.id, type: m.type, link: m.link },
              android: {
                priority: 'HIGH',
                ttl: '3600s',
                notification: { channel_id: 'dellvit_alerts', sound: 'default', tag: m.id },
              },
            },
          }),
          signal: AbortSignal.timeout(8000),
        },
      );
      if (res.ok) return;
      const text = await res.text();
      // The app was removed, or the token is no longer valid.
      if (res.status === 404 || /UNREGISTERED|registration token/i.test(text)) dead.push(token);
      else console.error(`Push to a phone failed (${res.status}): ${text.slice(0, 300)}`);
    } catch (error) {
      console.error('Push to a phone failed:', error);
    }
  }
}
