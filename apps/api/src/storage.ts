import 'dotenv/config';
import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
} from '@aws-sdk/client-s3';

export type StoredObject = { body: Buffer; contentType: string };
export type ObjectStorage = {
  put(key: string, body: Buffer, contentType: string): Promise<void>;
  get(key: string): Promise<StoredObject | undefined>;
  delete(key: string): Promise<void>;
};
let storage: ObjectStorage | undefined;
function backend(): ObjectStorage {
  if (storage) return storage;
  const { R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET_NAME } = process.env;
  if (!R2_ACCOUNT_ID || !R2_ACCESS_KEY_ID || !R2_SECRET_ACCESS_KEY || !R2_BUCKET_NAME)
    throw new Error(
      'Configure R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY and R2_BUCKET_NAME.',
    );
  if (!/^[a-f0-9]{32}$/i.test(R2_ACCOUNT_ID))
    throw new Error('R2_ACCOUNT_ID must be a Cloudflare account ID.');
  const client = new S3Client({
    region: 'auto',
    endpoint: `https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
    credentials: { accessKeyId: R2_ACCESS_KEY_ID, secretAccessKey: R2_SECRET_ACCESS_KEY },
    requestChecksumCalculation: 'WHEN_REQUIRED',
    responseChecksumValidation: 'WHEN_REQUIRED',
  });
  storage = {
    async put(Key, Body, ContentType) {
      await client.send(new PutObjectCommand({ Bucket: R2_BUCKET_NAME, Key, Body, ContentType }));
    },
    async get(Key) {
      try {
        const result = await client.send(new GetObjectCommand({ Bucket: R2_BUCKET_NAME, Key }));
        if (!result.Body) return undefined;
        return {
          body: Buffer.from(await result.Body.transformToByteArray()),
          contentType: result.ContentType || 'application/octet-stream',
        };
      } catch (error: any) {
        if (error.name === 'NoSuchKey' || error.$metadata?.httpStatusCode === 404) return undefined;
        throw error;
      }
    },
    async delete(Key) {
      await client.send(new DeleteObjectCommand({ Bucket: R2_BUCKET_NAME, Key }));
    },
  };
  return storage;
}
export function setTestStorage(value: ObjectStorage) {
  if (process.env.NODE_ENV !== 'test' || storage)
    throw new Error('Test storage cannot be configured here.');
  storage = value;
}
function validKey(key: string) {
  if (!/^(images|proofs|documents)\/[\da-f-]+\.(webp|pdf)$/.test(key))
    throw new Error('Invalid object key.');
  return key;
}
export const objects: ObjectStorage = {
  put: (key, body, contentType) => backend().put(validKey(key), body, contentType),
  get: (key) => backend().get(validKey(key)),
  delete: (key) => backend().delete(validKey(key)),
};
