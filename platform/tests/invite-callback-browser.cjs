const {chromium}=require('playwright');const assert=require('node:assert/strict');
const base=process.env.PLATFORM_TEST_ORIGIN;
if(!/^http:\/\/127\.0\.0\.1:\d+$/.test(base||''))throw new Error('Local tests only');
(async()=>{const browser=await chromium.launch({headless:true});try{
 const page=await browser.newPage(),apiCalls=[];
 await page.route('**/api/**',async route=>{
  const url=new URL(route.request().url());apiCalls.push({path:url.pathname,body:route.request().postDataJSON()});
  if(url.pathname==='/api/auth/consume'&&route.request().method()==='POST')return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({message:'Invitation confirmed. The production candidate remains locked.'})});
  return route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({error:'Locked during callback test.'})});
 });
 await page.goto(`${base}/#access_token=invite-fixture&type=invite&refresh_token=must-not-be-sent`);
 await page.getByRole('heading',{name:'Invitation confirmed'}).waitFor();
 assert.equal(new URL(page.url()).hash,'','the invite token is removed from the address bar');
 assert.equal(apiCalls.length,1,'callback makes no app/session/config requests');
 assert.equal(apiCalls[0].path,'/api/auth/consume');
 assert.deepEqual(apiCalls[0].body,{access_token:'invite-fixture',type:'invite',purpose:'verify'});
 console.log('Invite callback browser check passed.');
}finally{await browser.close();}})().catch(error=>{console.error(error);process.exitCode=1;});
