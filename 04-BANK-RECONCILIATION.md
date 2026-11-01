# BANK RECONCILIATION — BANKA HAREKETLERİNDEN TAHSİLAT

## 1. Amaç

Yönetici bankadan ay sonunda veya istediği tarihte hareketleri indirir.

CSV/XLSX sisteme yüklenir.

Sistem:

1. Hareketleri içeri alır
2. Mükerrerleri engeller
3. Daire/sakin ile eşleştirir
4. Açık borçları bulur
5. Tahsilat önerir
6. Kullanıcıya önizleme sunar
7. Tekli veya toplu tahsilat yapar

## 2. Temel Kural

**Banka hareketi tek başına tahsilat değildir.**

Banka hareketi:

```text
raw financial input
```

Tahsilat:

```text
confirmed accounting action
```

olarak ayrı tutulmalıdır.

## 3. Import Akışı

```text
Dosya seç
→ banka hesabı seç
→ parser çalıştır
→ kolonları normalize et
→ preview
→ duplicate kontrol
→ import
```

## 4. Desteklenen Dosya Tipleri

MVP:

```text
CSV
XLSX
```

İleri faz:

```text
MT940
CAMT.053
Banka API
```

## 5. Normalize Model

Her bankadan gelen kolonlar şu modele çevrilir:

```text
transaction_date
value_date
amount
direction
sender_name
sender_iban
description
bank_reference
currency
```

## 6. Duplicate Önleme

### Seviye 1

Bankanın kendi transaction/reference id'si.

### Seviye 2

Fingerprint:

```text
SHA256(
 bankAccountId
 transactionDate
 valueDate
 amount
 direction
 senderIban
 bankReference
 normalizedDescription
)
```

DB unique constraint zorunlu.

## 7. Eşleştirme Motoru

AI olmadan deterministic scoring.

### Sinyaller

#### IBAN eşleşmesi

Daha önce bu IBAN'dan aynı daire için ödeme geldiyse:

```text
+50
```

#### Ad-soyad eşleşmesi

```text
+20
```

#### Açıklamada blok/daire

```text
"A BLOK 12"
"D12"
"DAIRE 12"
```

```text
+40
```

#### Açık borç toplamı ile tutar eşleşmesi

```text
+30
```

#### Önceki ödeme geçmişi

```text
+20
```

## 8. Score

Öneri:

```text
>= 90   AUTO_CONFIDENT
70-89   SUGGESTED
< 70    REVIEW_REQUIRED
```

Ancak AUTO_CONFIDENT bile ilk sürümde otomatik muhasebeleştirilmez.

Toplu listede kullanıcı onayı bekler.

## 9. Eşleştirme Örneği

Banka:

```text
Gönderen: AHMET YILMAZ
IBAN: TR...
Açıklama: A BLOK 12 EYLUL AIDAT
Tutar: 2500
```

Sistem:

```text
A Blok / Daire 12
Açık borç: Eylül Aidat 2500
Score: 100
```

## 10. Belirsiz Durum

```text
Gönderen: MEHMET YILMAZ
Açıklama: AIDAT
Tutar: 6500
```

Açık borç:

```text
Temmuz  2500
Ağustos 2500
Ek      4000
```

Öneri:

```text
Temmuz  2500
Ağustos 2500
Ek      1500
```

Kullanıcı onaylar.

## 11. Banka Eşleştirme Ekranı

Tablo kolonları:

```text
Tarih
Gönderen
Açıklama
Tutar
Önerilen Daire
Eşleşme Skoru
Açık Borç
Durum
```

Filtre:

```text
Kesin eşleşen
Kontrol gereken
Eşleşmeyen
Tahsil edilen
Yoksayılan
```

## 12. Toplu Tahsilat

Kullanıcı örneğin 41 satır seçer.

Buton:

```text
41 Tahsilatı İşle
```

Önizleme:

```text
Toplam banka hareketi: 41
Toplam tahsilat: 128.500 TL
Tam kapanacak borç: 37
Kısmi kapanacak borç: 4
```

Sonra onay.

## 13. Transaction Modeli

Her banka hareketi ayrı DB transaction içinde işlenebilir.

Daha iyi kullanım için bulk request:

```text
41 işlem
```

backend'te her item sonucu ayrıca dönülebilir.

Alternatif:

Tüm batch tek transaction.

Öneri:

**Her banka hareketini ayrı transaction** işle.

Neden:

Bir satır problemli diye diğer 40 tahsilat rollback olmasın.

## 14. Idempotency

Endpoint:

```text
POST /banking/bulk-collect
```

Header:

```text
Idempotency-Key
```

Aynı request tekrar gelirse tekrar tahsilat oluşmamalı.

Ayrıca:

```text
bank_transaction.matched_payment_id
```

unique ilişki ile korunmalı.

## 15. Tekli Tahsilat

Kullanıcı bir banka hareketine tıklar.

```text
Daire seç
→ açık borçlar
→ dağıtım seç
→ tahsil et
```

## 16. Manuel Eşleştirme Hafızası

Bir IBAN manuel olarak daireye bağlanırsa:

```text
bank_sender_mapping
```

oluştur.

```text
sender_iban
unit_id
confidence
last_used_at
```

Sonraki ay aynı IBAN:

```text
yüksek skor
```

## 17. İsim Normalizasyonu

Türkçe karakter ve banka açıklama gürültüsü normalize edilmeli.

```text
Ş → S
İ → I
Ç → C
Ğ → G
Ü → U
Ö → O
```

Ayrıca:

```text
A.S.
LTD STI
HAVALE
FAST
EFT
```

gibi anlamsız token'lar ayıklanabilir.

## 18. Regex Örnekleri

```text
A BLOK 12
A/12
A-12
DAIRE 12
D:12
```

parser oluşturulmalı.

## 19. Negatif/Çıkış Hareketleri

`direction = OUT`

olan hareketler tahsilat motoruna girmez.

Gider eşleştirmede kullanılabilir.

## 20. Refund / İade

Negatif hareket önceki payment ile ilişkilendirilebilir.

İlk sürümde manuel review önerilir.

## 21. Banka Parser Plugin

```text
BankStatementParser
```

interface:

```ts
interface BankStatementParser {
  canParse(file: Buffer, metadata: unknown): boolean
  parse(file: Buffer): Promise<NormalizedBankTransaction[]>
}
```

Bankaya özel parser:

```text
ziraat
vakifbank
isbank
garanti
akbank
yapikredi
```

sonradan eklenebilir.

## 22. AI Kullanımı

İlk sürümde şart değil.

İleri faz:

Belirsiz açıklama:

```text
"eylul site"
```

AI yalnızca aday önerebilir.

AI:

```text
payment create
```

yapamaz.

## 23. Test Senaryoları

1. Aynı dosya iki kez yüklenir.
2. Aynı hareket farklı dosyada gelir.
3. Aynı tutarda iki farklı kişi ödeme yapar.
4. İsim aynı, IBAN farklı.
5. Daire no açıklamada var.
6. Kısmi ödeme.
7. Fazla ödeme.
8. Daha önce eşleşmiş transaction tekrar tahsil edilmeye çalışılır.
9. Out transaction yanlışlıkla seçilir.
10. Toplu 500 tahsilat.
