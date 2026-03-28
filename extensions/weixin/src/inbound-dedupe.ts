import { createDedupeCache } from "openclaw/plugin-sdk/infra-runtime";

const RECENT_WEIXIN_MESSAGE_TTL_MS = 20 * 60_000;
const RECENT_WEIXIN_MESSAGE_MAX = 5000;

const recentInboundMessages = createDedupeCache({
  ttlMs: RECENT_WEIXIN_MESSAGE_TTL_MS,
  maxSize: RECENT_WEIXIN_MESSAGE_MAX,
});

function buildWeixinInboundMessageKey(params: {
  accountId: string;
  senderId: string;
  messageId: string;
}): string | null {
  const accountId = params.accountId.trim();
  const senderId = params.senderId.trim();
  const messageId = params.messageId.trim();
  if (!accountId || !senderId || !messageId) {
    return null;
  }
  return `${accountId}:${senderId}:${messageId}`;
}

export function isRecentWeixinInboundMessage(params: {
  accountId: string;
  senderId: string;
  messageId: string;
}): boolean {
  const key = buildWeixinInboundMessageKey(params);
  if (!key) {
    return false;
  }
  return recentInboundMessages.check(key);
}

export function resetWeixinInboundDedupe(): void {
  recentInboundMessages.clear();
}
