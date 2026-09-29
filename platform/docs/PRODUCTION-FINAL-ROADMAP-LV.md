# Lumiq Production pabeigšanas ceļvedis

Mērķis: pabeigt un pārbaudīt Lumiq kā privāti lietojamu produktu, pirms `lumiq.cam` maršruta pārslēgšanas. Kandidāts paliek aiz Cloudflare Access ar atļauju tikai īpašniekam. `app-images` un `event-photo-media` ir neaizskarami. Šis ir jaunais darba saraksts; statusu atzīmē tikai pēc norādītā pierādījuma.

**Pēdējā pārskatīšana:** 2026-09-30. Šis saraksts neaizstāj pienākumu pārbaudīt katru dzīvo plūsmu; lokāli testi nav Production pierādījums.

**Darba princips:** kamēr TET izskata 2026-09-25 pieteikumu, pabeigt visus tālākos darbus kandidātā aiz Cloudflare Access. `lumiq.cam` DNS/Worker maršrutu neaiztikt. Kad pārējais gatavs, gaidīt TET atbloķēšanu; domēna pārslēgšana ir pēdējais solis.

## A. Pabeigt tagad, kamēr TET izskata pieteikumu

### 1. E-pasta sūtīšana

- [x] 2026-09-30 Supabase Production SMTP pārbaudīts pēc pārlādes: custom SMTP ieslēgts, `smtp.resend.com:465`, sūtītājs `Lumiq <noreply@lumiq.cam>`, lietotājvārds `resend`; saglabātā parole ir noslēpta un netika mainīta.
- [ ] Nosūtīt kontrolētu Auth testa vēstuli uz savu testa pastkasti; pārbaudīt piegādi, saites un kļūdu žurnālus. Pirms īstas vēstules nosūtīšanas apstiprināt konkrēto testa sūtījumu.
- [ ] Ar apstiprinātu testa vēstuli pārbaudīt piegādāto MIME: Auth ziņojumiem pārliecināties, ka ir salasāma `text/plain` alternatīva; ja tās nav, izvērtēt Supabase Send Email Hook ar Resend un multipart `text`/`html`, vispirms izveidojot integrācijas testus un atgriešanās plānu. Worker transakciju vēstulēm pārbaudīt abus variantus.
- [ ] Pārbaudīt Auth e-pastus Gmail un vēl vienā pasta klientā: Lumiq dizainu, attēlojumu mobilajā izkārtojumā, LV/EN tekstu, saites un derīguma termiņu.
- [x] Sagatavotas sešas Lumiq tēmas Supabase Auth HTML veidnes: reģistrācija, uzaicinājums, paroles atjaunošana, e-pasta maiņa un drošības paziņojumi.
- [x] Worker transakciju vēstules veidnes atbalsta HTML un teksta variantu; lokālie e-pasta testi izturēti.
- [x] 2026-09-30 atkārtoti palaisti `email-templates.test.mjs`, `auth-callback.test.mjs` un `operations.test.mjs`: 11/11 izturēti. Tie nepārbauda SMTP piegādi no Production.

### 2. Lumiq e-pasta adreses

- [x] Automātiskai sūtīšanai izmanto `noreply@lumiq.cam`; Production Supabase SMTP izmanto `Lumiq <noreply@lumiq.cam>` un Resend. Atsevišķa `noreplay@` adrese nav vajadzīga — pareizā rakstība ir `noreply@`.
- [x] Resend verificējis `send.lumiq.cam` un saknes `lumiq.cam`; saknes konfigurācijai Return-Path ir `outbound`, saglabājot esošo sūtīšanas apakšdomēnu.
- [x] 2026-09-30 salīdzinātas un pēc pārlādes pārbaudītas sešas vajadzīgās Supabase Production Auth veidnes: apstiprinājums, uzaicinājums, paroles atjaunošana, e-pasta maiņa, paroles maiņas un e-pasta maiņas paziņojums. Piecām no tām izņemts Supabase noklusētais HTML fragments, kas iepriekš bija pielīmēts pirms Lumiq dokumenta.
- [ ] Izvēlēties, kur saņemt `support@lumiq.cam` vēstules, un apstiprināt konkrēto galamērķa adresi. Šī ir cilvēka atbalsta adrese; sākumā pietiek ar vienu pastkasti vai aliasu, nevis vairākām atsevišķām pastkastēm.
- [ ] Tikai pēc galamērķa un pasta pakalpojuma izvēles izveidot `support@lumiq.cam` saņemšanu/pāradresāciju un pārbaudīt ienākošo vēstuli. Namecheap panelis prasa Namecheap nameserverus, bet domēna DNS ir Cloudflare; nameserverus nemainīt. Cloudflare Email Routing aktivizēšanai saskaņot esošo MX/SPF migrāciju un tās ietekmi uz esošajām pāradresācijām; ierakstus neaizstāt bez apstiprināta pasta plāna.
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

- 2026-09-30 kandidāta sākumlapa aiz Access joprojām rāda veco `/demo` saiti, un `/demo` atgriež `Not found`. Reģistrācijas forma atveras, bet konta izveide nav iesniegta; tā prasītu noteikumu pieņemšanu un izsūtītu Auth vēstuli. Repozitorija saites labojums ir vēlāk par dzīvo izvietojumu; pirms Production foto cikla jāizvērtē release gate un atsevišķi jāapstiprina tikai Access aizsargāta kandidāta izvietošana.
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
- [ ] Pēc apstiprinātas izvietošanas pārbaudīt kontrolētu retry/DLQ scenāriju bez reālu klientu datu ietekmes.
- [x] Production rezerves kopija pārbaudīta: 21 tabula, migrācijas `001–046`, kontrolsummas sakrīt. Esošo Recovery projektu nepārrakstīt.
- [x] Recovery atjaunošanas pārbaude un migrāciju ķēde izieta.
- [x] Cloudflare `$10` un `$50` budžeta brīdinājumi ir aktīvi; saņēmējs pārbaudīts kā īpašnieka konta adrese.
- [x] Production Worker Observability pēdējā pārbaudē rādīja veiksmīgus notikumus un 0 kļūdu; turpināt uzraudzību pēc izvietošanas.
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
