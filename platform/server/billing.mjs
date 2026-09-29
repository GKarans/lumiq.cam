import {createHmac,timingSafeEqual} from 'node:crypto';
import {PLANS} from '../shared/plans.js';
import {uuid,requireThat} from './security.mjs';

export function verifyStripe(body,header,secret,now=Date.now()) {
 requireThat(secret&&header,400,'Payment signature is missing.');
 const parts=header.split(',').map(p=>p.split('='));
 const timestamp=Number(parts.find(p=>p[0]==='t')?.[1]);
 requireThat(Math.abs(now/1000-timestamp)<300,400,'Payment signature expired.');
 const expected=createHmac('sha256',secret).update(`${timestamp}.${body}`).digest();
 requireThat(parts.some(([k,v])=>k==='v1'&&/^[a-f0-9]{64}$/.test(v)&&timingSafeEqual(Buffer.from(v,'hex'),expected)),400,'Payment signature is invalid.');
 return JSON.parse(body);
}

export function billingService(db,{local,origin,fetcher=fetch,auth={},systemRpc=false}) {
 const stripe=async(route,values,requestId)=>{
  const key=process.env.PLATFORM_STRIPE_SECRET;
  requireThat(key?.startsWith('sk_test_'),503,'Payments are not configured for testing yet.');
  const r=await fetcher(`https://api.stripe.com/v1/${route}`,{
   method:values?'POST':'GET',headers:{Authorization:`Bearer ${key}`,'Stripe-Version':'2025-04-30.basil','Content-Type':'application/x-www-form-urlencoded',...(requestId?{'Idempotency-Key':requestId}:{})},
   ...(values?{body:new URLSearchParams(values)}:{}),signal:AbortSignal.timeout(15000)
  });
  requireThat(r.ok,502,'The payment provider is temporarily unavailable.');return r.json();
 };
 const canonical=async(owner,id)=>{
  requireThat(/^sub_[\w]+$/.test(id),400,'Invalid subscription reference.');
  const current=await stripe(`subscriptions/${id}`);
  requireThat(current.metadata?.account_id===owner,400,'Subscription account mismatch.');
  const item=current.items?.data?.[0];
  const plan=Object.values(PLANS).find(p=>p.billing==='monthly'&&process.env[`PLATFORM_STRIPE_PRICE_${p.id.toUpperCase()}`]===item?.price?.id);
  requireThat(plan&&current.items.data.length===1&&item.quantity===1,409,'This subscription price is not recognized.');
  const end=item.current_period_end||current.current_period_end,start=item.current_period_start||current.current_period_start;
  requireThat(Number.isFinite(start)&&Number.isFinite(end)&&start<end,502,'The billing period is unavailable.');
  const status=({active:'active',trialing:'trialing',past_due:'overdue',unpaid:'overdue',canceled:'ended',incomplete_expired:'ended'}[current.status]||'incomplete');
  return{provider_id:id,plan:plan.id,status,period_start:new Date(start*1000).toISOString(),period_end:new Date(end*1000).toISOString(),cancel_at_end:current.cancel_at_period_end===true,provider_customer:typeof current.customer==='string'?current.customer:current.customer?.id||null};
 };
 const types=new Set(['checkout.session.completed','checkout.session.async_payment_succeeded','checkout.session.async_payment_failed','customer.subscription.created','customer.subscription.updated','customer.subscription.deleted','invoice.paid','invoice.payment_failed']);
 const apply=async event=>{
  requireThat(typeof event.id==='string'&&Number.isInteger(event.created),400,'Invalid payment event.');
  if(!types.has(event.type))return{ignored:true};
  if(systemRpc){
   const object=event.data?.object||{},checkout=event.type.startsWith('checkout.'),failed=event.type==='checkout.session.async_payment_failed';
   const providerId=event.type.startsWith('customer.subscription.')?object.id:object.subscription||object.parent?.subscription_details?.subscription;
   let owner=object.metadata?.account_id||object.parent?.subscription_details?.metadata?.account_id||null;
   if(!owner&&providerId){const mapped=await db.query('select public.resolve_billing_owner($1) as owner',[providerId]);owner=mapped.rows[0]?.owner||null;}
   if(checkout)requireThat(owner&&object.metadata?.order_id,400,'Payment account metadata is missing.');
   let subscription=null;
   if(providerId&&!failed&&(checkout?(object.payment_status==='paid'&&object.mode==='subscription'):true)){
    requireThat(owner,400,'Payment account metadata is missing.');
    subscription=await canonical(owner,providerId);
    requireThat(subscription,400,'Subscription could not be verified.');
   }
   const payload={id:event.id,created:event.created,type:event.type,owner_id:owner,order_id:object.metadata?.order_id||null,
    checkout_id:checkout?object.id:null,subscription_id:providerId||null,payment_status:object.payment_status||null,
    amount_total:object.amount_total??null,currency:object.currency||null,mode:object.mode||null,
    ...(subscription?{plan:subscription.plan,subscription_status:subscription.status,period_start:subscription.period_start,
      period_end:subscription.period_end,cancel_at_end:subscription.cancel_at_end,customer_id:subscription.provider_customer,
      provider_updated_at:event.created}:{})};
   const result=await db.query('select public.apply_provider_payment_event($1::jsonb) as result',[payload]);
   return result.rows[0]?.result||{ok:false};
  }
  return db.transaction(async tx=>{
   const prior=await tx.query('insert into payment_events(id,created) values($1,$2) on conflict do nothing returning id',[event.id,event.created]);
   if(!prior.rows.length)return{duplicate:true};
   const object=event.data?.object||{},checkout=event.type.startsWith('checkout.');
   const providerId=event.type.startsWith('customer.subscription.')?object.id:object.subscription||object.parent?.subscription_details?.subscription;
   const mapped=providerId?(await tx.query('select account_id from subscriptions where provider_id=$1',[providerId])).rows[0]:null;
   const owner=object.metadata?.account_id||object.parent?.subscription_details?.metadata?.account_id||mapped?.account_id;
   requireThat(owner,400,'Payment account metadata is missing.');
   await tx.query('select id from accounts where id=$1 for update',[owner]);
   const sub=(await tx.query('select * from subscriptions where account_id=$1 for update',[owner])).rows[0];
   requireThat(sub,404,'Payment account not found.');
   if(checkout){
    const order=(await tx.query('select * from orders where id=$1 and owner_id=$2 for update',[object.metadata.order_id,owner])).rows[0];
    requireThat(order,400,'Payment does not match the order.');
    if(event.type.endsWith('failed')){await tx.query("update orders set status='failed' where id=$1 and status='pending'",[order.id]);return{failed:true};}
    if(object.payment_status!=='paid')return{pending:true};
    requireThat(object.currency==='eur'&&Number(object.amount_total)===order.amount&&(!order.provider_id||order.provider_id===object.id),400,'Payment does not match the order.');
    if(order.status==='paid')return{duplicate:true};
    await tx.query("update orders set status='paid',provider_id=$1 where id=$2",[object.id,order.id]);
    if(PLANS[order.plan]?.billing==='one_time'){
     requireThat(local||object.mode==='payment',400,'A Single Event pass requires a one-time payment.');
     await tx.query('insert into event_passes(id,owner_id,order_id,entitlement) values($1,$2,$3,$4) on conflict(order_id) do nothing',[uuid(),owner,order.id,PLANS.single]);
     await tx.query('insert into audit(id,actor_id,action,target_id) values($1,$2,$3,$4)',[uuid(),owner,'pass.purchased',order.id]);
     return {ok:true,pass:true};
    }
    if(local){
     if(Number(sub.provider_updated_at)>event.created)return{stale:true};
     await tx.query("update subscriptions set plan=$1,status='active',period_start=case when plan<>'trial' and status='active' and period_end>now() then period_start else now() end,period_end=case when plan<>'trial' and status='active' and period_end>now() then period_end else now()+interval '1 month' end,cancel_at_end=false,provider_id=$2,provider_customer=$3,provider_updated_at=$4,updated_at=now() where account_id=$5",[order.plan,providerId,object.customer||`local-customer-${owner}`,event.created,owner]);
    }
   }
   if(!local){
    requireThat(!sub.provider_id||sub.provider_id===providerId||['ended','incomplete'].includes(sub.status),409,'Resolve the existing subscription before activating another.');
    const snapshot=await canonical(owner,providerId);
    await tx.query('update subscriptions set plan=$1,status=$2,period_start=$3,period_end=$4,cancel_at_end=$5,provider_id=$6,provider_customer=$7,updated_at=now() where account_id=$8',[
     snapshot.plan,snapshot.status,snapshot.period_start,snapshot.period_end,snapshot.cancel_at_end,snapshot.provider_id,snapshot.provider_customer,owner
    ]);
   }else if(!checkout){
    requireThat(sub.provider_id===providerId,400,'Subscription does not match this account.');
    if(Number(sub.provider_updated_at)>event.created)return{stale:true};
    const status=event.type==='invoice.payment_failed'?'overdue':event.type.endsWith('deleted')?'ended':event.type==='invoice.paid'?'active':({active:'active',past_due:'overdue',canceled:'ended'}[object.status]||sub.status);
    await tx.query('update subscriptions set status=$1,provider_updated_at=$2 where account_id=$3',[status,event.created,owner]);
   }
   await tx.query('insert into audit(id,actor_id,action,target_id) values($1,$2,$3,$4)',[uuid(),owner,event.type,event.id]);return{ok:true};
  });
 };
 return{
  apply,
  async reconcile(owner){requireThat(!local,409,'Local payments do not need reconciliation.');if(systemRpc){const current=await db.query('select public.get_billing_subscription_id($1::uuid) as provider_id',[owner]);const providerId=current.rows[0]?.provider_id;requireThat(providerId,404,'Subscription not found.');const snapshot=await canonical(owner,providerId);const result=await db.query('select public.reconcile_provider_subscription_state($1::uuid,$2::jsonb) as saved',[owner,snapshot]);requireThat(result.rows[0]?.saved===true,409,'Subscription could not be reconciled.');return{ok:true};}return db.transaction(async tx=>{const sub=(await tx.query('select * from subscriptions where account_id=$1 for update',[owner])).rows[0];requireThat(sub?.provider_id,404,'Subscription not found.');const snapshot=await canonical(owner,sub.provider_id);await tx.query('update subscriptions set plan=$1,status=$2,period_start=$3,period_end=$4,cancel_at_end=$5,provider_id=$6,provider_customer=$7,updated_at=now() where account_id=$8',[snapshot.plan,snapshot.status,snapshot.period_start,snapshot.period_end,snapshot.cancel_at_end,snapshot.provider_id,snapshot.provider_customer,owner]);return{ok:true};});},
  async checkout(user,input){
   const plan=PLANS[input.plan];requireThat(plan&&plan.price>0,400,'Choose a paid plan.');
   if(!local)requireThat(process.env.PLATFORM_STRIPE_SECRET?.startsWith('sk_test_')&&process.env[`PLATFORM_STRIPE_PRICE_${plan.id.toUpperCase()}`],503,'Paid plans are not available yet.');
   const id=uuid();let current,order;
   if(auth.createOwnOrder){order=await auth.createOwnOrder(user,id,plan.id);requireThat(order?.id===id&&order.plan===plan.id&&Number(order.amount)===plan.price,403,'The order could not be created for this account.');current=order;}
   else{current=(await db.query('select * from subscriptions where account_id=$1',[user.id])).rows[0];requireThat(plan.billing==='one_time'||local||!current.provider_id||['ended','incomplete'].includes(current.status),409,'Manage your existing subscription in the billing portal.');await db.query('insert into orders(id,owner_id,plan,amount) values($1,$2,$3,$4)',[id,user.id,plan.id,plan.price]);}
   if(local)return{url:`/checkout/${id}`,order:id,sandbox:true};
   const price=process.env[`PLATFORM_STRIPE_PRICE_${plan.id.toUpperCase()}`];requireThat(price,503,'This plan is not configured yet.');
   const oneTime=plan.billing==='one_time';
   const session=await stripe('checkout/sessions',{mode:oneTime?'payment':'subscription','line_items[0][price]':price,'line_items[0][quantity]':'1',success_url:`${origin}/app/billing?checkout=returned`,cancel_url:`${origin}/app/billing`,'metadata[account_id]':user.id,'metadata[order_id]':id,'billing_address_collection':'required','tax_id_collection[enabled]':'true','automatic_tax[enabled]':'true',...(oneTime?{}:{'subscription_data[metadata][account_id]':user.id}),client_reference_id:id,...(current.provider_customer?{customer:current.provider_customer}:{customer_email:user.email})},id);
   if(auth.setOwnOrderProvider)requireThat(await auth.setOwnOrderProvider(user,id,session.id)===true,409,'Checkout session could not be attached to the order.');else await db.query('update orders set provider_id=$1 where id=$2',[session.id,id]);
   return{url:session.url};
  },
  async simulate(user,id,outcome){
   requireThat(local,403,'Payment simulation is disabled.');requireThat(['success','cancel','fail'].includes(outcome),400,'Choose a payment outcome.');
   const order=(await db.query('select * from orders where id=$1 and owner_id=$2',[id,user.id])).rows[0];requireThat(order,404,'Order not found.');
   if(outcome!=='success'){await db.query("update orders set status=$1 where id=$2 and status='pending'",[outcome==='cancel'?'canceled':'failed',id]);return{ok:true};}
   return apply({id:`local-${id}`,created:Math.floor(Date.now()/1000),type:'checkout.session.completed',data:{object:{id:`local-${id}`,subscription:`local-sub-${id}`,payment_status:'paid',mode:PLANS[order.plan].billing==='one_time'?'payment':'subscription',amount_total:order.amount,currency:'eur',metadata:{account_id:user.id,order_id:id}}}});
  },
  async cancel(user){
   const sub=auth.getOwnSubscriptionPaymentDetails?await auth.getOwnSubscriptionPaymentDetails(user):(await db.query('select * from subscriptions where account_id=$1',[user.id])).rows[0];
   if(!local){requireThat(sub?.provider_id,409,'No subscription yet.');await stripe(`subscriptions/${encodeURIComponent(sub.provider_id)}`,{cancel_at_period_end:'true'},`cancel-${sub.provider_id}-${sub.period_end}`);}
   if(auth.cancelOwnSubscription)requireThat(await auth.cancelOwnSubscription(user),409,'Subscription could not be canceled.');else await db.query('update subscriptions set cancel_at_end=true where account_id=$1',[user.id]);return{ok:true};
  },
  async portal(user){
   const sub=auth.getOwnSubscriptionPaymentDetails?await auth.getOwnSubscriptionPaymentDetails(user):(await db.query('select * from subscriptions where account_id=$1',[user.id])).rows[0];
   if(local)return{url:'/app/billing?portal=local',sandbox:true};
   requireThat(sub?.provider_customer,409,'No billing account yet.');
   return{url:(await stripe('billing_portal/sessions',{customer:sub.provider_customer,return_url:`${origin}/app/billing`})).url};
  }
 };
}
