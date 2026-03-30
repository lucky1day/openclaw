import type { ResolvedWeixinAccount } from "./accounts.js";
import { getConfig } from "./api.js";

export interface CachedWeixinConfig {
  typingTicket: string;
}

const CONFIG_CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const CONFIG_CACHE_INITIAL_RETRY_MS = 2_000;
const CONFIG_CACHE_MAX_RETRY_MS = 60 * 60 * 1000;

type ConfigCacheEntry = {
  config: CachedWeixinConfig;
  everSucceeded: boolean;
  nextFetchAt: number;
  retryDelayMs: number;
};

class WeixinConfigManager {
  private cache = new Map<string, ConfigCacheEntry>();

  constructor(
    private readonly account: ResolvedWeixinAccount,
    private readonly log?: (msg: string) => void,
  ) {}

  async getForUser(userId: string, contextToken?: string): Promise<CachedWeixinConfig> {
    const now = Date.now();
    const entry = this.cache.get(userId);
    const shouldFetch = !entry || now >= entry.nextFetchAt;

    if (shouldFetch) {
      let fetchOk = false;
      try {
        const resp = await getConfig({
          account: this.account,
          ilinkUserId: userId,
          contextToken,
        });
        if (resp.ret === 0) {
          this.cache.set(userId, {
            config: { typingTicket: resp.typing_ticket?.trim() ?? "" },
            everSucceeded: true,
            nextFetchAt: now + Math.random() * CONFIG_CACHE_TTL_MS,
            retryDelayMs: CONFIG_CACHE_INITIAL_RETRY_MS,
          });
          this.log?.(
            `[${this.account.accountId}] config ${entry?.everSucceeded ? "refreshed" : "cached"} for ${userId}`,
          );
          fetchOk = true;
        }
      } catch (error) {
        this.log?.(
          `[${this.account.accountId}] getConfig failed for ${userId} (ignored): ${String(error)}`,
        );
      }

      if (!fetchOk) {
        const prevDelay = entry?.retryDelayMs ?? CONFIG_CACHE_INITIAL_RETRY_MS;
        const nextDelay = Math.min(prevDelay * 2, CONFIG_CACHE_MAX_RETRY_MS);
        if (entry) {
          entry.nextFetchAt = now + nextDelay;
          entry.retryDelayMs = nextDelay;
        } else {
          this.cache.set(userId, {
            config: { typingTicket: "" },
            everSucceeded: false,
            nextFetchAt: now + CONFIG_CACHE_INITIAL_RETRY_MS,
            retryDelayMs: CONFIG_CACHE_INITIAL_RETRY_MS,
          });
        }
      }
    }

    return this.cache.get(userId)?.config ?? { typingTicket: "" };
  }
}

const managerCache = new Map<string, WeixinConfigManager>();

function buildManagerKey(account: ResolvedWeixinAccount): string {
  return [
    account.accountId,
    account.baseUrl,
    account.token ?? "",
    account.routeTag ?? "",
    account.userId ?? "",
  ].join("\u0000");
}

function getManager(
  account: ResolvedWeixinAccount,
  log?: (msg: string) => void,
): WeixinConfigManager {
  const key = buildManagerKey(account);
  let manager = managerCache.get(key);
  if (!manager) {
    manager = new WeixinConfigManager(account, log);
    managerCache.set(key, manager);
  }
  return manager;
}

export async function getCachedWeixinConfig(params: {
  account: ResolvedWeixinAccount;
  userId: string;
  contextToken?: string;
  log?: (msg: string) => void;
}): Promise<CachedWeixinConfig> {
  return await getManager(params.account, params.log).getForUser(
    params.userId,
    params.contextToken,
  );
}

export function resetWeixinConfigManagersForTest(): void {
  managerCache.clear();
}
