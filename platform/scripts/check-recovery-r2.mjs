import { S3Client, ListObjectsV2Command } from '@aws-sdk/client-s3';

const bucket = 'lumiq-production-recovery';
const endpoint = 'https://af664043db99694ff5a6ac88a7e7dc4d.eu.r2.cloudflarestorage.com';
const accessKeyId = process.env.LUMIQ_RECOVERY_R2_ACCESS_KEY_ID;
const secretAccessKey = process.env.LUMIQ_RECOVERY_R2_SECRET_ACCESS_KEY;

if (!accessKeyId || !secretAccessKey) {
  throw new Error('Recovery R2 credentials are missing from the protected local process.');
}

const client = new S3Client({
  region: 'auto',
  endpoint,
  credentials: { accessKeyId, secretAccessKey }
});

try {
  const result = await client.send(new ListObjectsV2Command({ Bucket: bucket, MaxKeys: 1 }));
  console.log(`Recovery R2 access verified for ${bucket}; contains object: ${Boolean(result.KeyCount)}.`);
} catch (error) {
  const status = error?.$metadata?.httpStatusCode ?? 'unknown';
  const code = typeof error?.Code === 'string' ? error.Code.replace(/[^A-Za-z0-9_-]/g, '').slice(0, 48) : 'unknown';
  console.error(`Recovery R2 access check failed (HTTP ${status}, ${code}). No credentials were printed.`);
  if (status === 401) {
    console.error('R2 rejected the S3 credentials. Revoke the exposed token, then save a fresh token’s Access Key ID and Secret Access Key; do not use its Token value.');
  }
  process.exitCode = 1;
} finally {
  client.destroy();
}
