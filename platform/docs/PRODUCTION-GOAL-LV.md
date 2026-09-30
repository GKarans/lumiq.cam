# Lumiq Production goal

**Mērķis:** viena pilnībā strādājoša, tikai fotogrāfijām paredzēta Lumiq Production lietotne adresē `https://lumiq.cam`, aiz Cloudflare Access ar atļauju tikai īpašnieka e-pastam. Gala arhitektūrā nav aktīvas `candidate` lietotnes. Katru pabeigto darbu pārbaudīt, dokumentēt, commit un push uz `GKarans/lumiq.cam`.

**Statuss 2026-09-30:** `[x]` nozīmē, ka norādītais šaurais fakts ir pārbaudīts; tas nenozīmē, ka visa sadaļa ir gatava. `[ ]` nozīmē, ka rezultāts vēl nav pierādīts. `app-images` neaiztikt. `event-photo-media` neaiztikt, kamēr nav atsevišķi noskaidrotas tā atkarības un īpašnieks nav devis jaunu uzdevumu.

## 1. Viena Production arhitektūra

- [x] Ir atsevišķs Supabase Production projekts `baqebydtinysosueksgr`, Production Hyperdrive, ierobežotā `lumiq_production_runtime` loma, EU foto R2 un Production Queue/DLQ. 2026-09-30 deploy pārbaude apstiprināja šo piesaisti esošajā Worker ar tehnisko nosaukumu `lumiq-production-candidate`.
- [x] Esošā Production konfigurācija lieto `PLATFORM_MODE=production`, Production datubāzi un krātuvi; anonīms pieprasījums uz tās `workers.dev/healthz` 2026-09-30 saņēma Cloudflare Access `302`.
- [ ] Sagatavot vienu kanonisku Worker `lumiq-production` un pārbaudītu izvietošanas konfigurāciju ar Production Supabase, Hyperdrive, EU R2, Queue/DLQ, e-pasta noslēpumiem un pareizo `PLATFORM_ORIGIN`. Neizmantot Closed Test datus vai noslēpumus.
- [ ] Pirms jaunā Worker atvēršanas tam uzlikt Cloudflare Access politiku tikai `guntars.karans@gmail.com`; anonīmam klientam pārbaudīt `302` gan `workers.dev`, gan vēlāk `lumiq.cam` adresē. Izslēgt neaizsargātus preview URL.
- [ ] Pārcelt Production Queue un DLQ patērētājus uz vienīgo Production Worker, pārbaudīt, ka katrai rindai ir viens paredzētais patērētājs, un pēc pārbaudes izņemt veco `lumiq-production-candidate` servisu. Saglabāt zināmu labu Production versiju atgriešanās vajadzībām.
- [ ] Inventarizēt visus Cloudflare Worker, Hyperdrive un R2 resursus, Supabase projektus, Access lietotnes, DNS ierakstus un API tokenus. Katram fiksēt īpašnieku, atkarības, izmaksas un lēmumu `paturēt / izņemt`. Izņemt lieko tikai pēc atkarību, datu un backup pārbaudes; Recovery resursus nepārrakstīt.

## 2. Domēns un piekļuve

- [x] Cloudflare ir `lumiq.cam` DNS zona ar Cloudflare nameserveriem; MX ieraksti e-pasta saņemšanai publiski atbild.
- [ ] Atjaunot `lumiq.cam` tīmekļa maršrutu uz **Production** Worker. 2026-09-30 gan Cloudflare, gan Google publiskais DNS neatgrieza saknes A/AAAA/CNAME ierakstu; pašreizējais dators `lumiq.cam` neatrisināja. Cita tīkla agrāku piekļuvi neuzskatīt par pašreizējās maršrutēšanas pierādījumu.
- [ ] Pirms maršruta piesaistes pārbaudīt owner-only Access; pēc piesaistes pārbaudīt TLS, DNS no vismaz diviem tīkliem un anonīmu atteikumu visām galvenajām lapām un API. Saglabāt drošu atgriešanās plānu uz iepriekšējo **Production** versiju, nevis uz testu datubāzi.
- [ ] `www.lumiq.cam` novirzīt uz primāro adresi vai aizsargāt tikpat stingri; noņemt vecu parking lapu, ja tā vēl eksistē. Nav publiskas atvērtas alternatīvas Production lietotnei.
- [ ] TET mājas Wi-Fi bloķējumu risināt paralēli ar TET pieteikumu. Tas nav priekšnoteikums Production darba turpināšanai, ja citi tīkli un autoritatīvais DNS ir pārbaudīti; neapiet brīdinājumu ar nedrošu sertifikāta vai pāradresācijas izņēmumu.

## 3. Datubāze, Auth un noslēpumi

- [x] Jaunākās privātās Production rezerves kopijas pārbaude 2026-09-30 uzrādīja 21 tabulu, migrācijas `001–046`, derīgas kontrolsummas un tobrīd 0 foto objektu. Tas nepierāda pilnu restore.
- [ ] Atkārtoti pārbaudīt Production migrāciju kontrolsummas, RLS, `NOBYPASSRLS` runtime lomu, minimālās grants un Supabase Auth projekta identitāti. Nekādas lietotnes saites uz Closed Test vai Restore Drill DB.
- [ ] Supabase Auth `Site URL` un precīzos atļautos callback URL iestatīt uz `https://lumiq.cam` reģistrācijai, uzaicinājumam, paroles atjaunošanai, e-pasta maiņai un Google login, ja tas ir ieslēgts. Pārbaudīt katru saiti pēc faktiskas vēstules saņemšanas; nelietot wildcard redirect.
- [ ] Pārbaudīt sesijas atjaunošanu, izrakstīšanos, CSRF, rate limitus, paroles politiku un to, ka kļūdas neizpauž tokenus vai paroles. Noslēpumi paliek Cloudflare/Supabase secret glabātuvēs un vietējā DPAPI, nevis Git.

## 4. E-pasta servisi un dizains

- [x] Resend sūtīšanas domēni `lumiq.cam` un `send.lumiq.cam` bija verificēti; Production Supabase SMTP bija ieslēgts ar `Lumiq <noreply@lumiq.cam>`. Publicēti Resend DKIM, Return-Path, Cloudflare MX/SPF un DMARC monitoringa ieraksti.
- [x] `support@lumiq.cam` Cloudflare Email Routing noteikums pārsūtīja ārēju testa vēstuli uz `guntars.karans@gmail.com`, un Gmail `Lumiq` iezīme to parādīja. `noreply@` ir sūtītāja adrese; tai nav vajadzīga atsevišķa saņemšanas pastkaste.
- [x] Lumiq tēmas Auth HTML veidnes un Worker HTML/teksta veidnes ir sagatavotas; lokālie testi ir izturēti. Tas nepierāda visu reālo vēstuļu piegādi.
- [ ] Pārbaudīt reālu Production sūtījumu no `noreply@lumiq.cam`: reģistrācija, ielūgums, paroles atiestatīšana, e-pasta maiņa, paroles maiņas paziņojums un būtiskie produkta paziņojumi. Salīdzināt Supabase Auth, Resend un saņēmēja žurnālus.
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
