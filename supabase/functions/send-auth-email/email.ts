export const ACTION_PATHS = {
  signup: '/auth/verify',
  invite: '/',
  magiclink: '/auth/verify',
  reauthentication: '/auth/verify',
  recovery: '/auth/reset',
  email_change: '/auth/email',
} as const;

type Action = keyof typeof ACTION_PATHS;
type Locale = 'lv' | 'en';

export type HookPayload = {
  user?: { email?: string; new_email?: string; user_metadata?: { locale?: string } };
  email_data?: {
    email_action_type?: string;
    token_hash?: string;
    token_hash_new?: string;
    redirect_to?: string;
    site_url?: string;
  };
};

export type AuthMessage = {
  to: string;
  subject: string;
  text: string;
  html: string;
  replyTo?: string;
};

const copy = {
  lv: {
    signup: ['Apstiprini savu e-pastu', 'Vēl tikai viens solis, un tavs Lumiq konts būs gatavs. Apstiprini šo e-pasta adresi, lai turpinātu.', 'Apstiprināt e-pastu'],
    invite: ['Tevi uzaicina uz Lumiq', 'Tev ir nosūtīts uzaicinājums pievienoties Lumiq — vietai, kur pasākuma foto ir kopā.', 'Pieņemt uzaicinājumu'],
    magiclink: ['Tava Lumiq pieslēgšanās saite', 'Izmanto šo saiti, lai droši pieslēgtos savam Lumiq kontam.', 'Pieslēgties Lumiq'],
    reauthentication: ['Apstiprini savu identitāti', 'Izmanto šo saiti, lai apstiprinātu savu identitāti un turpinātu konta darbību.', 'Apstiprināt identitāti'],
    recovery: ['Atjauno savu paroli', 'Saņēmām pieprasījumu mainīt tava Lumiq konta paroli. Izmanto tālāk redzamo saiti, lai izvēlētos jaunu paroli.', 'Atjaunot paroli'],
    email_change: ['Apstiprini jauno e-pastu', 'Lai pabeigtu Lumiq konta e-pasta maiņu, apstiprini jauno adresi.', 'Apstiprināt jauno e-pastu'],
    security: 'Ja saiti nevari atvērt, nokopē to pārlūkā:',
    ignore: 'Ja šo pieprasījumu neveici tu, vari šo vēstuli ignorēt.',
    footer: 'Lumiq · Pasākuma foto, kopā.',
  },
  en: {
    signup: ['Confirm your email', 'One quick step and your Lumiq account will be ready. Confirm this email address to continue.', 'Confirm email'],
    invite: ['You are invited to Lumiq', 'You have been invited to join Lumiq, a shared home for event photos.', 'Accept invitation'],
    magiclink: ['Your Lumiq sign-in link', 'Use this link to securely sign in to your Lumiq account.', 'Sign in to Lumiq'],
    reauthentication: ['Confirm your identity', 'Use this link to confirm your identity and continue your account action.', 'Confirm identity'],
    recovery: ['Reset your password', 'We received a request to change the password for your Lumiq account. Use the link below to choose a new password.', 'Reset password'],
    email_change: ['Confirm your new email', 'To finish changing the email on your Lumiq account, confirm the new address.', 'Confirm new email'],
    security: 'If the button does not work, copy this link into your browser:',
    ignore: 'If you did not request this, you can ignore this email.',
    footer: 'Lumiq · Event photos, together.',
  },
} as const;

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[char]!);
}

function validEmail(value: unknown): value is string {
  return typeof value === 'string' && value.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

function verifyUrl(supabaseUrl: string, hash: string, action: Action, redirectTo: string): string {
  if (!/^[\da-f]{32,128}$/i.test(hash)) throw new Error('Invalid verification token hash.');
  const authOrigin = new URL(supabaseUrl);
  if (authOrigin.protocol !== 'https:' || authOrigin.username || authOrigin.password) throw new Error('Invalid Supabase URL.');
  const target = new URL(ACTION_PATHS[action], redirectTo);
  if (target.origin !== new URL(redirectTo).origin || target.protocol !== 'https:') {
    throw new Error('Invalid Auth redirect URL.');
  }
  const url = new URL('/auth/v1/verify', authOrigin);
  url.searchParams.set('token', hash);
  url.searchParams.set('type', action);
  url.searchParams.set('redirect_to', target.href);
  return url.href;
}

function createMessage(
  to: string,
  action: Action,
  locale: Locale,
  link: string,
  replyTo?: string,
  override?: { subject?: string; description?: string },
): AuthMessage {
  const words = copy[locale];
  const [title, description, button] = words[action];
  const subject = override?.subject || title;
  const message = override?.description || description;
  const safeTitle = escapeHtml(subject);
  const safeDescription = escapeHtml(message);
  const safeButton = escapeHtml(button);
  const safeLink = escapeHtml(link);
  const text = [
    subject,
    '',
    message,
    '',
    `${button}: ${link}`,
    '',
    words.security,
    link,
    '',
    action === 'recovery' ? words.ignore : '',
    '',
    words.footer,
  ].filter(Boolean).join('\n');
  const html = `<!doctype html><html lang="${locale}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light"><title>${safeTitle}</title></head><body style="margin:0;background:#f3f6f2;padding:24px 12px;color:#17241f;font-family:Arial,Helvetica,sans-serif"><table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:600px;margin:0 auto"><tr><td style="padding:12px 8px 20px;color:#153e32;font:bold 20px Arial">Lumiq</td></tr><tr><td style="background:#fff;border:1px solid #dce3dd;border-radius:8px;padding:32px 28px"><h1 style="margin:0 0 16px;font-size:24px;line-height:1.3">${safeTitle}</h1><p style="font-size:16px;line-height:1.65;color:#46564d">${safeDescription}</p><p style="margin:26px 0"><a href="${safeLink}" style="display:inline-block;background:#153e32;color:#fff;text-decoration:none;padding:13px 20px;border-radius:6px;font-weight:bold">${safeButton}</a></p><p style="font-size:13px;line-height:1.6;color:#627169">${escapeHtml(words.security)}<br><a href="${safeLink}" style="color:#153e32;word-break:break-all">${safeLink}</a></p>${action === 'recovery' ? `<p style="font-size:13px;line-height:1.6;color:#627169">${escapeHtml(words.ignore)}</p>` : ''}</td></tr><tr><td style="padding:18px 8px;color:#627169;font-size:13px;line-height:1.6">${escapeHtml(words.footer)}</td></tr></table></body></html>`;
  return { to, subject, text, html, ...(validEmail(replyTo) ? { replyTo } : {}) };
}

export function buildAuthMessages(
  payload: HookPayload,
  options: { supabaseUrl: string; replyTo?: string },
): AuthMessage[] {
  const user = payload.user;
  const email = payload.email_data;
  const action = email?.email_action_type;
  if (!user || !email || !validEmail(user.email) || !email.site_url) throw new Error('Invalid Auth email payload.');
  if (!['signup', 'invite', 'magiclink', 'reauthentication', 'recovery', 'email_change'].includes(action ?? '')) {
    throw new Error('Unsupported Auth email action.');
  }

  const site = new URL(email.site_url);
  if (site.protocol !== 'https:' && site.hostname !== 'localhost') throw new Error('Invalid Auth site URL.');
  const redirectTo = email.redirect_to || site.origin;
  const redirect = new URL(redirectTo);
  if (redirect.origin !== site.origin) throw new Error('Auth redirect must use the configured site origin.');

  const locale: Locale = user.user_metadata?.locale === 'lv' ? 'lv' : 'en';
  const type = action as Action;
  if (type !== 'email_change') {
    if (!email.token_hash) throw new Error('Missing Auth verification token.');
    return [createMessage(
      user.email,
      type,
      locale,
      verifyUrl(options.supabaseUrl, email.token_hash, type, site.origin),
      options.replyTo,
    )];
  }

  const newEmail = user.new_email;
  if (!validEmail(newEmail)) throw new Error('Missing new email address.');
  const messages: AuthMessage[] = [];
  if (email.token_hash_new) {
    messages.push(createMessage(
      user.email,
      type,
      locale,
      verifyUrl(options.supabaseUrl, email.token_hash_new, type, site.origin),
      options.replyTo,
      locale === 'lv'
        ? { subject: 'Apstiprini Lumiq e-pasta maiņu', description: `Pieprasīta konta e-pasta maiņa uz ${newEmail}. Apstiprini, ja tu šo maiņu pieprasīji.` }
        : { subject: 'Confirm your Lumiq email change', description: `An email change to ${newEmail} was requested for your account. Confirm if you requested this change.` },
    ));
  }
  const newAddressHash = email.token_hash;
  if (newAddressHash) {
    messages.push(createMessage(
      newEmail,
      type,
      locale,
      verifyUrl(options.supabaseUrl, newAddressHash, type, site.origin),
      options.replyTo,
    ));
  }
  if (!messages.length) throw new Error('Missing email change verification token.');
  return messages;
}
