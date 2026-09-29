# Lumiq pārbaudes un Windows DNS/TLS pamācība

Atjaunināts: 2026-09-26. Šī ir īpašnieka izpildāmo pārbaužu rokasgrāmata.
Izmanto tikai slēgtā testa vidi, sintētiskus notikumus un attēlus, kuru
augšupielādei ir piekrišana. Paroles, tokenus, datubāzes URL un R2 atslēgas
neievieto čatā, ekrānattēlos vai Git.

## Vienošanās par palaišanas secību

- Apmaksātus produkcijas resursus neveido un nepieslēdz, kamēr `lumiq.cam` nav
  pārslēgts un uzņēmums nav reģistrēts. Tas ir atlikts lēmums, nevis atļauja
  izmantot testa DB/R2 publiskai produkcijai.
- `lumiq.cam` jau ir pārslēgts uz slēgtā testa Worker aiz Cloudflare Access;
  tam jāraksta tikai atsevišķajā closed-test DB/R2. Publiska reģistrācija,
  pārdošana un viesu foto pieņemšana nav atļauta. Tas nav production launch.
  Tet Drošība iepriekš rādīja `Malware`. Svaiga pārbaude 2026-09-26 07:44 UTC
  atklāja, ka Wi-Fi izmanto DNS maršrutētāju `192.168.1.254`, kas `lumiq.cam`
  atrisina uz `81.198.92.113`; Cloudflare `1.1.1.1` atgriež
  `104.21.67.110` un `172.67.221.99`. Parastais `curl` joprojām kļūdās ar
  `SEC_E_UNTRUSTED_ROOT`, bet diagnostiska IP piespraušana katram Cloudflare
  IP ar ieslēgtu sertifikāta pārbaudi saņēma Access `302`. Tas norāda uz
  maršrutētāja DNS/upstream atbildes ceļu, bet pats par sevi neapstiprina Tet
  klasifikācijas cēloni. Nemaini DNS, lai apietu Tīkla vairogu; lūdz Tet
  pārbaudīt klasifikāciju un resolvera atbildi. Ja ir STOP lapa vai TLS
  brīdinājums, tajā neievadi PIN vai paroles.
- Pēc uzņēmuma reģistrācijas atgriezies pie `PRODUCTION-COST-PLAN.md`, saņem
  konkrēto ikmēneša izmaksu apstiprinājumu un tikai tad veido izolētos
  production DB/R2/Queue resursus. `lumiq.cam` nedrīkst sūtīt klientus uz
  closed-test vai staging datiem.
- Operatora juridiskā identitāte, privātuma paziņojums, noteikumi, nodokļi,
  dzēšanas/glabāšanas politika un galīgās cenas paliek atliktas līdz uzņēmuma
  reģistrācijai un kvalificētai juridiskai/nodokļu konsultācijai.

## 0. Slēgtā domēna Access pašreizējais stāvoklis

Cutover ir veikts: `lumiq.cam` piesaistīts `lumiq-closed-test` Worker un visu
hostname sargā Cloudflare Access. Allow sarakstā ir tikai īpašnieka e-pasts;
bez konfigurēta ārēja identitātes nodrošinātāja Access izmanto vienreizēju
e-pasta PIN. Anonīmi pieprasījumi uz sakni, `/app`, API, `/healthz`, Auth
atgriešanās ceļiem un sintētisku viesa URL ir saņēmuši Access `302`. Tas
apliecina anonīmās robežas pārbaudi, nevis autentificētu aplikācijas/Auth
plūsmu.

1. Pirms PIN ievades pārliecinies, ka pārlūkā redzams pareizais `lumiq.cam`
   hosts un nav Tet STOP lapas vai sertifikāta brīdinājuma. Ja tāds parādās,
   apstājies un seko sadaļai 6; nelieto allowlist kā apiešanu.
2. Īpašnieks atver
   `https://lumiq.cam/healthz`, autentificējas Access un pārbauda, ka JSON
   rāda `status: ok`, `service: lumiq-closed-test.gkarans-events.workers.dev`,
   `database: ready` un `storage: bound`.
3. Atver `https://lumiq.cam/app`, pārbauda īpašnieka pieteikšanos un
   organizatora paneli. Pārbauda, ka pieteikšanās/sesijas darbības nenonāk uz
   izdzēsto staging Worker un ka Supabase saites atgriežas uz paredzēto
   slēgtā testa adresi.
4. Visa hostname Access politika aiztur arī viesu saites, tāpēc šajā stāvoklī
   publiska viesa QR/augšupielādes plūsma nav testējama. Neveido `Bypass` vai
   publisku Access politiku. Viesa scenārijam vispirms jāizplāno atsevišķs
   izolēts, īslaicīgs testa hostname/piekļuves režīms ar tikai sintētiskiem
   foto un jāpārbauda, ka organizatora/admin API paliek slēgti.
5. Saglabā datumu, Worker versiju un nekonfidenciālos JSON/statusus. Nefiksē
   PIN, sīkdatnes, tokenus vai Access pāradresācijas pilno URL.

Cloudflare ļauj self-hosted Access aplikācijai aizsargāt visu hostname, kā arī
atsevišķus ceļus; šim slēgtajam pilotam jāizvēlas viss hostname:
[Application paths](https://developers.cloudflare.com/cloudflare-one/access-controls/policies/app-paths/),
[self-hosted public app](https://developers.cloudflare.com/cloudflare-one/access-controls/applications/http-apps/self-hosted-public-app/).

## 0.1 Testa DB un R2 veselības pārbaude

Testa DB migrācijas 001–012 ir lietotas slēgtajam testam. Svaigā
`wrangler deployments list` pārbaude 2026-09-25 16:54 UTC rāda
`lumiq-closed-test` versiju
`4fc5b617-5815-4c0e-bb2d-e0492279d683`; `lumiq.cam` pašlaik ir šī Worker
slēgtā alias. Vispirms pārliecinies par pareizo host un parastu TLS,
tikai pēc tam:

Jaunākais read-only `wrangler deployments list --name lumiq-closed-test`
2026-09-26 rāda versiju `8f6c4f83-703d-49e2-821c-8895abdadcb8` ar 100% datplūsmu.
Īpašnieka tā paša datuma ekrānattēls apstiprina, ka autentificētais
`workers.dev/app` atver organizatora paneli un Studio kontu. Tas ir tas pats
closed-test Worker, kam piesaistīts `lumiq.cam`; jaunā Worker versija skar abus
hostus. Ekrānattēls nepārbauda `lumiq.cam` pašreizējo TLS/Tet pieejamību.

1. Atver `https://lumiq.cam/healthz` caur Access.
2. Sagaidi `status: ok`, `database: ready` un `storage: bound`. `service` var
   būt test Worker identifikators. Ja tiek prasīts Access PIN, ievadi to tikai
   tad, ja pārlūkā nav DNS/TLS brīdinājuma.
3. Atver `/app` un pārbaudi īpašnieka dashboard. Šajā pārbaudē neveic nekādas
   slēgtā testa datubāzes/objektu izmaiņas; production resursu vēl nav.

## 1. Autentifikācija testa vidē

Sagatavo atsevišķu testa e-pasta adresi, kurai vari piekļūt. Nemaini vienīgo
īpašnieka konta paroli, ja neesi gatavs pēc tam pieteikties ar jauno paroli.

1. Šobrīd Access atļauj tikai īpašnieka e-pastu. Reģistrācijas testu citam
   kontam neveic, kamēr tā adrese nav īpaši pievienota Access allowlist un
   īpašnieks nav apstiprinājis šo pagaidu piekļuvi. Vispirms pārbaudi esošā
   īpašnieka login/session plūsmu caur `lumiq.cam` pēc DNS/TLS atbloķēšanas.
2. Pārbaudi, ka atgriežas uz paredzēto Lumiq lapu, konts ir verificēts un var
   atvērt organizatora lietotni.
3. Izraksties, piesakies atkārtoti, aizver/atver pārlūku un pārbaudi sesiju.
4. Pieprasi paroles atjaunošanu; atver e-pastu, iestati jaunu paroli abos
   laukos, pārbaudi neatbilstošu paroļu kļūdu, pēc tam piesakies ar jauno.
5. Ja maini e-pastu, pārbaudi apstiprinājumu un vecās/jaunās adreses darbību.
6. Pieraksti datumu, testa adreses aizstājvārdu (ne pilnu adresi, ja to nevajag),
   rezultātu un saites galamērķa ceļu. Ekrānattēlā aizsedz tokenus un query
   parametrus.

Jāizdodas: apstiprinājums, login, logout, parole un sesija darbojas; e-pasta
saite ved uz paredzēto closed-test hostu. Neveiksmīga piegāde vai nepareizs
hosta vārds ir release blocker. Produkcijas Auth URL vēlāk jākonfigurē tikai
atsevišķajā production Supabase projektā.

## 2. Foto piekļuve, atsaukšana un augšupielādes kļūmes

Izmanto divus testa organizatorus un vienu publicētu sintētisku notikumu katram.

1. Viesis A pievieno vārdu un vienu sintētisku foto. Pārbaudi pabeigtu
   augšupielādi, galerijas sīktēlu un R2 atslēgas viesfotogrāfa mapē.
2. Atver foto viesa sesijā; izslēdz kopīgošanu un pārlādē to pašu viesa saiti.
   Pēc atsaukšanas viesim foto jānoraida, organizatoram galerija joprojām
   jāatver.
3. Piesakies kā organizators B un mēģini atvērt A notikumu/foto API ierakstu.
   Atbildei jābūt liegta/neatrasta; nekādi cita organizatora dati nedrīkst
   parādīties.
4. R2 bucket jābūt privātam. Tieša publiska R2 objekta saite nedrīkst atdot
   foto. Neielīmē parakstītas saites vai tokenus pierādījumu ekrānattēlos.
5. Ar atsevišķu testa notikumu pārbaudi pārāk lielu avota failu, neatbalstītu
   vai bojātu attēlu, tīkla pārtraukumu augšupielādes laikā, retry un dublikāta
   pieprasījumu. Veiksmei jāparādās tikai pēc oriģināla un sīktēla saglabāšanas.
6. Pieraksti katras pārbaudes sagaidāmo/saņemto HTTP statusu, galerijas skaitu
   un R2 objektu skaitu. Kļūdainos testa objektus izdzēs caur lietotni un
   pārbaudi, ka fona tīrīšana tos aizvāc.

## 3. Rezerves kopijas atjaunošanas izmēģinājums

Avota closed-test DB ir PostgreSQL 17.6. Šajā datorā PostgreSQL 17.11 klienta
arhīvs no oficiālās EDB binaries lapas ir izvilkts lietotāja profilā:
`%LOCALAPPDATA%\Lumiq\postgresql17\bin`. `pg_dump --version` un
`pg_restore --version` apstiprina 17.11; lokāls PostgreSQL serveris nav
instalēts un PATH nav mainīts sistēmas līmenī. Pirms backup lokālajā
PowerShell procesā pievieno klienta rīku mapi:
`$env:PATH="$env:LOCALAPPDATA\Lumiq\postgresql17\bin;$env:PATH"`
un pārbaudi abas versijas. Docker nav nepieciešams, ja šie rīki ir pieejami.

Šo soli turpini tikai tad, kad backup avota piekļuve ievadāma drošā vietējā
terminālī un ir pieejams **atsevišķs tukšs** Supabase/R2 atjaunošanas mērķis.
Nekad neatjauno esošajā closed-test DB vai bucketā.

1. Šim avotam vajag PostgreSQL 17.x klienta rīkus. Tie jau atrodas
   `%LOCALAPPDATA%\Lumiq\postgresql17\bin`; iepriekšējā sadaļā norādītā PATH
   komanda iestata tos tikai pašreizējai PowerShell sesijai.
2. Izveido Cloudflare R2 API tokenu ar tikai Object Read atļauju, ierobežotu uz
   `lumiq-closed-test-photos`. Sagatavo Supabase Session Pooler URL (ports 5432).
   Nelīmē nekādus URL vai atslēgas čatā, `.env`, komandrindas argumentos vai Git.
3. No repozitorija saknes atver PowerShell un palaid
   `.\platform\scripts\backup-local.ps1`. Tas maskēti paprasīs avota savienojuma
   vērtības, atļaus tikai norādīto testa bucketu, saglabās backup ārpus repozitorija
   `%LOCALAPPDATA%\Lumiq\backups\` un palaidīs `backup:verify`. Beigās tas attīra
   procesa vides mainīgos. Ja komanda neizdodas, nepalaid restore un neizdzēs
   daļējo mapi; ziņo tikai nekonfidenciālo kļūdas tekstu.
4. Verifierim jāpārbauda database dump, publisko tabulu inventārs un katra
   lokālā R2 objekta kontrolsumma. Saglabā sekmīgi verificētās mapes ceļu.
5. Atjaunošanas mērķi jau ir izveidoti un pārbaudīti: Supabase Free projekts
   `Lumiq Restore Drill 2026-09-25`, ref `sprzlvywzpeyuzbsyplz`, Central EU
   (Frankfurt); Cloudflare R2 Standard bucket `lumiq-restore-drill-20260925`,
   EEUR, `0 B`, `Public Access: Disabled`. Avots ir cits projekts
   (`cpweowosocjuccjsyyic`) un cits buckets (`lumiq-closed-test-photos`).
6. Cloudflare izveido R2 API tokenu ar `Object Read & Write` atļauju, kas
   ierobežota tikai uz `lumiq-restore-drill-20260925`. Supabase projekta
   `Connect` logā izvēlies Session Pooler, portu 5432. Neielīmē tokenu vai
   savienojuma URL čatā, `.env`, komandrindas argumentos vai Git.
7. No repozitorija saknes atver PowerShell un palaid
   `.\platform\scripts\restore-local.ps1`. Palaidējs pēc noklusējuma izvēlas
   verificēto backupu `%LOCALAPPDATA%\Lumiq\backups\lumiq-restore-drill-20260925-221255`;
   pirms noslēpumu prasīšanas atkārto backup verifikāciju, prasa precīzu mērķa
   projekta ref un maskēti paprasa target pooler URL, bucketam piesaistītā
   tokena atslēgas un jaunu `lumiq_runtime` paroli (vismaz 32 nejaušas URL-drošas
   rakstzīmes). Palaidējs neļauj norādīt citu DB projektu vai bucketu un beigās
   iztīra procesa noslēpumus. PostgreSQL parole netiek nodota `pg_restore`
   komandrindas argumentos. R2 bucketam un Supabase Auth datiem pirms rakstīšanas
   jābūt tukšiem; daļēju publisko shēmu atjauno tikai pēc precīza apstiprinājuma.
    Ja tiek saņemts `28P01` / `password authentication failed`, skripts ir
    apstājies pirms datubāzes vai R2 objektu atjaunošanas. Mērķa projekta
    `Database > Settings` sadaļā nomaini tikai drill DB paroli, nogaidi dažas
    minūtes un no `Connect > Session pooler` (5432) nokopē jaunu pilnu URL.
    Shared pooler lietotājvārdam jābūt `postgres.sprzlvywzpeyuzbsyplz`;
    rezervētas paroles rakstzīmes URL jāprocentkodē. Atkārto skriptu ar jauno
    URL. Pēc veiksmīga R2 `ListObjects`, R2 piekļuves atslēga nav jāpārveido.
    Ja `pg_restore` apstājas ar `role "lumiq_runtime" does not exist`, iepriekšējais
    mēģinājums jau ir izveidojis publiskās tabulas. Jaunais palaidējs izlaiž avota
    ACL, izveido lomu ar maskēti ievadītu paroli un atjauno piekļuves grants.
    Atkārtojot, apstiprini tikai šī verified dumpa objektu tīrīšanu, ievadot
    `RESET PARTIAL sprzlvywzpeyuzbsyplz`; skripts noraida nezināmas tabulas,
    esošus Auth lietotājus un ne-tukšu R2 bucketu. Importa DDL/dati ir vienā
    transakcijā, tāpēc turpmāka DB importa kļūme tiek atritināta.
8. Veiksmes izvadē jābūt sakrītošam publisko tabulu/rindu inventāram un visu R2
   atslēgu, izmēru, SHA-256 kontrolsummu sakritībai. Pēc tam manuāli izpildi
   migration verifieri, ielādē atjaunoto aplikāciju izolētā kandidātā, pārbaudi
   `/healthz`, login, galeriju un izvelc vismaz vienu atjaunoto ZIP.
9. Fiksē avota/mērķa ID (bez noslēpumiem), koda versiju, objektu/rindu skaitu,
   ZIP manifestu, ilgumu, neatbilstības un veicēju. Tikai tad atzīmē restore
   gate kā izpildītu. Pēc testa iznīcini tikai īpaši šim drill izveidotos
   atjaunošanas resursus.

### 3.1. Restore kandidāta Worker un autentifikācijas smoke tests

Restore kandidāta izolācija un Access vārti ir sagatavoti. Hyperdrive ir
izveidots atsevišķi no closed-test: `lumiq-restore-drill`, ID
`7dce888394a3484bafbbe58d3ac329b4`, runtime lietotājs
`lumiq_runtime.sprzlvywzpeyuzbsyplz`, session pooler 5432, DB `postgres`,
caching disabled. Wrangler saraksts to apstiprināja 2026-09-26. Lokālā Git
ignorētā konfigurācijas kopija ir piesaistīta šim ID, publicējamā atslēga ir
iestatīta un dry-run izdevās. Kandidāts izvietots 2026-09-26 kā
`lumiq-restore-drill-candidate` (`d52a1020-973e-4fec-96e5-1acc84b9edfe`),
izmantojot tikai restore projektu/bucketu; tam nav cron/Queue. Pēc smoke
testiem tas atkārtoti izvietots un aizslēgts versijā
`c27d5132-c08d-49c7-b662-258df2d0edd1` ar `PLATFORM_RELEASE_APPROVED=NOT_APPROVED`.
Anonīms `/app` pieprasījums atgriezās ar Access `302`. Cloudflare Access ir
ieslēgts visai plūsmai ar tikai īpašnieka politiku `guntars.karans@gmail.com`;
pārlūkā Access pieteikšanās izdevās. Pirms release atbloķēšanas lapa rādīja
“Lumiq is not available”; pēc staging atbloķēšanas īpašnieka Chrome
ekrānattēlos apstiprināti Lumiq login/logout, dashboard, foto un ZIP
lejupielāde, paroles atkopšana, kā arī otra organizatora piekļuves atteikums.
Pēc smoke pārbaudes release atkal aizslēgts uz `NOT_APPROVED`.
Vienīgo closed-test Hyperdrive nedrīkst pārveidot vai izmantot šim testam.
Kandidāta veidne ir `cloudflare/worker/wrangler.restore-drill.template.jsonc`.

1. Supabase `sprzlvywzpeyuzbsyplz` projektā izvēlies `Connect > Session pooler`
   (ports 5432), DB `postgres`, runtime lietotāju
   `lumiq_runtime.sprzlvywzpeyuzbsyplz` un restore laikā izveidoto runtime
   paroli. Connection string ņem tieši no Supabase, neizdomā pooler hostu.
2. Pabeigts 2026-09-26: Cloudflare Dashboard izveidots Hyperdrive
   `lumiq-restore-drill`, un tā ID piesaistīts lokālajai konfigurācijai. Poga
   `Connect` konfigurācijas lapā nav jāspiež atkārtotai izveidei. Neizmanto
   Wrangler komandu ar paroli `--connection-string` argumentā, jo tā var
   nonākt shell vēsturē vai procesu sarakstā.
3. Pabeigts: izmantota lokāla konfigurācijas kopija, kas ir Git ignorēta:

   ```powershell
   Copy-Item cloudflare/worker/wrangler.restore-drill.template.jsonc cloudflare/worker/wrangler.restore-drill.local.jsonc
   ```

   Hyperdrive ID un Supabase `sb_publishable_...` atslēga ir iestatīti.
   Nekad nelieto `service_role` atslēgu. Konfigurācija piesaista tikai
   `lumiq-restore-drill-20260925` un `sprzlvywzpeyuzbsyplz`, bez cron/Queue/
   custom routes. Smoke testa laikā release bija īslaicīgi `staging`; pašreiz
   tas ir atgriezts uz `NOT_APPROVED`.
4. Pabeigts: build un dry-run izdevās; Cloudflare izvietojums izmantoja tikai
   izolētā restore Hyperdrive un bucket bindings.

   ```powershell
   npm run build
   npx wrangler deploy --dry-run --config cloudflare/worker/wrangler.restore-drill.local.jsonc
   ```

   Ja dry-run rāda
   nepareizu DB projektu, bucketu, route vai trūkstošu binding, apstājies.
5. Pabeigts 2026-09-26: kandidāts sākotnēji izvietots ar release `NOT_APPROVED` un
   `workers.dev` ir aizsargāts ar Cloudflare Access visai plūsmai. Allow
   politika atļauj tikai `guntars.karans@gmail.com`; privātā pārlūka testā
   parādījās Cloudflare Access e-pasta koda pieteikšanās. Pēc autentifikācijas
   kandidāts rādīja “Lumiq is not available”, jo release vēl bija bloķēts.
   Vēlāk Access saglabāts, kad release īslaicīgi nomainīts uz `staging`.
6. Pabeigts 2026-09-26: īpašnieks izveidoja 32 nejaušu baitu AES atslēgu
   lokāli un Cloudflare kandidāta Worker Secret
   `PLATFORM_SESSION_ENCRYPTION_KEY` redzams kā šifrēts. Vērtība nav repo,
   konfigurācijas `vars` vai čatā. Atslēgu ģenerēšanas PowerShell
   piemērs atslēgu ievieto clipboard, nevis izvada terminālī:

   ```powershell
   $keyBytes = [byte[]]::new(32)
   [Security.Cryptography.RandomNumberGenerator]::Fill($keyBytes)
   Set-Clipboard ([Convert]::ToHexString($keyBytes).ToLowerInvariant())
   Remove-Variable keyBytes
   ```

   Pabeigts: Cloudflare Secret laukā pievienots šifrēts Secret. Neievieto
   atslēgu `vars`, `.env`, Git vai čatā; pēc ielīmēšanas iztīri clipboard ar
   `Set-Clipboard -Value ''`.
   Supabase publishable key nav slepena; runtime parole ir tikai Hyperdrive.
7. Pabeigts 2026-09-26: pēc Secret, Access, Hyperdrive, bucket un Supabase
   projekta ID pārbaudes kandidāts izvietots ar `PLATFORM_RELEASE_APPROVED`
   vērtību `staging`. Šī veidne apzināti nesatur cron/Queue, tādēļ deploy pats
   nedrīkst palaist retention cleanup. Tālāk veic tikai kontrolētus testus ar
   atjaunotiem testa datiem un pēc sesijas atgriez release uz `NOT_APPROVED`.
8. Pabeigts 2026-09-26: tikai restore Supabase projektā `sprzlvywzpeyuzbsyplz`
   iestatīts Auth Site URL uz
   `https://lumiq-restore-drill-candidate.gkarans-events.workers.dev` un
   pievienoti precīzi redirect ceļi `/auth/verify`, `/auth/reset`,
   `/auth/email`, `/api/auth/google/callback`. Pēc lapas pārlādes pārbaudīts,
   ka ir tieši četri URL un nav wildcard. `lumiq.cam` un closed-test Auth
   iestatījumi netika mainīti. Default Supabase e-pasta veidnes paliek;
   pielāgots SMTP un citas e-pasta plūsmas nav pārbaudītas. 2026-09-26
   īpašnieks sekmīgi pārbaudīja login/logout, dashboard, foto oriģināla un
   ZIP lejupielādi, paroles atjaunošanas e-pastu/callback un otra konta
   pasākuma piekļuves atteikumu. Izolētā kandidātā 2026-09-26 arī izpildīta
   paātrināta retention cleanup pārbaude: foto, sīktēls un ZIP tika dzēsti,
   viesu rindas noņemtas, bet pasākuma kopsavilkuma lauki palika. Šī vecā
   Worker versija vēl saglabāja slug, storage prefiksu, pilnu entitlement un
   koplietošanas skaitītājus. Lokālais labojums tos minimizē; lai pierādītu
   gala stāvokli, jāizvieto labojums tikai aiz Access aizsargātajā kandidātā
   un jāatkārto izolēta expiry pārbaude. Pēc iepriekšējā smoke testa kandidāts
   tika aizslēgts uz `NOT_APPROVED`.
9. Smoke testa lock atjaunošana pabeigta 2026-09-26; pirms kandidāta datu dzēšanas atsevišķi pārskati
   pierādījumus un saglabā tos; drill resursus nedzēs, kamēr nav pieņemts
   īpašnieka lēmums.

Cloudflare dokumentācija: [Hyperdrive izveide Dashboard](https://developers.cloudflare.com/hyperdrive/examples/connect-to-postgres/postgres-database-providers/pgedge/), [Supabase Session pooler](https://supabase.com/docs/guides/database/connecting-to-postgres) un [Access aizsardzība Workers URL](https://developers.cloudflare.com/workers/configuration/cloudflare-access/). UI nosaukumi var mainīties; seko aktuālajam Dashboard.

Rīks nedrīkst tikt palaists, ja nevar skaidri pierādīt, ka mērķa DB un bucket ir
tukši un atsevišķi. Ja redzi neskaidru target ID vai secrets kļūdu, apstājies.

## 4. Slodze un drošības pārbaude

Slodzes testu neveic pret `lumiq.cam`, izdzēsto `lumiq-cam` Worker, klientu
e-pastiem vai īstiem foto datiem. Lieto tikai īpaši izolētu, budžetā ierobežotu
testa kandidātu.

1. Vispirms slēgtā testā palaid vienu mazu synthetic testu; tad pa pakāpēm
   palielini paralēlos viesus/augšupielādes, katrā posmā pierakstot kļūmes,
   Worker CPU, DB savienojumus, Queue backlog/ilgumu, R2 operācijas un izmaksas.
2. Maksimālo Studio testu (1000 foto un ZIP) drīkst darīt tikai atsevišķā
   izolētā vidē ar skaidri noteiktu budžetu, Queue/DLQ un atkopšanas scenāriju.
   Pašreiz lokālais 1000-foto tests nepierāda Cloudflare slodzes ietilpību.
3. Pirms ārēja drošības testa vienojies par rakstisku scope, atļautajiem
   hostiem, laika logu, datu/dzēšanas noteikumiem un avārijas kontaktu. Testeriem
   nedod production noslēpumus. Sāc ar Access aizsargātu kandidātu un synthetic
   datiem; kritiskus/augstas prioritātes atradumus labo un atkārtoti testē.
4. Pieraksti testētāju, metodes, atradumus un atkārtotās pārbaudes rezultātu.
   Neatzīmē neatkarīgo drošības gate kā pabeigtu tikai ar automatizētu `npm
   run check`.

## 5. Android un iPhone pārbaude

Izmanto testa eventu un piekrišanai paredzētus testa foto. Pieraksti telefona
modeli, OS, pārlūka versiju, datumu un tīklu.

1. Noskenē QR parastā un vājā apgaismojumā; atver viesa lapu, ievadi vārdu,
   atver aizmugurējo kameru, uzņem 10 foto un pārbaudi katra statusu.
2. Izvēlies 20 foto no galerijas, pagriez telefonu, pārslēdz lietotni, bloķē
   ekrānu un atgriezies. Pārbaudi, vai pabeigtais/nepabeigtais statuss ir
   saprotams un nav dublikātu.
3. Augšupielādes laikā uz 10–20 sekundēm izslēdz Wi-Fi vai ieslēdz Airplane
   mode, tad atjauno tīklu un lietotnē izmēģini retry. Nedrīkst ziņot par
   veiksmīgu augšupielādi, ja oriģināls vai sīktēls nav saglabāts.
4. Pārbaudi iPhone Safari un Android Chrome atsevišķi, arī vienas rokas
   lietojamību, safe-area, tastatūru, scroll un galerijas foto atvēršanu.
5. Saglabā nekonfidenciālus ekrānattēlus un pieraksti kļūdas; nelieto īstus
   viesu foto.

## 6. Tet Drošība DNS/TLS pārbaude

Tet Drošība iepriekš rādīja `Malware` STOP lapu. 2026-09-26 07:44 UTC
Windows Wi-Fi adapterim bija DNS serveris `192.168.1.254`; tiešs vaicājums
šim resolverim atgrieza `81.198.92.113`, savukārt `1.1.1.1` atgrieza
Cloudflare `104.21.67.110` un `172.67.221.99`. Parastais `curl.exe -I`
neizgāja Schannel TLS pārbaudi (`SEC_E_UNTRUSTED_ROOT`). Ar parastu sertifikāta
pārbaudi un tikai diagnostisku `--resolve` katram Cloudflare IP `lumiq.cam`
atgrieza Access `302` ar TLS verify rezultātu `0`; tātad Cloudflare TLS un
Access maršruts no šīs mašīnas darbojas, ja DNS tiek apiets diagnostikas nolūkā.
Nelieto šo paņēmienu ikdienas piekļuvei. Tet oficiāla klasifikācijas atbilde
nav saņemta, un šis rezultāts **nav domēna pilnas drošības apliecinājums**.

Tet apraksta Tīkla vairogu kā DNS līmeņa filtru, kas bloķē draudu sarakstos
esošus resursus un rāda STOP lapu; pašapkalpošanās pārvaldībā ir atļautais
saraksts. Atļautā saraksta izmantošana tikai apiet bloķējumu šim tīklam, tā
nav draudu klasifikācijas pārbaude vai drošības apliecinājums. Skatīt [Tet
Tīkla vairogs](https://www.tet.lv/biznesam/internets/tikla-vairogs).

1. Ja STOP lapa vai TLS brīdinājums atgriežas, tajā neievadi Access PIN,
   paroles vai konta datus. Neizvēlies turpināšanu un nepievieno `lumiq.cam`
   atļautajam sarakstam kā apiešanas risinājumu.
2. Ja brīdinājums joprojām parādās citā ierīcē/tīklā vai vajadzīgs oficiāls
   klasifikācijas apstiprinājums, sazinies ar Tet, izmantojot **Mans Tet**
   atbalstu vai [Tet kontaktu lapu](https://www.tet.lv/par-mums/kontakti).
   Nosūti domēnu `lumiq.cam`, STOP lapas ekrānattēlu, brīdinājuma datumu/laiku,
   draudu kategoriju `Malware` un faktu, ka Wi-Fi DNS maršrutētājs
   `192.168.1.254` atgrieza `81.198.92.113`, bet Cloudflare `1.1.1.1`
   atgrieza `104.21.67.110` un `172.67.221.99`. Lūdz pārbaudīt pašreizējo
   domēna klasifikāciju un router/upstream DNS atbildi, nevis tikai pievienot
   domēnu allowlist. Nesūti autentifikācijas saites,
   PIN, paroles vai signed URL.

   Ziņojuma teksts, ko vari pielāgot:

   > Labdien! Tet Drošība, atverot `https://lumiq.cam`, rāda STOP lapu ar
   > kategoriju “Malware”. Lūdzu pārbaudīt šī domēna klasifikāciju un norādīt,
   > kādi signāli izraisīja bloķēšanu. Agrāk šis domēns reizēm rādīja Lumiq
   > izstrādes/staging vietni; 2026-09-25 tas tika pārslēgts uz slēgtu testa
   > versiju ar Cloudflare Access. Domēns izmanto Cloudflare DNS/HTTPS;
   > Wi-Fi DNS serveris ir maršrutētājs `192.168.1.254`; tiešs vaicājums tam
   > atgrieza `81.198.92.113`, bet Cloudflare `1.1.1.1` atgrieza
   > `104.21.67.110` un `172.67.221.99`. Parastais TLS pieprasījums beidzās
   > ar `SEC_E_UNTRUSTED_ROOT`; diagnostiski piespraužot Cloudflare IP ar
   > ieslēgtu TLS pārbaudi, saņēmu Access `302`. Lūdzu pārbaudīt resolvera
   > atbildi un klasifikāciju. Pievienoju STOP lapas ekrānattēlu un tās
   > parādīšanās datumu/laiku. Lūdzu veikt atkārtotu pārbaudi un informēt,
   > kad klasifikācija ir izlabota vai kādas darbības no domēna īpašnieka
   > vēl nepieciešamas. Paldies!

   Pievieno datumu/laiku un ekrānattēlu. Ja Tet prasa īpašumtiesību
   apliecinājumu, sniedz to tikai Tet oficiālajā atbalsta kanālā. Nekopīgo
   Access PIN, paroles, autentifikācijas URL vai sensitīvus Worker datus.
3. Saglabā Tet atbildi un incidenta/references numuru. Šie lokālie DNS/TLS
   mērījumi nav Tet klasifikācijas atbilde.
4. Atkārto PowerShell pārbaudes parastajā tīklā, ja brīdinājums atgriežas vai
   pirms pirmās Access PIN ievades:

   ```powershell
   Get-DnsClientServerAddress -AddressFamily IPv4
   Resolve-DnsName lumiq.cam -Type A
   Resolve-DnsName lumiq.cam -Type A -Server 192.168.1.254
   Resolve-DnsName lumiq.cam -Type A -Server 1.1.1.1
   ipconfig /flushdns
   Resolve-DnsName lumiq.cam -Type A
   curl.exe -sS -I -o NUL -w "HTTP %{http_code} TLS %{ssl_verify_result}`n" https://lumiq.cam/healthz
   ```

   A ierakstiem jāatbilst Cloudflare zonai, TLS jāpārbauda bez brīdinājuma,
   un HTTP jābūt Access izaicinājumam, nevis publiskai `healthz` atbildei.
   Tikai pēc tam Access PIN ievadi `lumiq.cam` pārlūkā un pabeidz sadaļu 0.
5. Ja parastais DNS ved uz citu adresi nekā Cloudflare (`81.198.92.113` šajā
   pārbaudē; iepriekš arī `195.122.12.177`) vai TLS kļūda parādās, atgriezies
   pie Tet ar rezultātiem un apstājies. Nemaini DNS iestatījumus,
   nerediģē hosts failu, neinstalē sertifikātus, neizmanto `--resolve` ikdienas
   pārlūkošanai un nekad nelieto `curl -k` / `--insecure`.

Microsoft apraksta Windows DNS klienta keša pārbaudi un `ipconfig /flushdns`
[DNS troubleshooting](https://learn.microsoft.com/windows-server/networking/dns/troubleshoot/troubleshoot-dns-client)
un Windows 11 DNS servera maiņu sadaļā
[Essential network settings](https://support.microsoft.com/en-us/windows/experience/connectivity-networking/essential-network-settings-and-tasks-in-windows).

## Rezultāta nodošana

Pēc katras sadaļas atsūti: sadaļas numuru, testa datumu, ierīci/vidi, iznākumu
(`pass`/`fail`), kļūdas tekstu un nekonfidenciālu ekrānattēlu. Nekad nesūti
paroles, pilnus auth URL ar tokeniem, database URL, R2 atslēgas vai QR viesu
sesijas tokenus.
