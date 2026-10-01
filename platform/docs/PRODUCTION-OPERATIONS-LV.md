# Lumiq Production operāciju rokasgrāmata

Pārbaudīts 2026-10-01. Šis dokuments satur ne-noslēpumainu infrastruktūras stāvokli un darbības soļus. Tas nav atļauja mainīt dzīvos resursus. `app-images` un `event-photo-media` ir ārpus Lumiq Production tvēruma.

## Dzīvās Production konfigurācijas momentuzņēmums

| Daļa | Pašreiz pārbaudītais stāvoklis |
| --- | --- |
| Cloudflare Worker | `lumiq-production`; versija `c685f77b-68ea-42f0-a2c3-264966f1bdd8`, 100% trafika |
| Domēns | `lumiq.cam` ir Worker Custom Domain; `workers.dev` izslēgts; Worker Routes nav |
| Access | Visam `lumiq.cam`; viena Allow politika ar īpašnieka e-pastu `guntars.karans@gmail.com`; Access paliek ieslēgts |
| Datubāze | Supabase Production `baqebydtinysosueksgr`, EU Central; Worker savienojas caur `lumiq-production` Hyperdrive |
| Foto | EU R2 `lumiq-production-photos`; privāts, pašreiz 0 B |
| Queue | `lumiq-production-jobs`, viens Production produceris un consumeris; DLQ `lumiq-production-jobs-dlq`, Production consumeris |
| E-pasts | `Lumiq <noreply@lumiq.cam>`; atbildes/atbalsta adrese `support@lumiq.cam`; Resend `lumiq.cam` verified, sūtīšana ieslēgta, saņemšana izslēgta |

Secret vērtības, DB URL, tokeni, OTP un paroles šeit netiek glabātas. Access politikas MFA pašlaik ir izslēgta; tas ir drošības uzlabojuma jautājums, nevis šīs pārbaudes konfigurācijas izmaiņa. Resend Templates panelī nav izveidotu atkārtoti lietojamu veidņu; Auth HTML veidnes glabājas repozitorijā.

## Rezerves kopija un atjaunošana

- Ikdienas Windows uzdevums: `Lumiq Production Daily Backup`; pēdējais pārbaudītais palaides kods `0`, grafiks katru dienu 02:30 Rīgas laikā.
- Kopija tiek ievietota privātajā EU R2 `lumiq-production-backups` ar unikālu `production/<timestamp>` prefiksu. Pēc augšupielādes saturs tiek nolasīts atpakaļ un pārbaudīts ar izmēru un SHA-256.
- Retention ir izpildīts backup skriptā: glabāt vismaz 30 dienas, saglabāt jaunāko pilno komplektu; Cloudflare lifecycle noteikums tam nav aizstājējs.
- Pēdējā pārbaudītā kopa: `production/2026-09-30T23-32-07-795Z`, formāts v4, 21 DB/Auth tabula, migrācijas līdz `046`, 0 foto objektu. Manifesta un failu integritāte ir pārbaudīta; tas nav pierādījums par atjaunošanu.
- Restore: `platform/scripts/restore-local.ps1` ir paredzēts jaunam, tukšam Supabase projektam un jaunam tukšam R2 bucketam. Tas pirms rakstīšanas pārbauda projekta atsauci, backup, Auth tabulu tukšumu un mērķa bucketu. Production, Recovery un vecie/testu refs ir aizsargāti.
- Pilns atjaunošanas tests vēl nav pierādīts. Production snapshot ir bez foto objektiem, tāpēc pat sekmīgs DB restore nevalidētu foto atgūšanu. Lai izpildītu pilnu cloud drill, vajadzīgs izolēts projekts un buckets, kas var radīt papildu maksu; esošos Recovery resursus nedrīkst izmantot, kamēr nav pārbaudīta to atkarība un tukšums.
- Pēc restore nepieciešams pārbaudīt migrāciju kontrolsummas, tabulu/ierakstu skaitu, Auth lietotājus, R2 atslēgas un SHA-256, tad palaist lietotni tikai pret drill mērķiem un izpildīt login/event/photo/gallery/delete/ZIP smoke testus. Drill resursus likvidēt tikai pēc pierādījumu saglabāšanas un atsevišķa apstiprinājuma.

### Drošā rezerves kopijas pārbaude

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File platform/scripts/production-secrets.ps1 check-production-backup
```

Šī komanda ir read-only pret Production DB un foto; tā lejupielādē jaunāko privāto backup pagaidu mapē, pārbauda integritāti un iztīra pagaidu failus. Tā neveic restore.

### Restore palaišanas vārti

Pirms `restore-local.ps1` palaišanas dokumentēt atsevišķa mērķa nosaukumu, projekta ref, bucketu, cenu ietekmi, tukšuma pārbaudi un rezerves kopijas versiju. Nekad neievadīt Production ref vai Production bucketu. Neierakstīt noslēpumus žurnālā vai Git.

## Atvērtie operāciju riski

1. Supabase atbalsta atbilde par `auth` shēmas `USAGE` vēl nav saņemta; migrācijas `047` un `048`, reģistrācija, login un īsta Production foto plūsma ir bloķēta.
2. Atjaunošanas integritāte ir pārbaudīta, bet DB/R2 restore nav izpildīts.
3. Backup nav Production foto objektu kopija, jo Production foto bucket ir tukšs.
4. Access paliek ieslēgts tikai īpašniekam; to nenoņemt, kamēr publiska palaišana nav atsevišķi apstiprināta.
5. Worker pēdējo 24 h novērotās 10 kļūdas bija piesaistītas iepriekšējas versijas 503 logiem; pašreizējās versijas veselību nevar secināt no šī vēsturiskā loga vien.
6. Juridiskie teksti vēl ir pirms-palaišanas projekti; publisku pārdošanu un maksājumu pieņemšanu nesākt.
7. Resend piegādes statusi apliecina piegādātāja pieņemtu nosūtīšanu, nevis OTP izmantošanu, ienākšanu Inbox vai sekmīgu Auth.

## Incidenta sākotnējā pārbaude

1. Pārbaudīt Cloudflare Worker pēdējo deploymentu un Observability kļūdas, nemainot versiju.
2. Salīdzināt `lumiq.cam` Access, Worker Custom Domain un bindingus ar tabulu augstāk.
3. Supabase Auth problēmai pārbaudīt projekta Auth Logs un `platform_migrations` tikai-lasāmi; neizpildīt 047/048, kamēr Supabase nav norādījis atbalstītu grant ceļu.
4. E-pasta gadījumā salīdzināt Resend delivery un Supabase Auth notikumus, nekopējot OTP/reset URL žurnālā.
5. Datu zuduma gadījumā vispirms fiksēt laiku un backup prefiksu; neveikt atjaunošanu Production vidē.
