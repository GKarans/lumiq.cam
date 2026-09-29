import {createHash} from 'node:crypto';
import {readFile, writeFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {PLATFORM_MIGRATIONS} from '../server/migration-manifest.mjs';

const projectRef = process.argv[2];
if (projectRef !== 'baqebydtinysosueksgr') {
  throw new Error('Pass the exact Lumiq Production project ref to render this one-time initializer.');
}

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../server');
const statements = [
  `-- One-time initializer for Lumiq Production (${projectRef}).`,
  '-- Apply only in the confirmed empty production project. Schema only; no runtime role or secrets.',
  'begin;',
  `do $$ begin
    if exists(select 1 from information_schema.tables where table_schema = 'public') then
      raise exception 'Refusing initialization: public schema is not empty';
    end if;
    if exists(select 1 from auth.users) then
      raise exception 'Refusing initialization: Auth users exist';
    end if;
  end $$;`,
  'create table public.platform_migrations(version text primary key, checksum text not null, applied_at timestamptz not null default now());',
  'alter table public.platform_migrations enable row level security;',
  `do $$ begin
    if exists(select 1 from pg_roles where rolname = 'anon') then revoke all on public.platform_migrations from anon; end if;
    if exists(select 1 from pg_roles where rolname = 'authenticated') then revoke all on public.platform_migrations from authenticated; end if;
  end $$;`,
];

for (const {version, file} of PLATFORM_MIGRATIONS) {
  const sql = (await readFile(path.join(root, file), 'utf8')).replaceAll('\r\n', '\n');
  const checksum = createHash('sha256').update(sql).digest('hex');
  statements.push(`-- ${version} sha256:${checksum}`, sql,
    `insert into public.platform_migrations(version, checksum) values ('${version}', '${checksum}');`);
}

statements.push('commit;');
const output = `${statements.join('\n\n')}\n`;
if (process.argv[3]) await writeFile(path.resolve(process.argv[3]), output, {flag: 'wx'});
else process.stdout.write(output);
