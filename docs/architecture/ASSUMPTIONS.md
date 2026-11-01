# ASSUMPTIONS — Teknik Varsayımlar

Bu dosya, specification dokümanlarında açıkça çözülmemiş konularda alınan **makul production-grade** kararları kaydeder.

Son güncelleme: 2026-09-07 (kullanıcı tam yetki verdi; K-001…K-004 kilitlendi)

---

## KARAR KİLİDİ — Kritik Finans Soruları (2026-09-07)

| ID | Karar | Anlamı |
|----|-------|--------|
| **K-001** | **A** | Fazla ödeme: işlem reddedilir; kullanıcı tutarı/borç seçimini düzeltir. Advance ledger yok (MVP). |
| **K-002** | Config var, otomatik kapalı | Gecikme faizi şeması/UI ayarı durur; otomatik LATE_FEE tahakkuku MVP’de çalışmaz. |
| **K-003** | **A** | Payment REVERSED → BankTransaction `UNMATCHED`, `matched_payment_id` temizlenir; yeniden tahsil edilebilir. |
| **K-004** | **A** | Kısmi ödenmiş charge iptal edilemez; önce ilgili payment’lar reverse edilmeli. |

A-025 ve A-026 bu kilitle uyumludur.

---

## A-001 — Kimlik tipi

**Varsayım:** Tüm primary key’ler `bigint generated always as identity`.

**Gerekçe:** `01-DATABASE.md` basitlik için bigint tercih ediyor. UUID’ye ihtiyaç (public share link vb.) çıkarsa ilgili tablolara `public_id uuid` eklenebilir.

---

## A-002 — Para birimi (MVP)

**Varsayım:** MVP tek para birimi: `TRY`. `currency_code` kolonları şemada tutulur, default `'TRY'`. Multi-currency conversion yok.

---

## A-003 — Decimal yaklaşımı (TypeScript)

**Varsayım:** API ve Zod şemalarında tutarlar **string** olarak taşınır (`"4000.00"`). Service katmanında cent/minor-unit tabanlı `Money` sınıfı kullanılır (`backend/src/shared/utils/money.ts`). DB’de `numeric(18,2)`.

**Gerekçe:** Float yasak; JSON number hassasiyet riski taşır. `decimal.js` ESM/TS uyumu yerine sabit 2 hane Money tercih edildi.

---

## A-004 — `paid_amount` türetilir

**Varsayım:** `charge` tablosunda ayrı `paid_amount` kolonu tutulmaz.

```text
paid_amount = amount - open_amount
```

Allocation toplamı ile `amount - open_amount` tutarlılığı transaction içinde invariant olarak doğrulanır.

---

## A-005 — Soft delete kapsamı

**Varsayım:** Soft delete (`deleted_at`) yalnızca şu yönetimsel varlıklarda:

- `user` (disable tercih edilebilir)
- `person` (nadiren)
- `employee`
- `announcement`
- `ticket` ekleri / dokümanlar

Finansal tablolarda soft delete yok; status tabanlı iptal kullanılır.

---

## A-006 — Site scope

**Varsayım:** JWT’de `tenantId` zorunlu, `siteId` opsiyonel aktif site bağlamı.

- Site-scoped kullanıcılar tek site ile sınırlıdır.
- `TENANT_ADMIN` / `SUPER_ADMIN` site listesinden aktif site seçer; header veya query ile `X-Site-Id` gönderilebilir.
- Repository filtreleri her zaman `tenant_id` + (varsa) `site_id` uygular.

---

## A-007 — Rol adı çakışması

**Varsayım:** SaaS organizasyonu `tenant` tablosudur. Kiracı rolü API/enum’da `RESIDENT_TENANT` (veya `RENTER`) olarak adlandırılır; ürün dilinde “Kiracı” kalır.

**Gerekçe:** `TENANT` hem org hem rol anlamında çakışıyor.

---

## A-008 — Auth modeli (MVP)

**Varsayım:**

- Email + password
- JWT access token (kısa ömür) + refresh token (httpOnly cookie veya DB-backed)
- Password hash: Argon2id
- İlk sürümde OAuth/SSO yok

---

## A-009 — RBAC saklama

**Varsayım:**

- `user`
- `role` (sistem sabit rolleri + ileride custom)
- `user_role` (tenant/site scoped)
- Permission’lar kod içinde role→permission map; DB permission tablosu MVP’de yok

---

## A-010 — Idempotency store

**Varsayım:** `idempotency_key` tablosu:

```text
id, tenant_id, user_id, key, method, path, request_hash, response_status, response_body, created_at, expires_at
```

Unique: `(tenant_id, key)` (veya `(tenant_id, user_id, key)`).

TTL: 24–72 saat. Kritik mutasyon endpoint’lerinde zorunlu veya önerilen header.

---

## A-011 — Banka skor → match_status eşlemesi

**Varsayım:**

| Score band        | Classification   | `match_status` (eşleşme sonrası, tahsilat öncesi) |
|-------------------|------------------|---------------------------------------------------|
| >= 90             | AUTO_CONFIDENT   | `SUGGESTED`                                       |
| 70–89             | SUGGESTED        | `SUGGESTED`                                       |
| < 70              | REVIEW_REQUIRED  | `REVIEW_REQUIRED`                                 |
| aday yok          | —                | `UNMATCHED`                                       |
| kullanıcı yoksaydı| —                | `IGNORED`                                         |
| tahsilat yapıldı  | —                | `MATCHED`                                         |

`AUTO_CONFIDENT` ayrı bir DB status değildir; UI filtresi / score band alanıdır (`match_classification` computed veya kolon).

---

## A-012 — BankTransaction ↔ Payment ilişki

**Varsayım:**

- `payment.bank_transaction_id` nullable, **unique** (bir banka hareketi en fazla bir payment)
- `bank_transaction.matched_payment_id` nullable, **unique**
- İki yönlü referans aynı transaction içinde set edilir; tutarlılık service invariant’ı ile korunur

Nakit/kart tahsilatta `bank_transaction_id = null`.

---

## A-013 — OUT hareketleri

**Varsayım:** `direction = OUT` tahsilat/bulk-collect motoruna girmez. MVP’de gider eşleştirme opsiyonel manuel; otomatik expense create yok.

---

## A-014 — Refund / iade

**Varsayım:** MVP’de iade otomatik işlenmez. OUT veya negatif hareketler `REVIEW_REQUIRED` / manuel inceleme kuyruğunda kalır.

---

## A-015 — Import duplicate davranışları

**Varsayım:**

1. Aynı `file_hash` + aynı `bank_account_id` → import reddedilir veya “already imported” döner (yeni satır yok).
2. Farklı dosya, aynı fingerprint satır → satır `SKIPPED_DUPLICATE` olarak işaretlenir; diğer yeni satırlar import edilir.
3. Duplicate satır asla yeni `bank_transaction` ve asla payment üretmez.

---

## A-016 — Toplu tahsilat hata modeli

**Varsayım:** Her banka hareketi **kendi DB transaction**’ında işlenir.

Satır sonuçları: `SUCCESS` | `FAILED` | `SKIPPED`.

Batch header kaydı (`bulk_collection_batch`) özet tutar; tek satır hatası diğerlerini rollback etmez.

---

## A-017 — Allocation default

**Varsayım:** Banka toplu tahsilatta default strateji `OLDEST_FIRST` (due_date, sonra id). Preview’da kullanıcı override edebilir (`USER_SELECTED`).

`CHARGE_TYPE_PRIORITY` MVP’de şema/config ile desteklenir; UI ikinci öncelik.

---

## A-018 — Makbuz numarası

**Varsayım:** `receipt_sequence` tablosu: `(tenant_id, site_id, year) → last_value`.

Format: `{YYYY}-{00000001}` site bazlı. Transaction içinde `SELECT … FOR UPDATE` ile üretilir.

---

## A-019 — Nakit tahsilat → kasa

**Varsayım:** `payment_method = CASH` ise aynı DB transaction içinde `cash_transaction` (IN) oluşturulur. Banka transferinde cash hareketi oluşmaz.

---

## A-020 — Dosya depolama

**Varsayım:** MVP local Docker volume (`./data/uploads`). Banka dosyası ve ticket ekleri burada. S3/MinIO sonraki faz.

---

## A-021 — Background jobs

**Varsayım:** MVP’de in-process scheduler (`setInterval` / `node-cron`) + `job_run` tablosu. `pg-boss` ilk sürümde yok; ihtiyaç kanıtlanırsa değerlendirilir.

---

## A-022 — Monorepo yapısı

**Varsayım:**

```text
/
  backend/
  frontend/
  docs/
  docker-compose.yml
```

pnpm/npm workspace opsiyonel; ilk iskelette ayrı `package.json` yeterli.

---

## A-023 — Supplier (cari)

**Varsayım:** MVP’de minimal `supplier` tablosu (tenant scoped). Expense ve fuel_purchase FK ile bağlanır. Tam cari hesap/ekstre Sprint 7+.

---

## A-024 — Announcement / Ticket / Attendance şeması

**Varsayım:** `06-PERSONNEL-OPERATIONS.md` alanlarından türetilmiş minimal tablolar Sprint 8–9’da eklenir. Detay `INITIAL-ANALYSIS.md` entity listesinde.

---

## A-025 — Gecikme faizi (geçici)

**Varsayım (kod öncesi onay bekliyor — bkz. Kritik Soru K-002):**

Geçici teknik varsayım: site config alanları şemada bulunur; **otomatik gecikme tahakkuku MVP’de kapalı** (`enabled=false` default). Açılırsa ayrı `charge_type=LATE_FEE` batch job ile üretilir.

---

## A-026 — Fazla ödeme (geçici)

**Varsayım (kod öncesi onay bekliyor — bkz. Kritik Soru K-001):**

Geçici teknik varsayım: fazla tutar için MVP’de **işlemi reddetme veya kullanıcıya zorunlu seçim**:

1. Belirli açık borçlara manuel dağıt (toplam = payment amount)
2. İşlemi iptal et

`advance_balance` ledger’ı Sprint 7 sonrası. Otomatik “sonraki borca bırak” yok.

---

## A-027 — AI

**Varsayım:** Sprint 11’e kadar AI kodu yok. Tool interface iskeleti boş bırakılabilir; finansal mutasyon path’ine AI bağlanmaz.

---

## A-028 — Test altyapısı

**Varsayım:** Vitest + Testcontainers PostgreSQL + Fastify `.inject()`. Frontend kritik akışlar için Playwright sonraki faz; birim/entegrasyon öncelikli.

---

## A-029 — Audit yazımı

**Varsayım:** Audit, aynı business transaction içinde (best-effort değil, zorunlu) yazılır. Audit insert fail → tüm işlem rollback.

---

## A-030 — Pagination

**Varsayım:** Cursor veya offset+limit; default limit 50, max 200. List endpoint’lerinde server-side sort/filter.
