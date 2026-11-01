import type { FastifyReply, FastifyRequest } from "fastify";
import { AppError } from "../errors/app-error.js";
import { hasPermission, type Permission, type SystemRole } from "./rbac.js";

export type AuthUser = {
  id: number;
  tenantId: number;
  email: string;
  fullName: string;
  roles: SystemRole[];
  siteIds: number[];
};

declare module "@fastify/jwt" {
  interface FastifyJWT {
    payload: {
      sub: number;
      tenantId: number;
      email: string;
      fullName: string;
      roles: SystemRole[];
      siteIds: number[];
    };
    user: AuthUser;
  }
}

declare module "fastify" {
  interface FastifyRequest {
    authUser: AuthUser;
    activeSiteId?: number;
  }
}

export async function authenticate(request: FastifyRequest, _reply: FastifyReply): Promise<void> {
  try {
    const payload = await request.jwtVerify<{
      sub: number;
      tenantId: number;
      email: string;
      fullName: string;
      roles: SystemRole[];
      siteIds: number[];
    }>();
    request.authUser = {
      id: payload.sub,
      tenantId: payload.tenantId,
      email: payload.email,
      fullName: payload.fullName,
      roles: payload.roles,
      siteIds: payload.siteIds ?? [],
    };

    const siteHeader = request.headers["x-site-id"];
    if (typeof siteHeader === "string" && siteHeader.trim() !== "") {
      const siteId = Number(siteHeader);
      if (!Number.isInteger(siteId) || siteId <= 0) {
        throw new AppError("INVALID_SITE_HEADER", "Geçersiz X-Site-Id.", 400);
      }
      const isSuperOrTenantAdmin =
        request.authUser.roles.includes("SUPER_ADMIN") ||
        request.authUser.roles.includes("TENANT_ADMIN");
      if (!isSuperOrTenantAdmin && !request.authUser.siteIds.includes(siteId)) {
        throw new AppError("SITE_FORBIDDEN", "Bu site için yetkiniz yok.", 403);
      }
      request.activeSiteId = siteId;
    }
  } catch (error) {
    if (error instanceof AppError) throw error;
    throw new AppError("UNAUTHORIZED", "Kimlik doğrulama gerekli.", 401);
  }
}

export function requirePermission(...permissions: Permission[]) {
  return async (request: FastifyRequest, _reply: FastifyReply): Promise<void> => {
    if (!request.authUser) {
      throw new AppError("UNAUTHORIZED", "Kimlik doğrulama gerekli.", 401);
    }
    const ok = permissions.every((p) => hasPermission(request.authUser.roles, p));
    if (!ok) {
      throw new AppError("FORBIDDEN", "Bu işlem için yetkiniz yok.", 403, {
        required: permissions,
      });
    }
  };
}

export function getTenantId(request: FastifyRequest): number {
  if (!request.authUser?.tenantId) {
    throw new AppError("UNAUTHORIZED", "Tenant bağlamı yok.", 401);
  }
  return request.authUser.tenantId;
}
