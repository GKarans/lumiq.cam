# Lumiq Production palaišanas kontrolsaraksts

Pēdējā statusa pārbaude: 2026-09-30. Katrs punkts jāatzīmē par pabeigtu tikai pēc norādītā pierādījuma. `lumiq.cam` maršrutu nepārslēgt, kamēr TET nav noņēmis bloķējumu. Cloudflare Access paliek ieslēgts tikai īpašnieka e-pastam. `app-images` un `event-photo-media` neaiztikt.

## 1. E-pasta adreses un saņemšana

- [x] Production Supabase SMTP pēc pārlādes izmanto verificēto `Lumiq <noreply@lumiq.cam>` ar Resend lietotājvārdu `resend`; saglabātā SMTP parole paliek noslēpta.
- [x] Resend saknes `lumiq.cam` domēns verificēts ar pielāgoto Return-Path `outbound`, neskarot piecus Namecheap MX, Namecheap SPF un Worker DNS ierakstus.
- [x] 2026-09-30 publiskā DNS pārbaude: pieci Namecheap MX un Namecheap SPF joprojām publicēti, Resend DKIM atrodams, `_dmarc.lumiq.cam` nav publicēts; pārbaude bija tikai lasāma un DNS netika mainīts.
- [ ] Nosūtīt kontrolētu Auth testa vēstuli no `noreply@lumiq.cam` un pārbaudīt piegādi.
- [x] `support@lumiq.cam` pāradresācija uz `guntars.karans@gmail.com` pārbaudīta ar ārēju testa vēstuli; īpašnieka Gmail ekrānuzņēmumā tā redzama zem `Lumiq` iezīmes (2026-09-30).
- [x] Pāradresācijas saņēmējs apstiprināts: `guntars.karans@gmail.com`.
- [ ] Pirms Cloudflare Email Routing aktivizācijas atrisināt DNS konfliktu: publiskajā DNS šobrīd ir pieci `eforward*.registrar-servers.com` MX ieraksti un Namecheap SPF `include:spf.efwd.registrar-servers.com`. Cloudflare vednis piedāvā tos aizstāt ar saviem trim MX un SPF. Nekādas izmaiņas neveikt, kamēr nav izvēlēts, vai pārņemt ienākošā pasta maršrutēšanu un saglabāts vajadzīgais esošais pasts.
- Namecheap konta `Redirect Email` panelis prasa pārslēgt nameserverus uz Namecheap noklusējumu. To nedarīt, jo `lumiq.cam` DNS pašlaik apkalpo Cloudflare; pārbaudīts 2026-09-30.
- [ ] Nākamajā apstiprinātajā kandidāta izvietošanā pievienot Worker `PLATFORM_EMAIL_FROM=Lumiq <noreply@lumiq.cam>`; pašreizējā Production Runtime variables panelī tas nav iestatīts. Pēc tam kontrolēti pārbaudīt Worker transakciju e-pasta piegādi.

## 2. Lumiq e-pastu dizains

- [x] Sagatavotas sešas responsīvas, LV/EN Supabase Auth HTML veidnes: reģistrācijas apstiprinājums, uzaicinājums, paroles atiestatīšana, e-pasta maiņa un abu izmaiņu drošības paziņojumi.
- [x] Saglabāts `Lumiq` sūtītāja nosaukums; Worker paziņojumi atbalsta gan teksta, gan HTML saturu.
- [x] Pēc pārlādes pārbaudīts Production SMTP sūtītājs `noreply@lumiq.cam`, lietotājvārds `resend`, host `smtp.resend.com:465`; saglabātā parole paliek noslēpta.
- [x] 2026-09-30 Production Supabase Auth `Invite user` veidnei iestatīta tukšā tēma `Uzaicinājums uz Lumiq / Invitation to Lumiq`; pēc saglabāšanas un pārlādes tā joprojām redzama, HTML saturs nav mainīts.
- [x] 2026-09-30 lokāli pārbaudīta e-pasta funkcionalitāte: `npm test` (171/171), Auth Edge Function testi (8/8), `deno check` un `deno audit` bez atrastām ievainojamībām. Tie nesūta īstu vēstuli un neaizstāj piegādes pārbaudi.
- [ ] Nosūtīt kontrolētu Auth testa vēstuli un pārbaudīt reālu piegādi, saites un kļūdu žurnālus.
- [x] Kandidāta Worker dzīvajā konfigurācijā ir `PLATFORM_EMAIL_REPLY_TO=support@lumiq.cam`; faktiska nosūtīta ziņojuma galvene vēl nav pārbaudīta.
- [ ] Supabase Auth SMTP neuzrāda Reply-To lauku. Send Email Hook prototips to atbalsta, bet aizstāj iebūvēto SMTP; pirms iespējamas aktivizācijas izolēti pārbaudīt visas Auth darbības, drošības paziņojumus un kļūmju scenārijus. Production SMTP paliek aktīvs.
- [ ] Saņemt vēstules Gmail un vēl vienā pasta klientā; pārbaudīt abas valodas, saites, derīguma termiņu un mobilo izkārtojumu. Auth veidņu redaktorā nav atsevišķa `text/plain` lauka; Worker vēstulēm teksta alternatīva jau ir.

## 3. Production konta plūsma aiz Access

- [ ] Ar skaidri identificētu testa kontu pārbaudīt reģistrāciju vai uzaicinājumu, apstiprināšanu, pieslēgšanos, paroles atiestatīšanu un izrakstīšanos.
- [ ] Pēc testa izdzēst vai skaidri atzīmēt testa kontu un tā datus.
- [x] Kandidāta anonīmie `/`, `/login` un `/healthz` pieprasījumi atgrieza Cloudflare Access `302`; autorizētā pārlūkā kandidāts ir atverams.
- [x] 2026-09-30 anonīms HTTP `GET /app` uz Production kandidātu atgrieza Cloudflare Access `302`; pārbaude neizpildīja pāradresāciju un neizmantoja autentifikācijas datus.

## 4. Pasākuma un foto pilnais cikls

- [ ] Production kandidātā ar testa datiem izveidot pasākumu un QR kodu.
- [ ] Pārbaudīt viesa vārdu, foto uzņemšanu/augšupielādi, galeriju un sīktēlus.
- [ ] Pārbaudīt foto dzēšanu, R2 objekta izņemšanu un ZIP lejupielādi.
- [ ] Pārbaudīt saprotamas kļūdas un lēna tīkla uzvedību.
- [x] Izolētā lokālā browser suite izturēja 7 scenārijus, ieskaitot sintētisko foto ceļu; tas nav Production plūsmas pierādījums.
- [x] 2026-09-30 `npm run browser` izolētais UI/E2E tests izturēja 320–1440 px platumus, reģistrācijas/pasākuma/foto ceļu, uzaicinājuma callback, QR/cover redaktoru, norēķinu ekrānus un axe/keyboard/reduced-motion/200% zoom pārbaudes. Pārlūks neveica ārējus pieprasījumus; tas nav Production E2E pierādījums.

## 5. Drošība un izolācija

- [x] Kandidāta anonīmie pieprasījumi novirzās uz Access; `lumiq.cam` maršruts joprojām paliek Closed Test.
- [x] 2026-09-30 Cloudflare Workers saraksta pārbaude: `lumiq.cam` un vēl viens hostname ir pie `lumiq-closed-test`; `lumiq-production-candidate` ir tikai savā `workers.dev` hostname. DNS zonas Worker Routes sadaļā nav route ierakstu, tāpēc `lumiq.cam` piesaiste ir Worker hostname konfigurācija. Nekas netika mainīts.
- [x] 2026-09-30 Cloudflare Zero Trust politikā `Lumiq closed test - owner` tieši pārbaudīts `Allow` un viens `Include` noteikums ar īpašnieka konta e-pastu. Lietotņu sarakstā šī politika piesaistīta gan kandidāta hostname, gan `lumiq.cam`; adrese nav ierakstīta repozitorijā.
- [ ] Ar diviem atsevišķiem testa organizatoriem pierādīt pasākumu un galeriju savstarpēju izolāciju; apstiprināt, ka anonīmi lietotāji nevar atvērt organizatora sadaļas.
- [x] 2026-09-30 `npm run security` izturēja: noslēpumu skeneris pārbaudīja 271 tracked/unignored failu, `npm audit --audit-level=high` atrada 0 ievainojamību; tas neaizstāj dzīvu Production piekļuves testu.

## 6. Fona darbi, rezerves kopijas un uzraudzība

- [ ] Pievienot Production DLQ patērētāju un pārbaudīt Queue retry/DLQ dzīvajā vidē; pirms izvietošanas un kontrolētas kļūmes injicēšanas vajadzīgs atsevišķs apstiprinājums, jo tas var palaist Queue darbus pret Production DB.
- [x] 2026-09-30 Cloudflare Queue read-only pārbaude: `lumiq-production-jobs` Active ar `lumiq-production-candidate` consumer; batch 1, max wait 5 s, 10 retry, retry delay 0 s, concurrency 1, piesaistīts `lumiq-production-jobs-dlq`. DLQ rinda ir Inactive bez consumer; dashboard rāda 0 queued un 0 average backlog. Dzīvu kļūmi neinjicēju.
- [x] Jaunākā Production rezerves kopija atkārtoti pārbaudīta 2026-09-30 ar DPAPI komandu `check-production-backup`: `production/2026-09-29T15-47-15-316Z`, 21 tabula, migrācijas 001–046, 0 foto objektu; kontrolsummas sakrīt un atjaunošana netika veikta.
- [x] Recovery mērķa atjaunošana un migrāciju ķēde pārbaudīta; aizpildīto Recovery projektu nepārrakstīt.
- [x] 2026-09-30 pārbaudīti divi aktīvi Cloudflare Billing Budget Alert: automātiskais `$10` slieksnis un `$50` slieksnis; abiem e-pasta saņēmējs ir īpašnieka konta adrese. Testa vēstule netika sūtīta.
- [x] 2026-09-30 Production Worker Observability pēdējā stundā rādīja 4 veiksmīgus notikumus un 0 kļūdu; Worker Logs ir ieslēgti. Logu payloadi netika atvērti.
- [ ] Ar kontrolētu testa kļūmi pārbaudīt Queue retry/DLQ dzīvajā vidē pēc DLQ patērētāja izvietošanas un apstiprinājuma.

## 7. TET atbildes sagaidīšana

- Pieteikums nosūtīts 2026-09-25. Piecu darbdienu termiņš, neskaitot nedēļas nogali, aptuveni beidzas piektdien, 2026-10-02.
- Ja atbildes nav, pirmdien, 2026-10-05, sazināties atkārtoti ar sākotnējā STOP ekrāna attēlu un tīrības skenējumu rezultātiem.
- [ ] Saņemt TET apstiprinājumu, ka `lumiq.cam` vairs nav bloķēts, un pārbaudīt no Tet tīkla.
- Līdz atrisinājumam nemainīt `lumiq.cam` Worker maršrutu un neievadīt kontu datus STOP lapā.

## 8. Pēdējais solis pēc TET bloķējuma noņemšanas

- [ ] Pārbaudīt, ka parastais `lumiq.cam` DNS sasniedz Cloudflare Access, nevis STOP lapu.
- [ ] Pievienot precīzos `lumiq.cam` Auth redirect URL Supabase Production konfigurācijai.
- [ ] Pārslēgt hostname maršrutu no Closed Test uz Production, saglabājot owner-only Access.
- [ ] Uzreiz pārbaudīt pieslēgšanos, e-pasta saites un foto plūsmu; saglabāt un pārbaudīt atgriešanās maršruta instrukciju.

## Darba un izmaiņu kārtība

- Pēc katras pabeigtas darba vienības palaist attiecīgos testus, pārskatīt izmaiņas, veikt commit un push uz `lumiq.cam` repozitorija `main`.
- Nekad neierakstīt paroles vai tokenus repozitorijā. Secrets glabāt DPAPI lokāli vai Cloudflare/Supabase secrets glabātuvēs.
- “Izolēts lokālais tests”, “kandidāta aiz Access pārbaude” un “Production lietotāja plūsma” ir atšķirīgi pierādījumu līmeņi; nesaukt vienu par otru.
