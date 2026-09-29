import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {readFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {PLATFORM_MIGRATIONS} from '../server/migration-manifest.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const script = path.join(root, 'platform/scripts/render-production-init-sql.mjs');

test('production initializer is pinned, empty-database guarded and manifest exact', async () => {
  const sql = execFileSync(process.execPath, [script, 'baqebydtinysosueksgr'], {encoding: 'utf8'});
  assert.match(sql, /One-time initializer for Lumiq Production \(baqebydtinysosueksgr\)/);
  assert.match(sql, /Refusing initialization: public schema is not empty/);
  assert.match(sql, /Refusing initialization: Auth users exist/);
  assert.match(sql, /\nbegin;[\s\S]*commit;\s*$/);
  assert.match(sql, /create role lumiq_api_owner[\s\S]*?nologin[\s\S]*?nobypassrls/i);
  assert.doesNotMatch(sql, /create role lumiq_runtime|create role[^;]*\blogin\b|password\s+['"]/i);

  for (const {version, file} of PLATFORM_MIGRATIONS) {
    const source = (await readFile(path.join(root, 'platform/server', file), 'utf8')).replaceAll('\r\n', '\n');
    const checksum = createHash('sha256').update(source).digest('hex');
    assert.ok(sql.includes(`-- ${version} sha256:${checksum}`), `missing exact checksum for ${version}`);
    assert.ok(sql.includes(`insert into public.platform_migrations(version, checksum) values ('${version}', '${checksum}');`), `missing ledger row for ${version}`);
  }
});

test('production initializer refuses any project reference other than the verified production ref', () => {
  assert.throws(() => execFileSync(process.execPath, [script, 'cpweowosocjuccjsyyic'], {encoding: 'utf8', stdio: 'ignore'}));
});
