# Lumiq Production QA atskaite

Pārskata datums: 2026-10-01. QA vide: lokāls/izolēts tests un read-only Production konfigurācijas pārbaudes. Nekādi īsti Production foto netika augšupielādēti vai dzēsti.

## Lokāli pārbaudīts

| Plūsma | Rezultāts | Ko tas pierāda |
| --- | --- | --- |
| Foto MIME/tipa un izmēra pārbaude | PASS | Kods noraida neatbalstītus/formāta viltojumus un limitu pārsniegumus |
| Viesa upload rezervēšana, augšupielāde, finalize un retry | PASS | Sintētiska plūsma, atkārtojumi nedublē pabeigtu foto |
| Thumbnail un galerija | PASS | Sīktēlu izvēle, galerijas metadati un īpašnieka autorizācijas testu robežas |
| Foto dzēšana un cleanup retry | PASS | DB/storage atdalītas dzēšanas kļūmes atkopšanas scenāriji |
| ZIP eksports | PASS | 1,000 sintētisku foto sadalīti 2 daļās; kopā 72,056,284 baiti |
| Responsive/pārlūka plūsmas | PASS | 320–1440 px; QR/event, 20 sintētiski foto ar retry, preview un pieejamība |
| Pilnais lokālais kvalitātes skripts | PASS, pēdējā dokumentētā izpilde | Secret scan tīrs; `npm audit` bez augstas/smagas ievainojamības; 201/201 testi; build un pārlūka/a11y pārbaudes izturētas |

Pēdējais pilnais `npm run check` rezultāts ir reģistrēts `PRODUCTION-GOAL-LV.md` ar izpildes kontekstu. Tas bija lokāls un neveica ārējus Production pieprasījumus. Pēc šīs atskaites pievienošanas izmaiņu apjoms ir tikai dokumentācija.

## Read-only Production novērojumi

- `lumiq-production` Worker ir 100% trafikam; `lumiq.cam` ir custom domain un paliek aiz owner-only Cloudflare Access.
- Foto R2 bucket ir privāts un pašreiz uzrādīja 0 B; nav īstu augšupielādētu Production foto, ar kuriem validēt dzīvo galeriju vai ZIP.
- Queue/DLQ piesaistes ir Production; tās nav izmainītas šīs pārbaudes laikā.
- Resend `lumiq.cam` sūtītāja domēns ir verified, bet Supabase Auth un login joprojām ir bloķēti ar `auth` grants problēmu.

## Nav pārbaudīts dzīvajā

1. Organizatora reģistrācija, e-pasta apstiprināšana, paroles atiestatīšana un login: Supabase Production Auth grants kļūme (`047` nav lietota).
2. Autentificēts īsta konta pasākuma izveides un īpašnieka autorizācijas ceļš.
3. Fiziska Android/iPhone kamera, īsta mobilā tīkla upload un augstas izšķirtspējas attēlu atmiņas lietojums.
4. Production R2 foto oriģināls/sīktēls, galerijas nolasīšana, dzēšana, cleanup un ZIP lejupielāde.
5. Production datubāzes/objektu pilna restore un pēc-restore lietotnes smoke testi.
6. Īsts maksājums, rēķins, atmaksa vai Stripe/klix/Swedbank. Norēķinu UI ir simulēts.

## QA slēgšanas kritēriji pēc Supabase labošanas

Pēc Auth labojuma ar īpašnieka testkontu pārbaudīt svaigu sesiju, verify, reset un login; tad veikt vienu sintētisku Production event/foto pilno ciklu, pārbaudīt oriģinālu un thumbnail, dzēšanu/cleanup, pilnu ZIP atarhivēšanu un īpašnieka piekļuves robežas. Pirms piekļuves atvēršanas izpildīt atsevišķu launch gate pārbaudi. Neizmantot sensitīvas īstu viesu fotogrāfijas kā testdatus.
