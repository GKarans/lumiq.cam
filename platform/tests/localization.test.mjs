import test from 'node:test';
import assert from 'node:assert/strict';
import {html,t} from '../public/i18n.js';
import {legal} from '../public/content.js';
import {galleryCount,galleryUpdated} from '../public/gallery-copy.js';

test('Latvian source templates preserve interpolated customer content',()=>{
 const previous=globalThis.localStorage;
 globalThis.localStorage={getItem:()=> 'lv'};
 try{
  assert.equal(t('Create your first event'),'Izveidot pirmo pasākumu');
  assert.equal(t('Designed for private gatherings.'),'Radīts privātiem pasākumiem.');
  assert.match(t('Depending on applicable law, you may request access, correction, erasure, restriction or portability, object to certain processing, withdraw consent where relied upon and complain to your supervisory authority. Guests should first contact their organizer about event photos; the operator must also provide a working privacy contact. Requests may require proportionate identity verification. No fee or response-time promise overrides applicable law.'),/^Atbilstoši piemērojamajiem/);
  assert.equal(t('Google sign-in activates in staging after the provider is connected.'),'Google pieslēgšanās aktivizēsies testa vidē pēc pakalpojuma pieslēgšanas.');
  const customerTitle='Your people.';
  assert.equal(html`<h1>${customerTitle}</h1><p>Your people.</p>`, '<h1>Your people.</h1><p>Tavi cilvēki.</p>');
  assert.equal(html`<button aria-label="Next photo">Next photo</button>`, '<button aria-label="Nākamais foto">Nākamais foto</button>');
 }finally{globalThis.localStorage=previous;}
});

test('English source templates stay unchanged',()=>{
 const previous=globalThis.localStorage;
 globalThis.localStorage={getItem:()=> 'en'};
 try{assert.equal(html`<p>Your people.</p>`, '<p>Your people.</p>');}
 finally{globalThis.localStorage=previous;}
});

test('all legal policy copy is translated in Latvian and remains English in English mode',()=>{
 const previous=globalThis.localStorage;
 const strings=Object.values(legal).flatMap(document=>[document.title,document.intro,...document.sections.flatMap(section=>section)]);
 try{
  globalThis.localStorage={getItem:()=> 'lv'};
  for(const source of strings)assert.notEqual(t(source),source,`Missing Latvian policy translation: ${source.slice(0,100)}`);
  globalThis.localStorage={getItem:()=> 'en'};
  for(const source of strings)assert.equal(t(source),source,`English policy copy changed: ${source.slice(0,100)}`);
 }finally{globalThis.localStorage=previous;}
});

test('gallery empty-state counters and update time follow the selected language',()=>{
 const previous=globalThis.localStorage;const time=new Date('2026-09-26T17:21:00Z');
 try{
  globalThis.localStorage={getItem:()=> 'lv'};
  assert.equal(t('The gallery is waiting'),'Galerija gaida foto');
  assert.equal(t('Photos will appear here when guests finish uploading.'),'Foto parādīsies šeit pēc viesu augšupielādes.');
  assert.equal(galleryCount(0,0),'0 no 0 foto');
  assert.match(galleryUpdated(time),/^Atjaunināts \d{2}:\d{2}$/);
  globalThis.localStorage={getItem:()=> 'en'};
  assert.equal(galleryCount(0,0),'0 of 0 photos');
  assert.match(galleryUpdated(time),/^Updated \d{2}:\d{2}$/);
 }finally{globalThis.localStorage=previous;}
});
