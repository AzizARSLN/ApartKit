import type { Db, DbTransaction } from "../../db/client.js";
import { auditLogs } from "../../db/schema/index.js";

type Tx = Db | DbTransaction;

export type AuditInput = {
  tenantId: number;
  siteId?: number | null;
  userId?: number | null;
  action: string;
  entityType: string;
  entityId?: string | number | null;
  oldData?: unknown;
  newData?: unknown;
  ipAddress?: string | null;
  userAgent?: string | null;
};

export async function writeAudit(tx: Tx, input: AuditInput): Promise<void> {
  await tx.insert(auditLogs).values({
    tenantId: input.tenantId,
    siteId: input.siteId ?? null,
    userId: input.userId ?? null,
    action: input.action,
    entityType: input.entityType,
    entityId: input.entityId == null ? null : String(input.entityId),
    oldData: input.oldData ?? null,
    newData: input.newData ?? null,
    ipAddress: input.ipAddress ?? null,
    userAgent: input.userAgent ?? null,
  });
}
