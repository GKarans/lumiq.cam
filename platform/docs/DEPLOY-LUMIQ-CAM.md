# Lumiq.cam izvietošanas ceļvedis

> **Novecojis ceļvedis. Neizpildi pašreizējā izvietošanā.** Šis fails apraksta
> Render `starter` servisus un piesaisti domēnam `lumiq.cam`, kas var radīt
> izmaksas un pārņemt esošo domēnu. Pašreizējais īpašnieka lēmums ir tikai
> bezmaksas slēgts tests, bez publiska domēna un bez maksas servisiem. Izmanto
> [CLOSED-FREE-TEST.md](CLOSED-FREE-TEST.md). Šo ceļvedi saglabā kā vēsturisku
> atsauci; tas nav apstiprināts production plāns.

Šis ceļvedis pieslēdz `lumiq.cam` šim repozitorijam (`gala-produkts-saas`), izmantojot Namecheap domēna reģistrāciju, Cloudflare DNS/R2, Supabase DB/Auth un Render Node.js API/worker.

**Maksājumi netiek pieslēgti.** Explore bezmaksas izmēģinājums, konti, pasākumi, viesu lapas, foto augšupielāde, privātā galerija, kopīgošana, eksports, e-pasti un fona darbi ir paredzēti darbam. Maksas checkout un norēķinu portāls paliek izslēgti.

## Kas būs vajadzīgs

- Namecheap pieeja `lumiq.cam` DNS/nameserver iestatījumiem.
- Cloudflare konts ar `lumiq.cam` zonu un atsevišķu privātu R2 bucket.
- Jauns, šim produktam izolēts Supabase projekts; nelieto veco MVP projektu.
- Render konts diviem ilgstoši strādājošiem procesiem: web/API un worker.
- E-pastu piegādātājs. Lietotāja paroles apstiprināšanu un atkopšanu sūta Supabase Auth SMTP; lietotnes paziņojumus sūta Resend adapteris. Konti/atslēgas pašlaik vēl jāizveido un jāpārbauda.
- Kods jāieliek šī repozitorija `main` zarā. Pašreizējā darba koka izmaiņas vēl nav izvietotas, un ceļvedis neko necommitē vai nepush-o tavā vietā.

**Pirms Render Blueprint apstiprināšanas pārbaudi cenu.** `render.yaml` izveido divus `starter` servisus, web un worker; tie var radīt atkārtotas izmaksas. R2, Supabase un e-pasta pakalpojumiem var būt savi limiti/cenas. Šis ceļvedis nevienu resursu vai maksas plānu automātiski nepasūta.

## 1. Pārbaudi pareizo repozitoriju

Darbojies tikai `C:\Users\GKarans\Desktop\gala-produkts-saas`, nevis `DigitalWeddingCamera`/Event Photo SaaS.

```powershell
git remote -v
git branch --show-current
git status --short
npm ci --ignore-scripts
npx playwright install chromium
npm run check
```

Remote jābūt `https://github.com/GKarans/gala-produkts-saas.git`. Pārskati visas izmaiņas un testu rezultātus. Tikai pēc sava apstiprinājuma izveido commit, push uz repozitoriju un sapludini pārbaudīto zaru uz `main`. Render jāizvieto no `main`, lai neizvietotu nepabeigtu darba zaru. `.env` un slepenas vērtības GitHub nedrīkst nonākt.

## 2. Pievieno domēnu Cloudflare DNS pārvaldībai

Cloudflare kļūs par autoritatīvo DNS pārvaldītāju, bet Namecheap paliks reģistrators.

1. Cloudflare izvēlies **Add a domain**, ievadi `lumiq.cam`, izvēlies bezmaksas DNS plānu, ja tas atbilst vajadzībām, un apskati atrastos DNS ierakstus.
2. Pirms turpini, pieraksti un pārkopē uz Cloudflare visus esošos vajadzīgos ierakstus, īpaši MX, SPF, DKIM, DMARC un citus e-pasta TXT/CNAME ierakstus. Nepieciešams saglabāt esošā pasta darbību.
3. Namecheap sadaļā **Domain List → Manage → Advanced DNS** atspējo DNSSEC/izdzēs veco DS ierakstu pirms nameserver maiņas. Ja DNSSEC paliek ieslēgts ar veco DS vērtību, jaunā zona var neatrisināties.
4. Cloudflare parādīs divus konkrētus nameserver nosaukumus. Namecheap sadaļā **Domain List → Manage → Nameservers → Custom DNS** ievadi tieši šos abus un saglabā. Neievadi šeit Render A/CNAME ierakstus.
5. Sagaidi, līdz Cloudflare zona rāda **Active**. Pārbaude var aizņemt vairākas stundas, reizēm līdz 24–48 stundām.
6. No šī brīža DNS ierakstus rediģē Cloudflare DNS sadaļā. Pēc tam DNSSEC vari ieslēgt Cloudflare un Namecheap pusē iestatīt Cloudflare doto DS ierakstu; seko Cloudflare norādītajai secībai.

Ja `lumiq.cam` jau ir e-pasta pakalpojums, nepārslēdz nameserverus, kamēr Cloudflare zonā nav sagatavoti un salīdzināti visi tā DNS ieraksti.

## 3. Izveido izolētu Supabase projektu

1. Supabase izveido jaunu projektu Lumiq platformai un izvēlies reģionu pēc galveno lietotāju atrašanās vietas. Nesavieno veco Event Photo SaaS/MVP projektu.
2. Saglabā projekta **Project URL** un **Publishable key**. Service-role/secret atslēga pārlūkprogrammai nav vajadzīga un nekad nav jāievada front-endā.
3. Database sadaļā izveido atsevišķu servera DB lomu ar piekļuvi tikai platformas tabulām. Migrācijām īslaicīgi izmanto administratora savienojumu. Render parasti izmanto IPv4; Supabase tiešais DB host var būt IPv6, tādēļ Render mainīgajam nokopē Supabase Dashboard **Connect → Session pooler** SSL savienojuma virkni (ports 5432), ja tiešais host no Render nav sasniedzams. Neizmanto Transaction pooler (ports 6543): šis Node/Postgres process ir ilgstošs serveris, nevis serverless pieprasījumi. Neizmanto publishable key kā PostgreSQL paroli.
4. Projektā nav jāveido publiski pieejamas foto Storage mapes: foto glabāsies privātā Cloudflare R2 bucket.
5. Palaid visas platformas numurētās migrācijas no šī projekta lokālā PowerShell (repo saknē). URL ievadi tikai savā terminālī, nevis čatā vai failā:

```powershell
$env:PLATFORM_MODE = 'staging'
$env:PLATFORM_MIGRATE = '1'
$env:PLATFORM_DATABASE_URL = Read-Host 'Ievadi jaunā Supabase projekta migratora SSL PostgreSQL URL'
npm run migrate
Remove-Item Env:PLATFORM_MODE, Env:PLATFORM_MIGRATE, Env:PLATFORM_DATABASE_URL
```

Sagaidāmais ziņojums: `Isolated platform schema applied. No MVP migration was run.` Pārbaudi Supabase SQL Editor:

```sql
select version, applied_at from platform_migrations order by version;
select tablename, rowsecurity
from pg_tables
where schemaname = 'public'
order by tablename;
```

Jābūt visām migrācijām `001-platform` līdz `005-gallery-curation`; platformas tabulām RLS jābūt ieslēgtam. `anon` un `authenticated` lomām nedrīkst būt tieša lasīšanas piekļuve platformas tabulām. Pēc migrācijas Render API/worker izmantos ierobežotu servera DB lomu, nevis migratora administratora kontu.

### Supabase Auth, e-pasts un Google

1. Supabase **Authentication → URL Configuration** iestati Site URL `https://lumiq.cam`.
2. Pievieno atļautos redirect URL: `https://lumiq.cam/auth/verify`, `https://lumiq.cam/auth/reset`, `https://lumiq.cam/auth/email` un Google callback `https://lumiq.cam/api/auth/google/callback`. Neatļauj plašu `*` wildcard produkta URL.
3. Ieslēdz e-pasta verifikāciju. Auth e-pasta veidnēs izmanto Supabase `{{ .RedirectTo }}` un TokenHash: apstiprināšanai `{{ .RedirectTo }}?token={{ .TokenHash }}`, paroles atjaunošanai `{{ .RedirectTo }}?token={{ .TokenHash }}`, e-pasta maiņai `{{ .RedirectTo }}?token={{ .TokenHash }}`. Kods reģistrācijai padod `/auth/verify`, atkopšanai `/auth/reset`, bet e-pasta maiņai `/auth/email`. Pirms sūtīt lietotājiem, pārbaudi katru saiti no īstas testa vēstules.
4. Iestati savu SMTP pakalpojumu Supabase Auth vajadzībām. Supabase noklusētais sūtītājs nav paredzēts reālai plašai lietotāju plūsmai; pārbaudi piegādi, limitus un domēna verifikāciju.
5. Lai ieslēgtu Google pierakstīšanos, izveido OAuth klientu Google Cloud Console, iestati autorizēto redirect URI uz Supabase Auth callback: `https://<SUPABASE-PROJECT-REF>.supabase.co/auth/v1/callback`. Ievadi Google Client ID/Secret Supabase **Authentication → Providers → Google** un ieslēdz pakalpojumu. Callback lietotnes pusē ir `https://lumiq.cam/api/auth/google/callback`; atļauj to Supabase URL konfigurācijā. OAuth secret glabā tikai Supabase.
6. Testē reģistrāciju, e-pasta saiti, pieteikšanos, izrakstīšanos, paroles atjaunošanu, e-pasta maiņu un Google login. Nelieto testa adreses kā reālu klientu adreses.

## 4. Sagatavo Cloudflare R2 foto glabātuvi

1. Cloudflare **R2 → Create bucket** izveido jaunu bucket, piemēram, `lumiq-photos`. Pārbaudi R2 plāna, glabāšanas, operāciju un egress izmaksas pirms klientu foto ievietošanas.
2. Atstāj **Public access** un `r2.dev` atspējotus. Foto saņem caur autorizētu lietotnes API; publisks bucket nav vajadzīgs.
3. Izveido R2 S3 API tokenu ar Object Read & Write tiesībām tikai šim bucket. Saglabā Access Key ID un Secret Access Key paroļu pārvaldniekā.
4. Nokopē bucket S3 API endpoint no R2. Izmanto pilnu `https://<account-id>.r2.cloudflarestorage.com` adresi.
5. Bucket **Settings → CORS Policy** iestati:

```json
[
  {
    "AllowedOrigins": ["https://lumiq.cam"],
    "AllowedMethods": ["PUT"],
    "AllowedHeaders": ["Content-Type", "x-amz-checksum-sha256"],
    "ExposeHeaders": ["ETag"],
    "MaxAgeSeconds": 300
  }
]
```

Ja Cloudflare prasa arī lokālās testēšanas izcelsmi, pievieno to tikai atsevišķā testa bucket; publiskā bucket CORS sarakstā neatstāj `*`. CORS nav piekļuves kontrole.

## 5. Izvieto web un worker Render

1. Pārliecinies, ka pārbaudītais kods ir sapludināts `main` zarā un ir pieejams GitHub. Nekādu deploy no neapstiprinātām izmaiņām.
2. Render kontā pieslēdz GitHub un izvēlies **New → Blueprint**, repozitoriju `GKarans/gala-produkts-saas`, zaru `main`, Blueprint failu `render.yaml` repo saknē.
3. Pirms **Apply** apstiprināšanas pārbaudi resursu nosaukumus un pašreizējo Render cenu: Blueprint izveido `lumiq-staging-web` un `lumiq-staging-worker`, katru ar `starter` plānu. Apstiprini tikai tad, ja piekrīti izmaksām un servisu darbības nosacījumiem.
4. Web servisa un worker koplietotajā Environment sadaļā ievadi:

| Mainīgais | Vērtība |
|---|---|
| `PLATFORM_ORIGIN` | `https://lumiq.cam` |
| `PLATFORM_DATABASE_URL` | Jaunā Supabase ierobežotā servera DB loma, SSL savienojums |
| `PLATFORM_SUPABASE_URL` | Jaunā projekta Supabase URL |
| `PLATFORM_SUPABASE_PROJECT_REF` | Ne-slepenais Supabase projekta ID; jāsakrīt ar Auth URL un pirms deploy jāpārbauda pret Hyperdrive izcelsmes lietotāju |
| `PLATFORM_SUPABASE_PUBLISHABLE_KEY` | Jaunā projekta publishable key |
| `PLATFORM_SESSION_ENCRYPTION_KEY` | Render ģenerētais 64 heksadecimālu simbolu noslēpums |
| `PLATFORM_R2_BUCKET` | Izveidotā bucket nosaukums |
| `PLATFORM_R2_ENDPOINT` | R2 S3 endpoint |
| `PLATFORM_R2_ACCESS_KEY_ID` | Bucket ierobežotā atslēga |
| `PLATFORM_R2_SECRET_ACCESS_KEY` | Atbilstošais noslēpums |
| `PLATFORM_TRUSTED_PROXY_IPS` | Atstāj tukšu, ja nezini Render tiešo proxy IP; neuzmini un neuztici visiem proxy |
| `PLATFORM_EMAIL_KEY` | (Pēc izvēles) Resend API atslēga lietotnes paziņojumiem |
| `PLATFORM_EMAIL_FROM` | (Pēc izvēles) Verificētais Lumiq sūtītājs `Lumiq <noreply@lumiq.cam>` |
| `PLATFORM_ALERT_WEBHOOK` | (Pēc izvēles) Operāciju brīdinājumu HTTPS webhook |

Neizveido `PLATFORM_STRIPE_SECRET`, `PLATFORM_STRIPE_WEBHOOK_SECRET` vai `PLATFORM_STRIPE_PRICE_*`. Maksājumi ir apzināti izslēgti. `PLATFORM_MODE=staging` un `PLATFORM_RELEASE_APPROVED=staging` jau ir Blueprint failā; nemaini tos uz izdomātu production režīmu. Pēc mainīgo ievades Render veic deploy.

5. Web servisam jāsākas ar `npm start`, health check `/healthz`; worker ar `npm run worker`. Abiem nepieciešama viena un tā pati Supabase/R2 konfigurācija. Worker apstrādā eksportus, atkārtotus darbus, e-pastu outbox un foto glabāšanas termiņus.
6. Render web servisa lapā nokopē tā `*.onrender.com` hostname. Abiem servisiem jābūt veselīgiem; web `/healthz` atbild ar `200` un `database: ready`.

Render Blueprints ir definēti repozitorijā šeit: [render.yaml](../../render.yaml). Tajā šobrīd ir staging palaišanas vārti; neatkarīgs drošības audits, rezerves kopiju atjaunošanas mēģinājums, kapacitātes un reālas ārējo pakalpojumu pārbaudes vēl jāveic pirms publiskas produkcijas palaišanas.

## 6. Pieslēdz `lumiq.cam` Render servisam

1. Render web servisa **Settings → Custom Domains → Add Custom Domain** pievieno `lumiq.cam`. Ja vēlies arī `www.lumiq.cam`, pievieno to atsevišķi.
2. Render parādīs konkrēto DNS mērķi/ierakstus. Cloudflare **DNS → Records** izveido tieši Render norādīto CNAME: apex `@` uz Render servisa hostname (Cloudflare atbalsta apex CNAME flattening); `www`, ja pievienots, norādi uz Render hostname. Ja Render dashboard rāda citu precīzu mērķi, izmanto tā vērtību.
3. Sākumā Cloudflare ierakstiem uzliec **DNS only** (pelēks mākonis), lai Render var pārbaudīt domēnu un izdot TLS sertifikātu. Izdzēs konfliktējošus vecus `A`, `AAAA` vai CNAME ierakstus tikai pēc tam, kad pārliecinājies, ka tie nav vajadzīgi citam pakalpojumam.
4. Render dashboard gaidi, līdz domēns ir verified un TLS sertifikāts active. Cloudflare SSL/TLS režīmam izmanto **Full**; Render terminē HTTPS. Cloudflare proxy nav nepieciešams lietotnes darbībai. Ja vēlāk to ieslēdz, atkārtoti pārbaudi klienta IP/rate limit un uploadus.
5. Render Environment pārbaudi `PLATFORM_ORIGIN=https://lumiq.cam` bez beigu slīpsvītras un pārstartē/redeploy abus procesus pēc vides izmaiņām.
6. Pārbaudi `https://lumiq.cam/healthz`, sākumlapu un `https://www.lumiq.cam`, ja pievienots. Iestati Render izvēlēto kanonisko hostu (lumiq.cam vai www) un pārliecinies, ka otrs novirza uz to, nevis kalpo kā atšķirīga sesiju vietne.

## 7. Ieslēdz servisa paziņojumu e-pastu

1. Reģistrē Resend kontu un verificē sūtītāja domēnu. Pievieno tieši Resend dotās DNS vērtības Cloudflare DNS. Nesajauc SPF ierakstus vai esošo domēna e-pastu; ja vajag, apvieno SPF atbilstoši pasta pakalpojuma norādēm.
2. Render pievieno `PLATFORM_EMAIL_KEY` un `PLATFORM_EMAIL_FROM`, pēc tam atsevišķā testā pārbaudi lietotnes paziņojumu piegādi, queue statusu un kļūdu atkārtošanu.
3. Šis ir no Supabase Auth atsevišķs sūtīšanas kanāls. Abiem jābūt pārbaudītiem. Bez Resend vērtībām konti/foto funkcijas var darboties, bet lietotnes e-pasta paziņojumi netiks izsūtīti.

## 8. Pirms kopīgo saiti ar viesiem

Veic secīgi ar testa kontu un testa attēliem:

1. Reģistrē kontu, apstiprini e-pastu, ielogojies; pārbaudi Google tikai pēc tā iestatīšanas.
2. Izveido melnrakstu, rediģē viesa lapu un QR dizainu, publicē Explore pasākumu.
3. Noskenē QR telefonā, ievadi viesa vārdu, uzņem/augšupielādē vairākus foto. Pārbaudi, ka foto parādās organizatora galerijā, eksports veido ZIP un worker apstrādā darbu.
4. Pārbaudi dalītas galerijas ieslēgšanu/izslēgšanu un piekļuvi no privātā pārlūka. R2 publiskā lasīšana nedrīkst strādāt.
5. Reģistrē otru organizatoru un mēģini atvērt pirmā organizatora pasākumu, foto vai eksportu; piekļuvei jābūt liegtai.
6. Pārbaudi paroli un e-pasta atjaunošanu, servisa paziņojumus, worker žurnālus, neveiksmīga darba atkārtošanu un foto dzēšanas termiņu.
7. Maksas pogām jābūt neaktīvām ar paziņojumu, ka maksājumi nav pieslēgti. `POST /api/billing/checkout` maksas plānam jāatbild ar `503`, neradot order ierakstu. Explore jāpublicē ar bezmaksas izmēģinājuma limitu.
8. Izmēģini Android Chrome un iPhone Safari. Saglabā testu datumu, pārlūkus, iznākumus un kļūdas, bet ne screenshotus ar personu foto, piekļuves datiem, tokeniem vai parakstītām saitēm.

## Kas šobrīd nav izdarīts un ko nozīmē “palaists”

Šis ir palaišanas ceļvedis un koda sagatavošana, nevis jau veikta infrastruktūras konfigurēšana. Šajā darba gājienā netika mainīti Namecheap/Cloudflare/Supabase/Render konti, netika izveidoti resursi, palaistas migrācijas, mainīti nameserveri, publicēts DNS, veikts deploy vai push uz GitHub.

Repo pašreizējais servera ieejas punkts skaidri pieprasa `staging` režīmu, un `releaseReady` ir `false`. Tas ir **kontrolēts pirmsizlaišanas pilots**, nevis pierādīti ražošanai gatavs publisks SaaS. Pirms publiski reklamēt pakalpojumu vai pieņemt klientu foto, izpildi [LAUNCH-GATES.md](LAUNCH-GATES.md), faktiski pārbaudi datubāzes un R2 rezerves kopiju atjaunošanu, neatkarīgu drošības pārbaudi, slodzes mērījumus, atbalsta/e-pasta piegādi un juridisko/operatora kontaktinformāciju. Uzņēmuma informācija un domēns nav jāizdomā vai jāaizpilda ar nepatiesiem datiem.

## Oficiālā dokumentācija

- [Namecheap nameserver maiņa](https://www.namecheap.com/support/knowledgebase/article.aspx/767/10/how-to-change-dns-for-a-domain/)
- [Cloudflare pilnas DNS zonas pieslēgšana](https://developers.cloudflare.com/dns/zone-setups/full-setup/setup/)
- [Render pielāgotie domēni](https://render.com/docs/custom-domains)
- [Cloudflare DNS iestatījumi Render](https://render.com/docs/configure-cloudflare-dns)
- [Render Blueprints](https://render.com/docs/infrastructure-as-code)
- [Render background worker](https://render.com/docs/background-workers)
- [Supabase Auth redirect URL](https://supabase.com/docs/guides/auth/redirect-urls)
- [Supabase PostgreSQL connection methods and IP versions](https://supabase.com/docs/guides/database/connecting-to-postgres)
- [Supabase SMTP iestatīšana](https://supabase.com/docs/guides/auth/auth-smtp)
- [Supabase e-pasta veidnes](https://supabase.com/docs/guides/auth/auth-email-templates)
- [Cloudflare R2 CORS](https://developers.cloudflare.com/r2/buckets/cors/)
