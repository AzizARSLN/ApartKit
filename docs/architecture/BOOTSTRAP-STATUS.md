# Bootstrap / progress status

Updated: 2026-09-07

## Completed

### Backend
- Auth, tenant, sites/blocks/units, persons
- Billing charge batch preview/create
- Payments + allocation + receipt + reverse
- Banking: accounts, CSV/XLSX import, fingerprint dedupe, scoring, collect, bulk-collect + idempotency
- Expenses, suppliers, categories
- Reports dashboard + debt aging
- Personnel (employee/leave), operations (tickets/announcements/fuel)
- AI route stub (no mutations)
- Migrations: `0000_init`, `0001_ops`
- Tests: **18** passing; `tsc` clean

### Frontend (2026 light SaaS UI)
- Oyster canvas + deep teal accent (no purple / no dark-default)
- Manrope + Sora typography, soft mesh background, rise animations
- Login split layout with brand panel
- Dashboard live metrics from `/reports/dashboard`
- Bank reconciliation hub (upload → filter → bulk preview → collect)
- Charges wizard-lite, units, residents, expenses, tickets, settings
- Production build verified

### Sample data
- Seed: 33 units, admin user, AIDAT/EK, GENEL expense category
- Sample CSV: `docs/samples/bank-sample.csv`

## Run

```bash
docker compose up -d postgres   # POSTGRES_PORT=5433 locally
cd backend && npm run db:migrate && npm run db:seed && npm run dev
cd frontend && npm run dev
```


## Deferred / light
- Full AI assistant UI (Sprint 11)
- Manual payment list UI (API ready; bank flow primary)
- Portal for OWNER/RENTER
- Bank-specific parsers beyond generic CSV/XLSX
- PDF receipts
