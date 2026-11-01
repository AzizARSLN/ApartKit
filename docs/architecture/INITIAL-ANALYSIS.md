# INITIAL ANALYSIS — Site Yönetim SaaS

Kaynak dokümanlar: `00`–`09` specification seti.  
Kapsam: **yalnızca analiz** (Aşama 1). Uygulama kodu yok.  
Varsayımlar: `ASSUMPTIONS.md`  
Plan: `IMPLEMENTATION-PLAN.md`

Tarih: 2026-09-07

---

## 0. Özet Verdict

Doküman seti, **modular monolith** bir site yönetim SaaS’ı için tutarlı bir omurga tanımlıyor. En kritik ve en iyi tanımlanmış alan **banka mutabakatı + tahsilat allocation** modelidir. En zayıf alanlar: auth/user şeması, supplier/announcement/ticket/attendance tabloları, fazla ödeme ve gecikme faizinin operasyonel detayı, rol adı çakışması (`TENANT`).

MVP başarı kriteri nettir (33 daire → tahakkuk → XLSX → bulk collect → duplicate koruması) ve tüm mimari kararlar buna hizalanmalıdır.

---

## 1. Eksik veya Çelişkili Gereksinimler

### 1.1 Eksikler (şemada yok / yüzeysel)

| Konu | Nerede geçiyor | Gap |
|------|----------------|-----|
| `user`, session, refresh token | Auth her yerde | `01-DATABASE.md`’de tablo yok |
| RBAC join tabloları | Roller listesi | `user_role`, permission modeli yok |
| `idempotency_key` | Banka + backend | Tablo yok |
| `bank_sender_mapping` | `04` | Tablo alanları kısmi |
| `supplier` | expense, fuel | Tablo yok |
| `announcement` | MVP + frontend | Şema yok |
| `ticket` (+ attachment) | personnel/ops | Şema yok |
| `task` | personnel | Şema yok |
| `attendance` / puantaj | personnel | Şema yok |
| `receipt_sequence` | makbuz formatı | Sequence mekanizması yok |
| `site_finance_config` (gecikme) | `03` | Config entity yok |
| `bulk_collection_batch` | toplu tahsilat | İzlenebilirlik için önerilir, yok |
| Doküman yönetimi | `00` product | MVP’de mi? Detay yok |
| Yönetim kararları | `00` product | Detay yok |
| Tedarikçi/cari ekstre | `00` | Minimal supplier varsayımı |

### 1.2 Çelişkiler / belirsizlikler

| # | Konu | Çelişki | Öneri |
|---|------|---------|--------|
| C-1 | Rol `TENANT` vs org `tenant` | Aynı kelime iki anlam | Rol: `RENTER` / `RESIDENT_TENANT` (A-007) |
| C-2 | Score `AUTO_CONFIDENT` vs `match_status` | Status enum’da AUTO yok | Classification ≠ status (A-011) |
| C-3 | `paid_amount` | `03` kullanır, `01` charge’da yok | Türetilir (A-004) |
| C-4 | Fazla ödeme | Seçenek listesi var, advance “ileri faz” | Kritik soru K-001 |
| C-5 | Gecikme faizi | Config var, üretim akışı yok | Kritik soru K-002 |
| C-6 | Toplu tahsilat transaction | “ayrı tx öner” vs “tek tx alternatif” | Ayrı tx (A-016) — kullanıcı talimatı ile uyumlu |
| C-7 | ID tipi | uuid veya bigint | bigint (A-001) |
| C-8 | `block`/`unit` tenant_id | Ortak alanlarda tenant var; block örneğinde yok | Denormalize `tenant_id` tüm site-child tablolarda |
| C-9 | Product MVP listesi vs roadmap | Doküman/karar/tedarikçi product’ta var, roadmap’te zayıf | MVP dışı bırak veya Sprint 9+ |
| C-10 | Backend klasör `residents` vs entity `person` | İsim farkı | Modül: `residents`, tablo: `person` |
| C-11 | Payment iptal | `REVERSED` + karşıt kayıt | Ters kayıt modeli detayı netleştirilmeli (K-003) |
| C-12 | `bank_transaction` hem `matched_payment_id` hem `payment.bank_transaction_id` | Çift yön | Her ikisi + unique (A-012) |

### 1.3 Doküman öncelik sırası (çözümleme kuralı)

Çelişkide:

1. Kullanıcı talimatı (bu chat)
2. `00-PRODUCT-MASTER` finans kuralları
3. `03-FINANCE` / `04-BANK`
4. `01-DATABASE`
5. `02-BACKEND` / `05-FRONTEND`
6. Roadmap sıralaması

---

## 2. Modül Sınırları (Modular Monolith)

Her modül: `routes → service → repository → schema`. Paylaşılan altyapı `shared/`.

```text
shared/          errors, auth context, audit, pagination, decimal, crypto, idempotency
auth/            login, refresh, password, current user
tenants/         tenant CRUD (super admin), tenant settings
sites/           site, block, unit
residents/       person, ownership, occupancy
billing/         charge_type, charge_batch, charge, late-fee config hook
payments/        payment, allocation, receipt, reverse
banking/         bank_account, import, transaction, parsers, reconciliation, bulk-collect, sender_mapping
expenses/        supplier (minimal), expense
cash/            cash_account, cash_transaction
reports/         dashboard, aging, statements, collection rate
personnel/       employee, leave, attendance
fuel/            tank, purchase, consumption
operations/      ticket, task
communications/  announcement
ai/              tools + approval gateway (geç faz)
jobs/            in-process scheduler
```

### Sınır kuralları

- `banking` → `payments` API’sini (internal service) çağırır; payment satırını kendi içinde kopyalamaz.
- `payments` banka satırını `MATCHED` yapabilir (orchestrated use-case service veya banking callback). Tercih: **`CollectionService`** (payments veya banking altında orchestration) tek giriş noktası.
- `reports` yalnızca okur; mutasyon yok.
- `ai` yalnızca tool facade; DB’ye doğrudan yazmaz.

### İleride ayrılabilirlik

Modül klasörleri + net public service interface’leri. Event bus yok; sync function call. İleride HTTP/module extract için interface yeterli.

---

## 3. Entity Listesi

### 3.1 Platform / Auth

| Entity | Fiziksel silme | Not |
|--------|----------------|-----|
| Tenant | Soft/status | `ACTIVE/SUSPENDED` |
| User | Soft/disable | tenant üyesi |
| UserRole | Evet (unlink) | tenant/site scoped |
| RefreshToken / Session | Evet (rotate) | |
| IdempotencyKey | TTL purge | |
| AuditLog | Hayır | append-only |
| JobRun | Purge policy | |

### 3.2 Organizasyon

| Entity | Not |
|--------|-----|
| Site | |
| Block | `tenant_id` denormalize |
| Unit | |
| Person | |
| UnitOwnership | tarih aralıklı |
| UnitOccupancy | `OWNER_OCCUPIED`, `TENANT`, `OTHER` |

### 3.3 Billing

| Entity | Not |
|--------|-----|
| ChargeType | |
| ChargeBatch | preview → commit |
| Charge | OPEN/PARTIAL/PAID/CANCELLED |
| SiteFinanceConfig | gecikme ayarları |

### 3.4 Payments

| Entity | Not |
|--------|-----|
| Payment | CASH/BANK_TRANSFER/CREDIT_CARD; status POSTED/REVERSED/… |
| PaymentAllocation | payment↔charge M:N |
| Receipt | site-year sequence |
| ReceiptSequence | sayaç |
| PaymentReversal | karşıt kayıt metadata (opsiyonel ayrı tablo veya payment ilişkisi) |

### 3.5 Banking

| Entity | Not |
|--------|-----|
| BankAccount | |
| BankImportBatch | file_hash unique |
| BankTransaction | fingerprint unique; ≠ Payment |
| BankSenderMapping | IBAN→unit hafıza |
| BulkCollectionBatch | opsiyonel izleme |
| BulkCollectionItem | satır sonucu |

### 3.6 Cash / Expense

| Entity | Not |
|--------|-----|
| CashAccount | |
| CashTransaction | ref polymorphic |
| Supplier | minimal |
| Expense | CANCELLED/VOID status |
| ExpenseCategory | basit lookup |

### 3.7 Personnel / Ops / Fuel / Comms

| Entity | Not |
|--------|-----|
| Employee | person FK |
| LeaveRequest | |
| AttendanceRecord | günlük |
| WorkTask | görev |
| Ticket | talep/şikâyet |
| TicketAttachment | dosya |
| TicketComment | |
| FuelTank | |
| FuelPurchase | |
| FuelConsumption | |
| Announcement | |
| AnnouncementAudience | opsiyonel |

### 3.8 AI (geç)

| Entity | Not |
|--------|-----|
| AiInvocationLog | masked |

---

## 4. Entity İlişkileri (ER özeti)

```text
Tenant 1──* Site 1──* Block 1──* Unit
Tenant 1──* Person
Unit 1──* UnitOwnership *──1 Person
Unit 1──* UnitOccupancy *──1 Person

Tenant 1──* User *──* Role (via UserRole, optional Site)

Site 1──* ChargeBatch 1──* Charge *──1 Unit
ChargeType 1──* Charge
ChargeType 1──* ChargeBatch

Unit 1──* Payment 1──* PaymentAllocation *──1 Charge
Payment 1──0..1 Receipt
Payment 0..1──0..1 BankTransaction   (karşılıklı unique FK)

Site 1──* BankAccount 1──* BankImportBatch 1──* BankTransaction
BankAccount 1──* BankTransaction
Unit 0..*──0..* BankSenderMapping (via sender_iban)

Site 1──* CashAccount 1──* CashTransaction
Site 1──* Expense *──0..1 Supplier
Site 1──* Employee *──1 Person
Employee 1──* LeaveRequest
Employee 1──* AttendanceRecord
Site 1──* Ticket / Announcement / FuelTank …
```

### Kritik kardinaliteler

- 1 `BankTransaction` → en fazla 1 `Payment`
- 1 `Payment` → 0..1 `BankTransaction` (nakitte 0)
- 1 `Payment` → 1..N `PaymentAllocation`
- 1 `Charge` → 0..N `PaymentAllocation`
- 1 `Payment` → 0..1 `Receipt` (REVERSED sonrası receipt VOID)

---

## 5. Finansal Transaction Modeli (Doğrulama)

### 5.1 Invariant’lar

```text
I1  charge.open_amount ∈ [0, charge.amount]
I2  sum(allocations where payment POSTED) = charge.amount - charge.open_amount
I3  sum(payment_allocation.amount) = payment.amount   (POSTED payment)
I4  financial rows: no hard DELETE
I5  bank_transaction matched_payment_id unique; payment.bank_transaction_id unique
I6  tenant_id always from auth context
I7  amount scales: numeric(18,2); app decimal safe
```

### 5.2 Tahakkuk (ChargeBatch commit)

```text
BEGIN
  validate preview hash / inputs
  insert charge_batch (status=POSTED)
  insert charges (open_amount=amount, status=OPEN)
  audit
COMMIT
```

Preview ayrı, side-effect yok (veya geçici draft batch — tercih: **stateless preview**).

### 5.3 Tahsilat (tekli / bankadan)

```text
BEGIN
  lock bank_transaction FOR UPDATE (varsa)
  assert unmatched / not already matched
  lock target charges FOR UPDATE (oldest-first order)
  insert payment (POSTED)
  insert allocations
  update charges open_amount/status
  insert receipt (+ sequence lock)
  if bank: set MATCHED + matched_payment_id
  if CASH: insert cash_transaction
  upsert bank_sender_mapping (iban biliniyorsa)
  audit
COMMIT
```

### 5.4 Tahsilat iptali (REVERSED)

```text
BEGIN
  lock payment + allocations + charges + bank_tx
  payment.status = REVERSED
  reverse open_amount on charges (recompute status)
  receipt.status = VOID
  if bank_tx: match_status back to previous or UNMATCHED; clear matched_payment_id
    (tercih netleştirme: K-003)
  optional reversing ledger rows
  audit
COMMIT
```

### 5.5 Tutarlılık denklemi (rapor)

```text
sum(charge.amount where not CANCELLED)
- sum(allocation.amount where payment POSTED)
= sum(charge.open_amount where not CANCELLED)
```

---

## 6. Bank Reconciliation State Machine

### 6.1 Import batch status

```text
UPLOADED → PARSING → PARSED → IMPORTING → COMPLETED
                              ↘ FAILED
DUPLICATE_FILE (terminal, aynı file_hash)
```

### 6.2 BankTransaction.match_status

```text
                 ┌──────────────┐
                 │  UNMATCHED   │◄──────────────┐
                 └──────┬───────┘               │
                        │ score engine          │ unmatch / reverse
                        ▼                       │
                 ┌──────────────┐               │
                 │  SUGGESTED   │               │
                 │ (incl. AUTO) │               │
                 └──────┬───────┘               │
                        │ low score path        │
                        ▼                       │
                 ┌─────────────────┐            │
                 │ REVIEW_REQUIRED │────────────┤
                 └────────┬────────┘            │
          collect│        │ ignore              │
                 ▼        ▼                     │
          ┌──────────┐  ┌─────────┐             │
          │ MATCHED  │  │ IGNORED │─────────────┘
          └──────────┘  └─────────┘
```

**Kurallar:**

- OUT direction: scoring’e girmez; default `UNMATCHED` veya ayrı `IGNORED` önerisi yok — UI’da tahsilat disabled.
- `AUTO_CONFIDENT` score band’i `SUGGESTED` status altında filtrelenir; **otomatik payment YOK**.
- `MATCHED` yalnızca başarılı Payment commit sonrası.
- Aynı fingerprint insert → DB unique violation → skip.

### 6.3 Bulk collect item status

```text
PENDING → SUCCESS
       → FAILED (reason code)
       → SKIPPED (already matched / duplicate key / out direction / no unit)
```

### 6.4 Duplicate savunma katmanları

1. `unique(tenant_id, bank_account_id, file_hash)` — dosya
2. `unique(bank_account_id, fingerprint)` — hareket
3. `unique(payment.bank_transaction_id)` + `unique(bank_transaction.matched_payment_id)`
4. `Idempotency-Key` store
5. Row-level `SELECT FOR UPDATE` on bank_transaction

---

## 7. Yetki Modeli (RBAC)

### 7.1 Roller

| Rol | Kapsam | Özet |
|-----|--------|------|
| SUPER_ADMIN | platform | tüm tenant’lar |
| TENANT_ADMIN | tenant | site/user/ayar |
| SITE_MANAGER | site | operasyon + finans günlük |
| ACCOUNTANT | site | tahakkuk, tahsilat, banka, gider, rapor |
| BOARD_MEMBER | site | okuma ağırlıklı + duyuru |
| AUDITOR | site/tenant | salt okunur + audit |
| EMPLOYEE | site | görev/izin/kendi puantaj |
| OWNER | unit(s) | kendi borcu, talep, duyuru |
| RENTER (`TENANT` rolü) | unit | kendi borç/talep |

### 7.2 Permission örnekleri (kod map)

```text
tenant:read|write
site:read|write
unit:read|write
person:read|write
charge:preview|create|cancel
payment:preview|create|reverse
banking:import|reconcile|collect
expense:write
cash:write
report:finance
employee:manage
leave:approve
ticket:manage
announcement:write
audit:read
ai:use
```

### 7.3 Zorunlu kurallar

- Client `tenant_id` ignore.
- Site-scoped rollerde cross-site IDOR engeli.
- OWNER/RENTER yalnızca kendi `unit_id` seti.
- HIGH_RISK (toplu tahsilat, ters kayıt): `ACCOUNTANT` + `SITE_MANAGER` / `TENANT_ADMIN`.

---

## 8. API Endpoint Listesi (v1)

Prefix: `/api/v1`

### Auth
```text
POST   /auth/login
POST   /auth/refresh
POST   /auth/logout
GET    /auth/me
```

### Tenants / Users
```text
GET|POST       /tenants
GET|PATCH      /tenants/:id
GET|POST       /users
PATCH          /users/:id
PUT            /users/:id/roles
```

### Sites / Blocks / Units / Residents
```text
GET|POST       /sites
GET|PATCH      /sites/:id
GET|POST       /sites/:siteId/blocks
GET|POST       /sites/:siteId/units
GET|PATCH      /units/:id
POST           /units/import                  # optional CSV
GET|POST       /persons
GET|PATCH      /persons/:id
POST           /units/:id/ownerships
POST           /units/:id/occupancies
GET            /units/:id/ledger              # cari
```

### Billing
```text
GET|POST       /charge-types
POST           /billing/charge-batches/preview
POST           /billing/charge-batches
GET            /billing/charge-batches
GET            /billing/charge-batches/:id
POST           /billing/charge-batches/:id/cancel
GET            /charges
GET            /charges/:id
GET            /units/:id/open-charges
```

### Payments
```text
POST           /payments/preview
POST           /payments                      # Idempotency-Key
GET            /payments
GET            /payments/:id
POST           /payments/:id/reverse          # Idempotency-Key
GET            /receipts/:id
GET            /receipts/:id/pdf              # later
```

### Banking
```text
GET|POST       /bank-accounts
GET|PATCH      /bank-accounts/:id
POST           /banking/import/preview
POST           /banking/import                # multipart
GET            /banking/imports
GET            /banking/imports/:id
GET            /banking/transactions
GET            /banking/transactions/:id
POST           /banking/reconcile             # run/re-run scoring
POST           /banking/transactions/:id/suggest
POST           /banking/transactions/:id/ignore
POST           /banking/transactions/:id/match-preview
POST           /banking/transactions/:id/collect   # Idempotency-Key
POST           /banking/bulk-collect/preview
POST           /banking/bulk-collect          # Idempotency-Key
GET|POST       /banking/sender-mappings
```

### Expenses / Cash
```text
GET|POST       /suppliers
GET|POST       /expenses
POST           /expenses/:id/cancel
GET|POST       /cash-accounts
GET|POST       /cash-transactions
```

### Reports
```text
GET            /reports/dashboard
GET            /reports/debt-aging
GET            /reports/collection-rate
GET            /reports/income-expense
GET            /reports/bank
GET            /reports/unit-statement/:unitId
```

### Personnel / Ops / Fuel / Comms
```text
GET|POST       /employees
GET|POST       /leave-requests
POST           /leave-requests/:id/approve|reject
GET|POST       /attendance
GET|POST       /tasks
GET|POST       /tickets
PATCH          /tickets/:id
POST           /tickets/:id/comments
GET|POST       /fuel/tanks
POST           /fuel/purchases
POST           /fuel/consumptions
GET            /fuel/tanks/:id/forecast
GET|POST       /announcements
```

### System
```text
GET            /health
GET            /health/ready
GET            /audit-logs
```

---

## 9. Frontend Route Ağacı

```text
/login
/dashboard

/finance
  /finance/charges
  /finance/charges/new          # wizard
  /finance/charges/:batchId
  /finance/payments
  /finance/payments/:id
  /finance/expenses
  /finance/bank                 # reconciliation hub (kritik)
  /finance/bank/imports/:id
  /finance/cash
  /finance/reports
  /finance/reports/aging
  /finance/reports/unit/:unitId

/management
  /management/sites
  /management/units
  /management/units/:id
  /management/residents
  /management/employees
  /management/employees/:id

/operations
  /operations/tickets
  /operations/tickets/:id
  /operations/tasks
  /operations/fuel

/communication
  /communication/announcements

/settings
  /settings/general
  /settings/users
  /settings/bank-accounts
  /settings/charge-types
  /settings/finance             # late fee config
  /settings/audit

/portal                         # OWNER/RENTER (MVP light)
  /portal/balance
  /portal/tickets
  /portal/announcements
```

**Banka UX hedefi (≤3 adım):**  
`/finance/bank` → Upload → Select matches → Bulk preview/confirm.

---

## 10. Migration Sırası

Sıra FK bağımlılıklarına göre. Her adım ayrı Drizzle migration dosyası (veya sprint bazlı grup; ilk kurulumda numaralı):

| # | Migration | İçerik |
|---|-----------|--------|
| 001 | `tenants` | tenant |
| 002 | `users_auth` | user, refresh_token, user_role |
| 003 | `sites_org` | site, block, unit |
| 004 | `persons` | person, unit_ownership, unit_occupancy |
| 005 | `audit_idempotency` | audit_log, idempotency_key, job_run |
| 006 | `billing` | charge_type, site_finance_config, charge_batch, charge + indexes |
| 007 | `cash` | cash_account, cash_transaction |
| 008 | `banking_accounts` | bank_account |
| 009 | `payments` | payment, payment_allocation, receipt_sequence, receipt + uniques |
| 010 | `banking_import` | bank_import_batch, bank_transaction, bank_sender_mapping + fingerprint unique |
| 011 | `banking_bulk` | bulk_collection_batch, bulk_collection_item |
| 012 | `expenses` | supplier, expense_category, expense |
| 013 | `personnel` | employee, leave_request, attendance_record |
| 014 | `operations` | work_task, ticket, ticket_comment, ticket_attachment |
| 015 | `fuel` | fuel_tank, fuel_purchase, fuel_consumption |
| 016 | `communications` | announcement |
| 017 | `ai_optional` | ai_invocation_log (Sprint 11) |

**Not:** `payment.bank_transaction_id` FK için `bank_transaction` önce veya nullable FK sonradan `ALTER` — yukarıda payments (009) banking_import (010)’dan önce geldiği için: `payment.bank_transaction_id` önce constraintsız kolon, 010 sonunda FK + unique eklenir **veya** 009/010 birleştirilir. **Tercih:** 008 bank_account → 009 bank_import/tx → 010 payments (bank FK ile). Revize sıra:

| # | Revize | İçerik |
|---|--------|--------|
| 008 | banking base | bank_account |
| 009 | banking tx | import_batch, bank_transaction, sender_mapping |
| 010 | payments | payment (+ bank_tx FK), allocation, receipt |

Cash, billing indexes migration içinde veya hemen sonra.

---

## 11. Scoring Engine (özet)

Deterministik toplam skor (cap 100):

| Sinyal | Puan |
|--------|------|
| IBAN → sender_mapping / geçmiş ödeme | +50 |
| Açıklamada blok+daire | +40 |
| Açık borç tutarı tam eşleşme | +30 |
| Ad-soyad normalize eşleşme | +20 |
| Önceki ödeme geçmişi (unit) | +20 |

Eşikler: `>=90 AUTO_CONFIDENT`, `70–89 SUGGESTED`, `<70 REVIEW_REQUIRED`.

Türkçe normalizasyon + gürültü token temizliği zorunlu.

---

## 12. Kritik Sorular (kodlamadan önce yanıt gerekli)

Finansal sonucu değiştirir; Aşama 3’ten önce netleştirilmeli:

### K-001 — Fazla ödeme (overpayment)

Ödeme tutarı açık borç toplamını aşıyorsa MVP’de ne olsun?

- **A)** İşlemi reddet (kullanıcı tutarı/borç seçimini düzeltsin)
- **B)** Zorunlu kullanıcı seçimi: kalanı avans olarak tut (mini advance ledger)
- **C)** Kalanı “sonraki tahakkuka mahsup” notu ile park et

Geçici varsayım: **A** (+ manuel tam dağıtım). Bkz. A-026.

### K-002 — Gecikme faizi

MVP’de otomatik gecikme tahakkuku var mı, yoksa yalnızca config + manuel ek tahakkuk mu?

Geçici varsayım: **config var, otomatik kapalı**.

### K-003 — Tahsilat reverse sonrası banka durumu

Payment REVERSED olunca `BankTransaction`:

- **A)** `UNMATCHED` (yeniden tahsil edilebilir)
- **B)** `REVIEW_REQUIRED` (otomatik yeniden collect engelli)
- **C)** `IGNORED` ve yeni manuel akış

Geçici varsayım: **A** + audit trail (aynı bank_tx yeniden collect’e açık).

### K-004 — Charge iptali (kısmi tahsilat sonrası)

`PARTIAL` charge iptal edilirse:

- **A)** İptal engellenir; önce reverse payment
- **B)** Kalan `open_amount` cancel; ödenmiş kısım allocation’da kalır (charge status `CANCELLED` ama paid history durur)

Geçici varsayım: **A** (güvenli).

---

## 13. Riskler

1. Banka CSV çeşitliliği → generic parser + mapping UI ihtiyacı.
2. Fingerprint collision (eksik bank_reference) → false duplicate.
3. İsim benzerliği yanlış AUTO_CONFIDENT → UI’da onay zorunluluğu kritik.
4. 1000 hareket / 2GB RAM → stream parse, batch insert, index.
5. Tenant isolation bug → her repository’de zorunlu filter + integration test.
6. Receipt sequence concurrency → `FOR UPDATE`.

---

## 14. Aşama 1 Çıktı Kontrol Listesi

- [x] Eksik/çelişki tespiti
- [x] Modül sınırları
- [x] Entity listesi
- [x] İlişkiler
- [x] Finansal transaction modeli
- [x] Bank reconciliation state machine
- [x] Yetki modeli
- [x] API endpoint listesi
- [x] Frontend route ağacı
- [x] Migration sırası
- [x] Assumptions dosyası
- [x] Kritik sorular

**Sonraki:** `IMPLEMENTATION-PLAN.md` (Aşama 2). Kod yok.
