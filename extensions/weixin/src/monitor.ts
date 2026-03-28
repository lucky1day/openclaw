import { buildAgentMediaPayload, saveMediaBuffer } from "openclaw/plugin-sdk/media-runtime";
import {
  createChannelPairingController,
  dispatchInboundDirectDmWithRuntime,
  resolveInboundDirectDmAccessWithRuntime,
  type ChannelGatewayContext,
  type OpenClawConfig,
} from "../runtime-api.js";
import { acquireWeixinAccountLock } from "./account-lock.js";
import { WEIXIN_CHANNEL, type ResolvedWeixinAccount } from "./accounts.js";
import { getUpdates, sendTextWeixin } from "./api.js";
import { isRecentWeixinInboundMessage } from "./inbound-dedupe.js";
import { type MessageItem, MessageType, type WeixinMessage } from "./protocol.js";
import { getWeixinRuntime } from "./runtime.js";
import { readWeixinSyncBuf, writeWeixinSyncBuf } from "./sync-buf.js";
import {
  DEFAULT_WEIXIN_CDN_BASE_URL,
  downloadWeixinInboundImage,
  findWeixinInboundImageItem,
} from "./weixin-inbound-image.js";

type WeixinLogSink = {
  info?: (msg: string) => void;
  warn?: (msg: string) => void;
  error?: (msg: string) => void;
  debug?: (msg: string) => void;
};

function resolveStableWeixinMessageId(message: WeixinMessage): string | undefined {
  if (typeof message.message_id === "number" && Number.isFinite(message.message_id)) {
    return String(message.message_id);
  }
  if (typeof message.client_id === "string" && message.client_id.trim()) {
    return message.client_id.trim();
  }
  if (typeof message.seq === "number" && Number.isFinite(message.seq)) {
    return `seq:${message.seq}`;
  }
  return undefined;
}

function extractTextBody(itemList?: MessageItem[]): string {
  return (
    itemList
      ?.map((item) => item.text_item?.text?.trim() ?? "")
      .filter(Boolean)
      .join("\n") ?? ""
  );
}

function markdownToPlainText(text: string): string {
  return text
    .replace(/```[^\n]*\n?([\s\S]*?)```/g, (_, code: string) => code.trim())
    .replace(/!\[[^\]]*\]\([^)]*\)/g, "")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/\*\*(.+?)\*\*/g, "$1")
    .replace(/\*(.+?)\*/g, "$1")
    .replace(/__(.+?)__/g, "$1")
    .replace(/_(.+?)_/g, "$1")
    .replace(/~~(.+?)~~/g, "$1")
    .replace(/`(.+?)`/g, "$1");
}

function isWeixinSenderAllowed(senderId: string, allowFrom: string[]): boolean {
  return allowFrom.some((entry) => entry.trim() === senderId);
}

async function resolveWeixinDirectAccess(params: {
  cfg: OpenClawConfig;
  account: ResolvedWeixinAccount;
  senderId: string;
  rawBody: string;
}) {
  const runtime = getWeixinRuntime();
  return await resolveInboundDirectDmAccessWithRuntime({
    cfg: params.cfg,
    channel: WEIXIN_CHANNEL,
    accountId: params.account.accountId,
    dmPolicy: params.account.dmPolicy,
    allowFrom: params.account.allowFrom,
    senderId: params.senderId,
    rawBody: params.rawBody,
    isSenderAllowed: isWeixinSenderAllowed,
    readStoreAllowFrom: async (_provider, accountId) =>
      await runtime.channel.pairing.readAllowFromStore({
        channel: WEIXIN_CHANNEL,
        accountId,
      }),
    runtime: {
      shouldComputeCommandAuthorized: runtime.channel.commands.shouldComputeCommandAuthorized,
      resolveCommandAuthorizedFromAuthorizers:
        runtime.channel.commands.resolveCommandAuthorizedFromAuthorizers,
    },
    modeWhenAccessGroupsOff: "configured",
  });
}

export async function processWeixinDirectMessage(params: {
  cfg: OpenClawConfig;
  account: ResolvedWeixinAccount;
  message: WeixinMessage;
  log?: WeixinLogSink;
  statusSink?: (patch: {
    connected?: boolean;
    lastError?: string | null;
    lastInboundAt?: number | null;
    lastOutboundAt?: number | null;
  }) => void;
}): Promise<void> {
  const runtime = getWeixinRuntime();
  const senderId = params.message.from_user_id?.trim();
  if (!senderId || params.message.group_id) {
    return;
  }
  if (params.message.message_type === MessageType.BOT) {
    return;
  }

  const stableMessageId = resolveStableWeixinMessageId(params.message);
  if (
    stableMessageId &&
    isRecentWeixinInboundMessage({
      accountId: params.account.accountId,
      senderId,
      messageId: stableMessageId,
    })
  ) {
    params.log?.debug?.(
      `[${params.account.accountId}] skipping duplicate WeChat message ${stableMessageId} from ${senderId}`,
    );
    return;
  }

  params.statusSink?.({
    connected: true,
    lastError: null,
    lastInboundAt: params.message.create_time_ms ?? Date.now(),
  });

  const textBody = extractTextBody(params.message.item_list);
  let rawBody = textBody;
  let bodyForAgent = textBody;
  let mediaContext: Record<string, unknown> | undefined;
  let imageDownloadFailed = false;
  const imageItem = findWeixinInboundImageItem(params.message.item_list);
  if (imageItem) {
    try {
      const inboundImage = await downloadWeixinInboundImage(imageItem, {
        cdnBaseUrl: DEFAULT_WEIXIN_CDN_BASE_URL,
        saveMedia: saveMediaBuffer,
        label: `[${params.account.accountId}] inbound image`,
      });
      if (inboundImage) {
        mediaContext = buildAgentMediaPayload([
          { path: inboundImage.path, contentType: inboundImage.contentType },
        ]);
        if (!rawBody) {
          rawBody = "<media:image>";
          bodyForAgent = rawBody;
        }
      }
    } catch (error) {
      imageDownloadFailed = true;
      params.log?.warn?.(
        `[${params.account.accountId}] failed downloading inbound WeChat image: ${String(error)}`,
      );
    }
  }
  const resolvedAccess = await resolveWeixinDirectAccess({
    cfg: params.cfg,
    account: params.account,
    senderId,
    rawBody,
  });

  if (resolvedAccess.access.decision === "block") {
    params.log?.debug?.(
      `[${params.account.accountId}] blocked WeChat sender ${senderId} (${resolvedAccess.access.reason})`,
    );
    return;
  }

  if (!params.message.context_token) {
    params.log?.warn?.(
      `[${params.account.accountId}] dropping WeChat DM without context_token from ${senderId}`,
    );
    return;
  }

  if (resolvedAccess.access.decision === "pairing") {
    const pairing = createChannelPairingController({
      core: runtime,
      channel: WEIXIN_CHANNEL,
      accountId: params.account.accountId,
    });
    await pairing.issueChallenge({
      senderId,
      senderIdLine: `Your WeChat ID: ${senderId}`,
      sendPairingReply: async (text) => {
        await sendTextWeixin({
          account: params.account,
          to: senderId,
          text,
          contextToken: params.message.context_token!,
        });
        params.statusSink?.({
          connected: true,
          lastError: null,
          lastOutboundAt: Date.now(),
        });
      },
      onCreated: () => {
        params.log?.debug?.(`[${params.account.accountId}] pairing requested for ${senderId}`);
      },
      onReplyError: (error) => {
        params.log?.warn?.(
          `[${params.account.accountId}] failed sending WeChat pairing reply: ${String(error)}`,
        );
      },
    });
    return;
  }

  if (!rawBody && !mediaContext) {
    if (imageDownloadFailed) {
      params.log?.debug?.(
        `[${params.account.accountId}] dropping image-only WeChat DM after media download failure`,
      );
    }
    return;
  }

  await dispatchInboundDirectDmWithRuntime({
    cfg: params.cfg,
    runtime,
    channel: WEIXIN_CHANNEL,
    channelLabel: "WeChat",
    accountId: params.account.accountId,
    peer: { kind: "direct", id: senderId },
    senderId,
    senderAddress: `weixin:${senderId}`,
    recipientAddress: `weixin:${params.message.to_user_id ?? params.account.userId ?? params.account.accountId}`,
    conversationLabel: senderId,
    rawBody,
    bodyForAgent,
    messageId: stableMessageId ?? String(Date.now()),
    timestamp: params.message.create_time_ms,
    commandAuthorized: resolvedAccess.commandAuthorized,
    extraContext: mediaContext,
    deliver: async (payload) => {
      const runtime = getWeixinRuntime();
      const rawText =
        payload && typeof payload === "object" && "text" in payload
          ? String((payload as { text?: string }).text ?? "")
          : "";
      const tableMode = runtime.channel.text.resolveMarkdownTableMode({
        cfg: params.cfg,
        channel: WEIXIN_CHANNEL,
        accountId: params.account.accountId,
      });
      const outboundText = markdownToPlainText(
        runtime.channel.text.convertMarkdownTables(rawText, tableMode),
      ).trim();
      if (!outboundText) {
        return;
      }
      await sendTextWeixin({
        account: params.account,
        to: senderId,
        text: outboundText,
        contextToken: params.message.context_token!,
      });
      params.statusSink?.({
        connected: true,
        lastError: null,
        lastOutboundAt: Date.now(),
      });
    },
    onRecordError: (error) => {
      params.log?.error?.(
        `[${params.account.accountId}] failed recording WeChat inbound session: ${String(error)}`,
      );
    },
    onDispatchError: (error, info) => {
      params.log?.error?.(
        `[${params.account.accountId}] WeChat ${info.kind} reply failed: ${String(error)}`,
      );
    },
  });
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener(
      "abort",
      () => {
        clearTimeout(timer);
        reject(new Error("aborted"));
      },
      { once: true },
    );
  });
}

export async function monitorWeixinAccount(
  ctx: ChannelGatewayContext<ResolvedWeixinAccount>,
): Promise<void> {
  if (!ctx.account.token) {
    throw new Error("WeChat account is not linked. Run QR login first.");
  }
  const setStatus = (
    patch: Partial<{
      configured: boolean;
      enabled: boolean;
      running: boolean;
      connected: boolean;
      lastError: string | null;
      lastInboundAt: number | null;
      lastOutboundAt: number | null;
    }>,
  ) => {
    ctx.setStatus({ accountId: ctx.account.accountId, ...patch });
  };
  const lockRetryMs = Math.max(250, Math.min(5_000, ctx.account.pollIntervalMs));

  ctx.log?.info?.(`[${ctx.account.accountId}] monitor started (${ctx.account.baseUrl})`);

  try {
    while (!ctx.abortSignal.aborted) {
      let lock;
      try {
        lock = await acquireWeixinAccountLock(ctx.account);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        ctx.log?.warn?.(`[${ctx.account.accountId}] ${message}`);
        setStatus({
          configured: true,
          enabled: ctx.account.enabled,
          running: false,
          connected: false,
          lastError: message,
        });
        await sleep(lockRetryMs, ctx.abortSignal).catch(() => undefined);
        continue;
      }

      let getUpdatesBuf = readWeixinSyncBuf(ctx.account.syncBufFile);

      try {
        setStatus({
          connected: true,
          configured: true,
          enabled: ctx.account.enabled,
          running: true,
          lastError: null,
        });

        while (!ctx.abortSignal.aborted) {
          try {
            const response = await getUpdates({
              account: ctx.account,
              getUpdatesBuf,
              abortSignal: ctx.abortSignal,
            });

            setStatus({
              connected: true,
              configured: true,
              enabled: ctx.account.enabled,
              running: true,
              lastError: null,
            });

            if (response.get_updates_buf && response.get_updates_buf !== getUpdatesBuf) {
              getUpdatesBuf = response.get_updates_buf;
              writeWeixinSyncBuf(ctx.account.syncBufFile, getUpdatesBuf);
            }

            for (const message of response.msgs ?? []) {
              await processWeixinDirectMessage({
                cfg: ctx.cfg,
                account: ctx.account,
                message,
                log: ctx.log,
                statusSink: setStatus,
              });
            }
          } catch (error) {
            if (ctx.abortSignal.aborted) {
              return;
            }
            ctx.log?.warn?.(`[${ctx.account.accountId}] WeChat poll failed: ${String(error)}`);
            setStatus({
              connected: false,
              lastError: String(error),
            });
            await sleep(ctx.account.pollIntervalMs, ctx.abortSignal).catch(() => undefined);
          }
        }
      } finally {
        await lock.release().catch((error) => {
          ctx.log?.warn?.(
            `[${ctx.account.accountId}] failed to release WeChat account lock: ${String(error)}`,
          );
        });
      }
    }
  } finally {
    setStatus({
      connected: false,
      lastError: null,
    });
  }
}
