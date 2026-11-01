# SITE YÖNETİM SaaS — PRODUCT MASTER

## 1. Amaç

Düşük kaynak tüketen, hızlı geliştirilebilen, modern ve modüler bir site/apartman yönetim platformu geliştirmek.

Ana kullanım alanları:

- Aidat tahakkuku
- Ek borçlandırma
- Tahsilat
- Banka hareketlerinden otomatik/yarı otomatik ödeme eşleştirme
- Gelir-gider
- Kasa-banka
- Mali raporlar
- Personel izin ve puantaj
- Yakıt/enerji takibi
- Duyuru
- Talep/şikâyet
- Tedarikçi/cari
- Doküman yönetimi
- Yönetim kararları
- Audit log

## 2. Tasarım Prensipleri

1. Düşük kaynak tüketimi.
2. Tek deploy edilebilir backend.
3. Tek PostgreSQL veritabanı.
4. Mikroservis yok.
5. Kafka/RabbitMQ yok.
6. Redis ilk sürümde yok.
7. Finansal işlemler transaction içinde.
8. Finans kayıtları fiziksel silinmez.
9. Toplu işlemlerde preview zorunlu.
10. Banka hareketi tekrar yüklenirse çift tahsilat oluşmamalı.
11. AI yalnızca yardımcı katman olmalı; finansal mutasyon kullanıcı onayı olmadan yapılmamalı.
12. Tüm kritik işlemler audit log altında olmalı.

## 3. Önerilen Teknoloji

### Backend
- Node.js
- TypeScript
- Fastify
- Zod
- Drizzle ORM
- PostgreSQL
- Pino logging

### Frontend
- React
- TypeScript
- Vite
- TanStack Query
- React Hook Form
- Zod
- Tailwind CSS
- shadcn/ui

### Deployment
- Docker Compose
- PostgreSQL
- Node API
- Nginx + React build

## 4. MVP Modülleri

- Auth
- Tenant
- Site
- Blok
- Bağımsız bölüm
- Malik/Kiracı
- Aidat
- Tahakkuk
- Tahsilat
- Banka hareketi import
- Banka eşleştirme
- Gelir/Gider
- Kasa
- Banka
- Personel
- İzin
- Duyuru
- Talep
- Dashboard
- Mali rapor
- Audit

## 5. Ana Kullanıcı Rolleri

- SUPER_ADMIN
- TENANT_ADMIN
- SITE_MANAGER
- ACCOUNTANT
- BOARD_MEMBER
- AUDITOR
- EMPLOYEE
- OWNER
- TENANT

## 6. Ana İş Akışı

### Aylık Aidat

```text
Dönem oluştur
→ borçlandırılacak daireleri seç
→ dağıtım yöntemini seç
→ preview
→ onay
→ tahakkuk kayıtları oluşur
```

### Banka Tahsilatı

```text
Banka CSV/XLSX yükle
→ hareketleri normalize et
→ duplicate kontrol
→ eşleştirme motoru çalıştır
→ kesin eşleşenleri ayır
→ belirsizleri inceleme listesine al
→ toplu/tekli tahsilat önizle
→ kullanıcı onayı
→ Payment + Allocation + Receipt
→ BankTransaction = MATCHED
```

## 7. Ürün Farklılaştırıcıları

- Banka hareketlerinden toplu tahsilat
- Güvenilir duplicate engelleme
- Borç yaşlandırma
- Yakıt stok/tüketim tahmini
- Gider trend analizi
- Bütçe sapması
- Audit trail
- Hafif deployment
- Profesyonel yönetim firması multi-site modu
- AI asistanı fakat kontrollü finansal işlem modeli

## 8. Kaynak Hedefi

Önerilen minimum sunucu:

```text
2 vCPU
2–4 GB RAM
30–50 GB SSD
Ubuntu Server
Docker Compose
```

## 9. Ana Başarı Kriterleri

- 1000+ bağımsız bölümde rahat kullanım
- Banka dosyası yükleme ve 1000 hareket eşleştirme makul sürede
- Aynı banka dosyasının tekrar yüklenmesi çift tahsilat oluşturmamalı
- Aylık aidat üretimi tek işlemle yapılabilmeli
- Yönetici 30 saniyede finansal durumu görebilmeli
