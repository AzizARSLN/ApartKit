# IMPLEMENTATION ROADMAP

## Sprint 0 — İskelet

- Monorepo
- backend
- frontend
- PostgreSQL
- Docker Compose
- migration
- auth base
- logging
- health

## Sprint 1 — Organizasyon

- tenant
- site
- block
- unit
- person
- ownership
- occupancy

## Sprint 2 — Tahakkuk

- charge type
- charge batch
- charge preview
- charge create
- unit balance

## Sprint 3 — Tahsilat

- payment
- payment allocation
- receipt
- partial payment
- oldest-first

## Sprint 4 — Banka Import

- bank account
- import batch
- CSV parser
- XLSX parser
- normalization
- duplicate fingerprint

## Sprint 5 — Banka Eşleştirme

- deterministic scoring
- sender mapping
- suggested unit
- review screen
- manual match

## Sprint 6 — Toplu Tahsilat

- bulk preview
- idempotency
- one-transaction-per-row
- receipt generation
- audit

## Sprint 7 — Finans

- expense
- cash
- supplier
- reports
- dashboard

## Sprint 8 — Personel

- employee
- leave
- attendance

## Sprint 9 — Operasyon

- announcement
- ticket
- task
- fuel

## Sprint 10 — Rapor

- debt aging
- collection rate
- income-expense
- bank report
- unit statement

## Sprint 11 — AI

- read tools
- finance summary
- bank ambiguous suggestion
- approval model

## MVP Çıkış Kriteri

Aşağıdaki senaryo sorunsuz çalışmalı:

```text
33 daire import
→ Eylül aidat tahakkuku
→ banka XLSX upload
→ 41 hareket eşleştirme
→ 37 kesin + 4 review
→ bulk collect
→ borç bakiyeleri güncel
→ makbuzlar oluşmuş
→ duplicate dosya tekrar yüklendiğinde çift tahsilat yok
```
