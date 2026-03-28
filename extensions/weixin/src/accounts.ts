import {
  createAccountListHelpers,
  resolveMergedAccountConfig,
  type ChannelSetupInput,
  type OpenClawConfig,
} from "../runtime-api.js";
import { readWeixinAuthFile } from "./auth-file.js";

export const WEIXIN_CHANNEL = "weixin";
export const DEFAULT_ACCOUNT_ID = "default";
export const DEFAULT_BASE_URL = "https://ilinkai.weixin.qq.com";
export const DEFAULT_AUTH_FILE = ".local/share/openclaw/weixin/auth.json";
export const DEFAULT_SYNC_BUF_FILE = ".local/share/openclaw/weixin/sync-buf.json";
export const DEFAULT_POLL_INTERVAL_MS = 1000;
export const DEFAULT_BOT_TYPE = "3";

export type WeixinDmPolicy = "pairing" | "allowlist" | "open" | "disabled";

export type WeixinAccountConfig = {
  enabled?: boolean;
  name?: string;
  baseUrl?: string;
  authFile?: string;
  syncBufFile?: string;
  pollIntervalMs?: number;
  routeTag?: string;
  botType?: string;
  dmPolicy?: WeixinDmPolicy;
  allowFrom?: string[];
  defaultTo?: string;
};

export type WeixinChannelConfig = WeixinAccountConfig & {
  accounts?: Record<string, WeixinAccountConfig>;
  defaultAccount?: string;
};

export type ResolvedWeixinAccount = {
  accountId: string;
  enabled: boolean;
  configured: boolean;
  name?: string;
  baseUrl: string;
  token?: string;
  userId?: string;
  authFile: string;
  syncBufFile: string;
  pollIntervalMs: number;
  routeTag?: string;
  botType: string;
  dmPolicy: WeixinDmPolicy;
  allowFrom?: string[];
  defaultTo?: string;
};

const { listAccountIds, resolveDefaultAccountId } = createAccountListHelpers(WEIXIN_CHANNEL);

export const listWeixinAccountIds = listAccountIds;
export const resolveDefaultWeixinAccountId = resolveDefaultAccountId;

export function readWeixinConfig(cfg: OpenClawConfig): WeixinChannelConfig | undefined {
  return cfg.channels?.[WEIXIN_CHANNEL] as WeixinChannelConfig | undefined;
}

function resolveWeixinAccountId(cfg: OpenClawConfig, accountId?: string | null): string {
  const normalized = accountId?.trim();
  return normalized || resolveDefaultWeixinAccountId(cfg) || DEFAULT_ACCOUNT_ID;
}

export function readWeixinAccountConfig(
  cfg: OpenClawConfig,
  accountId?: string | null,
): WeixinAccountConfig {
  const channel = readWeixinConfig(cfg);
  return resolveMergedAccountConfig<WeixinAccountConfig>({
    channelConfig: channel,
    accounts: channel?.accounts,
    accountId: resolveWeixinAccountId(cfg, accountId),
    omitKeys: ["defaultAccount"],
  });
}

export function resolveWeixinAccount(
  cfg: OpenClawConfig,
  accountId?: string | null,
): ResolvedWeixinAccount {
  const resolvedAccountId = resolveWeixinAccountId(cfg, accountId);
  const channel = readWeixinConfig(cfg);
  const account = readWeixinAccountConfig(cfg, resolvedAccountId);
  const authFile = account.authFile ?? DEFAULT_AUTH_FILE;
  const auth = readWeixinAuthFile(authFile);

  return {
    accountId: resolvedAccountId,
    enabled: channel?.enabled !== false && account.enabled !== false,
    configured: Boolean(auth?.token),
    name: account.name?.trim() || undefined,
    baseUrl: auth?.baseUrl ?? account.baseUrl ?? DEFAULT_BASE_URL,
    token: auth?.token,
    userId: auth?.userId,
    authFile,
    syncBufFile: account.syncBufFile ?? DEFAULT_SYNC_BUF_FILE,
    pollIntervalMs: account.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS,
    routeTag: account.routeTag?.trim() || undefined,
    botType: account.botType ?? DEFAULT_BOT_TYPE,
    dmPolicy: account.dmPolicy ?? "pairing",
    allowFrom: account.allowFrom?.map((entry) => String(entry).trim()).filter(Boolean),
    defaultTo: account.defaultTo?.trim() || undefined,
  };
}

export function upsertWeixinAccount(
  cfg: OpenClawConfig,
  accountId: string,
  input: ChannelSetupInput,
): OpenClawConfig {
  const channel = readWeixinConfig(cfg) ?? {};
  const current = readWeixinAccountConfig(cfg, accountId);
  const nextAccount: WeixinAccountConfig = {
    ...current,
    enabled: current.enabled ?? true,
    ...(input.name ? { name: input.name } : {}),
    ...(input.url ? { baseUrl: input.url } : {}),
    ...(input.tokenFile ? { authFile: input.tokenFile } : {}),
  };

  const nextChannel: WeixinChannelConfig = {
    ...channel,
    enabled: channel.enabled ?? true,
  };

  if (!channel.accounts && accountId === DEFAULT_ACCOUNT_ID) {
    return {
      ...cfg,
      channels: {
        ...cfg.channels,
        [WEIXIN_CHANNEL]: {
          ...nextChannel,
          ...nextAccount,
        },
      },
    };
  }

  return {
    ...cfg,
    channels: {
      ...cfg.channels,
      [WEIXIN_CHANNEL]: {
        ...nextChannel,
        accounts: {
          ...(channel.accounts ?? {}),
          [accountId]: nextAccount,
        },
      },
    },
  };
}
