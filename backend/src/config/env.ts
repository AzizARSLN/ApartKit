import { config as loadDotenv } from "dotenv";
import { z } from "zod";

loadDotenv();
loadDotenv({ path: "../.env" });

const EnvSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().positive().default(3000),
  DATABASE_URL: z.string().min(1),
  JWT_ACCESS_SECRET: z.string().min(32),
  JWT_REFRESH_SECRET: z.string().min(32),
  JWT_ACCESS_TTL: z.string().default("15m"),
  JWT_REFRESH_TTL: z.string().default("7d"),
  LOG_LEVEL: z.string().default("info"),
  UPLOAD_DIR: z.string().default("./data/uploads"),
  CORS_ORIGIN: z.string().default("http://localhost:5173"),
  RUN_MIGRATE_ON_START: z
    .enum(["true", "false"])
    .optional()
    .transform((v) => v === "true"),
  RUN_SEED_ON_START: z
    .enum(["true", "false"])
    .optional()
    .transform((v) => v === "true"),
});

export type Env = z.infer<typeof EnvSchema>;

let cached: Env | null = null;

export function loadEnv(env: NodeJS.ProcessEnv = process.env): Env {
  if (cached) return cached;
  const parsed = EnvSchema.safeParse(env);
  if (!parsed.success) {
    const details = parsed.error.flatten().fieldErrors;
    console.error("Invalid environment configuration", details);
    process.exit(1);
  }
  cached = parsed.data;
  return cached;
}

export function resetEnvCache(): void {
  cached = null;
}
