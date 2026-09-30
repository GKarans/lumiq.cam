import { assertEquals, assertStringIncludes } from 'jsr:@std/assert@1';
import { createHandler } from './index.ts';
import { buildAuthMessages } from './email.ts';

const keyBytes = new Uint8Array(32).fill(7);
const secret = `v1,whsec_${btoa(String.fromCharCode(...keyBytes))}`;
const encoder = new TextEncoder();

async function signedRequest(payload: unknown, id = 'event-01') {
  const raw = JSON.stringify(payload);
  const timestamp = String(Math.floor(Date.now() / 1000));
  const key = await crypto.subtle.importKey('raw', keyBytes, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const signature = new Uint8Array(await crypto.subtle.sign('HMAC', key, encoder.encode(`${id}.${timestamp}.${raw}`)));
  const signatureBase64 = btoa(String.fromCharCode(...signature));
  return new Request('https://hook.example.test/send-auth-email', {
    method: 'POST',
    headers: {
      'webhook-id': id,
      'webhook-timestamp': timestamp,
      'webhook-signature': `v1,${signatureBase64}`,
      'content-type': 'application/json',
    },
    body: raw,
  });
}

const env = {
  SEND_EMAIL_HOOK_SECRET: secret,
  RESEND_API_KEY: 'synthetic-not-a-real-key',
  SUPABASE_URL: 'https://project.supabase.co',
  LUMIQ_EMAIL_FROM: 'Lumiq <noreply@lumiq.cam>',
  LUMIQ_SUPPORT_REPLY_TO: 'support@lumiq.cam',
};

function payload(action: string, extra: Record<string, unknown> = {}) {
  return {
    user: { email: 'guest@example.test', user_metadata: { locale: 'lv' } },
    email_data: {
      email_action_type: action,
      token_hash: 'a'.repeat(64),
      site_url: 'https://lumiq-production-candidate.gkarans-events.workers.dev',
      redirect_to: 'https://lumiq-production-candidate.gkarans-events.workers.dev',
      ...extra,
    },
  };
}

Deno.test('signed signup sends both MIME parts with the exact Lumiq callback', async () => {
  const sent: Array<{ body: Record<string, unknown>; headers: Headers }> = [];
  const handler = createHandler(env, async (_url, init) => {
    sent.push({ body: JSON.parse(String(init?.body)), headers: new Headers(init?.headers) });
    return new Response(JSON.stringify({ id: 'email-test' }), { status: 200 });
  });
  const response = await handler(await signedRequest(payload('signup')));
  assertEquals(response.status, 200);
  assertEquals(sent.length, 1);
  assertStringIncludes(String(sent[0].body.text), 'Apstiprini savu e-pastu');
  assertStringIncludes(String(sent[0].body.html), '<!doctype html>');
  assertEquals(sent[0].body.reply_to, 'support@lumiq.cam');
  assertEquals(sent[0].headers.get('Idempotency-Key'), 'supabase-auth/event-01/0');
  const link = new URL(String(sent[0].body.text).split('\n').find((line) => line.startsWith('https://'))!);
  assertEquals(link.origin, 'https://project.supabase.co');
  assertEquals(link.pathname, '/auth/v1/verify');
  assertEquals(link.searchParams.get('type'), 'signup');
  assertEquals(link.searchParams.get('redirect_to'), 'https://lumiq-production-candidate.gkarans-events.workers.dev/auth/verify');
});

Deno.test('email change sends both securely mapped recipient messages', async () => {
  const sent: Array<Record<string, unknown>> = [];
  const handler = createHandler(env, async (_url, init) => {
    sent.push(JSON.parse(String(init?.body)));
    return new Response('{}', { status: 200 });
  });
  const data = {
    ...payload('email_change', {
      token_hash: 'b'.repeat(64),
      token_hash_new: 'c'.repeat(64),
    }),
    user: { email: 'guest@example.test', new_email: 'new@example.test', user_metadata: { locale: 'lv' } },
  };
  const response = await handler(await signedRequest(data, 'email-change-01'));
  assertEquals(response.status, 200);
  assertEquals(sent.length, 2);
  assertEquals(sent[0].to, ['guest@example.test']);
  assertEquals(sent[1].to, ['new@example.test']);
  assertStringIncludes(String(sent[0].subject), 'Apstiprini Lumiq e-pasta maiņu');
  assertStringIncludes(String(sent[0].text), 'new@example.test');
  assertStringIncludes(String(sent[1].subject), 'Apstiprini jauno e-pastu');
  const oldLink = new URL(String(sent[0].text).split('\n').find((line) => line.startsWith('https://'))!);
  const newLink = new URL(String(sent[1].text).split('\n').find((line) => line.startsWith('https://'))!);
  assertEquals(oldLink.searchParams.get('token'), 'c'.repeat(64));
  assertEquals(newLink.searchParams.get('token'), 'b'.repeat(64));
});

Deno.test('invite and recovery callbacks use the app routes already supported by Lumiq', () => {
  const invite = buildAuthMessages(payload('invite'), { supabaseUrl: env.SUPABASE_URL })[0];
  const recovery = buildAuthMessages(payload('recovery'), { supabaseUrl: env.SUPABASE_URL })[0];
  const inviteLink = new URL(invite.text.split('\n').find((line) => line.startsWith('https://'))!);
  const recoveryLink = new URL(recovery.text.split('\n').find((line) => line.startsWith('https://'))!);
  assertEquals(new URL(inviteLink.searchParams.get('redirect_to')!).pathname, '/');
  assertEquals(new URL(recoveryLink.searchParams.get('redirect_to')!).pathname, '/auth/reset');
  assertEquals(recoveryLink.searchParams.get('type'), 'recovery');
});

Deno.test('magic link and reauthentication use the verified sign-in callback', () => {
  const magiclink = buildAuthMessages(payload('magiclink'), { supabaseUrl: env.SUPABASE_URL })[0];
  const reauthentication = buildAuthMessages(payload('reauthentication'), { supabaseUrl: env.SUPABASE_URL })[0];
  const magiclinkUrl = new URL(magiclink.text.split('\n').find((line) => line.startsWith('https://'))!);
  const reauthenticationUrl = new URL(reauthentication.text.split('\n').find((line) => line.startsWith('https://'))!);
  assertEquals(magiclinkUrl.searchParams.get('type'), 'magiclink');
  assertEquals(new URL(magiclinkUrl.searchParams.get('redirect_to')!).pathname, '/auth/verify');
  assertEquals(reauthenticationUrl.searchParams.get('type'), 'reauthentication');
  assertEquals(new URL(reauthenticationUrl.searchParams.get('redirect_to')!).pathname, '/auth/verify');
});

Deno.test('invalid webhook signatures never send email', async () => {
  let sends = 0;
  const handler = createHandler(env, async () => { sends += 1; return new Response('{}'); });
  const valid = await signedRequest(payload('signup'));
  const bad = new Request(valid, { headers: { ...Object.fromEntries(valid.headers), 'webhook-signature': 'v1,invalid' } });
  const response = await handler(bad);
  assertEquals(response.status, 401);
  assertEquals(sends, 0);
});

Deno.test('unsupported action types never reach Resend', async () => {
  let sends = 0;
  const handler = createHandler(env, async () => { sends += 1; return new Response('{}'); });
  const response = await handler(await signedRequest(payload('password_changed')));
  assertEquals(response.status, 400);
  assertEquals(sends, 0);
});

Deno.test('Resend failures return a generic error without exposing provider data', async () => {
  const handler = createHandler(env, async () => new Response('private provider diagnostic', { status: 500 }));
  const response = await handler(await signedRequest(payload('signup')));
  assertEquals(response.status, 502);
  assertEquals((await response.text()).includes('private provider diagnostic'), false);
});
