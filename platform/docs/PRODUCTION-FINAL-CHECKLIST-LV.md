# Lumiq Production pabeigšanas saraksts

Mērķis: pabeigt privāti lietojamu Lumiq produktu Production kandidātā, nemainot `lumiq.cam` maršrutu līdz TET bloķējuma atrisināšanai un neatverot publisku piekļuvi. Šis saraksts seko īpašnieka astoņu posmu secībai. Atzīme apliecina tikai norādīto pierādījumu, nevis plašāku dzīvas Production plūsmas darbspēju.

**Pēdējā darba pārbaude:** 2026-09-30. Papildu izpildes pierādījumi ir [Production progresa dokumentā](./PRODUCTION-PROGRESS-LV.md).

## Pārbaudītie infrastruktūras pamati

- [x] Production Supabase Pro, drošā runtime loma un Hyperdrive ir piesaistīti; migrācijas `001–046` auditētas.
- [x] Production backup no privātā R2 atkārtoti pārbaudīts 2026-09-30: 21 tabula, migrācijas `001–046`, 0 foto objektu, checksum derīgs.
- [x] Production kandidāts darbojas atsevišķā `workers.dev` adresē. `lumiq.cam` maršruts nav mainīts.
- [x] EU Production foto, backup un recovery bucketu atdalījums pārbaudīts. `app-images` un `event-photo-media` neaiztikt.
- [x] Supabase Auth SMTP izmanto verificēto Resend `send.lumiq.cam` un `Lumiq` sūtītāja nosaukumu.

## 1. E-pasta adreses un saņemšana

- [x] Sistēmas vēstules pašlaik sūta no `noreply@send.lumiq.cam`; tas ir esošais verificētais variants.
- [ ] Ja vajadzīgs tieši `noreply@lumiq.cam`, pievienot saknes domēnu Resend ar atsevišķu Return-Path un verificēt to; pirms tam saglabāt esošos piecus Namecheap MX un Namecheap SPF ierakstu. DNS vēl nav mainīts.
- [ ] Izveidot īstu `support@lumiq.cam` saņemšanu vai pāradresāciju un pārbaudīt ienākošo vēstuli. Galamērķa pastkaste jāapstiprina īpašniekam; jautājums ir uzdots.
- [ ] Neveidot pagaidām `events@` vai citas pastkastes.

## 2. Lumiq e-pastu dizains un pārbaude

- [x] Sagatavotas un Production Supabase Auth saglabātas sešas Lumiq HTML veidnes: apstiprināšana, uzaicinājums, paroles atjaunošana, e-pasta maiņa un konta drošības paziņojumi.
- [x] Worker transakciju vēstulēm Resend payload satur gan `text`, gan `html`; `node --test platform/tests/email-templates.test.mjs platform/tests/operations.test.mjs` izturēja 9/9.
- [ ] Supabase Auth panelī ir HTML lauks, nevis atsevišķa teksta MIME lauka. Pārbaudīt reāli saņemtās Auth vēstules MIME un izlemt, vai vajadzīgs atbalstīts Auth email hook, lai garantētu teksta alternatīvu.
- [ ] Pārbaudīt reālas vēstules Gmail un vēl vienā pasta klientā: LV/EN, saites, mobilais izkārtojums un MIME tipi.
- [ ] `support@lumiq.cam` iestatīt kā atbildes adresi tikai pēc ienākošās saņemšanas verificēšanas. Worker `PLATFORM_EMAIL_REPLY_TO` ir izvēles iestatījums; Supabase Auth Reply-To iespēja jāpārbauda atsevišķi.

## 3. Production konta plūsma aiz Access

- [ ] Ar atsevišķu testa kontu pārbaudīt reģistrāciju vai uzaicinājumu, apstiprinājuma saiti, pieslēgšanos, paroles atjaunošanu un izrakstīšanos.
- [ ] Pārbaudīt sesijas atkārtotu ielādi un kļūdainas/expired saites saprotamu apstrādi.
- [ ] Skaidri marķēt testa kontu, un pēc pārbaudes dzēst testa lietotāju un saistītos datus.

## 4. Pasākuma un foto pilnais cikls

- [ ] Izveidot testa pasākumu un QR kodu.
- [ ] Pārbaudīt viesa vārdu, kameras foto uzņemšanu/augšupielādi, galeriju un sīktēlus mobilajā ierīcē.
- [ ] Pārbaudīt foto dzēšanu datubāzē un objekta izņemšanu no R2.
- [ ] Pārbaudīt ZIP lejupielādi, kļūdu paziņojumus, lēnu savienojumu un atkārtotu mēģinājumu.
- [ ] Pēc testa izdzēst sintētisko pasākumu un objektus un apstiprināt, ka dati vairs nav pieejami.

## 5. Drošība un izolācija

- [x] Bez cookies kandidāta `/`, `/login` un `/healthz` katrs atgrieza `302` uz Cloudflare Access login.
- [x] Workers → Access pašreizējā skatā kandidāta hostname un `lumiq.cam` ir piesaistīti `Lumiq closed test - owner` Allow politikai; abiem Worker nav atsevišķas Worker-level politikas.
- [ ] Atvērt šīs politikas definīciju un atkārtoti apstiprināt, ka vienīgais Include nosacījums ir īpašnieka e-pasts; Worker Access kopsavilkums nerāda pašas politikas noteikumus.
- [ ] Ar diviem testa organizatoriem pierādīt, ka pasākumi un galerijas ir savstarpēji izolēti.
- [ ] Ar anonīmu klientu pārbaudīt, ka organizatora API, dati un faili nav pieejami arī ar tiešu URL; sākotnējais `302` pārbauda Access robežu, nevis iekšējās lietotnes autorizāciju.

## 6. Fona darbi, rezerves kopijas un uzraudzība

- [x] Lokālie sintētiskie Queue/DLQ, retry, job un backup testi izturēja 2026-09-30: `platform.test.mjs`, `worker-router.test.mjs`, `migrations.test.mjs` un `reliability.test.mjs`/`production-backup.test.mjs` kopā 81 pārbaude bez kļūdām. Tie nepierāda dzīvas Cloudflare Queue kļūmes apstrādi.
- [x] Jaunākā Production backup read-back un checksum pārbaude izturēja 2026-09-30.
- [ ] Pilnu restore testu veikt tikai tukšā izolētā mērķī; esošo Recovery datubāzi nepārrakstīt.
- [ ] Pārbaudīt aktuālos Production Worker kļūdu žurnālus un Queue/DLQ metriku, tostarp sintētisku kļūmes scenāriju bez reālu klientu datu ietekmes.
- [ ] Pievienot Cloudflare `$10`/`$50` budžeta brīdinājumu saņēmēju pēc adreses apstiprināšanas; pašlaik saņēmēju lauki ir tukši.
- [x] Pārbaudīt Cloudflare Production Worker Observability žurnālu “Last 1 hour” skatā 2026-09-30: 10 success, 0 errors; pēdējie redzamie notikumi ir `/api/config` un `/api/auth/session`. Tas nav pilnas lietotnes plūsmas pierādījums.
- [ ] Pārskatīt izmaksas un resursu atkarības; resursus nedzēst bez pierādītas neatkarības un īpašnieka apstiprinājuma. `app-images` un `event-photo-media` neaiztikt — STOP.

## 7. TET atbildes sagaidīšana un atkārtots pieprasījums

- [ ] Sagaidīt atbildi uz 2026-09-25 nosūtīto TET pieprasījumu. Piecu darba dienu termiņš, neieskaitot nedēļas nogali, beidzas aptuveni 2026-10-02.
- [ ] Ja atbildes nav līdz termiņam, 2026-10-05 sazināties ar TET atkārtoti, pievienojot sākotnējā STOP ekrāna attēlu un skenēšanas rezultātus.
- [ ] Līdz TET apstiprinājumam `lumiq.cam` maršrutu nemainīt.

## 8. Pēdējais solis pēc TET bloķējuma noņemšanas

- [ ] No parastā klienta tīkla pārliecināties, ka `lumiq.cam` DNS/HTTPS vairs nenovirza uz `stop.tiklavairogs.tet.lv` un sasniedz Cloudflare Access.
- [ ] Pievienot precīzos `lumiq.cam` callback/redirect URL Supabase Auth atļautajam sarakstam.
- [ ] Pirms cutover pārbaudīt kandidāta veselību, vienīgā īpašnieka Access politiku un tūlītēju DNS/Worker rollback procedūru.
- [ ] Pēc īpašnieka apstiprinājuma pārslēgt `lumiq.cam` Worker maršrutu no Closed Test uz Production, saglabājot Access/PIN.
- [ ] Tūlīt pārbaudīt īpašnieka pieteikšanos, Auth e-pasta saites, foto plūsmu un anonīmu bloķēšanu; kļūmes gadījumā atjaunot iepriekšējo maršrutu.

**Līdz 8. posma izpildei:** `lumiq.cam` paliek Closed Test maršrutā; kandidāts paliek atsevišķā adresē aiz Access; publiska piekļuve netiek atvērta.
