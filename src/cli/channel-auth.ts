import { resolveChannelDefaultAccountId } from "../channels/plugins/helpers.js";
import {
  getChannelPlugin,
  listChannelPlugins,
  normalizeChannelId,
} from "../channels/plugins/index.js";
import { resolveInstallableChannelPlugin } from "../commands/channel-setup/channel-plugin-resolution.js";
import { loadConfig, writeConfigFile, type OpenClawConfig } from "../config/config.js";
import { setVerbose } from "../globals.js";
import { isBlockedObjectKey } from "../infra/prototype-keys.js";
import { defaultRuntime, type RuntimeEnv } from "../runtime.js";
import { sanitizeForLog } from "../terminal/ansi.js";
import { renderQrToTerminal, writeQrDataUrlToTempFile } from "./channel-auth-qr.js";
import { callGatewayFromCli, type GatewayRpcOpts } from "./gateway-rpc.js";

type ChannelAuthOptions = {
  channel?: string;
  account?: string;
  verbose?: boolean;
} & Pick<GatewayRpcOpts, "url" | "token" | "timeout">;

type ChannelPlugin = NonNullable<ReturnType<typeof getChannelPlugin>>;
type ChannelAuthMode = "login" | "logout";
const WEB_LOGIN_WAIT_TIMEOUT_MS = 300_000;
const WEB_LOGIN_RPC_TIMEOUT_MS = 315_000;

type WebLoginStartResult = {
  qrcodeUrl?: string;
  message?: string;
};

type WebLoginWaitResult = {
  connected?: boolean;
  message?: string;
};

function resolveWebLoginWaitRpcTimeout(timeout: string | undefined): string {
  const parsed = Number(timeout);
  if (Number.isFinite(parsed) && parsed > 0) {
    return String(Math.max(parsed, WEB_LOGIN_RPC_TIMEOUT_MS));
  }
  return String(WEB_LOGIN_RPC_TIMEOUT_MS);
}

function supportsGatewayWebLogin(plugin: ChannelPlugin): boolean {
  if (!plugin.gateway?.loginWithQrStart || !plugin.gateway?.loginWithQrWait) {
    return false;
  }
  const methods = plugin.gatewayMethods ?? [];
  return methods.includes("web.login.start") && methods.includes("web.login.wait");
}

function supportsChannelAuthMode(plugin: ChannelPlugin, mode: ChannelAuthMode): boolean {
  return mode === "login"
    ? Boolean(plugin.auth?.login) || supportsGatewayWebLogin(plugin)
    : Boolean(plugin.gateway?.logoutAccount);
}

function isConfiguredAuthPlugin(plugin: ChannelPlugin, cfg: OpenClawConfig): boolean {
  const channels = cfg.channels as Record<string, unknown> | undefined;
  const key = plugin.id;
  if (
    !channels ||
    isBlockedObjectKey(key) ||
    !Object.prototype.hasOwnProperty.call(channels, key)
  ) {
    return false;
  }
  const channelCfg = channels[key];
  if (!channelCfg || typeof channelCfg !== "object") {
    return false;
  }

  for (const accountId of plugin.config.listAccountIds(cfg)) {
    try {
      const account = plugin.config.resolveAccount(cfg, accountId);
      const enabled = plugin.config.isEnabled
        ? plugin.config.isEnabled(account, cfg)
        : account && typeof account === "object"
          ? ((account as { enabled?: boolean }).enabled ?? true)
          : true;
      if (enabled) {
        return true;
      }
    } catch {
      continue;
    }
  }

  return false;
}

function resolveConfiguredAuthChannelInput(cfg: OpenClawConfig, mode: ChannelAuthMode): string {
  const configured = listChannelPlugins()
    .filter((plugin): plugin is ChannelPlugin => supportsChannelAuthMode(plugin, mode))
    .filter((plugin) => isConfiguredAuthPlugin(plugin, cfg))
    .map((plugin) => plugin.id);

  if (configured.length === 1) {
    return configured[0];
  }
  if (configured.length === 0) {
    throw new Error(`Channel is required (no configured channels support ${mode}).`);
  }
  const safeIds = configured.map(sanitizeForLog);
  throw new Error(
    `Channel is required when multiple configured channels support ${mode}: ${safeIds.join(", ")}`,
  );
}

async function resolveChannelPluginForMode(
  opts: ChannelAuthOptions,
  mode: ChannelAuthMode,
  cfg: OpenClawConfig,
  runtime: RuntimeEnv,
): Promise<{
  cfg: OpenClawConfig;
  configChanged: boolean;
  channelInput: string;
  channelId: string;
  plugin: ChannelPlugin;
}> {
  const explicitChannel = opts.channel?.trim();
  const channelInput = explicitChannel || resolveConfiguredAuthChannelInput(cfg, mode);
  const normalizedChannelId = normalizeChannelId(channelInput);

  const resolved = await resolveInstallableChannelPlugin({
    cfg,
    runtime,
    rawChannel: channelInput,
    ...(normalizedChannelId ? { channelId: normalizedChannelId } : {}),
    allowInstall: true,
    supports: (candidate) => supportsChannelAuthMode(candidate, mode),
  });
  const channelId = resolved.channelId ?? normalizedChannelId;
  if (!channelId) {
    throw new Error(`Unsupported channel: ${channelInput}`);
  }
  const plugin = resolved.plugin;
  if (!plugin || !supportsChannelAuthMode(plugin, mode)) {
    throw new Error(`Channel ${channelId} does not support ${mode}`);
  }
  return {
    cfg: resolved.cfg,
    configChanged: resolved.configChanged,
    channelInput,
    channelId,
    plugin,
  };
}

function resolveAccountContext(
  plugin: ChannelPlugin,
  opts: ChannelAuthOptions,
  cfg: OpenClawConfig,
) {
  const accountId = opts.account?.trim() || resolveChannelDefaultAccountId({ plugin, cfg });
  return { accountId };
}

async function runGatewayWebLogin(opts: {
  plugin: ChannelPlugin;
  cfg: OpenClawConfig;
  accountId: string;
  channelId: string;
  runtime: RuntimeEnv;
  verbose: boolean;
  gatewayRpcOpts: Pick<GatewayRpcOpts, "url" | "token" | "timeout">;
}) {
  if (!supportsGatewayWebLogin(opts.plugin)) {
    throw new Error(`Channel ${opts.channelId} does not support login`);
  }

  const start = (await callGatewayFromCli("web.login.start", opts.gatewayRpcOpts, {
    channel: opts.channelId,
    accountId: opts.accountId,
    verbose: opts.verbose,
  })) as WebLoginStartResult;

  if (start.message) {
    opts.runtime.log(start.message);
  }
  if (start.qrcodeUrl) {
    const renderedInline = await renderQrToTerminal(opts.runtime, start.qrcodeUrl);
    if (!renderedInline) {
      const qrPath = await writeQrDataUrlToTempFile(
        start.qrcodeUrl,
        opts.channelId,
        opts.accountId,
      );
      if (qrPath) {
        opts.runtime.log(`QR image saved to: ${qrPath}`);
      } else if (/^https?:\/\//i.test(start.qrcodeUrl.trim())) {
        opts.runtime.log(`QR URL: ${start.qrcodeUrl.trim()}`);
      }
    }
  }

  opts.runtime.log("Waiting for QR scan confirmation...");
  const wait = (await callGatewayFromCli(
    "web.login.wait",
    {
      ...opts.gatewayRpcOpts,
      timeout: resolveWebLoginWaitRpcTimeout(opts.gatewayRpcOpts.timeout),
    },
    {
      channel: opts.channelId,
      accountId: opts.accountId,
      timeoutMs: WEB_LOGIN_WAIT_TIMEOUT_MS,
    },
  )) as WebLoginWaitResult;
  if (!wait.connected) {
    throw new Error(wait.message || `Channel ${opts.channelId} login failed`);
  }
  opts.runtime.log(wait.message || "Channel login succeeded.");
}

export async function runChannelLogin(
  opts: ChannelAuthOptions,
  runtime: RuntimeEnv = defaultRuntime,
) {
  const loadedCfg = loadConfig();
  const { cfg, configChanged, channelInput, plugin } = await resolveChannelPluginForMode(
    opts,
    "login",
    loadedCfg,
    runtime,
  );
  if (configChanged) {
    await writeConfigFile(cfg);
  }
  setVerbose(Boolean(opts.verbose));
  const { accountId } = resolveAccountContext(plugin, opts, cfg);
  const login = plugin.auth?.login;
  if (!login) {
    await runGatewayWebLogin({
      plugin,
      cfg,
      accountId,
      channelId: plugin.id,
      runtime,
      verbose: Boolean(opts.verbose),
      gatewayRpcOpts: {
        url: opts.url,
        token: opts.token,
        timeout: opts.timeout,
      },
    });
    return;
  }
  // Auth-only flow: do not mutate channel config here.
  await login({
    cfg,
    accountId,
    runtime,
    verbose: Boolean(opts.verbose),
    channelInput,
  });
}

export async function runChannelLogout(
  opts: ChannelAuthOptions,
  runtime: RuntimeEnv = defaultRuntime,
) {
  const loadedCfg = loadConfig();
  const { cfg, configChanged, channelInput, plugin } = await resolveChannelPluginForMode(
    opts,
    "logout",
    loadedCfg,
    runtime,
  );
  if (configChanged) {
    await writeConfigFile(cfg);
  }
  const logoutAccount = plugin.gateway?.logoutAccount;
  if (!logoutAccount) {
    throw new Error(`Channel ${channelInput} does not support logout`);
  }
  // Auth-only flow: resolve account + clear session state only.
  const { accountId } = resolveAccountContext(plugin, opts, cfg);
  const account = plugin.config.resolveAccount(cfg, accountId);
  await logoutAccount({
    cfg,
    accountId,
    account,
    runtime,
  });
}
