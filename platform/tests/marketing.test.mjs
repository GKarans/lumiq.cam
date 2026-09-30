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
  assert.match(marketing, /if\(route==='\/status'\)\{if\(!state\.config\?\.local\)/);
  assert.match(marketing, /Live service status is not available yet/);
  assert.match(marketing, /Local development environment\. This is not production uptime monitoring/);
  assert.match(await readFile(path.join(root, 'i18n.js'), 'utf8'), /Live service status is not available yet/);
  assert.match(app, /else if\(path==='\/demo'\)\{if\(state\.config\.local\)\{const d=await api\('\/local\/demo'\)/);
  assert.match(app, /go\('\/features'\);return;\}/);
  assert.match(latvian, /'Explore the guest flow':'Apskatīt viesa plūsmu'/);
  assert.match(latvian, /'Guest experience':'Viesa plūsma'/);
  assert.match(latvian, /'Create an event':'Izveidot pasākumu'/);
});

test('password reset feedback frontend uses a fresh cache-busted entry module', async () => {
  const html = await readFile(path.join(root, 'index.html'), 'utf8');
  assert.match(html, /\/app\.js\?v=auth-reset-feedback-20260930-1/);
});
