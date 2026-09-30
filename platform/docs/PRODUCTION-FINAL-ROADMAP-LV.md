# Lumiq Production pabeigšanas saraksts

Mērķis: pabeigt un pārbaudīt Lumiq kā privāti lietojamu produktu, pirms `lumiq.cam` maršruta pārslēgšanas. Kandidāts paliek aiz Cloudflare Access ar atļauju tikai īpašniekam. `app-images` un `event-photo-media` ir neaizskarami. Šis ir jaunais darba saraksts; statusu atzīmē tikai pēc norādītā pierādījuma.

**Pēdējā pārskatīšana:** 2026-09-30. Šis saraksts neaizstāj pienākumu pārbaudīt katru dzīvo plūsmu; lokāli testi nav Production pierādījums.

**Darba princips:** kamēr TET izskata 2026-09-25 pieteikumu, pabeigt visus tālākos darbus kandidātā aiz Cloudflare Access. `lumiq.cam` DNS/Worker maršrutu neaiztikt. Kad pārējais gatavs, gaidīt TET atbloķēšanu; domēna pārslēgšana ir pēdējais solis.

## Īsā izpildes secība

1. [ ] Pabeigt e-pasta saņemšanu un piegādes pārbaudes; sakārtot Lumiq veidnes.
2. [ ] Pēc atsevišķa apstiprinājuma atjaunināt kandidāta Worker, saglabājot Cloudflare Access un nemainot `lumiq.cam` maršrutu.
3. [ ] Kandidātā aiz Access pārbaudīt konta/Auth plūsmas un visu foto ciklu ar QA datiem.
4. [ ] Pārbaudīt divu organizatoru izolāciju, anonīmo piekļuvi, Queue/DLQ, rezerves kopijas, brīdinājumus un žurnālus.
5. [ ] Pabeigt kandidāta pieņemšanas pārbaudi un gaidīt TET atbildi; ja līdz norunātajam termiņam tās nav, nosūtīt atgādinājumu.
6. [ ] Tikai pēc TET atbloķēšanas pārbaudīt domēnu no Tet un cita tīkla, pievienot precīzos Auth callback URL un ar īpašnieka apstiprinājumu pārslēgt `lumiq.cam` uz Production.

TET statuss neaiztur pārējos kandidāta darbus; tas aiztur tikai pēdējo `lumiq.cam` pieslēgšanu.

## A. Pabeigt tagad, kamēr TET izskata pieteikumu

### 1. E-pasta sūtīšana

- [ ] **Lumiq dizaina standarts:** visām Auth un Worker transakciju vēstulēm lietot vienotu Lumiq tēmu, skaidru virsrakstu un darbības pogu, salasāmu mobilo izkārtojumu un teksta alternatīvu. Vēstulēs neiekļaut paroles vai tokenus.
- [ ] Veidņu komplektā pārbaudīt reģistrācijas apstiprinājumu, uzaicinājumu, paroles atjaunošanu, e-pasta maiņu, drošības paziņojumus un produkta transakciju vēstules; `support@lumiq.cam` likt Reply-To tikai pēc ienākošā pasta pārbaudes.
- [x] 2026-09-30 Supabase Production SMTP pārbaudīts pēc pārlādes: custom SMTP ieslēgts, `smtp.resend.com:465`, sūtītājs `Lumiq <noreply@lumiq.cam>`, lietotājvārds `resend`; saglabātā parole ir noslēpta un netika mainīta.
- [ ] Nosūtīt kontrolētu Auth testa vēstuli uz savu testa pastkasti; pārbaudīt piegādi, saites un kļūdu žurnālus. Pirms īstas vēstules nosūtīšanas apstiprināt konkrēto testa sūtījumu.
- [ ] Ar apstiprinātu testa vēstuli pārbaudīt piegādāto MIME: Auth ziņojumiem pārliecināties, ka ir salasāma `text/plain` alternatīva; ja tās nav, izvērtēt Supabase Send Email Hook ar Resend un multipart `text`/`html`, vispirms izveidojot integrācijas testus un atgriešanās plānu. Worker transakciju vēstulēm pārbaudīt abus variantus.
- [ ] Pārbaudīt Auth e-pastus Gmail un vēl vienā pasta klientā: Lumiq dizainu, attēlojumu mobilajā izkārtojumā, LV/EN tekstu, saites un derīguma termiņu.
- [x] Sagatavotas sešas Lumiq tēmas Supabase Auth HTML veidnes: reģistrācija, uzaicinājums, paroles atjaunošana, e-pasta maiņa un drošības paziņojumi.
- [x] Worker transakciju vēstules veidnes atbalsta HTML un teksta variantu; lokālie e-pasta testi izturēti.
- [x] 2026-09-30 atkārtoti palaisti `email-templates.test.mjs`, `auth-callback.test.mjs` un `operations.test.mjs`: 11/11 izturēti. Tie nepārbauda SMTP piegādi no Production.

### 2. Lumiq e-pasta adreses

- [x] Automātiskai sūtīšanai izmanto `noreply@lumiq.cam`; Production Supabase SMTP izmanto `Lumiq <noreply@lumiq.cam>` un Resend. Atsevišķa `noreplay@` adrese nav vajadzīga — pareizā rakstība ir `noreply@`.
- [ ] **Sākuma adrešu komplekts:** `noreply@lumiq.cam` automatizētām vēstulēm un `support@lumiq.cam` klientu atbalstam. Sākumā pietiek ar vienu atbalsta pastkasti/galamērķi; `privacy@` un `billing@` var pievienot vēlāk kā aliasus, ja būs vajadzība.
- [ ] Pirms ienākošā pasta DNS izmaiņām apstiprināt vienu adresi, uz kuru pāradresēt `support@lumiq.cam`, un pārbaudīt esošo MX/SPF ietekmi. Nameserverus nepārslēgt.
- [x] 2026-09-30 Resend domēnu panelī tieši pārbaudīts, ka gan `send.lumiq.cam`, gan saknes `lumiq.cam` ir `Verified`; saknes konfigurācijai Return-Path ir `outbound`, saglabājot esošo sūtīšanas apakšdomēnu. Šajā pārbaudē domēnu vai DNS iestatījumus nemainīju.
- [x] 2026-09-30 salīdzinātas un pēc pārlādes pārbaudītas sešas vajadzīgās Supabase Production Auth veidnes: apstiprinājums, uzaicinājums, paroles atjaunošana, e-pasta maiņa, paroles maiņas un e-pasta maiņas paziņojums. Piecām no tām izņemts Supabase noklusētais HTML fragments, kas iepriekš bija pielīmēts pirms Lumiq dokumenta.
- [ ] Izvēlēties, kur saņemt `support@lumiq.cam` vēstules, un apstiprināt konkrēto galamērķa adresi. Šī ir cilvēka atbalsta adrese; sākumā pietiek ar vienu pastkasti vai aliasu, nevis vairākām atsevišķām pastkastēm.
- [ ] Tikai pēc galamērķa un pasta pakalpojuma izvēles izveidot `support@lumiq.cam` saņemšanu/pāradresāciju un pārbaudīt ienākošo vēstuli. Namecheap panelis prasa Namecheap nameserverus, bet domēna DNS ir Cloudflare; nameserverus nemainīt. Cloudflare Email Routing aktivizēšanai saskaņot esošo MX/SPF migrāciju un tās ietekmi uz esošajām pāradresācijām; ierakstus neaizstāt bez apstiprināta pasta plāna.
- [x] 2026-09-30 Cloudflare Email Routing vednis tikai-lasīšanas režīmā parāda 3 saknes `lumiq.cam` MX ierakstus, DKIM TXT un SPF TXT, ko pievienotu aktivizējot. Vednī ir `Activate` darbība; to nenospiedu, jo tā ir DNS maiņa un vēl nav apstiprināts `support@` galamērķis/esošo aliasu saglabāšana. DNS netika mainīts.
- [ ] Pēc `support@` saņemšanas pārbaudīt ienākošu vēstuli un atbildes plūsmu; iestatīt `support@lumiq.cam` kā Reply-To, kur tas ir atbalstīts, un pārbaudīt Worker `PLATFORM_EMAIL_REPLY_TO` un Supabase Auth Reply-To atsevišķi.
- [ ] Vēlāk vajadzīgās adreses, piemēram, `privacy@` vai `billing@`, sākumā veidot kā aliasus uz apstiprināto atbalsta galamērķi; šobrīd tās nav Production palaišanas priekšnoteikums.

### 3. Production konta un piekļuves plūsma

- [ ] Ar skaidri marķētu testa kontu kandidātā pārbaudīt uzaicinājumu vai reģistrāciju, verifikāciju, pieteikšanos, paroles atjaunošanu, izrakstīšanos un sesijas atjaunošanu pēc lapas pārlādes.
- [ ] Pārbaudīt beigušos/kļūdainu Auth saiti un saprotamu kļūdas paziņojumu.
- [ ] Pēc testa izdzēst testa kontu un tā datus vai dokumentēt, kāpēc tas jāpatur.
- [x] Kandidāta anonīmie pamatpieprasījumi ir aizsargāti ar Cloudflare Access.
- [x] 2026-09-30 tiešie pieprasījumi bez pārlūka sesijas uz kandidāta `/`, `/login` un `/healthz` atgrieza `302`; autorizētajā pārlūkā vietne atveras ar esošo Access sesiju.
- [x] Access atļaujas politika pārbaudīta: `Allow` tikai īpašnieka e-pastam; `lumiq.cam` maršruts nav mainīts.

### 4. Produkta pilnais foto cikls

- 2026-09-30 atkārtotā kandidāta pārbaudē sākumlapa aiz Access joprojām rāda veco `/demo` saiti, un `/demo` atgriež `Not found`. Wrangler tikai-lasāmā deploy vēsture rāda aktīvo versiju `37314545-a149-416a-837b-ea5efbb8f6b0`, kas izveidota 2026-09-29 19:19 UTC; tā nav sasaistīta ar pašreizējo repozitorija commit. Pašreizējā ignorētā Production konfigurācija norāda `PLATFORM_RELEASE_APPROVED=production`, bet `production:preflight` atsaka deploy, jo prasa `NOT_APPROVED`. Neizvietoju un guard neapgāju; jāsaņem atsevišķs īpašnieka lēmums par tikai Access aizsargātā kandidāta atjaunināšanu. Reģistrācijas forma atveras, bet konta izveide nav iesniegta; tā prasītu noteikumu pieņemšanu un izsūtītu Auth vēstuli.
- [ ] Pēc atsevišķa apstiprinājuma izvietot pašreizējo kandidāta konfigurāciju, kas ietver galveno Queue un DLQ patērētāju; saglabāt `workers.dev` kandidāta hostname un Cloudflare Access, `lumiq.cam` maršrutu neaiztikt. Pēc izvietošanas atkārtoti pārbaudīt sākumlapas saites un DLQ darbību.
- [ ] Kandidātā izveidot marķētu QA pasākumu un QR kodu.
- [ ] Ar telefonu atvērt viesa saiti, ievadīt vārdu, uzņemt foto, augšupielādēt to un pārbaudīt galeriju/sīktēlus.
- [ ] Pārbaudīt organizatora foto dzēšanu, R2 objekta dzēšanu un ZIP lejupielādi.
- [ ] Pārbaudīt tukšu galeriju, lēnu vai pārtrauktu tīklu, neatļautu failu un saprotamus kļūdu paziņojumus.
- [ ] Pēc testa dzēst QA pasākumu un tā foto; pārbaudīt, ka DB ieraksti un R2 objekti tiešām vairs nav pieejami.
- [x] Izolētie lokālie testi aptver sintētisku foto plūsmu; tas vēl nepierāda Production integrāciju.

### 5. Drošība, darbi rindā un darbības gatavība

- [ ] Ar diviem testa organizatoriem pārbaudīt savstarpēju pasākumu un galeriju izolāciju; ar anonīmu klientu pārbaudīt tiešos API un failu URL.
- [ ] Pirms Queue DLQ patērētāja izvietošanas saņemt īpašnieka atsevišķu apstiprinājumu; kandidāts paliek aiz Access, `lumiq.cam` netiek mainīts.
- 2026-09-30 Wrangler tiešā pārbaudē galvenajam `lumiq-production-jobs` patērētājam ir 10 retry un DLQ `lumiq-production-jobs-dlq`; DLQ patērētāju saraksts ir tukšs.
- [x] 2026-09-30 lokālie Queue/Worker/reliability testi izturēja 63/63: sintezēta Queue nosūtīšanas kļūme un atkopšana, dead-letter apstrāde un manuāls retry, Worker starta kļūdas retry un ierobežota job apstrāde. Tas nav dzīvas Production Queue/DLQ pārbaudes pierādījums.
- [ ] Pēc apstiprinātas izvietošanas pārbaudīt kontrolētu retry/DLQ scenāriju bez reālu klientu datu ietekmes.
- [x] 2026-09-30 atkārtoti tikai-lasāmi pārbaudīta jaunākā Production rezerves kopija `production/2026-09-29T15-47-15-316Z`: 21 tabula, migrācijas `001–046`, kontrolsummas sakrīt, 0 foto objektu. Esošo Recovery projektu nepārrakstīt.
- [x] 2026-09-30 atkārtoti palaists Production drošās runtime lomas audits: 19/19 publiskajām tabulām RLS, `anon`/`authenticated` tiešais SELECT = 0; `lumiq_production_runtime` ir `LOGIN`, `NOINHERIT`, `NOBYPASSRLS`, bez administratīvām tiesībām un bez tiešām tabulu/kolonnu/sequence tiesībām, izņemot migrāciju versijas lasīšanu. Atļautas tikai 29 auditētās RPC funkcijas.
- [x] Recovery atjaunošanas pārbaude un migrāciju ķēde izieta.
- [ ] 2026-09-30 Cloudflare Alerts panelī tieši pārbaudīti abi aktīvie Billing Budget Alert noteikumi (`$10` automātiskais un `$50`); abiem `Notification email` lauks ir tukšs. Adresāta pievienošana gaida īpašnieka apstiprinājumu; pēc saglabāšanas jāpārbauda testa paziņojuma saņemšana.
- [ ] Production Worker Observability pārbaudē bija 4 vēsturiski HTTP 503 notikumi (29. septembrī). Atvērtā notikuma trace neuzrādīja span vai startup izņēmuma cēloni; izvietošanas vēsture apstiprināja, ka tas nāca no iepriekšējās versijas `8d865654…`, nevis pašreizējās aktīvās versijas `37314545…` (100% trafika). Tas nav pierādījums, ka 503 cēlonis ir novērsts. Pēc nākamās drošās smoke pārbaudes un ar pieejamiem startup žurnāliem pārbaudīt pašreizējo versiju.
- [x] 2026-09-30 pilnais `npm test` izturēja 171/171 testu; `npm run build` validēja 60 publiskos failus. Būvējums neveica izvietošanu un neaizstāj Production integrācijas pārbaudi.
- [ ] Pārskatīt resursu lietojumu un atkarības. Nekādu R2, Worker, Hyperdrive vai Supabase projektu nedzēst, kamēr nav pierādīts, ka tie nav vajadzīgi un nav atsevišķa īpašnieka apstiprinājuma.

## B. TET atbildes sagaidīšana

- Pieteikums nosūtīts **2026-09-25**; TET solītais termiņš ir līdz piecām darbdienām, neieskaitot nedēļas nogali, aptuveni līdz **2026-10-02**.
- Ja līdz termiņam nav atbildes, **2026-10-05** nosūtīt atkārtotu pieprasījumu ar sākotnējā STOP ekrāna attēlu un skenējumu rezultātiem.
- [ ] Saņemt TET atbildi un skaidru apstiprinājumu par `lumiq.cam` atbloķēšanu. Ja līdz piecu darbdienu termiņam nav atbildes, sekot līdzi 2026-10-05.
- [ ] Pēc apstiprinājuma pārbaudīt `lumiq.cam` no Tet tīkla un vēl viena neatkarīga tīkla; pārliecināties, ka STOP pāradresācija vairs nenotiek. Līdz šai pārbaudei domēna cutover nav atļauts.
- Līdz šim brīdim `lumiq.cam` maršrutu nemainīt un STOP lapā neievadīt konta datus.

## C. Pēdējais darbs pēc TET atbloķēšanas: `lumiq.cam` pieslēgšana Production

- [ ] Pārbaudīt kandidāta gatavību: veselība, īpašnieka vienīgā Access politika, SMTP/Auth saites, foto plūsma un atgriešanas plāns.
- [ ] Supabase Production Auth atļautajos URL pievienot precīzos `https://lumiq.cam` callback/redirect maršrutus, nepievienojot plašus wildcard.
- [ ] Pēc īpašnieka apstiprinājuma pārslēgt `lumiq.cam` Worker maršrutu no Closed Test uz Production, saglabājot Access un īpašnieka ierobežojumu.
- [ ] Uzreiz pārbaudīt pieteikšanos, e-pasta callback, anonīmu bloķēšanu un foto pilno ciklu.
- [ ] Ja pārbaude neizdodas, atjaunot iepriekšējo Worker maršrutu; publisku piekļuvi neatvērt.

## Pabeigšanas kritērijs

Production kandidāts ir lietojams īpašniekam aiz Access, e-pasti pienāk un foto pilnais cikls ir pārbaudīts. Tikai pēc TET atbloķēšanas un īpašnieka apstiprinājuma izpilda pēdējo `lumiq.cam` maršruta maiņu. `app-images` un `event-photo-media` netiek aiztikti.
