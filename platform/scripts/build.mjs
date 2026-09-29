import {cp,mkdir,readFile,writeFile,readdir,rm} from 'node:fs/promises';
import path from 'node:path';
import {ROOT} from '../server/db.mjs';
import {VERSION} from '../shared/plans.js';
import {build} from 'esbuild';

// Only the public surface is packaged. No environment, database or reference files.
const destination=path.resolve(ROOT,'dist');
if(path.basename(destination)!=='dist'||destination===path.parse(destination).root)throw new Error('Unsafe build output path.');
await rm(destination,{recursive:true,force:true});
await mkdir(destination,{recursive:true});
await cp(path.join(ROOT,'public'),destination,{recursive:true,filter:source=>!source.endsWith('.png')||source.endsWith(path.join('assets','brand-mark.png'))});
await mkdir(path.join(destination,'shared'),{recursive:true});
await mkdir(path.join(destination,'vendor'),{recursive:true});
await cp(path.join(ROOT,'shared'),path.join(destination,'shared'),{recursive:true});
await cp(path.join(ROOT,'../node_modules/lucide/dist/umd/lucide.js'),path.join(destination,'vendor/lucide.js'));
await build({entryPoints:[path.join(ROOT,'../node_modules/fabric/dist/index.min.mjs')],bundle:true,format:'esm',target:['es2022'],minify:true, outfile:path.join(destination,'vendor/fabric.js')});
const files=[];
async function inspect(dir){for(const entry of await readdir(dir,{withFileTypes:true})){const file=path.join(dir,entry.name);if(entry.isDirectory())await inspect(file);else{const relative=path.relative(destination,file).replaceAll('\\','/');if(/\.env|\.sql$|\.toml$|\.local|server\//.test(relative))throw new Error('Private file in build');if(/\.(js|html|json|css)$/.test(file)&&/ojcvnsbhphvijmzjfenl|event-photo-saas\.netlify\.app|sk_live_|service_role/.test(await readFile(file,'utf8')))throw new Error('Reference infrastructure or secret in build');files.push(relative);}}}
await inspect(destination);
await writeFile(path.join(destination,'build-manifest.json'),JSON.stringify({version:VERSION,mode:'local-preview',releaseReady:false,files},null,2));
console.log(`Validated ${files.length} public files. Backend required; no deploy performed.`);
