# Gala produkts SaaS

Atsevisks foto pasakumu platformas repozitorijs. Tas nav savienots ar Event Photo SaaS MVP repozitoriju vai ta production servisiem.

Produkts lauj organizatoram izveidot pasakumu, publicet QR saiti, sanemt viesu optimizetus foto, parvaldit galeriju un sagatavot ZIP eksportus. Viesiem konts nav nepieciesams.

## Lokala palaisana

Nepieciesams Node.js 22.

```powershell
npm install
npm run dev
```

Atver `http://127.0.0.1:5700/`.

- `/sample-workspace` - organizatora demonstracija
- `/demo` - viesa demonstracija
- `/pricing` - cenu plani
- `/inbox` - lokala verifikacijas un paroles atjaunosanas vestulu kaste

Pasakuma darba vietas QR riks piedava cetrus Lumiq drukas dizainus, kvadrata, A5 un galda kartites formatus. Canva izveidotu JPEG, PNG vai WebP fonu var saglabat privati tikai konkreta pasakuma vajadzibam.

Lokalie dati glabajas `platform/.local/` un netiek versiju kontrole.

## Parbaude

```powershell
npm run check
```

Komanda izpilda backend testus, publisko failu build un izolētu Chromium gala plusmu. Testi neizmanto Event Photo SaaS servisus.

## Dokumentacija

- [Production goal un darbu saraksts](platform/docs/PRODUCTION-GOAL-LV.md)
- [Arhitektura](platform/docs/ARCHITECTURE.md)
- [Paveiktais un atlikusais](platform/docs/PROGRESS.md)
- [Produkta roadmap](platform/docs/PRODUCT-ROADMAP.md)
- [Testesana](platform/docs/TESTING.md)
- [Lokala un staging sagatavosana](platform/docs/SETUP.md)
- [Palaisanas kriteriji](platform/docs/LAUNCH-GATES.md)
- [Drosibas parbaudes](platform/docs/SECURITY-VERIFICATION.md)
- [Cenu un kapacitates lemumi](platform/docs/PRICING.md)
- [20 uzlabojumu statuss](platform/docs/20-IMPROVEMENTS-STATUS.md)
- [Staging un hostinga arhitektura](platform/docs/STAGING-AND-HOSTING.md)
- [Backup un atjaunosana](platform/docs/BACKUP-RESTORE.md)
- [Monitorings](platform/docs/OBSERVABILITY.md)
- [Drosibas audita pakotne](platform/docs/SECURITY-AUDIT-PACK.md)
- [Izmaksas un juridiskie varti](platform/docs/UNIT-ECONOMICS-AND-LEGAL.md)

## Statuss

Lokala produkta versija ir darbotiesspejiga, bet production pieslegsana apzinati nav aktivizeta. Pirms publiskas palaisanas japabeidz jaunas infrastrukturas integracija, realu iericu un slodzes testi, backup/restore parbaude, neatkarigs drosibas audits un juridisko dokumentu apstiprinasana.
