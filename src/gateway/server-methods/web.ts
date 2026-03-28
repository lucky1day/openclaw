import { listChannelPlugins, normalizeChannelId } from "../../channels/plugins/index.js";
import {
  ErrorCodes,
  errorShape,
  formatValidationErrors,
  validateWebLoginStartParams,
  validateWebLoginWaitParams,
} from "../protocol/index.js";
import { formatForLog } from "../ws-log.js";
import type { GatewayRequestHandlers, RespondFn } from "./types.js";

const WEB_LOGIN_METHODS = new Set(["web.login.start", "web.login.wait"]);

function resolveChannelId(params: unknown): string | undefined {
  if (typeof (params as { channel?: unknown }).channel !== "string") {
    return undefined;
  }
  return normalizeChannelId((params as { channel?: string }).channel) ?? undefined;
}

const supportsWebLogin = (plugin: { gatewayMethods?: string[] | null }) =>
  (plugin.gatewayMethods ?? []).some((method) => WEB_LOGIN_METHODS.has(method));

const resolveWebLoginProvider = (params?: unknown) => {
  const plugins = listChannelPlugins();
  const channelId = resolveChannelId(params);
  if (channelId) {
    return plugins.find((plugin) => plugin.id === channelId) ?? null;
  }
  return plugins.find((plugin) => supportsWebLogin(plugin)) ?? null;
};

function resolveAccountId(params: unknown): string | undefined {
  return typeof (params as { accountId?: unknown }).accountId === "string"
    ? (params as { accountId?: string }).accountId
    : undefined;
}

function respondProviderUnavailable(respond: RespondFn) {
  respond(
    false,
    undefined,
    errorShape(ErrorCodes.INVALID_REQUEST, "web login provider is not available"),
  );
}

function respondProviderUnsupported(respond: RespondFn, providerId: string) {
  respond(
    false,
    undefined,
    errorShape(ErrorCodes.INVALID_REQUEST, `web login is not supported by provider ${providerId}`),
  );
}

export const webHandlers: GatewayRequestHandlers = {
  "web.login.start": async ({ params, respond, context }) => {
    if (!validateWebLoginStartParams(params)) {
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.INVALID_REQUEST,
          `invalid web.login.start params: ${formatValidationErrors(validateWebLoginStartParams.errors)}`,
        ),
      );
      return;
    }
    try {
      const accountId = resolveAccountId(params);
      const provider = resolveWebLoginProvider(params);
      if (!provider) {
        respondProviderUnavailable(respond);
        return;
      }
      await context.stopChannel(provider.id, accountId);
      if (!provider.gateway?.loginWithQrStart) {
        respondProviderUnsupported(respond, provider.id);
        return;
      }
      const result = await provider.gateway.loginWithQrStart({
        force: Boolean((params as { force?: boolean }).force),
        timeoutMs:
          typeof (params as { timeoutMs?: unknown }).timeoutMs === "number"
            ? (params as { timeoutMs?: number }).timeoutMs
            : undefined,
        verbose: Boolean((params as { verbose?: boolean }).verbose),
        accountId,
      });
      respond(true, result, undefined);
    } catch (err) {
      respond(false, undefined, errorShape(ErrorCodes.UNAVAILABLE, formatForLog(err)));
    }
  },
  "web.login.wait": async ({ params, respond, context }) => {
    if (!validateWebLoginWaitParams(params)) {
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.INVALID_REQUEST,
          `invalid web.login.wait params: ${formatValidationErrors(validateWebLoginWaitParams.errors)}`,
        ),
      );
      return;
    }
    try {
      const accountId = resolveAccountId(params);
      const provider = resolveWebLoginProvider(params);
      if (!provider) {
        respondProviderUnavailable(respond);
        return;
      }
      if (!provider.gateway?.loginWithQrWait) {
        respondProviderUnsupported(respond, provider.id);
        return;
      }
      const result = await provider.gateway.loginWithQrWait({
        timeoutMs:
          typeof (params as { timeoutMs?: unknown }).timeoutMs === "number"
            ? (params as { timeoutMs?: number }).timeoutMs
            : undefined,
        accountId,
      });
      if (result.connected) {
        await context.startChannel(provider.id, accountId);
      }
      respond(true, result, undefined);
    } catch (err) {
      respond(false, undefined, errorShape(ErrorCodes.UNAVAILABLE, formatForLog(err)));
    }
  },
};
