FROM node:20-alpine AS deps
WORKDIR /app
COPY package.json ./
RUN npm install

FROM node:20-alpine AS build
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY package.json tsconfig.json tsconfig.build.json drizzle.config.ts ./
COPY src ./src
COPY drizzle ./drizzle
RUN npm run build

FROM node:20-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
RUN apk add --no-cache wget
COPY package.json ./
RUN npm install --omit=dev && npm install tsx
COPY --from=build /app/dist ./dist
COPY --from=build /app/drizzle ./drizzle
COPY --from=build /app/src ./src
COPY drizzle.config.ts tsconfig.json ./
RUN mkdir -p /app/data/uploads
EXPOSE 3000
CMD ["sh", "-c", "npx tsx src/db/migrate.ts && if [ \"$RUN_SEED_ON_START\" = \"true\" ]; then npx tsx src/db/seed.ts; fi && node dist/server.js"]
