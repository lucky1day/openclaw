import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

export type WeixinAuthData = {
  token?: string;
  baseUrl?: string;
  userId?: string;
  updatedAt?: string;
};

function normalizeString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

export function readWeixinAuthFile(authFile?: string | null): WeixinAuthData | null {
  if (!authFile?.trim() || !existsSync(authFile)) {
    return null;
  }
  try {
    const parsed = JSON.parse(readFileSync(authFile, "utf-8")) as Record<string, unknown>;
    return {
      token: normalizeString(parsed.token),
      baseUrl: normalizeString(parsed.baseUrl),
      userId: normalizeString(parsed.userId),
      updatedAt: normalizeString(parsed.updatedAt),
    };
  } catch {
    return null;
  }
}

export function writeWeixinAuthFile(authFile: string, update: WeixinAuthData): void {
  mkdirSync(path.dirname(authFile), { recursive: true });

  const current = readWeixinAuthFile(authFile) ?? {};
  const next: WeixinAuthData = {
    ...current,
    ...update,
    updatedAt: new Date().toISOString(),
  };

  writeFileSync(authFile, JSON.stringify(next, null, 2), "utf-8");
  try {
    chmodSync(authFile, 0o600);
  } catch {
    // best effort only
  }
}
