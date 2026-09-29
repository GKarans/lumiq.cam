# Lumiq Production pabeigšanas ceļvedis

Mērķis: pabeigt un pārbaudīt Lumiq kā privāti lietojamu produktu, pirms `lumiq.cam` maršruta pārslēgšanas. Kandidāts paliek aiz Cloudflare Access ar atļauju tikai īpašniekam. `app-images` un `event-photo-media` ir neaizskarami. Šis ir jaunais darba saraksts; statusu atzīmē tikai pēc norādītā pierādījuma.

**Pēdējā pārskatīšana:** 2026-09-30. Šis saraksts neaizstāj pienākumu pārbaudīt katru dzīvo plūsmu; lokāli testi nav Production pierādījums.

## A. Pabeigt tagad, kamēr TET izskata pieteikumu

### 1. E-pasta sūtīšana

- 2026-09-30 Supabase Production SMTP pārbaudē: custom SMTP ir ieslēgts, host `smtp.resend.com`, ports `465`, sūtītāja nosaukums `Lumiq` un saglabāta noslēpta parole. Sūtītāja e-pasta un lietotājvārda lauki ir tukši; paroles vērtība netika skatīta vai mainīta.
- [ ] Supabase Production SMTP papildināt ar lietotājvārdu `resend` un verificēto sūtītāju `Lumiq <noreply@send.lumiq.cam>`, tad saglabāt. Saglabātā parole ir noslēpta; to neaiztikt un neierakstīt repozitorijā vai čatā.
- [ ] Saglabāt SMTP iestatījumus un nosūtīt kontrolētu Auth testa vēstuli uz savu testa pastkasti; pārbaudīt piegādi, saites un kļūdu žurnālus.
- [ ] Pārbaudīt Auth e-pastus Gmail un vēl vienā pasta klientā: mobilais izkārtojums, LV/EN teksts, saites, derīguma termiņš un `text/plain`/HTML atbalsts.
- [x] Sagatavotas sešas Lumiq tēmas Supabase Auth HTML veidnes: reģistrācija, uzaicinājums, paroles atjaunošana, e-pasta maiņa un drošības paziņojumi.
- [x] Worker transakciju vēstules veidnes atbalsta HTML un teksta variantu; lokālie e-pasta testi izturēti.
- [x] 2026-09-30 atkārtoti palaisti `email-templates.test.mjs`, `auth-callback.test.mjs` un `operations.test.mjs`: 11/11 izturēti. Tie nepārbauda SMTP piegādi no Production.

### 2. Lumiq e-pasta adreses

- [ ] Saglabāt minimālo adrešu komplektu: `noreply@send.lumiq.cam` sūtīšanai un `support@lumiq.cam` klientu atbildēm. `noreply@lumiq.cam` nav aktīvs, kamēr saknes domēns nav atsevišķi verificēts Resend.
- [ ] Izvēlēties, kur saņemt `support@lumiq.cam` vēstules, un apstiprināt konkrēto galamērķa adresi.
- [ ] Tikai pēc galamērķa izvēles konfigurēt ienākošo e-pastu un pārbaudīt saņemšanu. Pirms Cloudflare Email Routing aktivizēšanas izvērtēt DNS konfliktu ar pašreizējiem pieciem Namecheap MX un SPF ierakstu; tos neaizstāt bez apstiprināta pasta plāna.
- [ ] Pēc `support@` saņemšanas pārbaudīt Reply-To. Neveidot nevajadzīgas `events@`, `info@` vai citas atsevišķas pastkastes; ja vajag papildu adresi, sākt ar aliasu uz atbalsta pastkasti.
- [ ] Ja vēlāk vajadzīgs sūtīt tieši no `@lumiq.cam`, pievienot un verificēt saknes domēnu Resend, saglabājot esošo pasta DNS konfigurāciju un apvienojot SPF korekti.

### 3. Production konta un piekļuves plūsma

- [ ] Ar skaidri marķētu testa kontu kandidātā pārbaudīt uzaicinājumu vai reģistrāciju, verifikāciju, pieteikšanos, paroles atjaunošanu, izrakstīšanos un sesijas atjaunošanu pēc lapas pārlādes.
- [ ] Pārbaudīt beigušos/kļūdainu Auth saiti un saprotamu kļūdas paziņojumu.
- [ ] Pēc testa izdzēst testa kontu un tā datus vai dokumentēt, kāpēc tas jāpatur.
- [x] Kandidāta anonīmie pamatpieprasījumi ir aizsargāti ar Cloudflare Access.
- [x] Access atļaujas politika pārbaudīta: `Allow` tikai īpašnieka e-pastam; `lumiq.cam` maršruts nav mainīts.

### 4. Produkta pilnais foto cikls

- [ ] Kandidātā izveidot marķētu QA pasākumu un QR kodu.
- [ ] Ar telefonu atvērt viesa saiti, ievadīt vārdu, uzņemt foto, augšupielādēt to un pārbaudīt galeriju/sīktēlus.
- [ ] Pārbaudīt organizatora foto dzēšanu, R2 objekta dzēšanu un ZIP lejupielādi.
- [ ] Pārbaudīt tukšu galeriju, lēnu vai pārtrauktu tīklu, neatļautu failu un saprotamus kļūdu paziņojumus.
- [ ] Pēc testa dzēst QA pasākumu un tā foto; pārbaudīt, ka DB ieraksti un R2 objekti tiešām vairs nav pieejami.
- [x] Izolētie lokālie testi aptver sintētisku foto plūsmu; tas vēl nepierāda Production integrāciju.

### 5. Drošība, darbi rindā un darbības gatavība

- [ ] Ar diviem testa organizatoriem pārbaudīt savstarpēju pasākumu un galeriju izolāciju; ar anonīmu klientu pārbaudīt tiešos API un failu URL.
- [ ] Pirms Queue DLQ patērētāja izvietošanas saņemt īpašnieka atsevišķu apstiprinājumu; kandidāts paliek aiz Access, `lumiq.cam` netiek mainīts.
- [ ] Pēc apstiprinātas izvietošanas pārbaudīt kontrolētu retry/DLQ scenāriju bez reālu klientu datu ietekmes.
- [x] Production rezerves kopija pārbaudīta: 21 tabula, migrācijas `001–046`, kontrolsummas sakrīt. Esošo Recovery projektu nepārrakstīt.
- [x] Recovery atjaunošanas pārbaude un migrāciju ķēde izieta.
- [x] Cloudflare `$10` un `$50` budžeta brīdinājumi ir aktīvi; saņēmējs pārbaudīts kā īpašnieka konta adrese.
- [x] Production Worker Observability pēdējā pārbaudē rādīja veiksmīgus notikumus un 0 kļūdu; turpināt uzraudzību pēc izvietošanas.
- [ ] Pārskatīt resursu lietojumu un atkarības. Nekādu R2, Worker, Hyperdrive vai Supabase projektu nedzēst, kamēr nav pierādīts, ka tie nav vajadzīgi un nav atsevišķa īpašnieka apstiprinājuma.

## B. TET atbildes sagaidīšana

- Pieteikums nosūtīts **2026-09-25**; TET solītais termiņš ir līdz piecām darbdienām, neieskaitot nedēļas nogali, aptuveni līdz **2026-10-02**.
- Ja līdz termiņam nav atbildes, **2026-10-05** nosūtīt atkārtotu pieprasījumu ar sākotnējā STOP ekrāna attēlu un skenējumu rezultātiem.
- [ ] Saņemt TET atbildi un skaidru apstiprinājumu par `lumiq.cam` atbloķēšanu.
- [ ] Pēc apstiprinājuma pārbaudīt `lumiq.cam` no Tet tīkla un vēl viena neatkarīga tīkla; pārliecināties, ka STOP pāradresācija vairs nenotiek.
- Līdz šim brīdim `lumiq.cam` maršrutu nemainīt un STOP lapā neievadīt konta datus.

## C. Pēdējais darbs: `lumiq.cam` pieslēgšana Production

- [ ] Pārbaudīt kandidāta gatavību: veselība, īpašnieka vienīgā Access politika, SMTP/Auth saites, foto plūsma un atgriešanas plāns.
- [ ] Supabase Production Auth atļautajos URL pievienot precīzos `https://lumiq.cam` callback/redirect maršrutus, nepievienojot plašus wildcard.
- [ ] Pēc īpašnieka apstiprinājuma pārslēgt `lumiq.cam` Worker maršrutu no Closed Test uz Production, saglabājot Access un īpašnieka ierobežojumu.
- [ ] Uzreiz pārbaudīt pieteikšanos, e-pasta callback, anonīmu bloķēšanu un foto pilno ciklu.
- [ ] Ja pārbaude neizdodas, atjaunot iepriekšējo Worker maršrutu; publisku piekļuvi neatvērt.

## Pabeigšanas kritērijs

Production kandidāts ir lietojams īpašniekam aiz Access, e-pasti pienāk un foto pilnais cikls ir pārbaudīts. Tikai pēc TET atbloķēšanas un īpašnieka apstiprinājuma izpilda pēdējo `lumiq.cam` maršruta maiņu. `app-images` un `event-photo-media` netiek aiztikti.
