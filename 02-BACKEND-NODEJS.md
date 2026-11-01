# BACKEND — Node.js + TypeScript + Fastify

## 1. Teknoloji

```text
Node.js
TypeScript
Fastify
Drizzle ORM
PostgreSQL
Zod
Pino
JWT
Vitest
```

## 2. Neden Fastify

- Hafif
- Düşük memory footprint
- Yüksek throughput
- Schema tabanlı validation
- Plugin mimarisi
- Küçük VPS için uygun

## 3. Klasör Yapısı

```text
src/
├── app.ts
├── server.ts
├── config/
├── db/
│   ├── schema/
│   ├── migrations/
│   └── client.ts
├── modules/
│   ├── auth/
│   ├── tenants/
│   ├── sites/
│   ├── units/
│   ├── residents/
│   ├── billing/
│   ├── payments/
│   ├── banking/
│   ├── expenses/
│   ├── personnel/
│   ├── fuel/
│   ├── notifications/
│   └── reports/
├── shared/
│   ├── errors/
│   ├── auth/
│   ├── audit/
│   ├── pagination/
│   └── utils/
└── jobs/
```

## 4. Modül Yapısı

Örnek `banking`:

```text
banking/
├── banking.routes.ts
├── banking.service.ts
├── banking.repository.ts
├── banking.schemas.ts
├── reconciliation.service.ts
├── parsers/
│   ├── generic-csv.parser.ts
│   ├── generic-xlsx.parser.ts
│   └── bank-specific/
└── banking.types.ts
```

## 5. Katmanlar

Aşırı katmanlaşma yapılmamalı.

Yeterli yapı:

```text
Route
Service
Repository
DB
```

Domain kuralları Service içinde veya ayrı domain service'te tutulabilir.

## 6. API

Prefix:

```text
/api/v1
```

Örnek:

```text
POST /auth/login

GET  /sites
GET  /units

POST /billing/charge-batches/preview
POST /billing/charge-batches

POST /payments
POST /payments/preview

POST /banking/import
GET  /banking/transactions
POST /banking/reconcile
POST /banking/transactions/:id/match
POST /banking/bulk-collect

GET  /reports/dashboard
GET  /reports/debt-aging
```

## 7. Validation

Zod.

Örnek:

```ts
const CreatePaymentSchema = z.object({
  unitId: z.number().int().positive(),
  amount: z.string(),
  paymentDate: z.coerce.date(),
  paymentMethod: z.enum([
    "CASH",
    "BANK_TRANSFER",
    "CREDIT_CARD"
  ])
})
```

## 8. Transaction

Drizzle transaction kullanılmalı.

```ts
await db.transaction(async (tx) => {
  // payment
  // allocation
  // charge update
  // receipt
  // bank match
  // audit
})
```

## 9. Error Response

Standart format:

```json
{
  "code": "BANK_TRANSACTION_ALREADY_MATCHED",
  "message": "Banka hareketi daha önce tahsilata bağlanmış.",
  "details": {}
}
```

## 10. Tenant Isolation

Her repository çağrısında:

```text
tenant_id
```

filtrelenmeli.

Client'tan gelen tenant id'ye güvenilmemeli.

JWT içindeki tenant/site scope kullanılmalı.

## 11. Background Job

İlk sürümde harici queue yok.

Basit işler:

- gecikme hesaplama
- bildirim
- otomatik eşleştirme tekrar deneme
- günlük özet

için:

```text
PostgreSQL job table + setInterval/cron process
```

veya `pg-boss` değerlendirilebilir.

Ayrı Redis/RabbitMQ zorunlu değildir.

## 12. Logging

Pino.

Log:

```text
request_id
tenant_id
site_id
user_id
route
duration
status
```

## 13. Test

- Vitest
- Testcontainers PostgreSQL
- Supertest yerine Fastify inject

Kritik testler:

- duplicate banka hareketi
- aynı banka transaction'a ikinci payment bağlanamaması
- kısmi tahsilat
- oldest-first dağıtım
- toplu tahsilat rollback
