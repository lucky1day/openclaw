import { randomUUID } from "node:crypto";
import { loadConfig } from "openclaw/plugin-sdk/config-runtime";
import { DEFAULT_BOT_TYPE, resolveWeixinAccount, type ResolvedWeixinAccount } from "./accounts.js";
import { writeWeixinAuthFile } from "./auth-file.js";

const ACTIVE_LOGIN_TTL_MS = 5 * 60_000;
const QR_STATUS_POLL_INTERVAL_MS = 1000;

type ActiveLogin = {
  id: string;
  sessionKey: string;
  accountId: string;
  baseUrl: string;
  botType: string;
  authFile: string;
  qrcode: string;
  qrcodeUrl: string;
  startedAt: number;
};

type QrCodeResponse = {
  qrcode?: string;
  qrcode_img_content?: string;
};

type QrStatusResponse = {
  status?: "wait" | "scaned" | "confirmed" | "expired";
  bot_token?: string;
  baseurl?: string;
  ilink_user_id?: string;
};

export type WeixinQrStartResult = {
  sessionKey: string;
  qrcodeUrl?: string;
  message: string;
};

export type WeixinQrWaitResult = {
  connected: boolean;
  accountId?: string;
  userId?: string;
  message: string;
};

const activeLogins = new Map<string, ActiveLogin>();

function isLoginFresh(login: ActiveLogin): boolean {
  return Date.now() - login.startedAt < ACTIVE_LOGIN_TTL_MS;
}

function purgeExpiredLogins(): void {
  for (const [sessionKey, login] of activeLogins.entries()) {
    if (!isLoginFresh(login)) {
      activeLogins.delete(sessionKey);
    }
  }
}

function buildQrHeaders(account: Pick<ResolvedWeixinAccount, "routeTag">): Record<string, string> {
  return account.routeTag ? { SKRouteTag: account.routeTag } : {};
}

function ensureTrailingSlash(baseUrl: string): string {
  return baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`;
}

async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init);
  if (!response.ok) {
    throw new Error(`WeChat login request failed: ${response.status} ${response.statusText}`);
  }
  return (await response.json()) as T;
}

async function fetchQrCode(account: ResolvedWeixinAccount): Promise<QrCodeResponse> {
  const url = new URL(
    `ilink/bot/get_bot_qrcode?bot_type=${encodeURIComponent(account.botType || DEFAULT_BOT_TYPE)}`,
    ensureTrailingSlash(account.baseUrl),
  );
  return await fetchJson<QrCodeResponse>(url.toString(), {
    headers: buildQrHeaders(account),
  });
}

async function fetchQrStatus(
  login: Pick<ActiveLogin, "baseUrl" | "qrcode">,
  routeTag?: string,
): Promise<QrStatusResponse> {
  const url = new URL(
    `ilink/bot/get_qrcode_status?qrcode=${encodeURIComponent(login.qrcode)}`,
    ensureTrailingSlash(login.baseUrl),
  );
  return await fetchJson<QrStatusResponse>(url.toString(), {
    headers: {
      "iLink-App-ClientVersion": "1",
      ...(routeTag ? { SKRouteTag: routeTag } : {}),
    },
  });
}

function resolveLoginAccount(accountId?: string): ResolvedWeixinAccount {
  return resolveWeixinAccount(loadConfig(), accountId);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function startWeixinLoginWithQr(
  opts: {
    accountId?: string;
    force?: boolean;
    timeoutMs?: number;
    verbose?: boolean;
  } = {},
): Promise<WeixinQrStartResult> {
  const account = resolveLoginAccount(opts.accountId);
  const sessionKey = account.accountId;

  purgeExpiredLogins();
  const existing = activeLogins.get(sessionKey);
  if (!opts.force && existing && isLoginFresh(existing)) {
    return {
      sessionKey,
      qrcodeUrl: existing.qrcodeUrl,
      message: "二维码已就绪，请使用微信扫描。",
    };
  }

  const qr = await fetchQrCode(account);
  if (!qr.qrcode || !qr.qrcode_img_content) {
    return {
      sessionKey,
      message: "微信没有返回可用二维码。",
    };
  }

  activeLogins.set(sessionKey, {
    id: randomUUID(),
    sessionKey,
    accountId: account.accountId,
    baseUrl: account.baseUrl,
    botType: account.botType,
    authFile: account.authFile,
    qrcode: qr.qrcode,
    qrcodeUrl: qr.qrcode_img_content,
    startedAt: Date.now(),
  });

  return {
    sessionKey,
    qrcodeUrl: qr.qrcode_img_content,
    message: "使用微信扫描以下二维码，以完成连接。",
  };
}

export async function waitForWeixinLogin(opts: {
  sessionKey: string;
  timeoutMs?: number;
  verbose?: boolean;
}): Promise<WeixinQrWaitResult> {
  const login = activeLogins.get(opts.sessionKey);
  if (!login) {
    return {
      connected: false,
      message: "当前没有进行中的微信登录，请先生成二维码。",
    };
  }

  const routeTag = resolveLoginAccount(login.accountId).routeTag;
  const deadline = Date.now() + Math.max(opts.timeoutMs ?? ACTIVE_LOGIN_TTL_MS, 1000);

  while (Date.now() <= deadline) {
    const status = await fetchQrStatus(login, routeTag);
    if (status.status === "confirmed" && status.bot_token) {
      writeWeixinAuthFile(login.authFile, {
        token: status.bot_token,
        baseUrl: status.baseurl ?? login.baseUrl,
        userId: status.ilink_user_id,
      });
      activeLogins.delete(opts.sessionKey);
      return {
        connected: true,
        accountId: login.accountId,
        userId: status.ilink_user_id,
        message: "微信账号已连接。",
      };
    }
    if (status.status === "expired") {
      activeLogins.delete(opts.sessionKey);
      return {
        connected: false,
        message: "二维码已过期，请重新生成。",
      };
    }
    await sleep(QR_STATUS_POLL_INTERVAL_MS);
  }

  return {
    connected: false,
    message: "等待扫码确认超时。",
  };
}
