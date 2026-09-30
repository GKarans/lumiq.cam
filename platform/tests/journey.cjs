const {chromium}=require('playwright');
const assert=require('node:assert/strict');
const sharp=require('sharp');
const base=process.env.PLATFORM_TEST_ORIGIN||'http://127.0.0.1:5700';
if(!/^http:\/\/127\.0\.0\.1:\d+$/.test(base))throw new Error('Local tests only');
(async()=>{
 const browser=await chromium.launch({headless:true});
 try{
  const context=await browser.newContext({viewport:{width:390,height:844},timezoneId:'Europe/Riga'}),page=await context.newPage(),errors=[],external=[];
  page.on('pageerror',e=>errors.push(e.message));page.on('request',r=>{if(!r.url().startsWith(base)&&!r.url().startsWith('blob:'))external.push(r.url());});
  const email=`journey-${Date.now()}@example.test`;let password='Local-testing-only-123!';
  await page.goto(base+'/register');await page.getByLabel('First name',{exact:true}).fill('Browser');await page.getByLabel('Last name',{exact:true}).fill('Tester');await page.getByLabel('Email',{exact:true}).fill(email);await page.getByLabel('Password',{exact:true}).fill(password);await page.getByLabel('Confirm password',{exact:true}).fill(password);await page.getByRole('checkbox').check();await page.getByRole('button',{name:'Create account'}).click();await page.waitForURL('**/inbox');
  const inbox=await (await context.request.get(base+'/api/local/inbox')).json();const link=inbox.find(x=>x.recipient===email).body;
  await page.goto(link);await page.getByRole('button',{name:'Verify email'}).click();await page.getByRole('heading',{name:'Your memories are waiting.'}).waitFor();
  await page.goto(base+'/reset');await page.getByLabel('Email',{exact:true}).fill(email);await page.getByRole('button',{name:'Send reset link'}).click();await page.waitForURL('**/inbox');
  const resetMail=(await(await context.request.get(base+'/api/local/inbox')).json()).find(x=>x.recipient===email&&x.body.includes('/auth/reset'));assert.ok(resetMail,'reset link should be delivered');await page.goto(resetMail.body);
  await page.getByLabel('New password',{exact:true}).fill('Browser-new-password-123!');await page.getByLabel('Confirm password',{exact:true}).fill('Browser-other-password-456!');await page.getByRole('button',{name:'Save password'}).click();await page.getByRole('alert').filter({hasText:/Passwords do not match|Paroles nesakrīt/}).waitFor();
  await page.getByLabel('Confirm password',{exact:true}).fill('Browser-new-password-123!');let rejectFirstReset=false;await page.route('**/api/auth/consume',async route=>{if(!rejectFirstReset){rejectFirstReset=true;return route.fulfill({status:400,contentType:'application/json',body:JSON.stringify({error:'Authentication could not be completed. Check your details or request a new email link.'})});}return route.continue();});await page.getByRole('button',{name:'Save password'}).click();await page.getByRole('alert').filter({hasText:/This reset link is invalid or expired|Šī paroles atjaunošanas saite/}).waitFor();await page.unroute('**/api/auth/consume');await page.getByRole('button',{name:'Save password'}).click();await page.waitForURL('**/login');password='Browser-new-password-123!';
  await page.getByLabel('Email',{exact:true}).fill(email);await page.getByLabel('Password',{exact:true}).fill(password);await page.getByRole('button',{name:'Sign in',exact:true}).click();await page.getByRole('heading',{name:'My events',exact:true}).waitFor();
  await page.getByRole('button',{name:'Create event',exact:true}).first().click();await page.getByLabel('Event name').fill('Browser.Journey.With.A.Very.Long.Unbroken.Name.For.Responsive.Checking');
  const clock=offset=>new Intl.DateTimeFormat('sv-SE',{timeZone:'Europe/Riga',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).format(new Date(Date.now()+offset)).replace(' ','T');
  await page.getByLabel('Starts',{exact:true}).fill(clock(-3600000));await page.getByLabel('Ends',{exact:true}).fill(clock(3600000));await page.getByRole('button',{name:'Save draft'}).click();await page.getByRole('button',{name:'Publish event'}).click();await page.getByRole('button',{name:'Confirm',exact:true}).click();await page.getByRole('button',{name:'Pause uploads'}).waitFor();
  const eventId=new URL(page.url()).pathname.split('/').pop().match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i)?.[0];assert.ok(eventId,'event URL should end in its canonical ID');const e=await(await context.request.get(base+'/api/events/'+eventId)).json();
  await page.goto(base+'/event/'+e.slug);await page.getByLabel('Your name',{exact:true}).fill('Photographer');await page.getByRole('button',{name:'Join the gathering'}).click();await page.getByRole('button',{name:'Choose photos'}).waitFor();
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
  const fixture=await sharp({create:{width:80,height:60,channels:3,background:'#2e866f'}}).jpeg().toBuffer();
  let failOnce=true;await page.route('**/content/*/photo',async route=>{if(failOnce){failOnce=false;return route.abort('failed');}return route.continue();});
  await page.locator('#choose').setInputFiles(Array.from({length:20},(_,i)=>({name:`photo-${i}.jpg`,mimeType:'image/jpeg',buffer:fixture})));
  await page.locator('.queue > strong').filter({hasText:'20 uploaded'}).waitFor({timeout:90000});
  await page.screenshot({path:'platform/test-results/journey-20-uploads.png',fullPage:true});
  await page.goto(base+'/app/events/'+e.id);await page.locator('#gallery-count').filter({hasText:'20 of 20'}).waitFor();
  assert.equal((await page.locator('#gallery img').evaluateAll(images=>images.every(i=>new URL(i.src).pathname.endsWith('/thumb')))),true);
  await page.locator('[data-preview]').first().click();await page.locator('dialog .preview-image').waitFor();await page.keyboard.press('ArrowRight');await page.keyboard.press('Escape');
  await page.locator('.mobile-workspace-nav summary').click();await page.locator('.mobile-workspace-nav').getByRole('button',{name:'Switch color theme'}).click();await page.locator('#main').click({position:{x:5,y:5}});await page.screenshot({path:'platform/test-results/journey-dark-gallery.png',fullPage:true});
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);assert.deepEqual(errors,[]);assert.deepEqual(external,[]);
  const deletion=await context.request.post(`${base}/api/events/${e.id}/action`,{headers:{Origin:base},data:{action:'delete',confirm:e.name}});assert.equal(deletion.status(),200);
  console.log('Browser journey passed: register/verify/login, event times/publish, 20 photos with transient retry, thumbnails/preview, dark theme. No external requests.');
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
