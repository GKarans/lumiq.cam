# Lumiq Production goal

Šis ir izpildes reģistrs pilnajam Production mērķim. Pilnais prasību saraksts un sākuma stāvoklis ir Codex goal pielikumā `goal-objective.md`; šeit atzīmēju tikai pārbaudītus rezultātus. `[x]` nenozīmē, ka visa produkta sadaļa ir pabeigta.

## Production infrastruktūra

- [x] Production Supabase, Hyperdrive, EU foto R2, Queue/DLQ un owner-only Access konfigurācija iepriekš auditēta; Production saites un dati saglabājami.
- [x] Aizvākti atsevišķie testi resursi pēc atkarību un backup pārbaudes (2026-10-01): Supabase `Lumiq.cam - test` (`cpweowosocjuccjsyyic`) un `Lumiq Restore Drill 2026-09-25` (`sprzlvywzpeyuzbsyplz`); Hyperdrive `lumiq-restore-drill` (`7dce888394a3484bafbbe58d3ac329b4`); tukšais R2 `lumiq-restore-drill-20260925`.
- [x] Pēc tīrīšanas Supabase organizācijas sarakstā palika `Lumiq Production` un `Lumiq Production Recovery`; Hyperdrive sarakstā tikai `lumiq-production`.
- [x] Pārbaudīts, ka Production backup R2 joprojām satur 36 objektus (419 kB), `lumiq-production-recovery` paliek tukšs restore mērķis, un `lumiq-production-photos` ir saglabāts.
- [x] `app-images` un `event-photo-media` nav aiztikti.
- [ ] Izveidot un pārbaudīt kanonisko `lumiq-production` Worker un tā vienīgo Queue/DLQ patērētāju; tikai tad izņemt veco candidate Worker.
- [ ] Sakārtot `lumiq.cam` DNS/Worker maršrutu uz Production, saglabājot Access aizsardzību un pārbaudot no vairākiem tīkliem.

## Autentifikācija, e-pasts un lietotnes QA

- [ ] Atrisināt Supabase Production Auth/DB tiesību problēmu, kas rada `/api/auth/consume` 403 un paroles maiņas/login kļūmes; pārbaudīt migrāciju 047 un Supabase Support atbildi.
- [ ] Ar atsevišķu QA kontu dzīvajā Production pārbaudīt reģistrāciju/ielūgumu, e-pasta saiti, login, sesijas atjaunošanu, logout un paroles atjaunošanas pilnu ciklu.
- [ ] Pārbaudīt Production e-pasta veidnes un piegādi, foto/QR/galerijas/dzēšanas/ZIP pilno plūsmu un divu organizatoru izolāciju.
- [ ] Pārbaudīt drošību, backup un pilnu izolētu restore, juridiskās lapas, izmaksas/brīdinājumus un mobilās ierīces.
- [ ] Pēc katra labojuma palaist atbilstošos testus, dokumentēt pierādījumus un commit/push veikt tikai uz `GKarans/lumiq.cam`; neiekļaut lietotāja lokālās izmaiņas.

## Gala pārbaude

- [ ] Svaigā sesijā pārbaudīt Access → Auth → event → QR → viesu foto → EU R2 → galerija → dzēšana → ZIP → logout → reset password.
- [ ] Apstiprināt, ka Production maršrutā nav candidate DB/datu, nav neaizsargātu preview URL, un `app-images`/`event-photo-media` nav mainīti.
