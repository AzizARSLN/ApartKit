# DEPLOYMENT — LOW RESOURCE

## 1. Hedef

```text
2 vCPU
2–4 GB RAM
Ubuntu
30–50 GB SSD
```

## 2. Container'lar

```text
postgres
api
nginx
```

Frontend statik build Nginx üzerinden servis edilir.

## 3. İlk Sürümde Olmayacaklar

```text
Redis
RabbitMQ
Kafka
Elasticsearch
Kubernetes
Prometheus stack
```

İhtiyaç oluşursa sonradan eklenir.

## 4. Docker Compose

Örnek:

```yaml
services:
  postgres:
    image: postgres:17-alpine

  api:
    build: ./backend
    depends_on:
      - postgres

  nginx:
    image: nginx:alpine
    depends_on:
      - api
```

## 5. PostgreSQL

Düşük kaynak için:

- düşük `max_connections`
- connection pool
- index disiplini
- ağır dashboard sorgularını optimize et
- N+1 yapma

## 6. Node

Production:

```text
NODE_ENV=production
```

Tek process ile başlanabilir.

2 vCPU varsa PM2 cluster şart değil.

## 7. Backup

Günlük:

```text
pg_dump
```

Haftalık harici kopya.

İleride:

```text
WAL / PITR
```

## 8. Dosya

İlk sürümde lokal volume olabilir.

Daha sonra:

```text
S3 / MinIO
```

## 9. TLS

Nginx + Let's Encrypt.

## 10. Monitoring

İlk sürüm:

```text
health endpoint
structured logs
disk usage alert
backup result
```

Ağır monitoring stack zorunlu değil.
