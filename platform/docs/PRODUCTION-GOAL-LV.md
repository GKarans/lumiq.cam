# Lumiq Production goal

**Mērķis:** viena pilnībā strādājoša, tikai fotogrāfijām paredzēta Lumiq Production lietotne adresē `https://lumiq.cam`, aiz Cloudflare Access ar atļauju tikai īpašnieka e-pastam. Gala arhitektūrā nav aktīvas `candidate` lietotnes. Katru pabeigto darbu pārbaudīt, dokumentēt, commit un push uz `GKarans/lumiq.cam`.

**Statuss 2026-09-30:** `[x]` nozīmē, ka norādītais šaurais fakts ir pārbaudīts; tas nenozīmē, ka visa sadaļa ir gatava. `[ ]` nozīmē, ka rezultāts vēl nav pierādīts. `app-images` neaiztikt. `event-photo-media` neaiztikt, kamēr nav atsevišķi noskaidrotas tā atkarības un īpašnieks nav devis jaunu uzdevumu.

## 1. Viena Production arhitektūra

- [x] Ir atsevišķs Supabase Production projekts `baqebydtinysosueksgr`, Production Hyperdrive, ierobežotā `lumiq_production_runtime` loma, EU foto R2 un Production Queue/DLQ. Iepriekšējais `lumiq-production-candidate` bija pārejas avots, ne gala Worker.
- [x] Kanoniskais Worker `lumiq-production` izvietots ar `PLATFORM_MODE=production`, Production DB/Hyperdrive, EU R2, Queue producer un abiem Worker noslēpumiem, ko ielika no DPAPI. Aktīvā 100% versija `c685f77b-68ea-42f0-a2c3-264966f1bdd8` (2026-09-30 RPC drošas diagnostikas izvietojums); `PLATFORM_ORIGIN=https://lumiq.cam`, `workers.dev` un Preview URL ir izslēgti.
- [x] `lumiq.cam` Cloudflare Access lietotnes galamērķis ir tieši `lumiq.cam`, un tās politikā Include noteikums atļauj tikai `guntars.karans@gmail.com` (2026-09-30 panelī pārbaudīts). Lietotnes un politikas nosaukumos vēl ir novecojis “Closed Development/Closed test”; nosaukumus nemainīju. Kanoniskajam Worker ir izslēgts `workers.dev` hostname; anonīmie galveno maršrutu pieprasījumi atgrieza Cloudflare Access `302`.
- [x] Production Queue un DLQ katrai ir tieši viens patērētājs `lumiq-production`; saraksti apstiprināja galvenās rindas DLQ piesaisti, `batch=1`, `retries=10`, `concurrency=1`.
- [ ] Pēc pilnā Production QA izņemt veco `lumiq-production-candidate` Worker un tā tikai-pārejas Access lietotni. Cloudflare Access panelī 2026-09-30 vēl uzrādīja `Lumiq Production Candidate` (`lumiq-production-candidate.gkarans-events.workers.dev`) un restore-drill/Closed-Test Access lietotnes; candidate anonīmais URL atgrieza Access `302`. Saglabāt zināmu labu Production versiju un atgriešanās iespēju; neko noņemt pirms atkarību, datu un QA pārbaudes.
- [ ] Inventarizēt visus Cloudflare Worker, Hyperdrive un R2 resursus, Supabase projektus, Access lietotnes, DNS ierakstus un API tokenus. Katram fiksēt īpašnieku, atkarības, izmaksas un lēmumu `paturēt / izņemt`. Izņemt lieko tikai pēc atkarību, datu un backup pārbaudes; Recovery resursus nepārrakstīt.

## 2. Domēns un piekļuve

- [x] Cloudflare ir `lumiq.cam` DNS zona ar Cloudflare nameserveriem; MX ieraksti e-pasta saņemšanai publiski atbild.
- [x] `lumiq.cam` Cloudflare Custom Domain ir piesaistīts `lumiq-production`; Cloudflare un Google publiskais DNS atgrieza saknes A ierakstus uz Cloudflare.
- [x] Pēc maršruta piesaistes TLS pieprasījums uz `lumiq.cam/healthz` atgrieza anonīmu Access `302`; saknes Access politika atļauj tikai īpašnieka e-pastu.
- [x] 2026-09-30 pašreizējā stacija un publiskie `1.1.1.1`/`8.8.8.8` resolvers `lumiq.cam` atrisina uz Cloudflare A/AAAA. Anonīmie pieprasījumi uz `/`, `/api/auth/session`, `/event/not-a-real-event`, `/assets/app.js` un `/healthz` visi atgrieza `302` uz Access. Tas pierāda piekļuves bloķēšanu šajos maršrutos, nevis autorizēta Production sesijas funkcionalitāti vai pārbaudi no otra neatkarīga interneta pieslēguma. Agrākais lietotāja `DNS_PROBE_FINISHED_NXDOMAIN` un TET mājas tīkla diagnostika paliek atvērta.
- [x] 2026-10-01 dokumentēta Production-only atgriešanās/ierobežošanas procedūra [CLOUDFLARE-CUTOVER.md](CLOUDFLARE-CUTOVER.md): fiksēt `lumiq-production` izvietojuma ID, pārbaudīt Production DB/EU R2/Queue piesaistes, paturēt Access, un lietot Wrangler rollback tikai uz pārbaudītu tā paša Production Worker versiju. Pašreizējais `c685f77b-68ea-42f0-a2c3-264966f1bdd8` fiksēts kā baseline, nevis QA apstiprināts rollback mērķis, jo Auth defekts vēl ir atvērts. CLI sintakse pārbaudīta; dzīvs rollback nav veikts.
- [x] 2026-09-30 Cloudflare aktivizēts `www.lumiq.cam` → `https://lumiq.cam` Single Redirect (ID `2f82b8af13e3409dbfd5ccde91d96461`), `301`, wildcard ceļš `${1}` un Preserve query string. Live tests `https://www.lumiq.cam/healthz?redirect_probe=1` atgrieza `301` uz `https://lumiq.cam/healthz?redirect_probe=1`; sekojot vienu novirzījumu, saņemts Access `302`. Tādējādi `www` nepiekļūst Worker/origin tieši un aizsardzība paliek uz kanoniskā hosta.
- [ ] TET mājas Wi-Fi bloķējumu risināt paralēli ar TET pieteikumu. Tas nav priekšnoteikums Production darba turpināšanai, ja citi tīkli un autoritatīvais DNS ir pārbaudīti; neapiet brīdinājumu ar nedrošu sertifikāta vai pāradresācijas izņēmumu.

## 3. Datubāze, Auth un noslēpumi

- [x] Jaunākās privātās Production rezerves kopijas pārbaude 2026-09-30 uzrādīja 21 tabulu, migrācijas `001–046`, derīgas kontrolsummas un tobrīd 0 foto objektu. Tas nepierāda pilnu restore.
- [x] 2026-09-30 read-only Production runtime pārbaude: Supabase projekts `baqebydtinysosueksgr`, DB `postgres`, loma `lumiq_production_runtime` ar `LOGIN`, `NOINHERIT`, `NOBYPASSRLS`, bez superuser/DB/role/replication privilēģijām; migrācijas `001–046`; 19 publiskās tabulas visas ar RLS; `anon` un `authenticated` bez tiešas SELECT; runtime bez tiešas tabulu/kolonnu/sequence piekļuves, ar migration-ledger versijas nolasīšanu un tikai pārbaudīto `SECURITY DEFINER` RPC allowlist. Šī pārbaude apstiprina DB lomas un grants, nevis Auth URL vai dzīvu klienta plūsmu. Nekādas DB izmaiņas netika veiktas.
- [x] 2026-09-30 pēc īpašnieka apstiprinājuma Supabase Production Auth `Site URL` iestatīts uz `https://lumiq.cam`; atļauto redirect URL sarakstā ir tikai precīzi `https://lumiq.cam/auth/verify`, `/auth/reset`, `/auth/email`, `/api/auth/google/callback` (pilnie URL panelī pārbaudīti), bez wildcard un bez kandidāta hosta. Šis ir konfigurācijas pierādījums, nevis e-pastu saņemšanas/klikšķa gala pārbaude.
- [ ] Pēc Auth URL maiņas ar īstām Production vēstulēm pārbaudīt reģistrācijas, uzaicinājuma, paroles atiestatīšanas, e-pasta maiņas un Google login (ja ieslēgts) callback; validēt, ka katra saite nonāk `lumiq.cam`, un pārbaudīt sesiju/izrakstīšanos. Neuzskatīt vecās kandidāta saites par derīgām; nelietot wildcard redirect.
- [x] 2026-09-30 jaunās Production reset vēstules paroles forma ielādējās, bet `POST /api/auth/consume` atgrieza `403` un UI “The account could not be synchronized”. Kods vispirms verificē recovery TokenHash un atjaunina Auth paroli, tikai pēc tam izsauc `sync_own_account`; tādēļ kļūda nav pierādījums, ka paroles maiņa izgāzās.
- [x] 2026-09-30 Production Worker izvietota droša PostgREST RPC kļūdu diagnostika. Tā žurnalē tikai RPC nosaukumu, HTTP statusu, standartizētu kļūdas kodu un pieprasījuma ID; neatspoguļo e-pastu, paroli, JWT, RPC atbildes tekstu vai lietotāja datus. Versija `c685f77b-68ea-42f0-a2c3-264966f1bdd8`; anonīmais `lumiq.cam/healthz` joprojām atgriež Access `302`.
- [x] 2026-09-30 drošā read-only Production pārbaudē atrasts konkrēts konta sinhronizācijas cēlonis: `lumiq_api_owner` (atsevišķā, ne-login SECURITY DEFINER funkcijas īpašnieka loma) trūkst `USAGE` uz `auth` shēmas; vajadzīgās `auth.users` kolonnu un `auth.uid()` tiesības citādi ir vietā. Jaunā tikai uz šo lomu vērstā migrācija `047-sync-account-auth-schema-usage` un preflight pārbaudes pievienotas repozitorijam; testi vēlāk tajā pašā dienā izturēja. Production datubāze nav mainīta.
- [ ] Pabeigt migrāciju 047 pēc Supabase atbalstīta risinājuma. 2026-10-01 īpašnieks apstiprināja tikai `USAGE ON SCHEMA auth` sešām iepriekšējās migrācijās Auth/JWT lietojošām funkciju īpašnieku lomām: `lumiq_api_owner`, `lumiq_admin_owner`, `lumiq_billing_owner`, `lumiq_support_owner`, `lumiq_session_owner`, `lumiq_preview_owner`. Lokālā 047 migrācija un Production/Recovery verifikatori ir salāgoti pārbaudīt visas sešas lomas; lokālais tests pārbauda, ka piecas pārējās `*_owner` lomas paliek bez šīs atļaujas. Production izpildītājam `postgres` iepriekš nebija `USAGE WITH GRANT OPTION` un tas nevar `SET ROLE supabase_admin`; iepriekšējais mēģinājums atcelts atomiski, Production ledger `001–046`, 047 nav piemērota. Sākotnējais Support ticket `SU-490493` sedza tikai API lomu. Pēc īpašnieka apstiprinājuma 2026-10-01 iesniegts jauns Supabase Support pieprasījums projektam `baqebydtinysosueksgr`, atsaucoties uz `SU-490493` un lūdzot tikai šīs sešas shēmas `USAGE` tiesības vai atbalstītu izpildes metodi. Pirms submit Support piekļuve Production projektam pārbaudīta kā izslēgta. Supabase apstiprinājuma ekrāns apliecina nosūtīšanu, bet jauns ticket ID/kvīts vēl nav redzams. Nepārņemt Supabase pārvaldītās shēmas īpašumtiesības. Pēc Supabase atbalstītas pieejas izpildīt migrāciju un read-only pārbaudi.
- [ ] Atkārtoti pārbaudīt login ar paša lietotāja nomainīto paroli un paroles maiņas plūsmu. Paroli vai reset tokenu neprasīt.
- [x] 2026-09-30 pēc īpašnieka apstiprinājuma Supabase Production jaunināts no PostgreSQL `17.6.1.166` uz `17.11.0.002`; Dashboard apstiprina arī PostgREST `14.18` (LATEST). Migrācijas posmi pabeigti un Supabase rādīja projektu tiešsaistē; turpinās pēcapstrādes pilnais backup. Paroles atiestatīšanas/login plūsma pēc šī jauninājuma vēl jāpārtestē.
- [ ] Pārbaudīt sesijas atjaunošanu, izrakstīšanos, CSRF, rate limitus, paroles politiku un to, ka kļūdas neizpauž tokenus vai paroles. Noslēpumi paliek Cloudflare/Supabase secret glabātuvēs un vietējā DPAPI, nevis Git.

## 4. E-pasta servisi un dizains

- [x] Resend sūtīšanas domēni `lumiq.cam` un `send.lumiq.cam` bija verificēti; Production Supabase SMTP bija ieslēgts ar `Lumiq <noreply@lumiq.cam>`. Publicēti Resend DKIM, Return-Path, Cloudflare MX/SPF un DMARC monitoringa ieraksti.
- [x] `support@lumiq.cam` Cloudflare Email Routing noteikums pārsūtīja ārēju testa vēstuli uz `guntars.karans@gmail.com`, un Gmail `Lumiq` iezīme to parādīja. `noreply@` ir sūtītāja adrese; tai nav vajadzīga atsevišķa saņemšanas pastkaste.
- [x] Lumiq tēmas Auth HTML veidnes un Worker HTML/teksta veidnes ir sagatavotas; lokālie testi ir izturēti. Tas nepierāda visu reālo vēstuļu piegādi.
- [ ] Pārbaudīt reālu Production sūtījumu no `noreply@lumiq.cam`: reģistrācija, ielūgums, paroles atiestatīšana, e-pasta maiņa, paroles maiņas paziņojums un būtiskie produkta paziņojumi. Salīdzināt Supabase Auth, Resend un saņēmēja žurnālus.
- [x] 2026-09-30 reset e-pasta šaurā pārbaude: Supabase Production nosūtīja paroles atjaunošanas vēstuli iepriekš izraudzītajam QA kontam; Supabase panelis apstiprināja “Password recovery sent” un 60 minūšu derīgumu, Resend `Emails → Sending` jaunāko attiecīgo vēstuli uzrādīja kā `Delivered`. Tas nepierāda, ka ziņa redzama lietotāja pastkastē vai ka callback/paroles maiņa/login ir veiksmīgi; Auth lietotāja žurnāls tajā brīdī rādīja “No authentication logs available”. Vēstules saturs/token netika atvērts.
- [x] 2026-09-30 pēc īpašnieka ziņojuma par atkārtotiem blokiem Production `Reset password` Auth veidne aizvietota ar statisku bilingvālu HTML: viens virsraksts, viens satura bloks, viena reset poga/saite (`{{ .SiteURL }}/auth/reset?token={{ .TokenHash }}`), bez locale `if/else` vadības blokiem. Supabase paziņoja “Successfully updated email template”; pēc pārlādes Preview kokā ir tieši viens virsraksts un viena saite. Lokālais tests pārbauda viena HTML dokumenta, viena virsraksta un vienas reset saites esamību. Jauna vēstule nav nosūtīta, tāpēc saņemtā e-pasta gala izskats joprojām jāpārbauda.
- [ ] Saņemtās vēstules pārbaudīt Gmail un `inbox.lv` vai citā neatkarīgā klientā: mobilais izkārtojums, LV/EN teksts, derīgas pogu saites, piegāde, `Reply-To: support@lumiq.cam` un salasāma teksta alternatīva. Ja Supabase SMTP nesūta vajadzīgo teksta daļu, pārbaudīt Send Email Hook izolēti pirms maiņas.
- [ ] Pārbaudīt atbildi klientam **no** `support@lumiq.cam` (ne tikai ienākošo pāradresāciju), izmantojot atbilstoši autorizētu sūtīšanas konfigurāciju; pārbaudīt SPF/DKIM/DMARC un atbildes nonākšanu pie saņēmēja.

## 5. Konta pilnais cikls Production vidē

- [ ] Ar skaidri marķētu QA kontu pārbaudīt reģistrāciju vai ielūgumu, saņemto apstiprinājuma saiti, login, pārlādes laikā saglabātu sesiju un logout. Pierakstīt Supabase lietotāja ID un rezultātu bez tokenu saglabāšanas.
- [ ] Pārbaudīt `Forgot password` no `lumiq.cam`: saņemta jauna saite, divu paroļu ievade, sekmīga maiņa, login ar jauno paroli un vecās saites noraidījums. Iepriekšējā vispārīgā Auth kļūda vēl nav atrisināta ar dzīvu atkārtotu testu.
- [ ] Pārbaudīt nepareizu paroli, nederīgu/izmantotu saiti, neeksistējošu e-pastu, vairākkārtēju pieprasījumu un saprotamus paziņojumus. Pārbaudīt arī Google login tikai tad, ja tas ir produkta ieslēgta funkcija.
- [ ] Izveidot otru atsevišķu QA organizatoru izolācijas pārbaudei; pēc testiem droši sakopt QA kontus un datus, saglabājot pārbaudes pierādījumus.

## 6. Pasākumi, QR un foto

- [ ] Pirmais organizators izveido, rediģē, publicē, aptur un beidz QA pasākumu; pārbauda dashboard, statusu, unikālo `lumiq.cam` saiti un lejuplādējamu/drukājamu QR.
- [ ] Viesis telefonā noskenē QR, ievada vārdu, atver kameru, uzņem foto un augšupielādē to bez konta. Lietotnē nav video augšupielādes vai video apstrādes.
- [ ] Pārbaudīt faila tipu/izmēra limitus, upload progresu, atkārtojumu pēc tīkla kļūdas un dubultas iesniegšanas aizsardzību. Apstiprināt, ka Production EU R2 ir gan oriģināls, gan sīktēls, DB metadati un galerijas priekšskatījums.
- [ ] Pārbaudīt galerijas atjaunošanos, foto lejupielādi, slēgta pasākuma uzvedību, koplietošanas atcelšanu un tukšas galerijas stāvokli.
- [ ] Organizators dzēš foto; pārbaudīt piekļuves atteikumu un vēlāk faktisku abu R2 objektu izņemšanu. Pārbaudīt pasākuma pilno ZIP, manifestu, ZIP daļas un atgriešanos pēc kļūmes.
- [ ] Pārbaudīt uz Android Chrome un iPhone Safari, tostarp lēnu internetu, kameras atcelšanu, lielu foto, HEIC/HEIF un saprotamus kļūdu paziņojumus. Lietot tikai piekritušus vai sintētiskus testa attēlus.

## 7. Drošība un izolācija

- [ ] Ar diviem QA organizatoriem tieši pārbaudīt, ka viens neredz otra pasākumus, galeriju, foto URL, QR dizainus vai ZIP. Pārbaudīt anonīmu API pieprasījumu noraidīšanu un viesa tiesības tikai sava pasākuma ietvaros.
- [ ] Pārbaudīt Cloudflare Access owner-only politiku uz `lumiq.cam`, `www` (ja izmanto) un Production `workers.dev`; bez Access sesijas nedrīkst atvērt UI, API vai `/healthz`.
- [ ] Pārbaudīt RLS, failu piekļuves noteikumus, HTML/SQL ievades robežas, noslēpumu skeneri, atkarību auditu un production logu datu minimizāciju. Atvērtas augstas smaguma kļūdas bloķē gatavības atzīmi.

## 8. Rindas, eksports un datu atjaunošana

- [x] Izolētā Cloudflare Queue vingrinājumā sintētiska ziņa tika atkārtota trīs reizes un apstiprināta DLQ; pagaidu resursi izņemti. Tas nepierāda Production darbu patērētāja kļūmju uzvedību.
- [ ] Pārbaudīt Production galvenās Queue un DLQ binding, patērētāju, backlog, retry, kļūdu paziņošanu un drošu operatora atkārtojumu bez klienta datu zuduma. Neievietot destruktīvu kļūmju testu īstā klienta darbā.
- [ ] Ieviest/pārbaudīt regulāru Production DB/Auth un R2 foto rezerves kopiju, glabāšanas termiņu, šifrēšanu, piekļuvi, automātisku brīdinājumu un kontrolsummas.
- [ ] Pilnu restore veikt tikai **jaunā tukšā izolētā** mērķī; nepārrakstīt esošo Recovery projektu. Salīdzināt DB/Auth rindu skaitu, foto/ZIP objektu skaitu un hash, migrācijas, RLS un izmērīto atjaunošanas laiku.

## 9. Maksājumi, izmaksas un žurnāli

- [ ] Pārbaudīt `lumiq.cam` Production privātuma, lietošanas noteikumu, atmaksas un kontaktu lapas, uzņēmuma/operatora datus un `support@lumiq.cam` saziņas ceļu. Pirms reālas klientu vai maksas piekļuves apstiprināt galīgo juridisko tekstu.
- [ ] Ja Production piedāvā maksas plānus, pārbaudīt Stripe testa checkout, webhook parakstu, aizkavētu/atkārtotu notikumu, atcelšanu un tiesību piešķiršanu. Reālu maksājumu pieņemšanu ieslēgt tikai ar apstiprinātiem juridiskajiem/cenu/atmaksas noteikumiem un īpašnieka atļauju.
- [ ] Pārbaudīt Cloudflare, Supabase, Resend un R2 izmaksu paneļus, brīdinājumu galamērķi, kļūdu žurnālus un veselības signālus. Saglabāt iepriekš noteikto papildu tēriņu robežu **€10** bez jauna īpašnieka apstiprinājuma.
- [ ] Pārbaudīt, ka ražošanas brīdinājumi sasniedz īpašnieku un kļūdas var sasaistīt ar pieprasījumu, neatklājot paroles, tokenus vai pilnus foto.

## 10. Pabeigšana un tīrīšana

- [x] Šim repo pēdējais koda labojums ir commit/push `0c334eb` uz `GKarans/lumiq.cam`; 183/183 lokālie testi, 60 publisko failu build un izolētā pārlūka pārbaude izturēja. Tie neaizstāj dzīvu Production QA.
- [ ] Pēc katras nākamās izmaiņas veikt atbilstošu testu, dokumentēt pierādījumu, izveidot loģisku commit un push **tikai** uz `GKarans/lumiq.cam`.
- [ ] Kad `lumiq-production` un `lumiq.cam` ir pārbaudīti, izņemt novecojušos Closed Test/restore drill/candidate resursus tikai pēc atkarību, datu, backup un izmaksu pārbaudes. Saglabāt nepieciešamo Production backup un Recovery infrastruktūru; `app-images` un nesaistīto `event-photo-media` neaiztikt.
- [ ] Ar svaigu pārlūka sesiju un telefonu izpildīt pilnu ķēdi: Access -> register/invite -> login -> event -> QR -> guest photo -> R2 -> thumbnail/gallery -> delete -> ZIP -> logout -> reset password. Atkārtot otram organizatoram un pārbaudīt izolāciju.
- [ ] Gala stāvoklis: `lumiq.cam` publiski atrisinās un atver **tikai** owner-only Access; pēc autorizācijas darbojas visas iepriekšējās plūsmas, e-pasti un foto. Nav aktīvas candidate lietotnes vai testu datu piesaistes Production maršrutam. Atklātāki lietotāju piekļuves noteikumi ir atsevišķs nākotnes lēmums.
