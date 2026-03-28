import crypto from "node:crypto";
import type { ResolvedWeixinAccount } from "./accounts.js";
import { MessageItemType, MessageState, MessageType, type GetUpdatesResp } from "./protocol.js";

const CHANNEL_VERSION = "2026.3.26";
const DEFAULT_API_TIMEOUT_MS = 15_000;
const DEFAULT_LONG_POLL_TIMEOUT_MS = 35_000;

function ensureTrailingSlash(baseUrl: string): string {
  return baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`;
}

function randomWechatUin(): string {
  const uint32 = crypto.randomBytes(4).readUInt32BE(0);
  return Buffer.from(String(uint32), "utf-8").toString("base64");
}

function buildHeaders(account: ResolvedWeixinAccount, body: string): Record<string, string> {
  return {
    "Content-Type": "application/json",
    AuthorizationType: "ilink_bot_token",
    ...(account.token ? { Authorization: `Bearer ${account.token}` } : {}),
    ...(account.routeTag ? { SKRouteTag: account.routeTag } : {}),
    "Content-Length": String(Buffer.byteLength(body, "utf-8")),
    "X-WECHAT-UIN": randomWechatUin(),
  };
}

async function apiFetch(params: {
  account: ResolvedWeixinAccount;
  endpoint: string;
  body: string;
  timeoutMs: number;
  abortSignal?: AbortSignal;
}): Promise<string> {
  const url = new URL(params.endpoint, ensureTrailingSlash(params.account.baseUrl));
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), params.timeoutMs);
  const onAbort = () => controller.abort();
  params.abortSignal?.addEventListener("abort", onAbort, { once: true });

  try {
    const response = await fetch(url.toString(), {
      method: "POST",
      headers: buildHeaders(params.account, params.body),
      body: params.body,
      signal: controller.signal,
    });
    const raw = await response.text();
    if (!response.ok) {
      throw new Error(`WeChat API ${response.status}: ${raw}`);
    }
    return raw;
  } finally {
    clearTimeout(timer);
    params.abortSignal?.removeEventListener("abort", onAbort);
  }
}

export async function getUpdates(params: {
  account: ResolvedWeixinAccount;
  getUpdatesBuf?: string;
  timeoutMs?: number;
  abortSignal?: AbortSignal;
}): Promise<GetUpdatesResp> {
  try {
    const raw = await apiFetch({
      account: params.account,
      endpoint: "ilink/bot/getupdates",
      body: JSON.stringify({
        get_updates_buf: params.getUpdatesBuf ?? "",
        base_info: { channel_version: CHANNEL_VERSION },
      }),
      timeoutMs: params.timeoutMs ?? DEFAULT_LONG_POLL_TIMEOUT_MS,
      abortSignal: params.abortSignal,
    });
    return JSON.parse(raw) as GetUpdatesResp;
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      return { ret: 0, msgs: [], get_updates_buf: params.getUpdatesBuf };
    }
    throw error;
  }
}

let nextClientId = 0;

function generateClientId(): string {
  nextClientId += 1;
  return `openclaw-weixin-${Date.now()}-${nextClientId}`;
}

export async function sendTextWeixin(params: {
  account: ResolvedWeixinAccount;
  to: string;
  text: string;
  contextToken: string;
  abortSignal?: AbortSignal;
}): Promise<{ messageId: string }> {
  const clientId = generateClientId();
  await apiFetch({
    account: params.account,
    endpoint: "ilink/bot/sendmessage",
    body: JSON.stringify({
      msg: {
        from_user_id: "",
        to_user_id: params.to,
        client_id: clientId,
        message_type: MessageType.BOT,
        message_state: MessageState.FINISH,
        item_list: [
          {
            type: MessageItemType.TEXT,
            text_item: { text: params.text },
          },
        ],
        context_token: params.contextToken,
      },
      base_info: { channel_version: CHANNEL_VERSION },
    }),
    timeoutMs: DEFAULT_API_TIMEOUT_MS,
    abortSignal: params.abortSignal,
  });
  return { messageId: clientId };
}
