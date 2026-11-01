import { createHash } from "node:crypto";
import { and, eq, gt } from "drizzle-orm";
import type { Db, DbTransaction } from "../../db/client.js";
import { idempotencyKeys } from "../../db/schema/index.js";

type Tx = Db | DbTransaction;

export function hashRequestBody(body: unknown): string {
  return createHash("sha256").update(JSON.stringify(body ?? null)).digest("hex");
}

export type IdempotencyLookup = {
  responseStatus: number;
  responseBody: unknown;
  requestHash: string;
};

export async function findIdempotency(
  tx: Tx,
  tenantId: number,
  key: string,
): Promise<IdempotencyLookup | null> {
  const [row] = await tx
    .select({
      responseStatus: idempotencyKeys.responseStatus,
      responseBody: idempotencyKeys.responseBody,
      requestHash: idempotencyKeys.requestHash,
      expiresAt: idempotencyKeys.expiresAt,
    })
    .from(idempotencyKeys)
    .where(
      and(
        eq(idempotencyKeys.tenantId, tenantId),
        eq(idempotencyKeys.key, key),
        gt(idempotencyKeys.expiresAt, new Date()),
      ),
    )
    .limit(1);

  if (!row) return null;
  return {
    responseStatus: row.responseStatus,
    responseBody: row.responseBody,
    requestHash: row.requestHash,
  };
}

export async function storeIdempotency(
  tx: Tx,
  input: {
    tenantId: number;
    userId: number | null;
    key: string;
    method: string;
    path: string;
    requestHash: string;
    responseStatus: number;
    responseBody: unknown;
    ttlHours?: number;
  },
): Promise<void> {
  const ttlHours = input.ttlHours ?? 24;
  const expiresAt = new Date(Date.now() + ttlHours * 60 * 60 * 1000);
  await tx.insert(idempotencyKeys).values({
    tenantId: input.tenantId,
    userId: input.userId,
    key: input.key,
    method: input.method,
    path: input.path,
    requestHash: input.requestHash,
    responseStatus: input.responseStatus,
    responseBody: input.responseBody as Record<string, unknown>,
    expiresAt,
  });
}
