import { and, eq, isNull } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { createLoginThrottle } from "./login-throttle.js";
import { db } from "../../db/client.js";
import { refreshTokens, userRoles, users } from "../../db/schema/index.js";
import { writeAudit } from "../../shared/audit/audit.js";
import { authenticate, getTenantId } from "../../shared/auth/auth-guards.js";
import type { SystemRole } from "../../shared/auth/rbac.js";
import { AppError } from "../../shared/errors/app-error.js";
import { hashPassword, hashToken, newRefreshToken, verifyPassword } from "../../shared/utils/crypto.js";
import { loadEnv } from "../../config/env.js";

const LoginSchema = z.object({
  email: z
    .string()
    .trim()
    .min(3)
    .max(255)
    .transform((v) => v.toLowerCase())
    .refine(
      (v) =>
        z.string().email().safeParse(v).success ||
        /^[^\s@]+@localhost$/i.test(v) ||
        /^[^\s@]+@[^\s@]+\.[^\s@]+$/i.test(v),
      "Geçersiz e-posta",
    ),
  password: z.string().min(8),
  tenantId: z.number().int().positive().optional(),
});

const RefreshSchema = z.object({
  refreshToken: z.string().min(20),
});

function parseTtlToMs(ttl: string): number {
  const match = /^(\d+)([smhd])$/.exec(ttl);
  if (!match) return 7 * 24 * 60 * 60 * 1000;
  const n = Number(match[1]);
  const unit = match[2];
  const mult = unit === "s" ? 1000 : unit === "m" ? 60_000 : unit === "h" ? 3_600_000 : 86_400_000;
  return n * mult;
}

async function loadUserRoles(userId: number, tenantId: number) {
  const rows = await db
    .select()
    .from(userRoles)
    .where(and(eq(userRoles.userId, userId), eq(userRoles.tenantId, tenantId)));
  const roles = rows.map((r) => r.role as SystemRole);
  const siteIds = rows
    .map((r) => r.siteId)
    .filter((id): id is number => typeof id === "number");
  return { roles, siteIds: [...new Set(siteIds)] };
}

export async function authRoutes(app: FastifyInstance): Promise<void> {
  const env = loadEnv();
  const loginThrottle = createLoginThrottle();

  app.post("/auth/login", async (request) => {
    const body = LoginSchema.parse(request.body);
    const throttleKey = `${request.ip}|${body.email.toLowerCase()}`;
    const retryAfterSeconds = loginThrottle.retryAfterSeconds(throttleKey);
    if (retryAfterSeconds > 0) {
      throw new AppError(
        "TOO_MANY_ATTEMPTS",
        "Çok fazla hatalı giriş denemesi. Lütfen daha sonra tekrar deneyin.",
        429,
        { retryAfterSeconds },
      );
    }
    const candidates = await db
      .select()
      .from(users)
      .where(and(eq(users.email, body.email.toLowerCase()), eq(users.status, "ACTIVE")));

    const user =
      body.tenantId != null
        ? candidates.find((u) => u.tenantId === body.tenantId)
        : candidates.length === 1
          ? candidates[0]
          : null;

    if (!user) {
      if (candidates.length > 1) {
        throw new AppError("TENANT_REQUIRED", "Birden fazla tenant bulundu. tenantId gönderin.", 400, {
          tenants: candidates.map((c) => c.tenantId),
        });
      }
      loginThrottle.recordFailure(throttleKey);
      throw new AppError("INVALID_CREDENTIALS", "E-posta veya şifre hatalı.", 401);
    }

    const ok = await verifyPassword(user.passwordHash, body.password);
    if (!ok) {
      loginThrottle.recordFailure(throttleKey);
      throw new AppError("INVALID_CREDENTIALS", "E-posta veya şifre hatalı.", 401);
    }

    loginThrottle.clear(throttleKey);
    const { roles, siteIds } = await loadUserRoles(user.id, user.tenantId);
    const accessToken = await app.jwt.sign(
      {
        sub: user.id,
        tenantId: user.tenantId,
        email: user.email,
        fullName: user.fullName,
        roles,
        siteIds,
      },
      { expiresIn: env.JWT_ACCESS_TTL },
    );

    const refreshToken = newRefreshToken();
    const expiresAt = new Date(Date.now() + parseTtlToMs(env.JWT_REFRESH_TTL));
    await db.insert(refreshTokens).values({
      tenantId: user.tenantId,
      userId: user.id,
      tokenHash: hashToken(refreshToken),
      expiresAt,
    });

    await writeAudit(db, {
      tenantId: user.tenantId,
      userId: user.id,
      action: "AUTH_LOGIN",
      entityType: "user",
      entityId: user.id,
      ipAddress: request.ip,
      userAgent: request.headers["user-agent"],
    });

    return {
      accessToken,
      refreshToken,
      user: {
        id: user.id,
        tenantId: user.tenantId,
        email: user.email,
        fullName: user.fullName,
        roles,
        siteIds,
      },
    };
  });

  app.post("/auth/refresh", async (request) => {
    const body = RefreshSchema.parse(request.body);
    const tokenHash = hashToken(body.refreshToken);
    const [stored] = await db
      .select()
      .from(refreshTokens)
      .where(and(eq(refreshTokens.tokenHash, tokenHash), isNull(refreshTokens.revokedAt)))
      .limit(1);

    if (!stored || stored.expiresAt.getTime() < Date.now()) {
      throw new AppError("INVALID_REFRESH_TOKEN", "Refresh token geçersiz.", 401);
    }

    await db
      .update(refreshTokens)
      .set({ revokedAt: new Date() })
      .where(eq(refreshTokens.id, stored.id));

    const [user] = await db.select().from(users).where(eq(users.id, stored.userId)).limit(1);
    if (!user || user.status !== "ACTIVE") {
      throw new AppError("UNAUTHORIZED", "Kullanıcı aktif değil.", 401);
    }

    const { roles, siteIds } = await loadUserRoles(user.id, user.tenantId);
    const accessToken = await app.jwt.sign(
      {
        sub: user.id,
        tenantId: user.tenantId,
        email: user.email,
        fullName: user.fullName,
        roles,
        siteIds,
      },
      { expiresIn: env.JWT_ACCESS_TTL },
    );

    const nextRefresh = newRefreshToken();
    await db.insert(refreshTokens).values({
      tenantId: user.tenantId,
      userId: user.id,
      tokenHash: hashToken(nextRefresh),
      expiresAt: new Date(Date.now() + parseTtlToMs(env.JWT_REFRESH_TTL)),
    });

    return { accessToken, refreshToken: nextRefresh };
  });

  app.post("/auth/logout", { preHandler: [authenticate] }, async (request) => {
    const body = RefreshSchema.partial().parse(request.body ?? {});
    if (body.refreshToken) {
      await db
        .update(refreshTokens)
        .set({ revokedAt: new Date() })
        .where(eq(refreshTokens.tokenHash, hashToken(body.refreshToken)));
    }
    return { ok: true };
  });

  app.get("/auth/me", { preHandler: [authenticate] }, async (request) => {
    const tenantId = getTenantId(request);
    const [user] = await db
      .select({
        id: users.id,
        tenantId: users.tenantId,
        email: users.email,
        fullName: users.fullName,
        status: users.status,
      })
      .from(users)
      .where(and(eq(users.id, request.authUser.id), eq(users.tenantId, tenantId)))
      .limit(1);

    if (!user) {
      throw new AppError("NOT_FOUND", "Kullanıcı bulunamadı.", 404);
    }

    return {
      ...user,
      roles: request.authUser.roles,
      siteIds: request.authUser.siteIds,
    };
  });
}

export async function ensureUserPassword(password: string): Promise<string> {
  return hashPassword(password);
}
