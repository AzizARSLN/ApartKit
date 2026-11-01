# FRONTEND — React + TypeScript

## 1. Stack

```text
React
TypeScript
Vite
TanStack Query
React Hook Form
Zod
Tailwind CSS
shadcn/ui
```

## 2. Ana Route'lar

```text
/dashboard

/finance/charges
/finance/payments
/finance/expenses
/finance/bank
/finance/cash
/finance/reports

/management/units
/management/residents
/management/employees

/operations/tickets
/operations/fuel

/communication/announcements

/settings
```

## 3. Dashboard

Kartlar:

```text
Bu Ay Tahakkuk
Bu Ay Tahsilat
Tahsilat Oranı
Açık Borç
Vadesi Geçmiş
Banka Bakiye
Kasa Bakiye
Bu Ay Gider
```

## 4. Banka Mutabakat Ekranı

Özel önem.

Header:

```text
[Banka Hesabı] [Tarih] [Dosya Yükle]
```

Özet:

```text
Toplam hareket
Eşleşen
Kontrol gereken
Eşleşmeyen
Tahsil edilen
```

Data grid:

```text
checkbox
tarih
gönderen
açıklama
tutar
önerilen daire
score
açık borç
durum
```

Bulk action:

```text
Seçilen 41 hareket
[ Tahsilat Önizle ]
```

## 5. Tahsilat Önizleme Drawer/Modal

```text
A Blok / 12
Gelen: 4.000 TL

Açık Borçlar:
Eylül Aidat   2.500
Ek Ödeme      4.000

Dağıtım:
Eylül Aidat   2.500
Ek Ödeme      1.500
```

## 6. Aidat Tahakkuk Wizard

Adımlar:

```text
1. Dönem
2. Borç türü
3. Dağıtım
4. Daireler
5. Preview
6. Onay
```

## 7. UI İlkeleri

- Finansal tutarlar sağa hizalı
- İşlem butonları açık
- Sil butonu finansal kayıtta yok
- Toplu işlemde preview
- Empty state
- Loading skeleton
- Error state
- Mobile responsive

## 8. Table

Server-side pagination.

1000+ kayıt frontend'e tek seferde çekilmemeli.

## 9. Query

TanStack Query.

Mutation sonrası invalidation:

```text
payments
charges
dashboard
bank-transactions
```

## 10. Kritik Kullanılabilirlik

Yönetici:

```text
banka dosyası yükleme
→ eşleşenleri seçme
→ toplu tahsilat
```

işini mümkünse 3 ekrandan fazla dolaşmadan tamamlamalı.
