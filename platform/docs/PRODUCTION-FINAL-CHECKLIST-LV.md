# Lumiq Production pabeigšanas saraksts

Mērķis: pabeigt un pārbaudīt privāti lietojamu Lumiq produktu uz Production kandidāta, neatverot publisku piekļuvi un nemainot `lumiq.cam` maršrutu, kamēr TET nav atrisinājis bloķējumu.

**Pēdējais pārbaudītais stāvoklis:** 2026-09-29. Pārbaudītos faktus un pierādījumus skatīt [Production progresā](./PRODUCTION-PROGRESS-LV.md). Šis saraksts ir izpildes secība, nevis apgalvojums, ka vēl nepārbaudītās darbības jau ir izdevušās.

## 1. Pamati jau pārbaudīti

- [x] Production Supabase Pro, DB migrācijas `001–046`, drošā `lumiq_production_runtime` loma un Hyperdrive piesaiste.
- [x] Production rezerves kopija pārbaudīta no R2; atjaunošanas projekts un migrāciju ķēde pārbaudīti.
- [x] Kandidāta Worker ir izvietots atsevišķā `workers.dev` adresē; kandidātam un `lumiq.cam` ir owner-only Cloudflare Access politika.
- [x] Cloudflare EU foto, backup un recovery R2 resursi ir atdalīti. `app-images` un ar to saistīto `event-photo-media` neaiztikt.
- [x] Supabase Auth SMTP caur Resend un sešas Auth veidnes ir konfigurētas; `send.lumiq.cam` ir verificēts.
- [x] Lokālie testi, būve, drošības pārbaudes un sintētiskie pārlūka scenāriji ir izturējuši. Tie neaizstāj dzīvo Production plūsmas pārbaudi.

## 2. Pabeigt kandidāta e-pastus

- [ ] Izveidot un verificēt atsevišķu Production QA saņēmēja adresi; izmantot to reģistrācijas, uzaicinājuma, apstiprinājuma, paroles atiestatīšanas un e-pasta maiņas pārbaudēm.
- [ ] Pārbaudīt reālu piegādi vismaz Gmail un vēl vienā pasta klientā, saites un mobilos veidņu izkārtojumus. Noslēpumus un klikšķināmus autentifikācijas tokenus neiekļaut testu atskaitēs.
- [ ] Izveidot `support@lumiq.cam` saņemšanu/pāradresāciju uz īpašnieka izvēlētu pastkasti; pirms konfigurēšanas jāzina saņēmēja adrese.
- [ ] Pārbaudīt `noreply@lumiq.cam` kā sūtītāja adresi. Līdz Resend saknes domēna verifikācijai palikt pie strādājošā `noreply@send.lumiq.cam`.
- [ ] Resend saknes domēnam izmantot atsevišķu Return-Path, piemēram, `outbound`, un tikai tad sagatavot/verificēt nepieciešamos DNS ierakstus. Pirms DNS izmaiņām saglabāt esošos piecus Namecheap MX un Namecheap SPF ierakstu; automātisku DNS konfigurāciju neizmantot.
- [ ] Sagatavot Lumiq vizuālajā stilā sakārtotas vēstuļu veidnes: konta apstiprināšana, uzaicinājums, paroles atiestatīšana, paroles maiņas paziņojums, e-pasta adreses maiņas paziņojums un produkta atbalsta vēstule. Pārskatīt latviešu/angļu tekstu, kontrastu, logo, pogas un vienkārša teksta alternatīvu.
- [ ] Pārbaudīt, ka kļūdaina vai nedeliverējama adrese nerada sensitīvu datu noplūdi un lietotājam tiek parādīts saprotams statuss.

**Piezīme:** Resend saknes `lumiq.cam` ieraksts pašlaik ir `Not Started`; tā DNS nav mainīts. Noklusētais Return-Path konfliktē ar esošo `send.lumiq.cam` konfigurāciju. Saņēmēja pastkastei vēl nav apstiprināts pāradresācijas galamērķis. Šīs darbības nav jāsāk ar esošo ierakstu dzēšanu, kamēr nav īpašnieka apstiprinājuma.

## 3. Pabeigt privātu Production lietotnes pārbaudi

- [ ] Atkārtoti pārbaudīt Cloudflare Access stāvokli un owner-only politiku abiem hostiem: kandidātam un `lumiq.cam`. Anonīmam pieprasījumam jāsaņem Access pieteikšanās, nevis lietotnes saturs.
- [ ] Kandidātā aiz Access iziet īpašnieka reģistrāciju, pieteikšanos, atteikšanos un sesijas atjaunošanu.
- [ ] Ar sintētiskiem testa datiem iziet pilnu foto plūsmu: izveidot pasākumu, QR/saiti, atvērt viesa lapu, uzņemt/augšupielādēt foto, pārbaudīt galeriju, dzēšanu un atjaunošanas uzvedību.
- [ ] Pārbaudīt foto tipu/izmēra ierobežojumus, kļūdas, mobilā ekrāna lietojamību, lēna savienojuma uzvedību un piekļuves izolāciju starp organizatoriem/pasākumiem.
- [ ] Pārbaudīt visu foto ZIP eksportu, lielas galerijas plūsmu, Queue retry/DLQ uzvedību un kļūmju novērojamību ar sintētiskiem datiem.
- [ ] Pārbaudīt backup brīdinājumus un atjaunošanas instrukcijas, nenodzēšot vai nepārrakstot esošo Recovery datubāzi.
- [ ] Izvietot kandidātā tikai pēc release gate izpildes; pēc izvietošanas atkārtot smoke testus. `lumiq.cam` maršrutu šajā posmā neaiztikt.

## 4. Izmaksas, konti un resursu inventārs

- [ ] Iestatīt un pārbaudīt Cloudflare `$10` un `$50` budžeta brīdinājumu saņēmējus, kad īpašnieks apstiprina adresi; pašlaik lauki ir tukši.
- [ ] Pārskatīt mēneša Supabase/Cloudflare/Resend izmaksas, kvotas un Recovery Micro termiņu; neieslēgt papildu maksas funkcijas bez vajadzības.
- [ ] Salīdzināt katru R2 bucket, Hyperdrive, Worker un Supabase projektu ar dzīvu bindingu, datiem un dokumentētu atjaunošanas vajadzību.
- [ ] Tikai pēc atkarību audita un atsevišķa īpašnieka apstiprinājuma arhivēt vai dzēst liekos resursus. Production, Recovery un vajadzīgo Restore Drill neatvienot pirms pierādījumu saglabāšanas.
- [ ] `app-images` un `event-photo-media` neaiztikt — STOP.

## 5. Dokumentācija un palaišanas vārti

- [ ] Atjaunināt lietotāja rokasgrāmatu, incidentu/rollback instrukciju, backup/restore pierādījumus un testa rezultātus.
- [ ] Atzīmēt, kas ir lokāli pārbaudīts, kas ir pārbaudīts Cloudflare/Supabase panelī un kas ir iziets īstā lietotāja pārlūkā.
- [ ] Atstāt publisku reģistrāciju, maksājumus un publisku piekļuvi izslēgtu, kamēr nav pabeigti juridiskie, cenu un īpašnieka palaišanas lēmumi.

## 6. Pēdējais ārējais šķērslis: TET un `lumiq.cam`

- [ ] Sagaidīt TET atbildi uz 2026-09-25 nosūtīto pieprasījumu (solītais termiņš: piecas darba dienas, neieskaitot nedēļas nogali; aptuveni līdz 2026-10-02).
- [ ] Ja atbildes nav pēc solītā termiņa, sazināties ar TET atkārtoti un pieprasīt `lumiq.cam` pārskatīšanu/atbloķēšanu. Saglabāt sarakstes un tīkla pārbaudes pierādījumus.
- [ ] Pēc TET apstiprinājuma no klienta tīkla pārbaudīt DNS un HTTPS sasniedzamību; pārliecināties, ka nav `stop.tiklavairogs.tet.lv` novirzīšanas.
- [ ] Pirms cutover vēlreiz pārbaudīt kandidāta veselību, Access owner-only politiku, autentifikācijas callback URL, DNS pašreizējo konfigurāciju un tūlītēju rollback ceļu.
- [ ] Tikai pēc visiem iepriekšējiem vārtiem un īpašnieka apstiprinājuma pārslēgt `lumiq.cam` uz Production Worker, saglabājot Access/PIN aizsardzību.
- [ ] Pēc pārslēgšanas testēt gan īpašnieka piekļuvi, gan anonīmu bloķēšanu; kļūmes gadījumā nekavējoties atjaunot iepriekšējo maršrutu.

**Līdz pēdējā posma izpildei:** `lumiq.cam` paliek Closed Test maršrutā, Production kandidāts paliek atsevišķā hostā aiz Access, un neviena publiska piekļuve netiek atvērta.
