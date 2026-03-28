import crypto from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  acquireFileLock,
  type FileLockHandle,
  type FileLockOptions,
} from "openclaw/plugin-sdk/infra-runtime";
import type { ResolvedWeixinAccount } from "./accounts.js";

const WEIXIN_ACCOUNT_LOCKS_KEY = Symbol.for("openclaw.weixin.accountLocks");

type WeixinAccountLockState = Map<string, FileLockHandle>;

function getWeixinAccountLockState(): WeixinAccountLockState {
  const globalRecord = globalThis as typeof globalThis & {
    [WEIXIN_ACCOUNT_LOCKS_KEY]?: WeixinAccountLockState;
  };
  if (!globalRecord[WEIXIN_ACCOUNT_LOCKS_KEY]) {
    globalRecord[WEIXIN_ACCOUNT_LOCKS_KEY] = new Map<string, FileLockHandle>();
  }
  return globalRecord[WEIXIN_ACCOUNT_LOCKS_KEY];
}

const WEIXIN_ACCOUNT_LOCK_OPTIONS: FileLockOptions = {
  retries: {
    retries: 2,
    factor: 1.5,
    minTimeout: 15,
    maxTimeout: 75,
    randomize: true,
  },
  stale: 60_000,
};

function resolveWeixinAccountScopeKey(account: ResolvedWeixinAccount): string {
  const baseUrl = account.baseUrl.trim().toLowerCase();
  const userId = account.userId?.trim();
  if (baseUrl && userId) {
    return `${baseUrl}::${userId}`;
  }
  return [
    account.accountId.trim(),
    path.resolve(account.authFile),
    path.resolve(account.syncBufFile),
  ].join("::");
}

function resolveWeixinAccountLockFile(account: ResolvedWeixinAccount, scopeKey: string): string {
  const digest = crypto.createHash("sha256").update(scopeKey).digest("hex").slice(0, 16);
  const authDir = path.dirname(path.resolve(account.authFile));
  return path.join(authDir, `.openclaw-weixin-monitor-${digest}`);
}

async function annotateLockFile(params: {
  lockPath: string;
  scopeKey: string;
  account: ResolvedWeixinAccount;
}): Promise<void> {
  try {
    const raw = await fs.readFile(params.lockPath, "utf8");
    const current =
      raw.trim().length > 0
        ? (JSON.parse(raw) as Record<string, unknown>)
        : ({} as Record<string, unknown>);
    await fs.writeFile(
      params.lockPath,
      JSON.stringify(
        {
          ...current,
          hostname: os.hostname(),
          channel: "weixin",
          scopeKey: params.scopeKey,
          accountId: params.account.accountId,
          userId: params.account.userId,
          baseUrl: params.account.baseUrl,
          authFile: path.resolve(params.account.authFile),
          syncBufFile: path.resolve(params.account.syncBufFile),
        },
        null,
        2,
      ),
      "utf8",
    );
  } catch {
    // Best effort only.
  }
}

function buildLockErrorMessage(params: {
  account: ResolvedWeixinAccount;
  lockPath: string;
  detail?: string;
}): string {
  const identity = params.account.userId?.trim() || params.account.accountId;
  const suffix = params.detail ? `: ${params.detail}` : "";
  return `WeChat account already monitored elsewhere (${identity}, lock=${params.lockPath})${suffix}`;
}

export class WeixinAccountLockError extends Error {
  readonly lockPath: string;
  readonly scopeKey: string;

  constructor(params: { message: string; lockPath: string; scopeKey: string; cause?: unknown }) {
    super(params.message);
    this.name = "WeixinAccountLockError";
    this.lockPath = params.lockPath;
    this.scopeKey = params.scopeKey;
    if (params.cause !== undefined) {
      (this as Error & { cause?: unknown }).cause = params.cause;
    }
  }
}

export type WeixinAccountLock = {
  lockPath: string;
  scopeKey: string;
  release: () => Promise<void>;
};

export async function acquireWeixinAccountLock(
  account: ResolvedWeixinAccount,
): Promise<WeixinAccountLock> {
  const scopeKey = resolveWeixinAccountScopeKey(account);
  const lockFile = resolveWeixinAccountLockFile(account, scopeKey);
  const state = getWeixinAccountLockState();

  if (state.has(scopeKey)) {
    throw new WeixinAccountLockError({
      message: buildLockErrorMessage({
        account,
        lockPath: `${lockFile}.lock`,
        detail: "already monitored in this process",
      }),
      lockPath: `${lockFile}.lock`,
      scopeKey,
    });
  }

  let handle: FileLockHandle;
  try {
    handle = await acquireFileLock(lockFile, WEIXIN_ACCOUNT_LOCK_OPTIONS);
  } catch (error) {
    throw new WeixinAccountLockError({
      message: buildLockErrorMessage({
        account,
        lockPath: `${lockFile}.lock`,
      }),
      lockPath: `${lockFile}.lock`,
      scopeKey,
      cause: error,
    });
  }

  state.set(scopeKey, handle);
  await annotateLockFile({
    lockPath: handle.lockPath,
    scopeKey,
    account,
  });

  return {
    lockPath: handle.lockPath,
    scopeKey,
    release: async () => {
      if (state.get(scopeKey) === handle) {
        state.delete(scopeKey);
      }
      await handle.release();
    },
  };
}

export async function resetWeixinAccountLocksForTest(): Promise<void> {
  const state = getWeixinAccountLockState();
  const handles = Array.from(state.values());
  state.clear();
  await Promise.all(handles.map(async (handle) => await handle.release().catch(() => undefined)));
}
