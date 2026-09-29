import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../public');

test('public guest-flow links never point at the local-only demo route', async () => {
  const [marketing, app, latvian] = await Promise.all([
    readFile(path.join(root, 'marketing.js'), 'utf8'),
    readFile(path.join(root, 'app.js'), 'utf8'),
    readFile(path.join(root, 'marketing-lv.js'), 'utf8')
  ]);

  assert.doesNotMatch(marketing, /href="\/demo"/);
  assert.match(marketing, /href="\/features">\$\{icon\('play'\)\} Explore the guest flow/);
  assert.match(marketing, /href="\/features">Guest experience/);
  assert.match(marketing, /href="\/register">Create an event/);
  assert.match(app, /else if\(path==='\/demo'\)\{const d=await api\('\/local\/demo'\)/);
  assert.match(latvian, /'Explore the guest flow':'Apskatīt viesa plūsmu'/);
  assert.match(latvian, /'Guest experience':'Viesa plūsma'/);
  assert.match(latvian, /'Create an event':'Izveidot pasākumu'/);
});
