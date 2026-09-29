import {requireThat} from './security.mjs';

export function mailDelivery(db,{local=true,fetcher=fetch}){
 return async function deliver(){
  if(local)return {local:true};
  const messages=(await db.query('select public.claim_platform_deliveries(10) as messages')).rows[0]?.messages||[];
  let sent=0;
  for(const m of messages){
   try{
    requireThat(process.env.PLATFORM_EMAIL_KEY&&process.env.PLATFORM_EMAIL_FROM,503,'Email sender is not configured.');
    const r=await fetcher('https://api.resend.com/emails',{
     method:'POST',headers:{Authorization:`Bearer ${process.env.PLATFORM_EMAIL_KEY}`,'Content-Type':'application/json','Idempotency-Key':m.id},
     body:JSON.stringify({from:process.env.PLATFORM_EMAIL_FROM,to:[m.recipient],subject:m.subject,text:m.body}),signal:AbortSignal.timeout(15000)
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
