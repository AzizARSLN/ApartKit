import { createHash, randomBytes } from "node:crypto";
import * as argon2 from "argon2";

export async function hashPassword(password: string): Promise<string> {
  return argon2.hash(password, { type: argon2.argon2id });
}

export async function verifyPassword(hash: string, password: string): Promise<boolean> {
  return argon2.verify(hash, password);
}

export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function newRefreshToken(): string {
  return randomBytes(48).toString("base64url");
}

export function sha256(content: string | Buffer): string {
  return createHash("sha256").update(content).digest("hex");
}
