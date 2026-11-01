# FINANCE & BILLING

## 1. Tahakkuk

Tahakkuk üretmeden önce preview zorunlu.

Input:

```text
site
period
charge type
due date
distribution method
amount
target units
```

Dağıtım:

```text
EQUAL_PER_UNIT
FIXED_PER_UNIT
BY_GROSS_M2
BY_NET_M2
BY_LAND_SHARE
CUSTOM
```

## 2. Charge Batch

Toplu işlem başlığı.

Örnek:

```text
Eylül 2026 Ek Ödeme
33 daire
Daire başına 4.000 TL
Toplam 132.000 TL
```

## 3. Tahsilat

Bir tahsilat:

- tek borcu kapatabilir
- birden fazla borca dağılabilir
- bir borcu kısmen kapatabilir

## 4. Allocation Stratejileri

### OLDEST_FIRST

En eski açık borçtan başla.

### USER_SELECTED

Kullanıcı seçer.

### CHARGE_TYPE_PRIORITY

Örnek:

```text
Gecikme
Aidat
Yakıt
Ek ödeme
```

## 5. Kısmi Ödeme

Borç:

```text
4.000
```

Ödeme:

```text
1.500
```

Sonuç:

```text
paid_amount = 1.500
open_amount = 2.500
status = PARTIAL
```

## 6. Fazla Ödeme

İlk sürüm önerisi:

Fazla tutarı otomatik "emanet bakiye"ye atmak yerine kullanıcıya seçenek sun:

```text
- sonraki borca dağıt
- avans bakiye oluştur
- işlemi iptal et
```

### advance_balance

İleri fazda ayrı ledger hesabı önerilir.

## 7. Gecikme

Her site için config:

```text
enabled
monthly_rate
grace_days
calculation_method
```

## 8. İptal

Tahsilat silinmez.

```text
payment.status = REVERSED
```

Karşıt finansal kayıt oluşturulur.

## 9. Makbuz

Makbuz numarası site bazlı sequence.

Örnek:

```text
2026-00001245
```

## 10. Raporlar

- Tahakkuk toplamı
- Tahsilat toplamı
- Açık borç
- Vadesi geçmiş
- Tahsilat oranı
- Borç yaşlandırma
- Daire cari ekstresi

## 11. Borç Yaşlandırma

```text
0-30
31-60
61-90
91-180
180+
```

## 12. Finansal Tutarlılık

Her rapor aşağıdaki eşitliği bozmayacak:

```text
Tahakkuk
- İptal edilen tahakkuk
- Tahsilat allocation
= Açık borç
```
