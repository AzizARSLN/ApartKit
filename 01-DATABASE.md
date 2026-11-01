# DATABASE DESIGN — PostgreSQL

## 1. Genel Yaklaşım

Veritabanı: PostgreSQL.

Temel prensipler:

- Finansal tutarlar `numeric(18,2)`
- Zaman damgaları `timestamptz`
- ID için `uuid` veya `bigint`
- İlk sürümde basitlik için `bigint generated always as identity` tercih edilebilir
- Tenant izolasyonu zorunlu
- Finansal kayıtlar fiziksel silinmez
- Soft delete yalnızca yönetimsel varlıklarda kullanılır

## 2. Ortak Alanlar

```sql
id bigint generated always as identity primary key,
tenant_id bigint not null,
site_id bigint,
created_at timestamptz not null default now(),
created_by bigint,
updated_at timestamptz,
updated_by bigint
```

## 3. Temel Tablolar

### tenant

```text
id
name
status
```

### site

```text
id
tenant_id
name
code
address
```

### block

```text
id
site_id
name
code
```

### unit

```text
id
site_id
block_id
unit_no
floor_no
gross_m2
net_m2
land_share
status
```

### person

```text
id
tenant_id
first_name
last_name
identity_number
phone
email
```

### unit_ownership

```text
unit_id
person_id
start_date
end_date
share_rate
is_primary
```

### unit_occupancy

```text
unit_id
person_id
occupancy_type
start_date
end_date
```

## 4. Finans Tabloları

### charge_type

```text
id
tenant_id
code
name
category
```

### charge_batch

Toplu tahakkuk başlığı.

```text
id
tenant_id
site_id
period
charge_type_id
distribution_method
total_amount
due_date
status
description
```

### charge

Her daire için borç.

```text
id
tenant_id
site_id
unit_id
charge_batch_id
charge_type_id
period
amount
due_date
status
open_amount
```

Status:

```text
OPEN
PARTIAL
PAID
CANCELLED
```

### payment

```text
id
tenant_id
site_id
unit_id
payment_date
amount
payment_method
bank_transaction_id
description
status
```

### payment_allocation

```text
id
payment_id
charge_id
amount
```

Her payment birden fazla charge kaydına dağıtılabilir.

### receipt

```text
id
payment_id
receipt_no
issued_at
status
```

## 5. Banka Tabloları

### bank_account

```text
id
tenant_id
site_id
bank_name
iban
account_name
currency_code
```

### bank_import_batch

```text
id
tenant_id
site_id
bank_account_id
file_name
file_hash
imported_at
row_count
status
```

Unique:

```sql
unique (tenant_id, bank_account_id, file_hash)
```

### bank_transaction

```text
id
tenant_id
site_id
bank_account_id
import_batch_id
transaction_date
value_date
amount
direction
sender_name
sender_iban
description
bank_reference
raw_json
fingerprint
match_status
matched_unit_id
matched_payment_id
match_score
```

Unique:

```sql
unique (bank_account_id, fingerprint)
```

Match status:

```text
UNMATCHED
SUGGESTED
MATCHED
IGNORED
REVIEW_REQUIRED
```

## 6. Fingerprint

Bankadan benzersiz transaction id geliyorsa onu kullan.

Yoksa normalize edilmiş şu alanlardan hash üret:

```text
bank_account_id
transaction_date
value_date
amount
direction
bank_reference
sender_iban
normalized_description
```

Hash:

```text
SHA-256
```

Amaç: aynı banka hareketi tekrar içe aktarılsa bile duplicate oluşmaması.

## 7. Gider

### expense

```text
id
tenant_id
site_id
expense_date
category_id
supplier_id
amount
tax_amount
payment_status
bank_account_id
cash_account_id
invoice_number
description
status
```

## 8. Kasa

### cash_account

```text
id
tenant_id
site_id
name
currency_code
```

### cash_transaction

```text
id
cash_account_id
transaction_date
type
amount
reference_type
reference_id
description
```

## 9. Personel

### employee

```text
id
tenant_id
site_id
person_id
position
hire_date
leave_date
salary
iban
status
```

### leave_request

```text
id
employee_id
leave_type
start_date
end_date
day_count
reason
status
approved_by
```

## 10. Yakıt

### fuel_tank

```text
id
site_id
fuel_type
capacity
unit
minimum_stock
```

### fuel_purchase

```text
id
fuel_tank_id
supplier_id
purchase_date
quantity
unit_price
total_amount
```

### fuel_consumption

```text
id
fuel_tank_id
consumption_date
quantity
note
```

## 11. Audit

### audit_log

```text
id
tenant_id
site_id
user_id
action
entity_type
entity_id
old_data jsonb
new_data jsonb
ip_address
user_agent
created_at
```

## 12. Kritik Indexler

```sql
create index ix_charge_unit_status
on charge(unit_id, status);

create index ix_charge_due_date
on charge(site_id, due_date, status);

create index ix_payment_unit_date
on payment(unit_id, payment_date desc);

create index ix_bank_tx_match_status
on bank_transaction(site_id, match_status);

create index ix_bank_tx_sender_iban
on bank_transaction(sender_iban);

create index ix_bank_tx_amount_date
on bank_transaction(amount, transaction_date);
```

## 13. Finansal Transaction Kuralı

Tahsilat sırasında:

```text
BEGIN

payment insert
payment_allocation insert/update
charge open_amount update
charge status update
receipt insert
bank_transaction match update
audit insert

COMMIT
```

Hata halinde:

```text
ROLLBACK
```

## 14. Silme Politikası

Şunlar fiziksel silinmez:

- charge
- payment
- receipt
- expense
- bank_transaction
- cash_transaction

Yanlış kayıt için:

```text
CANCELLED
VOID
REVERSED
```

kullanılır.
