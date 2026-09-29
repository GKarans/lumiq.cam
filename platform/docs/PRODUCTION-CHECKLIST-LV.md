# Lumiq Production palaišanas kontrolsaraksts

Pēdējā statusa pārbaude: 2026-09-30. Katrs punkts jāatzīmē par pabeigtu tikai pēc norādītā pierādījuma. `lumiq.cam` maršrutu nepārslēgt, kamēr TET nav noņēmis bloķējumu. Cloudflare Access paliek ieslēgts tikai īpašnieka e-pastam. `app-images` un `event-photo-media` neaiztikt.

## 1. E-pasta adreses un saņemšana

- [x] Production Supabase SMTP izmanto verificēto `Lumiq <noreply@send.lumiq.cam>` ar Resend lietotājvārdu `resend`; saglabātā SMTP parole paliek noslēpta.
- [ ] Pabeigt Resend saknes `lumiq.cam` domēna verifikāciju un pēc tam pārbaudīt `noreply@lumiq.cam` sūtīšanu. Izmantots pielāgots Return-Path `outbound`, lai nesadurtos ar `send.lumiq.cam`; Resend vēl rāda `Pending`.
- [ ] Izveidot `support@lumiq.cam` kā īstu ienākošo adresi vai pāradresāciju un pārbaudīt saņemšanu.
- [ ] Apstiprināt pāradresācijas saņēmēja adresi.
- [ ] Pirms Cloudflare Email Routing aktivizācijas atrisināt DNS konfliktu: publiskajā DNS šobrīd ir pieci `eforward*.registrar-servers.com` MX ieraksti un Namecheap SPF `include:spf.efwd.registrar-servers.com`. Cloudflare vednis piedāvā tos aizstāt ar saviem trim MX un SPF. Nekādas izmaiņas neveikt, kamēr nav izvēlēts, vai pārņemt ienākošā pasta maršrutēšanu un saglabāts vajadzīgais esošais pasts.
- Namecheap konta `Redirect Email` panelis prasa pārslēgt nameserverus uz Namecheap noklusējumu. To nedarīt, jo `lumiq.cam` DNS pašlaik apkalpo Cloudflare; pārbaudīts 2026-09-30.
- [ ] Ja sūtīšanai vajadzīgs tieši `@lumiq.cam`, pievienot saknes domēnu Resend un verificēt, apvienojot SPF, neizdzēšot esošo pasta konfigurāciju.

## 2. Lumiq e-pastu dizains

- [x] Sagatavotas sešas responsīvas, LV/EN Supabase Auth HTML veidnes: reģistrācijas apstiprinājums, uzaicinājums, paroles atiestatīšana, e-pasta maiņa un abu izmaiņu drošības paziņojumi.
- [x] Saglabāts `Lumiq` sūtītāja nosaukums; Worker paziņojumi atbalsta gan teksta, gan HTML saturu.
- [x] Pēc pārlādes pārbaudīts Production SMTP sūtītājs `noreply@send.lumiq.cam`, lietotājvārds `resend`, host `smtp.resend.com:465`; saglabātā parole paliek noslēpta.
- [ ] Nosūtīt kontrolētu Auth testa vēstuli un pārbaudīt reālu piegādi, saites un kļūdu žurnālus.
- [ ] Pēc `support@` saņemšanas konfigurēt un notestēt Reply-To.
- [ ] Saņemt vēstules Gmail un vēl vienā pasta klientā; pārbaudīt abas valodas, saites, derīguma termiņu un mobilo izkārtojumu. Auth veidņu redaktorā nav atsevišķa `text/plain` lauka; Worker vēstulēm teksta alternatīva jau ir.

## 3. Production konta plūsma aiz Access

- [ ] Ar skaidri identificētu testa kontu pārbaudīt reģistrāciju vai uzaicinājumu, apstiprināšanu, pieslēgšanos, paroles atiestatīšanu un izrakstīšanos.
- [ ] Pēc testa izdzēst vai skaidri atzīmēt testa kontu un tā datus.
- [x] Kandidāta anonīmie `/`, `/login` un `/healthz` pieprasījumi atgrieza Cloudflare Access `302`; autorizētā pārlūkā kandidāts ir atverams.

## 4. Pasākuma un foto pilnais cikls

- [ ] Production kandidātā ar testa datiem izveidot pasākumu un QR kodu.
- [ ] Pārbaudīt viesa vārdu, foto uzņemšanu/augšupielādi, galeriju un sīktēlus.
- [ ] Pārbaudīt foto dzēšanu, R2 objekta izņemšanu un ZIP lejupielādi.
- [ ] Pārbaudīt saprotamas kļūdas un lēna tīkla uzvedību.
- [x] Izolētā lokālā browser suite izturēja 7 scenārijus, ieskaitot sintētisko foto ceļu; tas nav Production plūsmas pierādījums.

## 5. Drošība un izolācija

- [x] Kandidāta anonīmie pieprasījumi novirzās uz Access; `lumiq.cam` maršruts joprojām paliek Closed Test.
- [x] 2026-09-30 Cloudflare Zero Trust politikā `Lumiq closed test - owner` tieši pārbaudīts `Allow` un viens `Include` noteikums ar īpašnieka konta e-pastu. Lietotņu sarakstā šī politika piesaistīta gan kandidāta hostname, gan `lumiq.cam`; adrese nav ierakstīta repozitorijā.
- [ ] Ar diviem atsevišķiem testa organizatoriem pierādīt pasākumu un galeriju savstarpēju izolāciju; apstiprināt, ka anonīmi lietotāji nevar atvērt organizatora sadaļas.

## 6. Fona darbi, rezerves kopijas un uzraudzība

- [ ] Pievienot un pārbaudīt Production DLQ patērētāju; pašlaik DLQ nav patērētāja, lai gan pēdējā pārbaudē backlog bija 0. Pirms izvietošanas vajadzīgs atsevišķs apstiprinājums.
- [x] Jaunākā Production rezerves kopija atkārtoti pārbaudīta 2026-09-30: 21 tabula, migrācijas 001–046 un kontrolsummas sakrīt; netika veikta atjaunošana.
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
