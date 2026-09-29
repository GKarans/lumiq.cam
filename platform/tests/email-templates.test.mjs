import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../email-templates');
const templates=[
 ['supabase-confirm-signup.html','{{ .ConfirmationURL }}'],
 ['supabase-invite.html','{{ .ConfirmationURL }}'],
 ['supabase-reset-password.html','{{ .ConfirmationURL }}'],
 ['supabase-change-email.html','{{ .ConfirmationURL }}'],
 ['supabase-password-changed.html',null]
];

test('Supabase Auth email templates are responsive, localized and use supported variables',async()=>{
 for(const [file,requiredVariable] of templates){
  const html=await readFile(path.join(root,file),'utf8');
  assert.match(html,/<meta name="viewport" content="width=device-width,initial-scale=1">/,file);
  assert.match(html,/Lumiq/,file);
  assert.match(html,/{{ if eq \.Data\.locale "lv" }}/,file);
  assert.match(html,/{{ else }}/,file);
  assert.match(html,/{{ end }}/,file);
  if(requiredVariable)assert.ok(html.includes(requiredVariable),`${file} includes ${requiredVariable}`);
 }
 const changedEmail=await readFile(path.join(root,'supabase-change-email.html'),'utf8');
 assert.match(changedEmail,/{{ \.NewEmail }}/);
});
