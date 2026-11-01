import { defineConfig } from "drizzle-kit";

export default defineConfig({
  schema: "./src/db/schema/index.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: {
    url: process.env.DATABASE_URL ?? "postgresql://siteyonetim:siteyonetim@localhost:5432/siteyonetim",
  },
  strict: true,
  verbose: true,
});
