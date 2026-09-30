import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

const endpoint='https://api.resend.com/emails';
const sender='Lumiq <noreply@lumiq.cam>';
const recipient='guntars.karans@gmail.com';

export async function sendProductionBackupAlert({apiKey=process.env.LUMIQ_PRODUCTION_EMAIL_KEY,fetchImpl=globalThis.fetch}={}){
 if(!apiKey)throw new Error('The Production email credential is unavailable.');
 const response=await fetchImpl(endpoint,{
  method:'POST',
  headers:{Authorization:`Bearer ${apiKey}`,'Content-Type':'application/json'},
  signal:AbortSignal.timeout(10000),
  body:JSON.stringify({
   from:sender,to:[recipient],subject:'Lumiq Production backup failed',
   text:'Lumiq Production automatizētā rezerves kopija neizdevās. Pārbaudi Windows Task Scheduler uzdevuma "Lumiq Production Daily Backup" rezultātu. Šajā paziņojumā nav iekļauti dati, paroles vai rezerves kopijas saturs.'
  })
 });
 if(!response.ok)throw new Error(`Resend rejected the backup alert with HTTP ${response.status}.`);
}

if(process.argv[1]&&resolve(process.argv[1]).toLowerCase()===fileURLToPath(import.meta.url).toLowerCase()){
 try{
  await sendProductionBackupAlert();
  console.log('Sanitized Production backup failure alert accepted by Resend.');
 }catch(error){
  const status=Number.isInteger(error?.status)?error.status:'SEND_FAILED';
  console.error(`Production backup failure alert was not sent (${status}).`);
  process.exitCode=1;
 }
}
