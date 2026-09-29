import {execFileSync} from 'node:child_process';
import {readFileSync} from 'node:fs';
const files=execFileSync('git',['ls-files','--cached','--others','--exclude-standard'],{encoding:'utf8'}).trim().split(/\r?\n/).filter(Boolean);
const forbidden=[[/sk_live_[A-Za-z0-9]+/,'live Stripe key'],[/whsec_[A-Za-z0-9]{16,}/,'Stripe webhook secret'],[/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/,'private key'],[/service_role[^\n]{0,30}eyJ[A-Za-z0-9_-]+/i,'Supabase service-role token']];
const findings=[];
for(const file of files){if(/\.(png|jpe?g|webp|woff2?|zip|pdf|docx)$/i.test(file))continue;let content;try{content=readFileSync(file,'utf8');}catch{continue;}for(const [pattern,label]of forbidden)if(pattern.test(content))findings.push(`${file}: ${label}`);}
if(findings.length){console.error(findings.join('\n'));process.exit(1);}
console.log(`Secret scan passed across ${files.length} tracked and unignored workspace files.`);
