# Lumiq production migrācijas progress

Pēdējā pārbaude: 2026-09-29, pēc Hyperdrive paroles rotācijas, kandidāta deploy, Access pārbaudes un pilna `npm run check`. Šis ir dzīvs kontrolsaraksts ar lokāliem un
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
| Production Access | KANDIDĀTS AIZ OWNER-ONLY ACCESS | Kandidāta Workers.dev hostam un `lumiq.cam` ir īpašnieka politika. Pēc deploy anonīmi GET uz kandidāta `/` un `/healthz` atgrieza Cloudflare Access `302` uz login; `lumiq.cam` arī atgrieza `302`. Cloudflare Access/PIN paliek obligāts. |
| Production Worker | CALLBACK-ONLY DEPLOYOTS; PRODUKTA RELEASE BLOĶĒTS | 2026-09-29 versija `bde62a26-5c98-4bb6-821f-44491dacdf28` pievieno tikai owner-Access aizsargātu ielūguma callback pārbaudi. Pie `NOT_APPROVED` Worker pieņem tikai `POST /api/auth/consume` ar invite callback; citi Worker/API/health maršruti un scheduled darbi paliek bloķēti. Anonīmie `GET /`, `/api/auth/consume`, `/api/config` un `/healthz` pēc deploy saņēma Cloudflare Access `302`. `lumiq-production-candidate` paliek atsevišķs workers.dev host; custom route nav piesaistīts, `lumiq.cam` nav mainīts. |
| Foto/backup R2, Queue/DLQ | RESURSI LIVE UN KANDIDĀTAM PIEVIENOTI | `wrangler r2 bucket list` rāda atsevišķi `lumiq-production-photos`, `lumiq-production-backups` un `lumiq-production-recovery`. `wrangler queues list` pēc deploy rāda `lumiq-production-jobs` ar 1 producer/1 consumer un atsevišķu `lumiq-production-jobs-dlq` ar 0/0. DLQ bindinga darbība vēl jāpārbauda ar sintētisku job kļūmi pēc release gate atvēršanas aiz Access. |
| Supabase plāns un izmaksas | PRO AKTĪVS; RECOVERY LIMITS €10 / 48 H | Live Billing panelis 2026-09-29: Pro `$25`, 3 projekti, pašreizējās izmaksas `$25`, prognoze `$33.95`, Spend Cap ieslēgts. Panelis saka, ka ārpus iekļautā lietojuma netiks iekasēts papildus, bet projekti var kļūt nepieejami; Compute dokumentācija atsevišķi norāda, ka compute stundas nav segtas ar Spend Cap. Jaunā Micro forma rāda `$10/m`; 48 h ir ap `$0.66` pirms nodokļiem/valūtas komisijas. Esošā `$33.95` prognoze var ietvert citus lietojuma posteņus un pati par sevi negarantē, ka viss papildu tēriņš ir zem €10; monitorēt izmaksas un neieslēgt Recovery ilgāk par 48 h bez jauna apstiprinājuma. Papildu PITR/read replicas/log drains nav ieslēgti. `lumiq.cam-test` pauzēts; Production un Restore Drill ir aktīvi. |
| Recovery mērķis | BACKUP ATJAUNOTS; MIGRĀCIJAS 001–046 PĀRBAUDĪTAS | Supabase projekts `Lumiq Production Recovery`, ID `mokdvgxxxcuqgzimofut`, izveidots Frankfurt Micro. `production/2026-09-29T15-04-26-031Z` backup inventārs (21 DB/Auth tabula, 0 foto objektu) sakrīt ar Recovery datiem. Atkārtota `apply-recovery-migrations` pārbaude 2026-09-29 apstiprināja 46/46 migrācijas bez kontrolsummu neatbilstībām (`appliedNow: []`), 19/19 RLS, anon/authenticated tiešo SELECT = 0 un `lumiq_restore_runtime` bez `BYPASSRLS` vai administratīvām tiesībām. Recovery R2 piekļuve pārbaudīta, mērķa buckets ir tukšs. Atkārtots restore apzināti apstājas pie non-empty aizsardzības; esošie dati netiek dzēsti vai pārrakstīti. Recovery paliek aktīvs. |
| E-pasts, brīdinājumi un izmaksas | RESEND VERIFIED; AUTH SMTP UN INVITE CALLBACK PĀRBAUDĪTI | 2026-09-29 Resend verificēja `send.lumiq.cam` (Ireland `eu-west-1`): DKIM TXT un abus sūtīšanas CNAME ierakstus; publiskie DNS atrisinājumi sakrīt, Namecheap saknes MX/SPF palika neskarti. `LUMIQ_PRODUCTION_EMAIL_KEY` ir saglabāta Windows DPAPI glabātuvē, un `PLATFORM_EMAIL_KEY` kandidāta Worker secret sarakstā apstiprināts bez vērtības atklāšanas. Īpašnieks saglabāja Production Supabase Auth custom SMTP; uzaicinājuma e-pasts `noreply@send.lumiq.cam` tika piegādāts (Gmail to sākumā ielika Spam). Pirmais pieņemšanas mēģinājums atgriezās kandidāta saknē, bet to bloķēja `NOT_APPROVED`; testa Auth lietotājs tika dzēsts. Callback-only Worker versija `bde62a26-5c98-4bb6-821f-44491dacdf28` pārbauda tikai `type=invite`, izveidojot Supabase Auth lietotāja ierakstu bez Lumiq sesijas/profila. Īpašnieka 2026-09-29 ekrānattēls apstiprina “Invitation confirmed” un saglabātu release-lock; šo jauno vienreizējo Auth testa lietotāju vēl izdzēst pēc callback pārbaudes. Cloudflare kontā 2026-09-29 redzami divi aktīvi Billing Budget Alert: `$10` un `$50`; e-pasta adresāti vēl jāapstiprina. `npm run cost` noklusētajā scenārijā (100 abonenti, 275 pasākumi/mēn.) modelē `$69.12` platformas infrastruktūru un `$134.03` kopējas izmaksas; tas nav pašreizējā rēķina novērtējums. Workers Paid, R2 Paid, Images Stream Basic un Zero Trust Free ir aktīvi līdz 12.10.; R2/Workers usage šajā ciklā ir iekļauts bez papildu usage maksas. |
| `lumiq.cam` | ESOŠAIS SLĒGTAIS TESTS; LOKĀLAIS DNS NOVECojis | 2026-09-29 Cloudflare publiskais DNS atgrieza Cloudflare IP `104.21.67.110` un `172.67.221.99`; HTTPS pie abiem ar parastu TLS validāciju atgrieza Access `302`. Šīs darbstacijas Windows DNS atgriež veco Tet IP `81.198.92.113`; pēc DNS cache flush tas nemainījās, un parastais TLS pieprasījums joprojām atgriežas ar `SEC_E_UNTRUSTED_ROOT`. DNS/Access sertifikāta apiešana netika izmantota; lokālais tīkls jāatjaunina vai jāgaida resolvera cache termiņš. Domēna Worker maršrutu nemainīt, kamēr kandidāta pilnie testi nav sekmīgi. |
| Publiska palaišana | BLOĶĒTA | PVN numurs iepriekš atzīts par izdomātu. Vajadzīgi īsti uzņēmuma dati, apstiprinātas cenas/atmaksas/juridiskie teksti un maksājumu konfigurācija, kā arī īpašnieka palaišanas apstiprinājums. |

## Lokālā pārbaude

2026-09-29 pilnais `npm run check` pēc drošās runtime rotācijas papildinājuma izturēja: noslēpumu skenēšana pārbaudīja 251 tracked un neignorētu workspace failu, `npm audit` atrada 0 ievainojamību, visi 163/163 Node testi bija zaļi, build apstiprināja 60 publiskos failus un pārlūka/pieejamības pārbaudes izturēja 320–1440 px izmērus. Pārbaudīta Production drošā loma, Hyperdrive identitāte, kandidāta Access `302`, R2/Queue resursu esamība un Wrangler dry-run 66 assetiem. Pārlūka testos izmantoti sintētiski dati, nevis lietotāja preview dati. Production kandidāts ir deployots, bet pilna attālinātā lietotnes/Auth/SMTP pārbaude vēl nav pabeigta.
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
- Production kandidāta Worker ir izvietots ar `NOT_APPROVED`. `workers.dev` `/` un `/healthz` anonīmi saņem Cloudflare Access login `302`; sesijas atslēga konfigurēta. `lumiq.cam` nav piesaistīts kandidātam.
- Pēc īpašnieka Access pieteikšanās kandidāta mājaslapa rāda release-lock ziņojumu “Lumiq is not available”; tā ir paredzēta `NOT_APPROVED` vārteja, nevis pilna lietotnes verifikācija.
- Drošās Production paroles rotācijas izmēģinājuma `npx` neveiksme izveidoja lokālu npm diagnostikas žurnālu ar iepriekšējo runtime paroli. Tā tika rotēta, un iepriekšējā parole vairs nav derīga. Žurnāla dzēšanu pašreizējā izpildvides politika liedza; īpašniekam manuāli jāizdzēš `%LOCALAPPDATA%\npm-cache\_logs\2026-09-29T16_38_20_622Z-debug-0.log`.
- Lokālais pilnais komplekts izturēja: 163/163 testi, 251 workspace faili secret scan, `npm audit` 0 ievainojamību, build, browser un accessibility pārbaudes. Tas nav pilnas Production Auth/SMTP plūsmas pierādījums.
- Atsevišķi palaists reliability tests: 39/39 izturēja. Sintētiskais 1,000 foto Studio eksports izveidoja 2 ZIP daļas (72,056,284 baiti) ap 3 sekundēs; maksimālā rindā buferētā plūsma bija 400,170 baiti. Tas pārbauda lokālo ZIP cauruļvadu, nevis Production Worker reālo slodzi.
- Production backup pārbaudīts atkārtoti ar `check-production-backup`: jaunākais privātais objekts `production/2026-09-29T15-47-15-316Z`, 21 tabula, 46 migrācijas, 0 foto objektu; lejupielādētais saturs un kontrolsummas derīgas. Jauns objekts netika izveidots.
- Cloudflare Notifications UI apstiprina, ka $10 un $50 Billing Budget Alert abi ir ieslēgti, bet abu e-pasta adresātu lauki ir tukši. Adresātu neievadīju; konkrētās adreses pievienošanai vajadzīgs īpašnieka apstiprinājums.
- `lumiq.cam` sākotnējais HTTPS HEAD izmantoja Windows DNS resolvera vecos A ierakstus un beidzās ar `SEC_E_UNTRUSTED_ROOT`. Tiešs autoritatīvā Cloudflare nameservera DNS vaicājums atgrieza Cloudflare edge IP; HTTPS caur šo IP ar ieslēgtu normālu sertifikāta validāciju atbildēja ar Cloudflare Access `302` login redirect. Sertifikāta pārbaude netika apieta.
- Cloudflare Access lietotņu sarakstā ir atsevišķas lietotnes `lumiq-production-candidate.gkarans-events.workers.dev` un `lumiq.cam`; abām piesaistīta `Lumiq closed test - owner` politika (`Allow` tikai `guntars.karans@gmail.com`). Pēc deploy anonīmi kandidāta `/` un `/healthz` pieprasījumi atgrieza Access `302`. `lumiq.cam` nav piesaistīts kandidātam; pēc kandidāta autentificēto testu pabeigšanas jāpievieno domēns un jāpārbauda HTTPS redirect, saglabājot Access/PIN.

## Nākamie soļi

Izmaksu pārbaude veikta 2026-09-29: Pro organizācijā minimālais jaunais compute
ir `Micro` (projekta forma rāda `$10/m`; aptuveni `$0.66` par 48 h). Spend Cap
negarantē nepārtrauktu darbību bez papildu compute izmaksām.

1. Production backup v4 ir izveidots un attālināti verificēts; pilnvērtīgam jaunā formāta restore drill vajadzīga tukša izolēta mērķa DB. Pašreizējais Recovery projekts ir aizpildīts, un drošības pārbaude liedz to pārrakstīt.
2. Īpašniekam jāpieslēdzas Resend (pārlūka cilne jau atvērta), jāpievieno atsevišķs `send.lumiq.cam` sūtīšanas domēns un jāatsūta tā dashboarda ģenerētie DNS ieraksti. Tos pievienot Cloudflare DNS, nepārveidojot saknes Namecheap MX/SPF, verificēt domēnu, API atslēgu ievadīt tikai DPAPI `save-production-email`, tad pievienot `PLATFORM_EMAIL_KEY`, konfigurēt Production Supabase Auth SMTP un iztestēt reālu reģistrācijas/atjaunošanas e-pastu.
3. Pārbaudīt Cloudflare `$10`/`$50` budžeta brīdinājumu adresātus un testa piegādi; pašlaik formās adresāti ir tukši un adresāta pievienošanai gaidāms īpašnieka apstiprinājums.
4. Kandidātā ar sintētiskiem datiem pārbaudīt reģistrāciju/pieslēgšanos, foto, galeriju, ZIP, dzēšanu/atjaunošanu, Queue/DLQ, slodzes robežas, brīdinājumus un restore. Kandidāta Auth URL ir iestatīts; vēl jāpārbauda reāla e-pasta piegāde.
5. Pēc tehnisko vārtu zaļas gaismas piesaistīt `lumiq.cam`, saglabājot PIN/Access. Publisko piekļuvi neatvērt līdz īpašnieka atsevišķam apstiprinājumam un juridisko/maksājumu jautājumu slēgšanai.

## Drošības robežas

- Closed-test resursi netiek izmantoti Production.
- Paroles/tokeni netiek izvadīti čatā, ierakstīti repozitorijā vai `vars`; izmanto DPAPI un Cloudflare secrets.
- Production Worker paliek `NOT_APPROVED`; custom domain netiek piesaistīts pirms izolētiem testiem.
- Cloudflare Access/PIN paliek ieslēgts; neizveidot publisku atļaušanas politiku.
- Production migrācijas 001–046 ir piemērotas pēc verificēta Recovery restore un auditētas.
- Restore Drill paliek aktīvs pēc īpašnieka lēmuma; nevienu Supabase projektu nepauzēt vai nedzēst bez jauna īpašnieka lēmuma.
- Jaunās Production runtime lomas read-only pārbaude `pwsh -NoProfile -File .\platform\scripts\production-secrets.ps1 run-safe-runtime-check` izturēja 2026-09-29; tā verificē visas 46 migrācijas un 29 RPC allowlist.
- Publisku palaišanu neapstiprina tehniskais deploy; vajadzīgs īpašnieka atsevišķs lēmums.
