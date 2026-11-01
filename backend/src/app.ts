import cors from "@fastify/cors";
import helmet from "@fastify/helmet";
import jwt from "@fastify/jwt";
import multipart from "@fastify/multipart";
import Fastify from "fastify";
import { ZodError } from "zod";
import { loadEnv } from "./config/env.js";
import { pool } from "./db/client.js";
import { auditRoutes } from "./modules/audit/audit.routes.js";
import { authRoutes } from "./modules/auth/auth.routes.js";
import { bankingRoutes } from "./modules/banking/banking.routes.js";
import { billingRoutes } from "./modules/billing/billing.routes.js";
import { decisionRoutes } from "./modules/decisions/decisions.routes.js";
import { expenseRoutes } from "./modules/expenses/expenses.routes.js";
import { operationsRoutes } from "./modules/operations/operations.routes.js";
import { paymentRoutes } from "./modules/payments/payments.routes.js";
import { personnelRoutes } from "./modules/personnel/personnel.routes.js";
import { reportRoutes } from "./modules/reports/reports.routes.js";
import { residentRoutes } from "./modules/residents/residents.routes.js";
import { kurumRoutes } from "./modules/kurum/kurum.routes.js";
import { siteRoutes } from "./modules/sites/sites.routes.js";
import { isAppError } from "./shared/errors/app-error.js";

export async function buildApp() {
  const env = loadEnv();

  const app = Fastify({
    logger: {
      level: env.LOG_LEVEL,
      transport:
        env.NODE_ENV === "development"
          ? { target: "pino-pretty", options: { colorize: true } }
          : undefined,
    },
    genReqId: (req) => {
      const header = req.headers["x-request-id"];
      return typeof header === "string" && header.length > 0
        ? header
        : `req_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
    },
    requestIdHeader: "x-request-id",
  });

  await app.register(helmet, { contentSecurityPolicy: false });
  await app.register(cors, {
    origin: env.CORS_ORIGIN === "*" ? true : env.CORS_ORIGIN.split(",").map((s) => s.trim()),
    credentials: true,
  });
  await app.register(jwt, { secret: env.JWT_ACCESS_SECRET });
  await app.register(multipart, {
    limits: {
      fileSize: 20 * 1024 * 1024,
      files: 1,
    },
  });

  app.setErrorHandler((error, request, reply) => {
    if (error instanceof ZodError) {
      return reply.status(400).send({
        code: "VALIDATION_ERROR",
        message: "İstek doğrulaması başarısız.",
        details: error.flatten(),
      });
    }

    if (isAppError(error)) {
      return reply.status(error.statusCode).send({
        code: error.code,
        message: error.message,
        details: error.details,
      });
    }

    request.log.error({ err: error }, "Unhandled error");
    return reply.status(500).send({
      code: "INTERNAL_ERROR",
      message: "Beklenmeyen bir hata oluştu.",
      details: {},
    });
  });

  app.get("/api/v1/health", async () => ({
    status: "ok",
    service: "siteyonetim-api",
    timestamp: new Date().toISOString(),
  }));

  app.get("/api/v1/health/ready", async (_request, reply) => {
    try {
      await pool.query("select 1");
      return { status: "ready" };
    } catch {
      return reply.status(503).send({
        code: "DB_UNAVAILABLE",
        message: "Veritabanı hazır değil.",
        details: {},
      });
    }
  });

  await app.register(
    async (api) => {
      await api.register(authRoutes);
      await api.register(kurumRoutes);
      await api.register(siteRoutes);
      await api.register(residentRoutes);
      await api.register(billingRoutes);
      await api.register(paymentRoutes);
      await api.register(bankingRoutes);
      await api.register(expenseRoutes);
      await api.register(reportRoutes);
      await api.register(personnelRoutes);
      await api.register(operationsRoutes);
      await api.register(auditRoutes);
      await api.register(decisionRoutes);
    },
    { prefix: "/api/v1" },
  );

  return app;
}
