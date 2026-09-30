# Lumiq Production pabeigšanas saraksts

Mērķis: pabeigt privāti lietojamu Lumiq produktu Production kandidātā, nemainot `lumiq.cam` maršrutu līdz TET bloķējuma atrisināšanai un neatverot publisku piekļuvi. Šis saraksts seko īpašnieka astoņu posmu secībai. Atzīme apliecina tikai norādīto pierādījumu, nevis plašāku dzīvas Production plūsmas darbspēju.

**Pēdējā darba pārbaude:** 2026-09-30. Papildu izpildes pierādījumi ir [Production progresa dokumentā](./PRODUCTION-PROGRESS-LV.md).

## Pārbaudītie infrastruktūras pamati

- [x] Production Supabase Pro, drošā runtime loma un Hyperdrive ir piesaistīti; migrācijas `001–046` auditētas.
- [x] Production backup no privātā R2 atkārtoti pārbaudīts 2026-09-30: 21 tabula, migrācijas `001–046`, 0 foto objektu, checksum derīgs.
- [x] Production kandidāts darbojas atsevišķā `workers.dev` adresē. `lumiq.cam` maršruts nav mainīts.
- [x] EU Production foto, backup un recovery bucketu atdalījums pārbaudīts. `app-images` un `event-photo-media` neaiztikt.
- [x] Supabase Auth SMTP izmanto verificēto Resend saknes `lumiq.cam` domēnu ar `Lumiq <noreply@lumiq.cam>`; Worker sūtītājam paredzēts verificētais `send.lumiq.cam`.

## 1. E-pasta adreses un saņemšana

- [x] Resend saknes domēns `lumiq.cam` ir verificēts ar atsevišķu `outbound` Return-Path; esošie Namecheap MX/SPF ieraksti ir saglabāti.
- [x] Supabase Production Auth SMTP sūtītājs ir `Lumiq <noreply@lumiq.cam>`; SMTP parole palika noslēpta un netika mainīta.
- [x] 2026-09-30 atkārtoti Supabase panelī pārbaudīts, ka custom SMTP ir ieslēgts, sūtītājs ir `Lumiq <noreply@lumiq.cam>`, Resend host ir `smtp.resend.com` un ports `465`; SMTP parole netika atvērta vai mainīta.
- [ ] Izveidot reālu ienākošo `support@lumiq.cam` pastkasti vai pāradresāciju. Galamērķa adrese vēl jāapstiprina īpašniekam.
- [ ] Pirms ienākošā pasta aktivizēšanas saskaņot pilnu saknes domēna pasta maršrutēšanu: Cloudflare Email Routing vednis piedāvā Cloudflare MX un SPF ierakstus, kas konfliktē ar esošajiem pieciem Namecheap `eforward` MX un saknes SPF. Aktivizācija var pārtraukt pašreizējās Namecheap pāradresācijas; saglabāt esošo iestatījumu, līdz īpašnieks apstiprina migrāciju un galamērķus.
- [ ] Pēc maršrutēšanas plāna apstiprināšanas konfigurēt ienākošo pastu un pārbaudīt `support@lumiq.cam` saņemšanu, neietekmējot vajadzīgos esošos adresātus.
- [ ] Nosūtīt vēstuli uz `support@lumiq.cam` un pārbaudīt saņemšanu/atbildi; tikai tad iestatīt `support@` kā Reply-To.
- [x] Sākumā paredzētas tikai `noreply@` un `support@`; `events@` un citas atsevišķas pastkastes nav vajadzīgas.

## 2. Lumiq e-pastu dizains un pārbaude

- [x] Sagatavotas un Production Supabase Auth saglabātas Lumiq HTML veidnes reģistrācijas apstiprināšanai, uzaicinājumam, paroles atjaunošanai, e-pasta maiņai un konta drošības paziņojumiem.
- [x] 2026-09-30 Supabase Production veidnē `Change email address` saglabāta tēma `Apstiprini jauno Lumiq e-pastu / Confirm your new Lumiq email`; pēc lapas pārlādes vērtība joprojām bija iestatīta.
- [x] Worker transakciju vēstulēm Resend payload satur gan `text`, gan `html`; pēdējā `node --test platform/tests/email-templates.test.mjs platform/tests/operations.test.mjs` pārbaude 2026-09-30 izturēja 8/8.
- [x] Auth e-pastu hook prototips veido `text/plain` un Lumiq HTML; 2026-09-30 `npx --yes deno test --allow-net` izturēja 8/8 sintētiskus testus, `deno check index.ts` un `deno audit` izturēja. Tas nav izvietots vai pieslēgts Production, tādēļ dzīvo Auth sūtītāju un drošības paziņojumus tas neaizstāj.
- [ ] Kontrolēti nosūtīt Auth vēstules uz testa pastkasti; pārbaudīt reālo piegādi, saites, LV/EN tekstu, mobilā izkārtojuma un MIME/plain-text uzvedību.
- [ ] Pārbaudīt vēstules Gmail un vismaz vienā citā pasta klientā.
- [ ] Pēc `support@` ienākošās saņemšanas verifikācijas iestatīt to kā Reply-To, kur tas ir atbalstīts; pārbaudīt Worker `PLATFORM_EMAIL_REPLY_TO` un Supabase Auth Reply-To atsevišķi.

## 3. Production konta plūsma aiz Access

- [x] Lokālajā izolētajā pārlūka testā izieta reģistrācija, e-pasta verifikācija, pieslēgšanās, paroles atjaunošanas saite un jauna parole; uzaicinājuma callback tests izturēja. Sintētiski dati, nevis Production.
- [ ] Ar atsevišķu testa kontu pārbaudīt reģistrāciju vai uzaicinājumu, apstiprinājuma saiti, pieslēgšanos, paroles atjaunošanu un izrakstīšanos.
- [ ] Pārbaudīt sesijas atkārtotu ielādi un kļūdainas/expired saites saprotamu apstrādi.
- [ ] Skaidri marķēt testa kontu, un pēc pārbaudes dzēst testa lietotāju un saistītos datus.

## 4. Pasākuma un foto pilnais cikls

- [x] Lokālajā izolētajā browser journey izveidots/publicēts pasākums, pievienots viesa vārds, augšupielādēti 20 testa foto ar vienu tīkla kļūmes atkārtojumu, galerijā redzēti sīktēli un priekšskatījums; mobilais izkārtojums saglabājās.
- [ ] Production kandidātā izveidot skaidri marķētu QA pasākumu un QR; pārbaudīt viesa vārdu, kameras foto uzņemšanu/augšupielādi, galeriju un sīktēlus mobilajā ierīcē. Lokālais tests nepieslēdz Production Supabase vai R2.
- [ ] Pārbaudīt foto dzēšanu datubāzē un objekta izņemšanu no R2.
- [ ] Pārbaudīt ZIP lejupielādi, kļūdu paziņojumus, lēnu savienojumu un atkārtotu mēģinājumu.
- [ ] Pēc testa izdzēst sintētisko pasākumu un objektus un apstiprināt, ka dati vairs nav pieejami.

## 5. Drošība un izolācija

- [x] Bez cookies kandidāta `/`, `/login`, `/api/auth/session`, `/api/config` un `/healthz` katrs atgrieza `302` uz Cloudflare Access login (2026-09-30).
- [x] Workers → Access pašreizējā skatā kandidāta hostname un `lumiq.cam` ir piesaistīti `Lumiq closed test - owner` Allow politikai; abiem Worker nav atsevišķas Worker-level politikas.
- [x] 2026-09-30 Cloudflare Access politikas definīcijā pārbaudīts: darbība `Allow`, vienīgais `Include` ir īpašnieka e-pasts `guntars.karans@gmail.com`; papildu `Require`/`Exclude` nav. Kandidāta un `lumiq.cam` Self-hosted lietotnes izmanto šo politiku.
- [x] Lokālais sintētiskais migrāciju tests apliecina organizer JWT lasījumu izolāciju un šauru RPC piekļuvi (`node --test platform/tests/migrations.test.mjs`, 3/3, 2026-09-30); tas nav dzīvs Production tests.
- [ ] Ar diviem atsevišķiem testa organizatoriem Production kandidātā pierādīt, ka pasākumi un galerijas ir savstarpēji izolēti.
- [ ] Ar anonīmu klientu pārbaudīt, ka organizatora API, dati un faili nav pieejami arī ar tiešu URL; sākotnējais `302` pārbauda Access robežu, nevis iekšējās lietotnes autorizāciju.

## 6. Fona darbi, rezerves kopijas un uzraudzība

- [x] Lokālie sintētiskie Queue/DLQ, retry, job un backup testi izturēja 2026-09-30: `platform.test.mjs`, `worker-router.test.mjs`, `migrations.test.mjs` un `reliability.test.mjs`/`production-backup.test.mjs` kopā 81 pārbaude bez kļūdām. Tie nepierāda dzīvas Cloudflare Queue kļūmes apstrādi.
- [x] Cloudflare Queue read-only konfigurācija 2026-09-30: `lumiq-production-jobs` ir aktīva, kandidāts ir Producer un Consumer; batch `1`, max wait `5 s`, max retries `10`, retry delay `0 s`, max concurrency `1`, DLQ piesaistīts. DLQ ir mērķa rinda bez consumer.
- [x] 2026-09-30 Cloudflare Metrics `Last 24 hours` abās rindās rāda 0 messages ingested, 0 retried, 0 backlog un 0 s lag; `lumiq-production-jobs-dlq` ir `Inactive`. Tas ir tukšas rindas sākuma stāvoklis, nevis retry/DLQ funkcionalitātes pierādījums.
- [x] Izolētais `node --test platform/tests/worker-router.test.mjs` izturēja 11/11, tostarp Consumer startup failure retry scenāriju. Tas nepierāda dzīvu Cloudflare retry/DLQ piegādi.
- [ ] Ar kontrolētu nekaitīgu testa darbu pārbaudīt dzīvu retry un nonākšanu DLQ; neizmantot reālu klienta darbu vai datus.
- [x] Jaunākā Production backup read-back un checksum pārbaude izturēja 2026-09-30.
- [x] Pilns Production backup restore ir veikts jaunajā izolētajā Recovery projektā; backup datu inventārs sakrita un migrācijas `001–046` pārbaudītas 2026-09-29. Esošo Recovery datubāzi atkārtoti nepārrakstīt.
- [ ] Pārbaudīt aktuālos Production Worker kļūdu žurnālus un Queue/DLQ metriku, tostarp sintētisku kļūmes scenāriju bez reālu klientu datu ietekmes.
- [x] 2026-09-30 Cloudflare Budget Alerts pārbaudē gan automātiskajam `$10`, gan `$50` brīdinājumam bija pa vienam saņēmējam (konta īpašnieks). Panelis rādīja `$0.00` par 2026. gada oktobri; brīdinājumu faktiskā piegāde nav testēta.
- [x] Cloudflare Production kandidāta Observability “Last 1 hour” skatā 2026-09-30 ap 05:25 GMT+3: 15 success, 0 errors; redzamie notikumi ir GET uz `/api/config`, `/api/auth/session` un `/api/local/demo`. Tas nav pilnas lietotnes plūsmas pierādījums.
- [ ] Pārskatīt izmaksas un resursu atkarības; resursus nedzēst bez pierādītas neatkarības un īpašnieka apstiprinājuma. `app-images` un `event-photo-media` neaiztikt — STOP.

## 7. TET atbildes sagaidīšana un atkārtots pieprasījums

- [ ] Sagaidīt atbildi uz 2026-09-25 nosūtīto TET pieprasījumu; piecu darba dienu termiņš aptuveni beidzas 2026-10-02.
- [ ] Ja līdz 2026-10-02 atbildes nav, 2026-10-05 sazināties ar TET atkārtoti, pievienojot sākotnējā STOP ekrāna attēlu un skenēšanas rezultātus.
- [ ] Līdz TET apstiprinājumam `lumiq.cam` maršrutu nemainīt.

## 8. Pēdējais solis pēc TET bloķējuma noņemšanas

- [ ] No parastā klienta tīkla pārliecināties, ka `lumiq.cam` DNS/HTTPS vairs nenovirza uz `stop.tiklavairogs.tet.lv` un sasniedz Cloudflare Access.
- [ ] Pievienot precīzos `lumiq.cam` callback/redirect URL Supabase Auth atļautajam sarakstam.
- [ ] Pirms cutover pārbaudīt kandidāta veselību, vienīgā īpašnieka Access politiku un tūlītēju DNS/Worker rollback procedūru.
- [ ] Pēc īpašnieka apstiprinājuma pārslēgt `lumiq.cam` Worker maršrutu no Closed Test uz Production, saglabājot Access/PIN.
- [ ] Tūlīt pārbaudīt īpašnieka pieteikšanos, Auth e-pasta saites, foto plūsmu un anonīmu bloķēšanu; kļūmes gadījumā atjaunot iepriekšējo maršrutu.

**Līdz 8. posma izpildei:** `lumiq.cam` paliek Closed Test maršrutā; kandidāts paliek atsevišķā adresē aiz Access; publiska piekļuve netiek atvērta.
