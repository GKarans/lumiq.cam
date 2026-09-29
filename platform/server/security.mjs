import {randomBytes,scrypt as scryptCallback,timingSafeEqual,createHash,randomUUID} from 'node:crypto';
import {promisify} from 'node:util';
const scrypt=promisify(scryptCallback);
export const uuid=()=>randomUUID();
export const token=()=>randomBytes(32).toString('hex');
export const hash=value=>createHash('sha256').update(value).digest('hex');
export class Fault extends Error {constructor(status,message){super(message);this.status=status;}}
export function requireThat(condition,status,message){if(!condition)throw new Fault(status,message);}
export function text(value,max=200){requireThat(typeof value==='string'&&value.trim().length>0&&value.trim().length<=max,400,`Enter a value of 1 to ${max} characters.`);return value.trim();}
export function email(value){const e=text(value,254).toLowerCase();requireThat(/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e),400,'Enter a valid email address.');return e;}
export function confirmedPassword(input){requireThat(typeof input?.password==='string'&&input.password.length>=12&&input.password.length<=128,400,'Use a password with 12 to 128 characters.');requireThat(input.password===input.password_confirm,400,'Passwords do not match.');return input.password;}
export async function passwordHash(password){requireThat(typeof password==='string'&&password.length>=12&&password.length<=128,400,'Use a password with 12 to 128 characters.');const salt=randomBytes(16).toString('hex');return `${salt}:${(await scrypt(password,salt,64)).toString('hex')}`;}
export async function passwordMatches(password,stored){if(!stored||typeof password!=='string'||password.length>128)return false;const [salt,key]=stored.split(':');const result=await scrypt(password,salt,64);return key?.length===128&&timingSafeEqual(Buffer.from(key,'hex'),result);}
export function cookies(header=''){return Object.fromEntries((header||'').split(';').filter(x=>x.includes('=')).map(x=>{const i=x.indexOf('=');return[x.slice(0,i).trim(),x.slice(i+1)]}));}
export function csrf(req,origins){if(['GET','HEAD','OPTIONS'].includes(req.method))return;const allowed=origins instanceof Set?origins:new Set([origins]);requireThat(allowed.has(req.headers.get('origin')),403,'This request is not allowed.');}
export function rateLimiter(limit=120,window=60000){const buckets=new Map();return key=>{const now=Date.now();for(const[k,v]of buckets)if(v.until<now)buckets.delete(k);const b=buckets.get(key)||{count:0,until:now+window};buckets.set(key,b);requireThat(++b.count<=limit,429,'Too many attempts. Please wait a minute.');};}
export function databaseLimiter(db,limit,scope,now=()=>Date.now(),consume=null){
 return async key=>{
  const window=Math.floor(now()/60000),keyHash=hash(`${scope}:${key}`),requests=consume?await consume(keyHash,window,limit):(await db.query("insert into request_limits(key_hash,window_id,requests,expires_at) values($1,$2,1,now()+interval '2 minutes') on conflict(key_hash) do update set requests=case when request_limits.window_id=excluded.window_id then request_limits.requests+1 else 1 end,window_id=excluded.window_id,expires_at=excluded.expires_at returning requests",[keyHash,window])).rows[0].requests;
  requireThat(requests<=limit,429,'Too many attempts. Please wait a minute.');
 };
}
