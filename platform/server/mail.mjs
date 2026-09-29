import {email,requireThat} from './security.mjs';

const escapeHtml=value=>String(value).replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));

function renderBody(body){
 return String(body||'').split(/\n{2,}/).map(paragraph=>{
  const parts=paragraph.split(/(https:\/\/[^\s]+)/g);
  return `<p style="margin:0 0 18px;color:#26352e;font:16px/1.65 Arial,Helvetica,sans-serif">${parts.map(part=>part.startsWith('https://')?`<a href="${escapeHtml(part)}" style="color:#153e32;font-weight:700;word-break:break-all">${escapeHtml(part)}</a>`:escapeHtml(part).replace(/\n/g,'<br>')).join('')}</p>`;
 }).join('');
}

export function renderLumiqEmail(subject,body){
 const preheader=escapeHtml(String(body||'').replace(/\s+/g,' ').slice(0,140));
 const language=/[āčēģīķļņšūž]/i.test(`${subject} ${body}`)?'lv':'en';
 return `<!doctype html><html lang="${language}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light"><title>${escapeHtml(subject)}</title></head><body style="margin:0;background:#f3f6f2;padding:24px 12px;color:#17241f"><div style="display:none;max-height:0;overflow:hidden;opacity:0">${preheader}</div><table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:600px;margin:0 auto"><tr><td style="padding:12px 8px 20px"><table role="presentation" cellspacing="0" cellpadding="0"><tr><td style="width:36px;height:36px;border-radius:50%;background:#153e32;color:#fff;text-align:center;vertical-align:middle;font:bold 18px Arial">L</td><td style="padding-left:10px;color:#153e32;font:bold 20px Arial,Helvetica,sans-serif">Lumiq</td></tr></table></td></tr><tr><td style="background:#fff;border:1px solid #dce3dd;border-radius:8px;padding:32px 28px"><h1 style="margin:0 0 22px;color:#17241f;font:600 23px/1.3 Arial,Helvetica,sans-serif">${escapeHtml(subject)}</h1>${renderBody(body)}</td></tr><tr><td style="padding:18px 8px 8px;color:#627169;font:13px/1.6 Arial,Helvetica,sans-serif">Lumiq · Event photos, together.<br>This is a service email about your Lumiq account or event.</td></tr></table></body></html>`;
}

export function mailDelivery(db,{local=true,fetcher=fetch}){
 return async function deliver(){
  if(local)return {local:true};
  const messages=(await db.query('select public.claim_platform_deliveries(10) as messages')).rows[0]?.messages||[];
  let sent=0;
  for(const m of messages){
   try{
    requireThat(process.env.PLATFORM_EMAIL_KEY&&process.env.PLATFORM_EMAIL_FROM,503,'Email sender is not configured.');
    const replyTo=process.env.PLATFORM_EMAIL_REPLY_TO?email(process.env.PLATFORM_EMAIL_REPLY_TO):null;
    const message={from:process.env.PLATFORM_EMAIL_FROM,to:[m.recipient],subject:m.subject,text:m.body,html:renderLumiqEmail(m.subject,m.body)};
    if(replyTo)message.reply_to=replyTo;
    const r=await fetcher('https://api.resend.com/emails',{
     method:'POST',headers:{Authorization:`Bearer ${process.env.PLATFORM_EMAIL_KEY}`,'Content-Type':'application/json','Idempotency-Key':m.id},
     body:JSON.stringify(message),signal:AbortSignal.timeout(15000)
    });
    requireThat(r.ok,502,'Email delivery failed.');
    await db.query('select public.settle_platform_delivery($1::uuid,true) as settled',[m.id]);sent++;
   }catch{
    await db.query('select public.settle_platform_delivery($1::uuid,false) as settled',[m.id]);
   }
  }
  return {sent};
 };
}
