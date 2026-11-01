# IMPLEMENTATION PLAN — Site Yönetim SaaS

Bağımlılık: `INITIAL-ANALYSIS.md`, `ASSUMPTIONS.md`, spec `00`–`09`.  
Kapsam: **Aşama 2 — plan**. Uygulama kodu bu aşamada yok.

İlkeler:

- Her task küçük ve doğrulanabilir.
- Dependency sırası zorunlu.
- Kritik finans modülünde test olmadan bir sonrakine geçilmez.
- Over-engineering yok; modular monolith.

---

## Legend

| Alan | Anlam |
|------|--------|
| **ID** | Task kimliği |
| **Dep** | Bağımlı olduğu task’lar |
| **DoD** | Doğrulama kriteri |
| **Est** | Göreli büyüklük: S / M / L |

Status tracking için önerilen kolon (ayrı board’da): `TODO | DOING | DONE | BLOCKED`.

---

## Phase 0 — Skeleton (Sprint 0)

> Hedef: çalışır empty app + DB + health + CI lokal.

| ID | Task | Dep | Est | DoD |
|----|------|-----|-----|-----|
| P0-01 | Repo yapısı: `backend/`, `frontend/`, `docs/`, root README | — | S | Klasörler mevcut |
| P0-02 | `docker-compose.yml`: postgres:17-alpine, api, nginx stub | P0-01 | M | `docker compose up` postgres healthy |
| P0-03 | Backend: Node+TS+Fastify iskelet, `src/app.ts`, `server.ts` | P0-01 | M | `/api/v1/health` 200 |
| P0-04 | Config: env Zod parse (`DATABASE_URL`, `JWT_SECRET`, `PORT`) | P0-03 | S | Eksik env ile process exit |
| P0-05 | Drizzle client + klasör: `schema/`, `migrations/` | P0-03 | S | DB connect |
| P0-06 | Pino logger + request_id hook | P0-03 | S | JSON log’ta request_id |
| P0-07 | Shared errors + standard error serializer | P0-03 | S | `{code,message,details}` |
| P0-08 | Vitest + Testcontainers Postgres smoke | P0-05 | M | 1 smoke test yeşil |
| P0-09 | Frontend: Vite React TS + Tailwind + router shell | P0-01 | M | `/` render |
| P0-10 | shadcn/ui init + layout shell | P0-09 | S | App shell görünür |
| P0-11 | TanStack Query provider + API client stub | P0-09 | S | baseURL `/api/v1` |
| P0-12 | Nginx conf: static + `/api` proxy | P0-02,P0-03,P0-09 | M | Compose ile UI+API |
| P0-13 | `.env.example` backend/frontend | P0-04 | S | Dokümante |
| P0-14 | Migration runner script (`drizzle-kit`) | P0-05 | S | `migrate` komutu |

**Phase 0 exit:** Health OK, compose ayakta, test runner çalışıyor.

---

## Phase 1 — Auth + Tenant + Audit foundation

| ID | Task | Dep | Est | DoD |
|----|------|-----|-----|-----|
| P1-01 | Migration 001–002: tenants, users, refresh_tokens, user_roles | P0-14 | M | migrate OK |
| P1-02 | Migration 005a: audit_log, idempotency_key | P0-14 | S | migrate OK |
| P1-03 | Auth repository/service: register (internal), login, argon2 | P1-01 | M | login JWT döner |
| P1-04 | JWT access + refresh rotate | P1-03 | M | refresh çalışır |
| P1-05 | `authenticate` / `requirePermission` preHandlers | P1-04 | M | 401/403 |
| P1-06 | Tenant context: `req.user.tenantId` zorunlu filter helper | P1-05 | S | helper unit test |
| P1-07 | Audit writer service (same-tx capable) | P1-02 | S | insert test |
| P1-08 | Idempotency plugin (header capture + replay) | P1-02 | M | aynı key → aynı response |
| P1-09 | Routes: `/auth/*`, `/tenants`, `/users` (minimal) | P1-05 | M | inject tests |
| P1-10 | Seed: SUPER_ADMIN + demo tenant | P1-03 | S | seed script |
| P1-11 | Frontend: login page + auth store + protected route | P1-09,P0-11 | M | login→dashboard |
| P1-12 | Test: Tenant A token ile Tenant B resource 404/403 | P1-06,P1-09 | M | **zorunlu izolasyon testi** |

**Phase 1 exit:** Auth çalışır; tenant isolation testi yeşil.

---

## Phase 2 — Site / Block / Unit / Person

| ID | Task | Dep | Est | DoD |
|----|------|-----|-----|-----|
| P2-01 | Migration 003–004: site, block, unit, person, ownership, occupancy | P1-01 | M | migrate OK |
| P2-02 | Sites module CRUD + authz | P2-01,P1-05 | M | API tests |
| P2-03 | Blocks + Units CRUD, indexes | P2-02 | M | list pagination |
| P2-04 | Persons CRUD | P2-01 | M | API tests |
| P2-05 | Ownership / occupancy services (date overlap validation) | P2-03,P2-04 | M | overlap reject |
| P2-06 | Frontend: management units/residents list+forms | P2-03,P2-05,P1-11 | L | CRUD UI |
| P2-07 | Seed: 33 daire demo site (MVP senaryosu) | P2-05 | S | 33 unit |

**Phase 2 exit:** 33 daireli demo site hazır.

---

## Phase 3 — Charge / ChargeBatch (Tahakkuk)

> Finans kapısı #1 — test zorunlu.

| ID | Task | Dep | Est | DoD |
|----|------|-----|-----|-----|
| P3-01 | Migration billing: charge_type, charge_batch, charge, indexes | P2-01 | M | migrate OK |
| P3-02 | Decimal util + Zod money string schema | P0-07 | S | unit tests |
| P3-03 | Distribution engine: EQUAL, FIXED, GROSS_M2, NET_M2, LAND_SHARE | P3-02 | M | 33×4000=132000 test |
| P3-04 | `previewChargeBatch` (stateless) | P3-03 | M | preview totals |
| P3-05 | `commitChargeBatch` in DB transaction + audit | P3-04,P1-07 | M | charges OPEN |
| P3-06 | Cancel charge batch / charge rules (K-004 varsayım A) | P3-05 | M | no hard delete |
| P3-07 | Routes + schemas | P3-05 | S | inject tests |
| P3-08 | **Tests:** 33 daire 4000; custom distribution; tenant isolation | P3-07 | M | yeşil |
| P3-09 | Frontend: charge wizard (6 adım) + list | P3-07,P2-06 | L | preview→onay |

**Phase 3 exit:** Aidat tahakkuku E2E (API) + UI wizard; **P3-08 yeşil olmadan Phase 4’e geçilmez.**

---

## Phase 4 — Payment / Allocation / Receipt

> Finans kapısı #2 — test zorunlu.

| ID | Task | Dep | Est | DoD |
|----|------|-----|-----|-----|
| P4-01 | Migration cash (008) + payments (bank FK later-safe) | P3-01 | M | migrate OK |
| P4-02 | Allocation strategies: OLDEST_FIRST, USER_SELECTED | P3-02 | M | unit tests |
| P4-03 | `previewPayment` | P4-02 | M | partial/multi charge |
| P4-04 | `collectPayment` transaction: payment+alloc+charge+receipt+audit | P4-03,P1-07 | L | invariants I1–I3 |
| P4-05 | Receipt sequence FOR UPDATE | P4-04 | S | concurrent test |
| P4-06 | Cash payment → cash_transaction | P4-04 | S | linked row |
| P4-07 | Overpayment policy (K-001 yanıtına göre) | P4-04 | M | policy tests |
| P4-08 | `reversePayment` (K-003’e göre bank alanları henüz null-safe) | P4-04 | M | open_amount restore |
| P4-09 | Idempotency on POST /payments | P4-04,P1-08 | S | retry safe |
| P4-10 | Routes | P4-04 | S | API |
| P4-11 | **Tests:** partial; multi-alloc; oldest-first; excess; reverse; idempotency | P4-10 | L | **hepsi yeşil** |
| P4-12 | Frontend: manual payment + unit open charges | P4-10 | M | UI |

**Phase 4 exit:** P4-11 yeşil. Banka olmadan nakit tahsilat tamam.

---

## Phase 5 — Bank Account / Import / Fingerprint

> Finans kapısı #3 — duplicate testleri zorunlu.

| ID | Task | Dep | Est | DoD |
|----|------|-----|-----|-----|
| P5-01 | Migration bank_account, import_batch, bank_transaction, sender_mapping | P4-01 | M | uniques exist |
| P5-02 | Alter payment↔bank_transaction FKs + unique | P5-01,P4-01 | S | constraints |
| P5-03 | BankAccount CRUD | P5-01 | S | API |
| P5-04 | Normalizer + fingerprint SHA-256 | P5-01 | M | stable hash test |
| P5-05 | Parser interface + generic CSV | P5-04 | M | fixture parse |
| P5-06 | Generic XLSX parser | P5-05 | M | fixture parse |
| P5-07 | Import preview (no persist) | P5-05 | M | row counts |
| P5-08 | Import commit: file_hash + per-row fingerprint; skip dupes | P5-07,P1-07 | L | batch status |
| P5-09 | File storage local volume | P5-08 | S | file on disk |
| P5-10 | Routes multipart | P5-08 | M | API |
| P5-11 | **Tests:** same file twice; same tx two files; OUT not collectible flag | P5-10 | M | yeşil |
| P5-12 | Frontend: bank accounts settings + upload on `/finance/bank` | P5-10 | M | upload UX |

**Phase 5 exit:** Duplicate import imkânsız (DB+test).

---

## Phase 6 — Reconciliation Engine

| ID | Task | Dep | Est | DoD |
|----|------|-----|-----|-----|
| P6-01 | Name/IBAN/description normalization (TR) | P5-04 | M | unit tests |
| P6-02 | Unit/block regex extractors | P6-01 | M | fixtures A-12, DAIRE 12 |
| P6-03 | Scoring service signals + bands | P6-02,P2-05 | L | score fixtures |
| P6-04 | Persist suggestions: matched_unit_id, score, status | P6-03 | M | SUGGESTED/REVIEW/UNMATCHED |
| P6-05 | Re-run reconcile endpoint | P6-04 | S | idempotent re-score |
| P6-06 | Manual unit override + sender_mapping upsert | P6-04 | M | next score +50 |
| P6-07 | Ignore transaction | P6-04 | S | IGNORED |
| P6-08 | **Tests:** name same IBAN diff; description unit; amount match; mapping memory | P6-06 | M | yeşil |
| P6-09 | Frontend: bank grid filters + score + suggested unit | P6-04,P5-12 | L | hızlı UI |

**Phase 6 exit:** Deterministik eşleştirme; AUTO_CONFIDENT otomatik tahsilat yapmaz.

---

## Phase 7 — Bulk Collection

> Finans kapısı #4 — en kritik E2E.

| ID | Task | Dep | Est | DoD |
|----|------|-----|-----|-----|
| P7-01 | `matchPreview` single tx → allocation plan | P6-04,P4-03 | M | preview DTO |
| P7-02 | `collectFromBankTransaction` orchestration (1 DB tx) | P7-01,P4-04,P5-02 | L | MATCHED+receipt |
| P7-03 | Guard: already matched → SKIPPED/error code | P7-02 | S | unique violation safe |
| P7-04 | Bulk preview aggregate | P7-01 | M | totals + problem rows |
| P7-05 | Bulk collect: per-row transactions; SUCCESS/FAILED/SKIPPED | P7-04,P7-02 | L | partial success |
| P7-06 | Idempotency-Key on bulk-collect | P7-05,P1-08 | M | retry no double |
| P7-07 | bulk_collection_batch audit trail | P7-05 | S | summary stored |
| P7-08 | **Tests:** double collect same bank_tx; idempotent retry; 500 rows mix fail; OUT skipped | P7-06 | L | **yeşil** |
| P7-09 | Frontend: select N → preview drawer → confirm | P7-05,P6-09 | L | 3-step UX |
| P7-10 | **MVP scenario E2E:** 33 units → charge → XLSX 41 → 37+4 → bulk → re-import no dup | P7-08,P3-08,P5-11 | L | script/test |

**Phase 7 exit:** MVP çıkış kriterinin banka kısmı yeşil. **P7-08/P7-10 olmadan Phase 8 finans raporlarına güvenilmez.**

---

## Phase 8 — Expense / Cash / Reports / Dashboard

| ID | Task | Dep | Est | DoD |
|----|------|-----|-----|-----|
| P8-01 | Migration supplier, expense_category, expense | P5-01 | M | migrate |
| P8-02 | Expense CRUD + cancel (no delete) | P8-01 | M | tests |
| P8-03 | Cash accounts + manual cash tx | P4-06 | M | tests |
| P8-04 | Dashboard aggregates (optimized SQL) | P3-05,P4-04,P8-02 | M | < sensible latency |
| P8-05 | Debt aging report 0-30…180+ | P4-04 | M | bucket tests |
| P8-06 | Collection rate, income-expense, bank report, unit statement | P8-04 | L | equation I check |
| P8-07 | Frontend: dashboard cards + reports pages | P8-04,P8-05 | L | UI |
| P8-08 | Frontend: expenses + cash | P8-02,P8-03 | M | UI |

**Phase 8 exit:** Yönetici 30 sn’de finansal durum görür.

---

## Phase 9 — Personnel

| ID | Task | Dep | Est | DoD |
|----|------|-----|-----|-----|
| P9-01 | Migration employee, leave_request, attendance | P2-04 | M | migrate |
| P9-02 | Employee CRUD | P9-01 | S | API |
| P9-03 | Leave flow DRAFT→…→APPROVED | P9-02 | M | authz approve |
| P9-04 | Attendance daily upsert | P9-02 | S | API |
| P9-05 | Frontend management employees/leave | P9-03 | M | UI |

---

## Phase 10 — Operations / Fuel / Announcements

| ID | Task | Dep | Est | DoD |
|----|------|-----|-----|-----|
| P10-01 | Migration ticket, task, attachments | P2-01 | M | migrate |
| P10-02 | Ticket lifecycle + assign | P10-01 | M | API |
| P10-03 | Tasks CRUD | P10-01 | S | API |
| P10-04 | Migration fuel_* | P8-01 | S | migrate |
| P10-05 | Fuel stock + 30g forecast | P10-04 | M | formula test |
| P10-06 | Announcements CRUD | P2-02 | S | API |
| P10-07 | Frontend ops/fuel/comms | P10-02–P10-06 | L | UI |

---

## Phase 11 — AI (son)

| ID | Task | Dep | Est | DoD |
|----|------|-----|-----|-----|
| P11-01 | AI tool facade (read-only tools) | P8-05 | M | no direct DB |
| P11-02 | Draft tools (previewChargeBatch, suggestBankMatch) | P11-01,P6-03 | M | draft only |
| P11-03 | Write tools gated by explicit user approval | P11-02 | M | no auto mutate |
| P11-04 | AiInvocationLog + masking | P11-01 | S | audit |
| P11-05 | Frontend assistant panel (optional) | P11-03 | M | UI |

---

## Phase 12 — Hardening / Deploy polish

| ID | Task | Dep | Est | DoD |
|----|------|-----|-----|-----|
| P12-01 | Nginx TLS docs + Let’s Encrypt notes | P0-12 | S | doc |
| P12-02 | Backup script `pg_dump` cron example | P0-02 | S | script |
| P12-03 | Ready probe (DB ping) | P0-03 | S | `/health/ready` |
| P12-04 | Load sanity: 1000 tx import timing | P7-08 | M | measured |
| P12-05 | Security pass: IDOR checklist re-test | P1-12 | M | yeşil |
| P12-06 | Portal light (OWNER/RENTER balance+tickets) | P10-02,P4-10 | M | optional MVP+ |

---

## Cross-cutting work (sürekli)

Her feature DoD:

```text
schema | migration | validation | authorization | service | repository
route | audit | test | frontend | error state | loading state
```

Özellikle şu testler **regresyon suite**’te kalıcı:

1. 33×4000 = 132000 tahakkuk  
2. Kısmi ödeme  
3. Çoklu charge allocation  
4. Oldest-first  
5. Fazla ödeme politikası  
6. Aynı banka dosyası 2×  
7. Aynı hareket 2 dosyada  
8. Aynı BankTransaction 2× collect  
9. Aynı Idempotency-Key retry  
10. 500 satır bulk mixed results  
11. Tenant izolasyonu  

---

## Dependency Graph (yüksek seviye)

```text
P0 Skeleton
 └─ P1 Auth/Tenant/Audit/Idempotency
     └─ P2 Org/Units/Persons
         └─ P3 Charges ──┬─ P4 Payments ──┬─ P5 Bank Import
                         │                └─ P6 Scoring
                         │                     └─ P7 Bulk Collect ── P8 Reports
                         └───────────────────────────── P8 (dashboard needs charges)
 P7/P8 done → P9 Personnel → P10 Ops/Fuel/Comms → P11 AI → P12 Hardening
```

---

## Mapping: User module order → Plan phases

| # | Modül (kullanıcı sırası) | Phase |
|---|--------------------------|-------|
| 1 | Auth | P1 |
| 2 | Tenant | P1 |
| 3–5 | Site/Block/Unit | P2 |
| 6–7 | Person / Ownership/Occupancy | P2 |
| 8–9 | Charge / ChargeBatch | P3 |
| 10–12 | Payment / Allocation / Receipt | P4 |
| 13–15 | BankAccount / Import / BankTransaction | P5 |
| 16–17 | Reconciliation / BulkCollection | P6–P7 |
| 18–19 | Expense / Cash | P8 |
| 20 | Reports | P8 |
| 21–23 | Employee / Leave / Fuel | P9–P10 |
| 24–25 | Announcement / Ticket | P10 |
| 26 | AI | P11 |

---

## Blocked-by-questions

Aşağıdaki task’lar **Kritik Sorular** yanıtına bağlıdır; yanıt gelmeden varsayımla ilerlenir ama üretim öncesi kilitlenmeli:

| Question | Affects |
|----------|---------|
| K-001 Overpayment | P4-07, P7-02 |
| K-002 Late fee | P3 optional job; site_finance_config UI |
| K-003 Reverse→bank status | P4-08, P7-03 |
| K-004 Cancel partial charge | P3-06 |

---

## Suggested first coding slice (Aşama 3 başlangıcı)

Kullanıcı Aşama 3’e geç dediğinde sıra:

1. P0-01 … P0-14  
2. P1-01 … P1-12  
3. Durum raporu + K-001…K-004 netleştirme  

**Şu an yapılmayacak:** uygulama kodu, migration SQL implementasyonu, UI component’leri.

---

## Plan completion checklist

- [x] Küçük doğrulanabilir task’lar  
- [x] Dependency sırası  
- [x] Finans kapı testleri  
- [x] Banka duplicate / bulk / idempotency task’ları  
- [x] Frontend banka UX task’ları  
- [x] Roadmap sprint hizası  
- [x] Kritik soru blokları işaretli  
