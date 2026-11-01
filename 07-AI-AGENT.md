# AI AGENT DESIGN

## 1. Amaç

AI, sistemin ana çalışma motoru değildir.

AI:

- veri sorgulama
- özetleme
- öneri
- belge yorumlama
- belirsiz banka hareketi için aday üretme

işlerini yapar.

## 2. İşlem Seviyeleri

### READ

Otomatik.

Örnek:

```text
90 günü geçen borçluları getir.
```

### DRAFT

AI taslak üretir.

Örnek:

```text
33 daireye 4000 TL ek tahakkuk hazırla.
```

### WRITE

Kullanıcı onayı gerekir.

### HIGH_RISK_WRITE

İkinci onay veya özel permission.

## 3. Tool Mantığı

AI doğrudan DB erişmez.

Tool:

```text
getDebtAging
getUnitBalance
getExpensesSummary
previewChargeBatch
previewPayment
suggestBankMatch
```

Mutation tool:

```text
createChargeBatch
collectPayment
```

yalnızca kullanıcı onayından sonra çağrılabilir.

## 4. Banka AI

AI yalnızca:

```text
transaction → candidate unit
```

önerir.

Deterministic motor skoru önceliklidir.

## 5. Audit

Her AI çağrısında:

```text
prompt
tool
result
user
timestamp
```

kritik seviyede loglanabilir.

Kişisel veri loglarında masking uygulanmalı.
