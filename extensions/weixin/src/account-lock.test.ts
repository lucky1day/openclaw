import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { drainFileLockStateForTest } from "openclaw/plugin-sdk/infra-runtime";
import { afterEach, describe, expect, it } from "vitest";
import { acquireWeixinAccountLock, resetWeixinAccountLocksForTest } from "./account-lock.js";
import { type ResolvedWeixinAccount } from "./accounts.js";

function createAccount(tempDir: string): ResolvedWeixinAccount {
  return {
    accountId: "work",
    enabled: true,
    configured: true,
    baseUrl: "https://ilinkai.weixin.qq.com",
    token: "bot-token",
    userId: "wx-bot-1",
    authFile: path.join(tempDir, "auth.json"),
    syncBufFile: path.join(tempDir, "sync-buf.json"),
    pollIntervalMs: 1000,
    botType: "3",
    dmPolicy: "open",
  };
}

afterEach(async () => {
  await resetWeixinAccountLocksForTest();
  await drainFileLockStateForTest();
});

describe("weixin account lock", () => {
  it("rejects a second monitor lock for the same account until the first lock is released", async () => {
    const tempDir = mkdtempSync(path.join(os.tmpdir(), "openclaw-weixin-lock-"));

    try {
      const account = createAccount(tempDir);
      const first = await acquireWeixinAccountLock(account);

      await expect(acquireWeixinAccountLock(account)).rejects.toThrow(/already monitored/i);

      await first.release();

      const second = await acquireWeixinAccountLock(account);
      await second.release();
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });
});
