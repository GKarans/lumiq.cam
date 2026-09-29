# Lumiq production migrācijas progress

Pēdējā pārbaude: 2026-09-30, pēc Production Queue, Worker Access un e-pasta iestatījumu read-only audita. Šis ir dzīvs kontrolsaraksts ar lokāliem un
attālināti pārbaudītiem faktiem. Gatavs lokāls fails vai tests pats par sevi
nenozīmē, ka izmaiņa ir palaista Production.

## Pašreizējais stāvoklis

| Posms | Stāvoklis | Pierādījums / nākamais solis |
|---|---|---|
| Production Supabase | PRO AKTĪVS | `Lumiq Production`, projekts `baqebydtinysosueksgr`, Frankfurt. Supabase organizācijas Billing panelis 2026-09-29 rāda Pro plānu un ieslēgtu Spend Cap; Usage panelis rāda `$10` ikmēneša compute kredītu. |
| Production runtime | DROŠĀ LOMA IEVIESTA UN TIEŠI PĀRBAUDĪTA | 2026-09-29 `lumiq_production_runtime`: LOGIN/NOINHERIT/NOBYPASSRLS, bez SUPERUSER/CREATEDB/CREATEROLE/REPLICATION. Production audits apstiprina 19/19 RLS tabulas, anon/authenticated tiešais SELECT = 0; runtime tabulu/kolonnu/secību tiesības = 0, izņemot `platform_migrations.version` SELECT; precīza 29 RPC allowlist. Vecais `lumiq_runtime` nav mainīts. |
| Production Hyperdrive | DROŠĀ LOMA PIEVIENOTA | 2026-09-29 Wrangler atjaunināja `287181f11f734b63844bcda5eb7fe90c` uz `lumiq_production_runtime.baqebydtinysosueksgr`, Frankfurt Production pooler `5432/postgres`, caching `disabled`, 60 savienojumi. Jaunā nejaušā parole saglabāta DPAPI. Pēc rotācijas no jauna izturēja drošās lomas audits un attālinātais Production preflight. |
| Production DB migrācijas | 001–046 PIEMĒROTAS UN PĀRBAUDĪTAS | 2026-09-29 `run-safe-runtime-check` tieši Production apstiprināja visu 46 migrāciju žurnālu/kontrolsummas, 19/19 RLS tabulas, anon/authenticated tiešo SELECT = 0, drošās lomas robežas un precīzu RPC allowlist. |
| Production Supabase Auth URL | KANDIDĀTA REDIRECTI SAGLABĀTI | 2026-09-29 Supabase Production `Site URL` nomainīts no `http://localhost:3000` uz `https://lumiq-production-candidate.gkarans-events.workers.dev`. Saglabāti tikai precīzie `/auth/verify`, `/auth/reset`, `/auth/email` un `/api/auth/google/callback` ceļi. `lumiq.cam` ceļus pievienot domēna cutover laikā; closed-test Auth nav mainīts. |
| Restore Drill | MIGRĀCIJAS 001–045 PĀRBAUDĪTAS; PROJEKTS ACTIVE | Atkārtots read-only audits 2026-09-29 apstiprināja 45/45 migrācijas, bez trūkstošām, negaidītām vai checksum neatbilstošām migrācijām. `lumiq_restore_runtime` ir LOGIN/NOINHERIT/NOBYPASSRLS; `SUPERUSER/CREATEDB/CREATEROLE/REPLICATION` ir false, un loma nav dalībniece citās lomās. Vecais `lumiq_runtime` nav mainīts. Īpašnieks lēma projektu nepauzēt; Restore Drill paliek ACTIVE. |
| Production backup | V4 BACKUP AR 046 ĶĒDI VERIFICĒTS | `lumiq-production-backups/production/2026-09-29T15-47-15-316Z`: 21 tabula, pilna 001–046 kontrolsumma, 0 foto objektu. Gan izveides read-back, gan jaunais neatkarīgais tikai-lasāmais `check-production-backup` atkārtoti lejupielādēja un pārbaudīja checksumus; pagaidu lokālās kopijas dzēstas. Cloudflare R2 panelis pēc refresh joprojām rāda `0 B`, tāpēc šo UI metriku neizmantoju kā patiesības avotu, kamēr S3 pārbaude tieši apliecina objektus. Bucket `Public Access` ir `Disabled`. |
| DPAPI glabātuve | RECOVERY UN PRODUCTION PIEKĻUVES SAGLABĀTAS | `%APPDATA%\Lumiq\production-secrets.clixml`. Pārbaudīti tikai atslēgu nosaukumi: Recovery DB/runtime un R2 piekļuve, kā arī Production DB/runtime, foto R2 un backup R2 vērtības ir klāt. Recovery R2 piekļuves pārbaude izdevās. Noslēpumu vērtības netika izvadītas. |
| Production Access | KANDIDĀTS UN `lumiq.cam` AR OWNER-ONLY POLITIKU; SERVISS DEGRADĒTS | 2026-09-29 tieši Cloudflare Access lietotņu sarakstā redzamas atsevišķas lietotnes Production kandidāta hostname un `lumiq.cam` hostname, abām piesaistīta `Lumiq closed test - owner` politika. Politikas detaļās apstiprināts viens Include e-pasts `guntars.karans@gmail.com` un darbība `Allow`. Lietotņu lapa vienlaikus rāda Access degradācijas brīdinājumu, tādēļ iestatījumus atkārtoti pārbaudīt pēc incidenta. Kandidāta anonīmais `302` uz Access login iepriekš pārbaudīts. `lumiq.cam` maršruts joprojām ir Closed Test; PIN/Access paliek obligāts. |
| Production Worker | PILNA LIETOTNE CANDIDATE HOSTĀ; DOMĒNS VĒL NAV PĀRSLĒGTS | Aktīvā versija `37314545-a149-416a-837b-ea5efbb8f6b0` (100%). 2026-09-29 Cloudflare panelī pēdējās 24 h: 38 invocations, 0 errors; pēdējā stundā Observability rāda 10 success, 0 errors. Workers Logs ir ieslēgti, Traces izslēgti. Production release gate ir atvērts tikai aiz owner-only Access; īpašnieka pārlūkā pārbaudīta reģistrācijas forma. Reāla reģistrācija, foto upload/galerija/dzēšana un ZIP vēl nav pārbaudīti. `lumiq.cam` maršruts paliek Closed Test Worker; to nepārslēgt pirms šo plūsmu testiem un rollback pārbaudes. |
| Production R2, Queue/DLQ | EU RESURSI SAGLABĀTI; FOTO BUCKET PIESAISTĪTS | Svaigs `wrangler r2 bucket list` rāda trīs Production EU bucketus: `lumiq-production-photos`, `lumiq-production-backups`, `lumiq-production-recovery`. Worker foto bindingam skaidri iestatīta `jurisdiction: eu`. Trīs tukšie default-jurisdiction dublikāti ir izdzēsti. Foto/backup/recovery objektu skaits iepriekš pārbaudīts attiecīgi 0/18/0. `lumiq-production-jobs` ir 1 producer/1 consumer; DLQ ir atsevišķs un tā kļūmes ceļš vēl jāpārbauda. `app-images` nav aiztikts. |
| Supabase plāns un izmaksas | PRO AKTĪVS; RECOVERY LIMITS €10 / 48 H | Live Billing panelis 2026-09-29: Pro `$25`, 3 projekti, pašreizējās izmaksas `$25`, prognoze `$33.95`, Spend Cap ieslēgts. Panelis saka, ka ārpus iekļautā lietojuma netiks iekasēts papildus, bet projekti var kļūt nepieejami; Compute dokumentācija atsevišķi norāda, ka compute stundas nav segtas ar Spend Cap. Jaunā Micro forma rāda `$10/m`; 48 h ir ap `$0.66` pirms nodokļiem/valūtas komisijas. Esošā `$33.95` prognoze var ietvert citus lietojuma posteņus un pati par sevi negarantē, ka viss papildu tēriņš ir zem €10; monitorēt izmaksas un neieslēgt Recovery ilgāk par 48 h bez jauna apstiprinājuma. Papildu PITR/read replicas/log drains nav ieslēgti. `lumiq.cam-test` pauzēts; Production un Restore Drill ir aktīvi. |
| Recovery mērķis | BACKUP ATJAUNOTS; MIGRĀCIJAS 001–046 PĀRBAUDĪTAS | Supabase projekts `Lumiq Production Recovery`, ID `mokdvgxxxcuqgzimofut`, izveidots Frankfurt Micro. `production/2026-09-29T15-04-26-031Z` backup inventārs (21 DB/Auth tabula, 0 foto objektu) sakrīt ar Recovery datiem. Atkārtota `apply-recovery-migrations` pārbaude 2026-09-29 apstiprināja 46/46 migrācijas bez kontrolsummu neatbilstībām (`appliedNow: []`), 19/19 RLS, anon/authenticated tiešo SELECT = 0 un `lumiq_restore_runtime` bez `BYPASSRLS` vai administratīvām tiesībām. Recovery R2 piekļuve pārbaudīta, mērķa buckets ir tukšs. Atkārtots restore apzināti apstājas pie non-empty aizsardzības; esošie dati netiek dzēsti vai pārrakstīti. Recovery paliek aktīvs. |
| E-pasts un Supabase Auth | SŪTĪTĀJS SAGLABĀTS; ABI RESEND DOMĒNI VERIFIED; PIEGĀDES/INBOX QA GAIDA | Resend rāda `send.lumiq.cam` un `lumiq.cam` kā `Verified`. Saknes domēnam ir pielāgots Return-Path `outbound`; Cloudflare DNS publicē `resend._domainkey`, `outbound` un `routbound`, bet `send` CNAME netika atstāts. Esošie pieci Namecheap MX, Namecheap SPF, Worker un verificētie `send.lumiq.cam` DNS ieraksti nav mainīti. 2026-09-30 Production Supabase SMTP pēc pārlādes rāda custom SMTP ieslēgtu, `smtp.resend.com:465`, `Lumiq <noreply@lumiq.cam>`, lietotājvārdu `resend` un saglabātu noslēptu paroli. Reāla Auth piegāde un klientu pārbaude vēl jāveic. Sešas Lumiq Auth HTML veidnes saglabātas Production; hosted veidņu redaktorā nav atsevišķa `text/plain` lauka, Worker transakciju vēstulēm ir teksta un HTML variants. `support@lumiq.cam` saņēmējs vēl nav apstiprināts, tādēļ ienākošā maršrutēšana un Reply-To nav iestatīti. |
| `lumiq.cam` | CLOSED TEST; TET TĪKLA VAIROGA DNS BLOĶĒJUMS | 2026-09-29 atkārtoti: datora noklusētais DNS atgriež TET STOP IP `81.198.92.113`, un parasts HTTPS pieprasījums nonāk TET STOP lapā. Pieprasījums, piesaistot Cloudflare edge IP un saglabājot TLS pārbaudi, sasniedz esošo Access `302`. Tas norāda uz TET tīkla/DNS filtru, nevis Lumiq Worker kļūdu. Pārbaudīt Tīkla Vairoga atļauto sarakstu Mans Tet vai lūgt TET pārskatīt kļūdainu bloķējumu; neizslēgt Access. Domēna maršruts joprojām ir Closed Test. |
| Publiska palaišana | BLOĶĒTA | PVN numurs iepriekš atzīts par izdomātu. Vajadzīgi īsti uzņēmuma dati, apstiprinātas cenas/atmaksas/juridiskie teksti un maksājumu konfigurācija, kā arī īpašnieka palaišanas apstiprinājums. |

## Resursu tīrīšanas lēmumi

| Resurss | Lēmums | Pamatojums |
|---|---|---|
| R2 `app-images` | AIZLIEGTS AIZTIKT | Īpašnieka skaidrs STOP; `event-photo-media` ir atsevišķs esošs lietojums. Netika lasīts, mainīts, dzēsts vai pārsaistīts. |
| Production R2 (EU) | Paturēt | Photos ir kandidāta aktīvais binding; backups glabā verificēto rezerves kopiju; recovery pieder atjaunošanas plūsmai. Tukšums photos/recovery pats par sevi nav dzēšanas pamats. |
| Hyperdrive (3) | Paturēt pagaidām | `lumiq-production`, `lumiq-closed-test` un `lumiq-restore-drill` katrs pieder atsevišķam pašreizējam Worker/DB mērķim. Closed Test vai Restore Drill savienojumu dzēst tikai pēc attiecīgās vides arhivēšanas lēmuma. |
| Workers (4) | Paturēt pagaidām | Production candidate ir mērķa lietotne; `lumiq-closed-test` vēl apkalpo `lumiq.cam`; `lumiq-restore-drill-candidate` glabā atjaunošanas pierādījumu; `event-photo-media` saistīts ar neaizskaramo `app-images`. |
| Supabase projekti (4) | Paturēt līdz migrācijai/atjaunošanas pierādījumiem | Production ir aktīvais produkts; Recovery ir atjaunotās kopijas pierādījums; Restore Drill satur agrāku testu datus; `Lumiq.cam - test` ir pauzēts un ir pirmais kandidāts turpmākai arhivēšanai pēc īpašnieka apstiprinājuma. Recovery Micro apturēt pēc jauna formāta restore pierādījuma un pirms apmaksātā compute termiņa beigām. |

Droša nākamā secība: (1) pārbaudīt Production Auth un pilnu foto/ZIP dzīves ciklu aiz Access, (2) pārslēgt `lumiq.cam` tikai pēc rollback plāna un īpašnieka lēmuma, (3) pabeigt Recovery/Restore Drill pierādījumu salīdzinājumu, (4) tikai tad izvērtēt pauzētā test projekta, tā Worker/Hyperdrive un neizmantotā bucket dzēšanu. Šajā tīrīšanas darbā nevienu Supabase projektu, Hyperdrive vai Worker nedzēst.

## Lokālā pārbaude

2026-09-29 atkārtoti palaisti Queue/DLQ, jobs reliability, email delivery un
migrāciju testi: 63/63 izturēja. Tie pārbauda rindas sūtīšanas kļūmi un
atkārtotu publicēšanu, stale job atgūšanu, dead-letter marķēšanu un retry,
e-pasta piegādes retry/final failure un R2 cleanup retry tikai lokāli ar
sintētiskiem datiem; tie nav dzīvas Production rindas kļūmes tests.

2026-09-29 pēc EU bucket jurisdikcijas preflight papildinājuma pilnais `npm run check` izturēja: 167/167 Node testi, secret scan (253 faili), `npm audit` (0 ievainojamību), build (60 publiskie faili), pārlūka plūsmas 320–1440 px un axe/keyboard/reduced-motion/200% zoom. Pārlūka pārbaude izmantoja izolētus sintētiskus datus. Tā nepierāda Production Supabase reāla konta izveidi vai foto/ZIP dzīves ciklu.
runtime/Restore Drill skriptiem un fokusētie migrāciju, backup un Production
initializer testi izturēja (15/15). Migrācija 045 nav mainīta, lai saglabātu
jau piemērotās Restore Drill kontrolsummu. Migrācija 046 izolētajā PostgreSQL
testā noņem iepriekš iedotas tabulu,
kolonnu un sekvenču tiesības, noņem to default grants un neļauj jaunām
tabulām/sekvencēm tās automātiski mantot. Verifieris pieļauj tikai
`platform_migrations.version` lasīšanu. Pilnā testa rezultāti norādīti augstāk. Production runtime
verifikatoram ir atsevišķs drošās lomas režīms ar `NOBYPASSRLS`, pilna
migrāciju žurnāla, tabulu/kolonnu/sekvenču grant un 29 iekšējo RPC atļauju
pārbaudi. Production preflight vienību testi (6/6) izturēja; verifieris pēc
`--runtime-role` parametra spēj stingri pārbaudīt gan `lumiq_runtime`, gan
`lumiq_production_runtime`, un bez parametra prasa sākotnējo `lumiq_runtime`.
Šie lokālie testi nepierāda Production izvietojumu vai attālinātas DB
migrācijas. Restore Drill read-only migrāciju audits 2026-09-29 apstiprināja
tieši 001–045 (45/45) ar sakrītošām kontrolsummām; tas apzināti negaida
Production-only migrāciju 046. Audita skripta tvēruma regressijas tests izturēja
kopā ar pārējiem production-backup testiem (9/9).

2026-09-29: atjaunošanas skripts vairs neveido `lumiq_runtime` ar
`BYPASSRLS` un plašām tabulu tiesībām. Tas sagatavo `lumiq_restore_runtime`
ar `NOBYPASSRLS`, bez admin atribūtiem vai lomu dalības, un tikai minimālām
`CONNECT`/shēmas `USAGE` tiesībām; pārbauda arī tiešo `accounts` tabulas
piekļuvi un objekta īpašumtiesības, kā arī atsakās pieskarties esošai
`BYPASSRLS` lomai. Restore safety un Production backup fokusētie testi (21/21)
un viss Node testu komplekts (156/156) izturēja. Pilnais `npm run check`
izturēja: secret scan (185 faili), `npm audit` (0 ievainojamības), build,
responsive/browser un accessibility pārbaudes. Šajā agrākajā kontrolpunktā
remote restore vēl nebija palaists; pašreizējo Recovery stāvokli skatīt tabulā augstāk.

2026-09-29 Production bootstrap: provisioner izveidoja `lumiq_production_runtime`
ar tikai migrāciju versijas lasīšanas tiesībām. Jaunā loma pieslēdzās Production
Session Pooler un tiešais verifieris apstiprināja tās drošības atribūtus un
grantu robežas pie migrācijām 001–013. Vēlāk 014–046 tika piemērotas un auditētas;
Hyperdrive maiņa un Worker deploy joprojām gaida turpmākos vārtus.

Papildu read-only verifikācija 2026-09-29: Production loma ir bez `REPLICATION`,
Restore Drill 45 migrācijas un to kontrolsummas joprojām precīzi sakrīt; drošās
Restore Drill lomas admin/REPLICATION atribūti ir izslēgti.

Production konfigurācijas statiskais preflight apstiprināja izolēto DB/R2/Queue/DLQ
identitāti un `NOT_APPROVED`. Wrangler deploy dry-run iekļāva 66 assetus un tikai
Production bindings; tas neveica deploy. Lokālajā ignorētajā failā publicējamās
atslēgas vērtība ir placeholder un R2 limiti ir `1`, tādēļ to nedrīkst deployot
vai izmantot slodzes testam.

2026-09-29: sagatavots atsevišķs Production-to-Recovery restore runneris un
Recovery režīms migrāciju runnerim. Runneri bloķē zināmos Production,
Restore Drill un closed-test projektu ID un pieprasa jauna Recovery project ref
apstiprinājumu. Recovery runtime un DB paroles ir saglabātas DPAPI; vērtības
nav izvadītas. Pēc tam tika atjaunots verificētais backup un piemērotas migrācijas līdz 046.

Papildu pārbaude 2026-09-29: Recovery fokusētie testi 11/11 un jaunākais pilnais
`npm run check` izturēja ar 157/157 testiem, build, browser journeys un
accessibility pārbaudēm. Backup saraksta izgūšanai izmantots S3 `Delimiter`,
lai atlasītu jaunāko timestamp prefiksu, nelasot katra backup objektu sarakstu.

## Aktuālais kontrolpunkts — 2026-09-29

- Production safe runtime read-only pārbaude izturēja: pareizais projekts `baqebydtinysosueksgr`, loma `lumiq_production_runtime` ir `LOGIN/NOINHERIT/NOBYPASSRLS`, bez `SUPERUSER/CREATEDB/CREATEROLE/REPLICATION`, migrācijas 001–046 sakrīt, RLS ir 19/19, anon/authenticated tiešie SELECT ir 0 un lomas tiešie tabulu/grantu ceļi ir 0.
- Cloudflare Hyperdrive `287181f11f734b63844bcda5eb7fe90c` izmanto `lumiq_production_runtime.baqebydtinysosueksgr`; Frankfurt session pooler, ports 5432, `postgres` DB, kešošana atspējota, limits 60.
- Production safe runtime parole ir rotēta ar DPAPI pagaidu paroli; pilnā `001–046` read-only verifikācija un Hyperdrive identity preflight izturēja. Vecā parole ir nederīga.
- Production kandidāta Worker versija `37314545-a149-416a-837b-ea5efbb8f6b0` ir aktīva 100% aiz Cloudflare Access; anonīmiem pieprasījumiem Access atgriež `302`, īpašnieka pārlūkā ielādējās reģistrācijas forma. Reāla Auth un foto/ZIP datu plūsma vēl nav pārbaudīta.
- Drošās Production paroles rotācijas izmēģinājuma `npx` neveiksme izveidoja lokālu npm diagnostikas žurnālu ar iepriekšējo runtime paroli. Tā tika rotēta, un iepriekšējā parole vairs nav derīga. Žurnāla dzēšanu pašreizējā izpildvides politika liedza; īpašniekam manuāli jāizdzēš `%LOCALAPPDATA%\npm-cache\_logs\2026-09-29T16_38_20_622Z-debug-0.log`.
- Pilnais `npm run check` pēc EU jurisdikcijas testa izturēja: 167/167 testi, secret scan, `npm audit` 0 ievainojamību, build, browser un accessibility pārbaudes.
- Atsevišķi palaists reliability tests: 39/39 izturēja. Sintētiskais 1,000 foto Studio eksports izveidoja 2 ZIP daļas (72,056,284 baiti) ap 3 sekundēs; maksimālā rindā buferētā plūsma bija 400,170 baiti. Tas pārbauda lokālo ZIP cauruļvadu, nevis Production Worker reālo slodzi.
- Production backup atkārtoti pārbaudīts ar `check-production-backup` 2026-09-29: jaunākais privātais objekts `production/2026-09-29T15-47-15-316Z`, 21 tabula, 46 migrācijas, 0 foto objektu; attālināti lejupielādētais saturs un kontrolsummas derīgas, pagaidu lokālā kopija iztīrīta. Jauns objekts netika izveidots.
- Cloudflare Notifications UI apstiprina, ka $10 un $50 Billing Budget Alert abi ir ieslēgti, bet abu e-pasta adresātu lauki ir tukši. Adresātu neievadīju; konkrētās adreses pievienošanai vajadzīgs īpašnieka apstiprinājums.
- `lumiq.cam` noklusētais DNS šajā datorā atgrieza TET STOP IP `81.198.92.113`; atkārtotais HTTPS pieprasījums atgrieza STOP `307`. Diagnostikas HTTPS pieprasījums, piesaistot Cloudflare edge IP, ar normālu TLS validāciju atgrieza esošo Cloudflare Access `302`. Tas lokalizē problēmu TET tīkla/DNS ceļā; sertifikāta pārbaude netika apieta.
- Cloudflare Access lietotņu sarakstā ir atsevišķas lietotnes kandidāta Workers.dev hostam un `lumiq.cam`; abām ir owner-only politika. `lumiq.cam` joprojām ir piesaistīts Closed Test Worker, nevis Production candidate. Pirms pārslēgšanas jāpabeidz autentificētais Production smoke tests un jāizplāno tūlītējs rollback, saglabājot Access/PIN.
- Cloudflare publiskais statusa panelis 2026-09-29 rāda Access `Degraded`, bet Workers, Hyperdrive un R2 `Operational`. Lietotņu lapa kontā tajā pašā pārbaudē neielādēja lietotņu rindas un rādīja degradācijas brīdinājumu; Access lietotnes/politiku pārbaudīt atkārtoti pēc servisa atjaunošanas. [Cloudflare status](https://www.cloudflarestatus.com/services)
- 2026-09-29 autorizētā pārlūka sesijā kandidāta sākumlapa un reģistrācijas forma ielādējās. Neautorizēts `/` un `/healthz` pieprasījums atgrieza Access `302`. Sākumlapas viesa pieredzes saite atvēra `/demo`, kas Production vidē atgrieza `Not found`, jo demo API ir tikai lokālai videi. Mārketinga saites izlabotas uz `/features`, lokalizētas LV un aizsargātas ar regresijas testu; lokālais `/demo` paliek neskarts. Pilnais `npm run check` izturēja (170/170 testi, build, browser un accessibility). Deploy netika veikts: `block-deploy.mjs` aizliedz Production deploy, kamēr palaišanas vārti un īpašnieka apstiprinājums nav izpildīti. Tāpēc šis labojums vēl nav redzams kandidāta Worker.
- 2026-09-29 kandidāta `/status` lapa rādīja lokālās izstrādes tekstu un nepatiesu “Not connected” mākoņservisu rindu. Avota labojums saglabā lokālo statusu tikai lokālajā režīmā; Production norāda, ka reāllaika darbspējas dati vēl nav pieejami. Izmaiņa lokalizēta LV un iekļauta regresijas pārbaudē; pilnais `npm run check` izturēja. Deploy nav veikts, tādēļ publiskā kandidāta lapa līdz atļautai izvietošanai vēl rāda iepriekšējo saturu.

## Nākamie soļi

Izmaksu pārbaude veikta 2026-09-29: Pro organizācijā minimālais jaunais compute
ir `Micro` (projekta forma rāda `$10/m`; aptuveni `$0.66` par 48 h). Spend Cap
negarantē nepārtrauktu darbību bez papildu compute izmaksām.

1. Production backup v4 ir izveidots un attālināti verificēts; pilnvērtīgam jaunā formāta restore drill vajadzīga tukša izolēta mērķa DB. Pašreizējais Recovery projekts ir aizpildīts, un drošības pārbaude liedz to pārrakstīt.
2. Pārbaudīt kontrolētu Supabase Auth vēstuli no `noreply@lumiq.cam`, pēc tam notestēt saites un izskatu Gmail un otrā pasta klientā. Izvēlēties `support@lumiq.cam` saņemšanas galamērķi; piecus Namecheap MX un Namecheap SPF nemainīt, kamēr nav apstiprināts pasta maršrutēšanas plāns. Hosted Auth veidņu redaktoram ir HTML lauks bez atsevišķa plain-text lauka; Worker paziņojumi sūta `text` un `html`.
3. Pārbaudīt Cloudflare `$10`/`$50` budžeta brīdinājumu adresātus un testa piegādi; pašlaik adresāti nav apstiprināti.
4. Kandidātā ar sintētiskiem datiem pārbaudīt reģistrāciju/pieslēgšanos, foto, galeriju, ZIP, dzēšanu/atjaunošanu, Queue/DLQ, slodzes robežas, brīdinājumus un restore. Kandidāta Auth URL ir iestatīts; reāla Production Auth plūsma un foto/ZIP vēl jānotestē.
5. Pirms domēna cutover atkārtoti pārbaudīt, ka Cloudflare Access `lumiq.cam` hostname un owner-only politika ir precīzi konfigurēti; pašreizējā Cloudflare Access UI rādīja servisa degradāciju un neuzrādīja app ierakstus. Pēc TET bloķējuma noņemšanas un tehnisko vārtu izpildes piesaistīt `lumiq.cam`, saglabājot PIN/Access. Publisko piekļuvi neatvērt līdz īpašnieka atsevišķam apstiprinājumam un juridisko/maksājumu jautājumu slēgšanai.

## 2026-09-30 read-only pārbaude

- Production kandidāta versija `37314545-a149-416a-837b-ea5efbb8f6b0` joprojām ir 100%. Bez sesijas Worker atbild ar HTTP 302; Cloudflare Worker panelī nav custom domain vai route. `PLATFORM_RELEASE_APPROVED` ir `production`, un Access politika ir owner-only. `lumiq.cam` maršruts nav mainīts.
- `lumiq-production-jobs` ir viens consumer ar 10 retry un `lumiq-production-jobs-dlq` kā galamērķi. DLQ pašlaik ir `Inactive`, Wrangler neuzrāda consumer, un Cloudflare Metrics rāda backlog 0, 0 ingested, 0 acknowledged un 0 retried pēdējās 24 h. Consumer pievienošana/deploy vēl nav veikta; pirms tās jāiziet tiešās Production izvietošanas apstiprinājums.
- Production Worker `PLATFORM_EMAIL_KEY` noslēpums eksistē, bet Runtime variables panelī nav `PLATFORM_EMAIL_FROM`. `platform/server/mail.mjs` pieprasa abus, tāpēc lietotnes Resend paziņojumi pašlaik nevar tikt nosūtīti. Lokālā veidne un ignorētais Production config sagatavoti ar `Lumiq <noreply@send.lumiq.cam>`; atsevišķam deploy vajadzīgs owner apstiprinājums.
- 2026-09-30 Supabase Production SMTP pēc pārlādes: ieslēgts, `smtp.resend.com:465`, `Lumiq <noreply@lumiq.cam>`, Username `resend`; saglabātā parole paliek noslēpta. Reāla Auth vēstules piegāde vēl jāpārbauda.
- Auth template sarakstā ir Lumiq apstiprināšanas, uzaicinājuma, reset, e-pasta maiņas un drošības paziņojumu veidnes; `Password changed` un `Email address changed` paziņojumi ir ieslēgti. Reālā piegāde Gmail un otrā pasta klientā vēl nav testēta.
- Pēc DLQ un sender konfigurācijas izmaiņām `node --test platform/tests/production-preflight.test.mjs platform/tests/worker-router.test.mjs` izturēja 19/19. Wrangler `--dry-run` kompilēja Production config un 66 assetus, neveicot deploy. Production preflight apstājās pie release gate: lokālais dzīvais config ir `production`, bet statiskais preflight pieprasa `NOT_APPROVED`; šajā skrējienā Hyperdrive remote identity pārbaude netika sasniegta. Release vārtus nedrīkst mainīt klusējot.

## Drošības robežas

- Closed-test resursi netiek izmantoti Production.
- Paroles/tokeni netiek izvadīti čatā, ierakstīti repozitorijā vai `vars`; izmanto DPAPI un Cloudflare secrets.
- Production Worker paliek `NOT_APPROVED`; custom domain netiek piesaistīts pirms izolētiem testiem.
- Cloudflare Access/PIN paliek ieslēgts; neizveidot publisku atļaušanas politiku.
- Production migrācijas 001–046 ir piemērotas pēc verificēta Recovery restore un auditētas.
- Restore Drill paliek aktīvs pēc īpašnieka lēmuma; nevienu Supabase projektu nepauzēt vai nedzēst bez jauna īpašnieka lēmuma.
- Jaunās Production runtime lomas read-only pārbaude `pwsh -NoProfile -File .\platform\scripts\production-secrets.ps1 run-safe-runtime-check` izturēja 2026-09-29; tā verificē visas 46 migrācijas un 29 RPC allowlist.
- Publisku palaišanu neapstiprina tehniskais deploy; vajadzīgs īpašnieka atsevišķs lēmums.

Papildu e-pasta verifikācija 2026-09-30: `node --test platform/tests/email-templates.test.mjs platform/tests/operations.test.mjs` izturēja 9/9. Tika pārbaudīta Supabase Auth HTML veidņu responsivitāte, lokalizācijas atzari un mainīgie, kā arī Worker vēstuļu `text`/`html`, satura escape, Reply-To un retry uzvedība. Tie ir lokāli sintētiski testi, nevis dzīvas Production vēstules piegāde. Supabase oficiālā dokumentācija uzskaita Auth veidnes kā HTML Go-template un nedokumentē atsevišķu plain-text satura lauku: https://supabase.com/docs/guides/auth/auth-email-templates.

Papildu kandidāta Access pārbaude 2026-09-30: bez cookies nosūtīti HTTP GET uz kandidāta `/`, `/login` un `/healthz`; visi trīs atgrieza `302` uz Cloudflare Access login hostu. Atsevišķā jau autorizētā pārlūkā sākumlapa ielādējās, tādēļ šī pārlūka sesija nav anonīmās piekļuves pierādījums. Organizatoru savstarpējās datu izolācijas pārbaude un pilna autentificēta konta plūsma vēl nav veikta.

Production rezerves kopija atkārtoti verificēta 2026-09-30 ar `pwsh -NoProfile -File .\platform\scripts\production-secrets.ps1 check-production-backup`: jaunākais privātais objekts `production/2026-09-29T15-47-15-316Z`, 21 tabula, 46 migrācijas, 0 foto objekti; lokālais checksum verifikators izturēja, un pagaidu lejupielāde tika izdzēsta. Atjaunošana netika palaista.

Cloudflare Access konfigurācijas atkārtotā pārbaude 2026-09-30: publiskais statusa panelis nerāda aktīvus vai nesenus incidentus. Tiešie `/one/access/apps` un `/access/apps` ceļi atgrieza `Page not found`, bet Workers → Access kopsavilkums darbojas. Kandidāta `lumiq-production-candidate.gkarans-events.workers.dev` hostname un Closed Test Worker `lumiq.cam` hostname ir piesaistīti `Lumiq closed test - owner` Allow politikai; katram Worker kopsavilkumā norādīts, ka Worker-specific policy nav iestatīta. Šis kopsavilkums neatklāj pašas Allow politikas Include kritēriju, tādēļ tajā vēl tieši jāapstiprina vienīgā īpašnieka e-pasta adrese. Kandidāta anonīmie 302 rezultāti iepriekšējā rindkopā paliek atsevišķi pierādījumi.

Cloudflare Production Worker Observability 2026-09-30: atvērtajā “Last 1 hour” skatā bija 10 success, 0 errors; pēdējie redzamie notikumi ietver `GET /api/config` un `GET /api/auth/session`. Tas apstiprina tikai paneļa žurnālu metriku šim periodam, nevis reģistrācijas vai foto plūsmas darbspēju.

Izolētais browser suite 2026-09-30 (`npm run browser`) izturēja visus 7 scenārijus un izveidoja ignorētu `platform/test-results/browser-report.json`: `browser.cjs`, `journey.cjs`, `invite-callback-browser.cjs`, `designer.cjs`, `billing-browser.cjs`, `refinement-browser.cjs` un `accessibility.cjs`. Tas izmantoja tikai pagaidu lokālu PostgreSQL un failus. `journey.cjs` pārbaudīja sintētisku reģistrāciju/verifikāciju/pieteikšanos/paroles atiestatīšanu, pasākuma publicēšanu, 20 foto ar vienu transient upload retry, galerijas sīktēlus/priekšskatījumu un mobile izkārtojumu. Tas nepieslēdzās Production DB/R2 un nav Production konta plūsmas vai foto datu pierādījums.

Production backup atkārtota read-only pārbaude 2026-09-30 ar `pwsh -NoProfile -File .\platform\scripts\production-secrets.ps1 check-production-backup` izturēja: jaunākais privātais objekts joprojām ir `production/2026-09-29T15-47-15-316Z`, tajā ir 21 tabula un migrācijas `001–046`, nav foto objektu, un kontrolsummas ir derīgas. Jauns backup netika izveidots un restore netika palaists; pilnais restore tests vēl jāveic tikai tukšā izolētā mērķī.

Cloudflare Access politika atkārtoti pārbaudīta 2026-09-30 tās definīcijā: `Lumiq closed test - owner` darbība ir `Allow`; vienīgais `Include` nosacījums ir `guntars.karans@gmail.com`, un papildu `Require`/`Exclude` nosacījumu nav. Access Applications sarakstā kandidāta hostname un `lumiq.cam` ir atsevišķas Self-hosted lietotnes, abas piesaistītas šai politikai. `lumiq.cam` Worker maršruts nav mainīts; šī pārbaude neapliecina TET atbloķēšanu vai produkta pilno lietotāja plūsmu.

Cloudflare Billing Budget Alerts atkārtoti pārbaudīti 2026-09-30: aktīvs noklusētais `$10` brīdinājums un aktīvs `$50` brīdinājums. Abu rediģēšanas formās `Notification email` lauks ir tukšs. Brīdinājumus un saņēmējus nemainīju; jāpievieno īpašnieka apstiprināts e-pasts un pēc tam atsevišķi jānosūta/saņem testa paziņojums.

Cloudflare Email Routing iestatīšanas vedni apskatīju 2026-09-30, neaktivizējot: tas piedāvā saknes `lumiq.cam` trīs Cloudflare MX ierakstus un SPF TXT. Šie ieraksti konfliktē ar esošajiem pieciem Namecheap `eforward` MX un saknes Namecheap SPF, un vednis brīdina, ka konfliktus var noņemt aktivizēšanas laikā. Tādēļ tas var pārtraukt esošo ienākošo pasta maršrutēšanu; aktivizācija gaida īpašnieka lēmumu par migrāciju un visu vajadzīgo saņēmēju galamērķiem.
