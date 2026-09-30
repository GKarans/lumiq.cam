import { Webhook } from 'standardwebhooks';
import { buildAuthMessages, type HookPayload } from './email.ts';

export type HookEnv = {
  SEND_EMAIL_HOOK_SECRET?: string;
  RESEND_API_KEY?: string;
  SUPABASE_URL?: string;
  LUMIQ_EMAIL_FROM?: string;
  LUMIQ_SUPPORT_REPLY_TO?: string;
};

export function createHandler(env: HookEnv, fetcher: typeof fetch = fetch) {
  return async (request: Request): Promise<Response> => {
    if (request.method !== 'POST') return new Response('Method not allowed', { status: 405 });
    if (!env.SEND_EMAIL_HOOK_SECRET || !env.RESEND_API_KEY || !env.SUPABASE_URL || !env.LUMIQ_EMAIL_FROM) {
      return Response.json({ error: { http_code: 503, message: 'Auth email service is not configured.' } }, { status: 503 });
    }

    const raw = await request.text();
    let payload: HookPayload;
    let webhookId: string;
    try {
      const secret = env.SEND_EMAIL_HOOK_SECRET.replace(/^v1,whsec_/, '');
      const verifier = new Webhook(secret);
      const headers = Object.fromEntries(request.headers);
      payload = verifier.verify(raw, headers) as HookPayload;
      webhookId = request.headers.get('webhook-id') || '';
      if (!webhookId) throw new Error('Missing webhook ID.');
    } catch {
      return Response.json({ error: { http_code: 401, message: 'Invalid Auth email signature.' } }, { status: 401 });
    }

    let messages;
    try {
      messages = buildAuthMessages(payload, {
        supabaseUrl: env.SUPABASE_URL,
        replyTo: env.LUMIQ_SUPPORT_REPLY_TO,
      });
    } catch {
      return Response.json({ error: { http_code: 400, message: 'Unsupported or invalid Auth email request.' } }, { status: 400 });
    }

    for (const [index, message] of messages.entries()) {
      const body = {
        from: env.LUMIQ_EMAIL_FROM,
        to: [message.to],
        subject: message.subject,
        text: message.text,
        html: message.html,
        ...(message.replyTo ? { reply_to: message.replyTo } : {}),
      };
      let response: Response;
      try {
        response = await fetcher('https://api.resend.com/emails', {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${env.RESEND_API_KEY}`,
            'Content-Type': 'application/json',
            'Idempotency-Key': `supabase-auth/${webhookId}/${index}`,
          },
          body: JSON.stringify(body),
        });
      } catch {
        return Response.json({ error: { http_code: 502, message: 'Auth email delivery failed.' } }, { status: 502 });
      }
      if (!response.ok) {
        return Response.json({ error: { http_code: 502, message: 'Auth email delivery failed.' } }, { status: 502 });
      }
    }
    return new Response(null, { status: 200 });
  };
}

if (import.meta.main) {
  Deno.serve(createHandler({
    SEND_EMAIL_HOOK_SECRET: Deno.env.get('SEND_EMAIL_HOOK_SECRET'),
    RESEND_API_KEY: Deno.env.get('RESEND_API_KEY'),
    SUPABASE_URL: Deno.env.get('SUPABASE_URL'),
    LUMIQ_EMAIL_FROM: Deno.env.get('LUMIQ_EMAIL_FROM'),
    LUMIQ_SUPPORT_REPLY_TO: Deno.env.get('LUMIQ_SUPPORT_REPLY_TO'),
  }));
}
