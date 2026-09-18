import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
} from '@aws-sdk/client-s3';
import { objects } from '../apps/api/src/storage.js';

await test('R2 adapter sends private bucket commands and handles missing objects without hiding failures', async () => {
  process.env.R2_ACCOUNT_ID = 'a'.repeat(32);
  process.env.R2_ACCESS_KEY_ID = 'test-access-key';
  process.env.R2_SECRET_ACCESS_KEY = 'test-secret-key';
  process.env.R2_BUCKET_NAME = 'test-private-bucket';
  const calls: any[] = [];
  let mode = 'ok';
  const send = mock.method(S3Client.prototype, 'send', async function (
    this: S3Client,
    command: any,
  ) {
    calls.push(command);
    assert.equal(
      (await this.config.endpoint!()).hostname,
      'a'.repeat(32) + '.r2.cloudflarestorage.com',
    );
    if (mode === 'missing') throw Object.assign(new Error('Missing'), { name: 'NoSuchKey' });
    if (mode === 'denied')
      throw Object.assign(new Error('Access denied'), {
        name: 'AccessDenied',
        $metadata: { httpStatusCode: 403 },
      });
    if (command instanceof GetObjectCommand)
      return {
        Body: { transformToByteArray: async () => new Uint8Array([1, 2, 3]) },
        ContentType: 'image/webp',
      };
    return {};
  } as any);
  const key = 'proofs/11111111-1111-4111-8111-111111111111.webp';
  try {
    await objects.put(key, Buffer.from([1, 2, 3]), 'image/webp');
    assert.ok(calls[0] instanceof PutObjectCommand);
    assert.equal(calls[0].input.Bucket, 'test-private-bucket');
    assert.equal(calls[0].input.Key, key);
    assert.equal(calls[0].input.ACL, undefined);
    assert.deepEqual(await objects.get(key), {
      body: Buffer.from([1, 2, 3]),
      contentType: 'image/webp',
    });
    await objects.delete(key);
    assert.ok(calls[2] instanceof DeleteObjectCommand);
    mode = 'missing';
    assert.equal(await objects.get(key), undefined);
    mode = 'denied';
    await assert.rejects(objects.get(key), /Access denied/);
    assert.throws(() => objects.get('images/../proofs/private.webp'), /Invalid object key/);
  } finally {
    send.mock.restore();
  }
});
