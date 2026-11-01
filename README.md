# Site Yönetim SaaS

Türkiye için apartman / site / rezidans yönetim platformu.

Modular monolith — Node.js (Fastify) + React (Vite) + PostgreSQL.

## Dokümantasyon

- Spec: kökteki `00`–`09`
- Mimari: `docs/architecture/`

## Hızlı başlangıç


```bash
cp .env.example .env
docker compose up -d postgres
cd backend && npm install && npm run db:migrate && npm run db:seed && npm run dev
cd frontend && npm install && npm run dev
```

veya tam stack:

```bash
docker compose up --build
```

API: `http://localhost:3000/api/v1/health`  
UI: `http://localhost:5173`

## Varsayılan giriş (seed)

- Email: `backend/.env` içindeki `ADMIN_EMAIL`
- Password: `backend/.env` içindeki `ADMIN_PASSWORD`

Örnek banka dosyası: `docs/samples/bank-sample.csv`

## UI

2026 light SaaS: oyster zemin, deep teal vurgu, Sora/Manrope tipografi, mobil uyumlu banka mutabakat akışı.

## Teknoloji

Backend: Fastify, Drizzle, Zod, Pino, Vitest  
Frontend: React, Vite, TanStack Query, RHF, Tailwind, shadcn/ui  
Deploy: Docker Compose (postgres + api + nginx)
