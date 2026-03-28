import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import type { PluginRuntime } from "openclaw/plugin-sdk/core";
import { drainFileLockStateForTest } from "openclaw/plugin-sdk/infra-runtime";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createStartAccountContext } from "../../../test/helpers/extensions/start-account-context.js";
import { resetWeixinAccountLocksForTest } from "./account-lock.js";
import type { ResolvedWeixinAccount } from "./accounts.js";
import { resetWeixinInboundDedupe } from "./inbound-dedupe.js";
import { setWeixinRuntime } from "./runtime.js";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

afterEach(async () => {
  vi.unstubAllGlobals();
  resetWeixinInboundDedupe();
  await resetWeixinAccountLocksForTest();
  await drainFileLockStateForTest();
});

describe("weixin monitor", () => {
  it("dispatches a direct DM through the reply pipeline and sends the text reply back to WeChat", async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ ret: 0 }));
    const recordInboundSession = vi.fn(async () => {});
    const dispatchReplyWithBufferedBlockDispatcher = vi.fn(async ({ dispatcherOptions }) => {
      await dispatcherOptions.deliver({ text: "**reply**" });
    });

    vi.stubGlobal("fetch", fetchMock);
    setWeixinRuntime({
      channel: {
        routing: {
          resolveAgentRoute: vi.fn(({ accountId, peer }) => ({
            agentId: "agent-main",
            accountId,
            sessionKey: `dm:${peer.id}`,
          })),
        },
        session: {
          resolveStorePath: vi.fn(() => "/tmp/weixin-session-store"),
          readSessionUpdatedAt: vi.fn(() => 1234),
          recordInboundSession,
          recordSessionMetaFromInbound: vi.fn(),
          updateLastRoute: vi.fn(),
        },
        reply: {
          resolveEnvelopeFormatOptions: vi.fn(() => ({ mode: "agent" })),
          formatAgentEnvelope: vi.fn(({ body }) => `env:${body}`),
          finalizeInboundContext: vi.fn((ctx) => ctx),
          dispatchReplyWithBufferedBlockDispatcher,
        },
        text: {
          resolveMarkdownTableMode: vi.fn(() => "off"),
          convertMarkdownTables: vi.fn((text) => text),
        },
        commands: {
          shouldComputeCommandAuthorized: vi.fn(() => false),
          resolveCommandAuthorizedFromAuthorizers: vi.fn(() => false),
        },
        pairing: {
          readAllowFromStore: vi.fn(async () => []),
          upsertPairingRequest: vi.fn(async () => {}),
        },
      },
    } as unknown as PluginRuntime);

    const { processWeixinDirectMessage } = await import("./monitor.js");

    await processWeixinDirectMessage({
      cfg: {
        session: { store: { type: "jsonl" } },
        commands: { useAccessGroups: true },
      } as never,
      account: {
        accountId: "work",
        enabled: true,
        configured: true,
        baseUrl: "https://wx.example.com",
        token: "bot-token",
        authFile: "/tmp/weixin-auth.json",
        syncBufFile: "/tmp/weixin-sync.json",
        pollIntervalMs: 1000,
        botType: "3",
        dmPolicy: "open",
      } satisfies ResolvedWeixinAccount,
      message: {
        message_id: 42,
        from_user_id: "wx-user-1",
        to_user_id: "wx-bot-1",
        create_time_ms: 1_710_000_000_000,
        message_type: 1,
        context_token: "ctx-token-1",
        item_list: [
          {
            type: 1,
            text_item: { text: "hello" },
          },
        ],
      },
      log: {
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
        debug: vi.fn(),
      },
    });

    expect(recordInboundSession).toHaveBeenCalledTimes(1);
    expect(dispatchReplyWithBufferedBlockDispatcher).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    const [requestUrl, requestInit] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(requestUrl).toContain("ilink/bot/sendmessage");
    const body = JSON.parse(String(requestInit.body)) as {
      msg?: {
        to_user_id?: string;
        context_token?: string;
        item_list?: Array<{ text_item?: { text?: string } }>;
      };
    };
    expect(body.msg?.to_user_id).toBe("wx-user-1");
    expect(body.msg?.context_token).toBe("ctx-token-1");
    expect(body.msg?.item_list?.[0]?.text_item?.text).toBe("reply");
  });

  it("deduplicates repeated inbound WeChat message ids", async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ ret: 0 }));
    const recordInboundSession = vi.fn(async () => {});
    const dispatchReplyWithBufferedBlockDispatcher = vi.fn(async ({ dispatcherOptions }) => {
      await dispatcherOptions.deliver({ text: "reply once" });
    });

    vi.stubGlobal("fetch", fetchMock);
    setWeixinRuntime({
      channel: {
        routing: {
          resolveAgentRoute: vi.fn(({ accountId, peer }) => ({
            agentId: "agent-main",
            accountId,
            sessionKey: `dm:${peer.id}`,
          })),
        },
        session: {
          resolveStorePath: vi.fn(() => "/tmp/weixin-session-store"),
          readSessionUpdatedAt: vi.fn(() => 1234),
          recordInboundSession,
          recordSessionMetaFromInbound: vi.fn(),
          updateLastRoute: vi.fn(),
        },
        reply: {
          resolveEnvelopeFormatOptions: vi.fn(() => ({ mode: "agent" })),
          formatAgentEnvelope: vi.fn(({ body }) => `env:${body}`),
          finalizeInboundContext: vi.fn((ctx) => ctx),
          dispatchReplyWithBufferedBlockDispatcher,
        },
        text: {
          resolveMarkdownTableMode: vi.fn(() => "off"),
          convertMarkdownTables: vi.fn((text) => text),
        },
        commands: {
          shouldComputeCommandAuthorized: vi.fn(() => false),
          resolveCommandAuthorizedFromAuthorizers: vi.fn(() => false),
        },
        pairing: {
          readAllowFromStore: vi.fn(async () => []),
          upsertPairingRequest: vi.fn(async () => {}),
        },
      },
    } as unknown as PluginRuntime);

    const { processWeixinDirectMessage } = await import("./monitor.js");

    const params: Parameters<typeof processWeixinDirectMessage>[0] = {
      cfg: {
        session: { store: { type: "jsonl" } },
        commands: { useAccessGroups: true },
      } as never,
      account: {
        accountId: "work",
        enabled: true,
        configured: true,
        baseUrl: "https://wx.example.com",
        token: "bot-token",
        userId: "wx-bot-1",
        authFile: "/tmp/weixin-auth.json",
        syncBufFile: "/tmp/weixin-sync.json",
        pollIntervalMs: 1000,
        botType: "3",
        dmPolicy: "open",
      },
      message: {
        message_id: 42,
        from_user_id: "wx-user-1",
        to_user_id: "wx-bot-1",
        create_time_ms: 1_710_000_000_000,
        message_type: 1,
        context_token: "ctx-token-1",
        item_list: [
          {
            type: 1,
            text_item: { text: "hello" },
          },
        ],
      },
      log: {
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
        debug: vi.fn(),
      },
    };

    await processWeixinDirectMessage(params);
    await processWeixinDirectMessage(params);

    expect(recordInboundSession).toHaveBeenCalledTimes(1);
    expect(dispatchReplyWithBufferedBlockDispatcher).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("attaches inbound image media context while preserving text", async () => {
    const finalizeInboundContext = vi.fn((ctx) => ctx);
    const dispatchReplyWithBufferedBlockDispatcher = vi.fn(async () => {});
    const fetchMock = vi.fn(async (url: string) => {
      if (url.includes("/download?")) {
        return new Response(new Uint8Array(Buffer.from("image-bytes")), { status: 200 });
      }
      return jsonResponse({ ret: 0 });
    });

    vi.stubGlobal("fetch", fetchMock);
    setWeixinRuntime({
      channel: {
        routing: {
          resolveAgentRoute: vi.fn(({ accountId, peer }) => ({
            agentId: "agent-main",
            accountId,
            sessionKey: `dm:${peer.id}`,
          })),
        },
        session: {
          resolveStorePath: vi.fn(() => "/tmp/weixin-session-store"),
          readSessionUpdatedAt: vi.fn(() => 1234),
          recordInboundSession: vi.fn(async () => {}),
          recordSessionMetaFromInbound: vi.fn(),
          updateLastRoute: vi.fn(),
        },
        reply: {
          resolveEnvelopeFormatOptions: vi.fn(() => ({ mode: "agent" })),
          formatAgentEnvelope: vi.fn(({ body }) => `env:${body}`),
          finalizeInboundContext,
          dispatchReplyWithBufferedBlockDispatcher,
        },
        text: {
          resolveMarkdownTableMode: vi.fn(() => "off"),
          convertMarkdownTables: vi.fn((text) => text),
        },
        commands: {
          shouldComputeCommandAuthorized: vi.fn(() => false),
          resolveCommandAuthorizedFromAuthorizers: vi.fn(() => false),
        },
        pairing: {
          readAllowFromStore: vi.fn(async () => []),
          upsertPairingRequest: vi.fn(async () => {}),
        },
      },
    } as unknown as PluginRuntime);

    const { processWeixinDirectMessage } = await import("./monitor.js");

    await processWeixinDirectMessage({
      cfg: {
        session: { store: { type: "jsonl" } },
        commands: { useAccessGroups: true },
      } as never,
      account: {
        accountId: "work",
        enabled: true,
        configured: true,
        baseUrl: "https://wx.example.com",
        token: "bot-token",
        authFile: "/tmp/weixin-auth.json",
        syncBufFile: "/tmp/weixin-sync.json",
        pollIntervalMs: 1000,
        botType: "3",
        dmPolicy: "open",
      } satisfies ResolvedWeixinAccount,
      message: {
        message_id: 108,
        from_user_id: "wx-user-2",
        to_user_id: "wx-bot-1",
        create_time_ms: 1_710_000_000_001,
        message_type: 1,
        context_token: "ctx-token-2",
        item_list: [
          {
            type: 1,
            text_item: { text: "describe this" },
          },
          {
            type: 2,
            image_item: {
              media: {
                encrypt_query_param: "encrypted-image",
              },
            },
          },
        ],
      } as never,
      log: {
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
        debug: vi.fn(),
      },
    });

    expect(finalizeInboundContext).toHaveBeenCalledWith(
      expect.objectContaining({
        BodyForAgent: "describe this",
        RawBody: "describe this",
        MediaPath: expect.stringContaining(path.sep),
        MediaUrl: expect.stringContaining(path.sep),
        MediaUrls: [expect.stringContaining(path.sep)],
        MediaType: "image/*",
        MediaTypes: ["image/*"],
      }),
    );
    expect(dispatchReplyWithBufferedBlockDispatcher).toHaveBeenCalledTimes(1);
  });

  it("uses a media placeholder body for image-only direct messages", async () => {
    const finalizeInboundContext = vi.fn((ctx) => ctx);
    const dispatchReplyWithBufferedBlockDispatcher = vi.fn(async () => {});
    const fetchMock = vi.fn(async (url: string) => {
      if (url.includes("/download?")) {
        return new Response(new Uint8Array(Buffer.from("image-only-bytes")), { status: 200 });
      }
      return jsonResponse({ ret: 0 });
    });

    vi.stubGlobal("fetch", fetchMock);
    setWeixinRuntime({
      channel: {
        routing: {
          resolveAgentRoute: vi.fn(({ accountId, peer }) => ({
            agentId: "agent-main",
            accountId,
            sessionKey: `dm:${peer.id}`,
          })),
        },
        session: {
          resolveStorePath: vi.fn(() => "/tmp/weixin-session-store"),
          readSessionUpdatedAt: vi.fn(() => 1234),
          recordInboundSession: vi.fn(async () => {}),
          recordSessionMetaFromInbound: vi.fn(),
          updateLastRoute: vi.fn(),
        },
        reply: {
          resolveEnvelopeFormatOptions: vi.fn(() => ({ mode: "agent" })),
          formatAgentEnvelope: vi.fn(({ body }) => `env:${body}`),
          finalizeInboundContext,
          dispatchReplyWithBufferedBlockDispatcher,
        },
        text: {
          resolveMarkdownTableMode: vi.fn(() => "off"),
          convertMarkdownTables: vi.fn((text) => text),
        },
        commands: {
          shouldComputeCommandAuthorized: vi.fn(() => false),
          resolveCommandAuthorizedFromAuthorizers: vi.fn(() => false),
        },
        pairing: {
          readAllowFromStore: vi.fn(async () => []),
          upsertPairingRequest: vi.fn(async () => {}),
        },
      },
    } as unknown as PluginRuntime);

    const { processWeixinDirectMessage } = await import("./monitor.js");

    await processWeixinDirectMessage({
      cfg: {
        session: { store: { type: "jsonl" } },
        commands: { useAccessGroups: true },
      } as never,
      account: {
        accountId: "work",
        enabled: true,
        configured: true,
        baseUrl: "https://wx.example.com",
        token: "bot-token",
        authFile: "/tmp/weixin-auth.json",
        syncBufFile: "/tmp/weixin-sync.json",
        pollIntervalMs: 1000,
        botType: "3",
        dmPolicy: "open",
      } satisfies ResolvedWeixinAccount,
      message: {
        message_id: 109,
        from_user_id: "wx-user-3",
        to_user_id: "wx-bot-1",
        create_time_ms: 1_710_000_000_002,
        message_type: 1,
        context_token: "ctx-token-3",
        item_list: [
          {
            type: 2,
            image_item: {
              media: {
                encrypt_query_param: "image-only",
              },
            },
          },
        ],
      } as never,
      log: {
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
        debug: vi.fn(),
      },
    });

    expect(finalizeInboundContext).toHaveBeenCalledWith(
      expect.objectContaining({
        BodyForAgent: "<media:image>",
        RawBody: "<media:image>",
        MediaPath: expect.stringContaining(path.sep),
      }),
    );
    expect(dispatchReplyWithBufferedBlockDispatcher).toHaveBeenCalledTimes(1);
  });

  it("falls back to text-only dispatch when image download fails on a mixed message", async () => {
    const finalizeInboundContext = vi.fn((ctx) => ctx);
    const dispatchReplyWithBufferedBlockDispatcher = vi.fn(async () => {});
    const warnLog = vi.fn();
    const fetchMock = vi.fn(async (url: string) => {
      if (url.includes("/download?")) {
        throw new Error("cdn unavailable");
      }
      return jsonResponse({ ret: 0 });
    });

    vi.stubGlobal("fetch", fetchMock);
    setWeixinRuntime({
      channel: {
        routing: {
          resolveAgentRoute: vi.fn(({ accountId, peer }) => ({
            agentId: "agent-main",
            accountId,
            sessionKey: `dm:${peer.id}`,
          })),
        },
        session: {
          resolveStorePath: vi.fn(() => "/tmp/weixin-session-store"),
          readSessionUpdatedAt: vi.fn(() => 1234),
          recordInboundSession: vi.fn(async () => {}),
          recordSessionMetaFromInbound: vi.fn(),
          updateLastRoute: vi.fn(),
        },
        reply: {
          resolveEnvelopeFormatOptions: vi.fn(() => ({ mode: "agent" })),
          formatAgentEnvelope: vi.fn(({ body }) => `env:${body}`),
          finalizeInboundContext,
          dispatchReplyWithBufferedBlockDispatcher,
        },
        text: {
          resolveMarkdownTableMode: vi.fn(() => "off"),
          convertMarkdownTables: vi.fn((text) => text),
        },
        commands: {
          shouldComputeCommandAuthorized: vi.fn(() => false),
          resolveCommandAuthorizedFromAuthorizers: vi.fn(() => false),
        },
        pairing: {
          readAllowFromStore: vi.fn(async () => []),
          upsertPairingRequest: vi.fn(async () => {}),
        },
      },
    } as unknown as PluginRuntime);

    const { processWeixinDirectMessage } = await import("./monitor.js");

    await processWeixinDirectMessage({
      cfg: {
        session: { store: { type: "jsonl" } },
        commands: { useAccessGroups: true },
      } as never,
      account: {
        accountId: "work",
        enabled: true,
        configured: true,
        baseUrl: "https://wx.example.com",
        token: "bot-token",
        authFile: "/tmp/weixin-auth.json",
        syncBufFile: "/tmp/weixin-sync.json",
        pollIntervalMs: 1000,
        botType: "3",
        dmPolicy: "open",
      } satisfies ResolvedWeixinAccount,
      message: {
        message_id: 110,
        from_user_id: "wx-user-4",
        to_user_id: "wx-bot-1",
        create_time_ms: 1_710_000_000_003,
        message_type: 1,
        context_token: "ctx-token-4",
        item_list: [
          {
            type: 1,
            text_item: { text: "still answer text" },
          },
          {
            type: 2,
            image_item: {
              media: {
                encrypt_query_param: "broken-image",
              },
            },
          },
        ],
      } as never,
      log: {
        info: vi.fn(),
        warn: warnLog,
        error: vi.fn(),
        debug: vi.fn(),
      },
    });

    expect(finalizeInboundContext).toHaveBeenCalledWith(
      expect.objectContaining({
        BodyForAgent: "still answer text",
        RawBody: "still answer text",
      }),
    );
    expect(finalizeInboundContext.mock.calls[0]?.[0]).not.toHaveProperty("MediaPath");
    expect(dispatchReplyWithBufferedBlockDispatcher).toHaveBeenCalledTimes(1);
    expect(warnLog).toHaveBeenCalledWith(
      expect.stringContaining("failed downloading inbound WeChat image"),
    );
  });

  it("drops image-only messages when image download fails", async () => {
    const finalizeInboundContext = vi.fn((ctx) => ctx);
    const dispatchReplyWithBufferedBlockDispatcher = vi.fn(async () => {});
    const debugLog = vi.fn();
    const fetchMock = vi.fn(async (url: string) => {
      if (url.includes("/download?")) {
        throw new Error("cdn unavailable");
      }
      return jsonResponse({ ret: 0 });
    });

    vi.stubGlobal("fetch", fetchMock);
    setWeixinRuntime({
      channel: {
        routing: {
          resolveAgentRoute: vi.fn(({ accountId, peer }) => ({
            agentId: "agent-main",
            accountId,
            sessionKey: `dm:${peer.id}`,
          })),
        },
        session: {
          resolveStorePath: vi.fn(() => "/tmp/weixin-session-store"),
          readSessionUpdatedAt: vi.fn(() => 1234),
          recordInboundSession: vi.fn(async () => {}),
          recordSessionMetaFromInbound: vi.fn(),
          updateLastRoute: vi.fn(),
        },
        reply: {
          resolveEnvelopeFormatOptions: vi.fn(() => ({ mode: "agent" })),
          formatAgentEnvelope: vi.fn(({ body }) => `env:${body}`),
          finalizeInboundContext,
          dispatchReplyWithBufferedBlockDispatcher,
        },
        text: {
          resolveMarkdownTableMode: vi.fn(() => "off"),
          convertMarkdownTables: vi.fn((text) => text),
        },
        commands: {
          shouldComputeCommandAuthorized: vi.fn(() => false),
          resolveCommandAuthorizedFromAuthorizers: vi.fn(() => false),
        },
        pairing: {
          readAllowFromStore: vi.fn(async () => []),
          upsertPairingRequest: vi.fn(async () => {}),
        },
      },
    } as unknown as PluginRuntime);

    const { processWeixinDirectMessage } = await import("./monitor.js");

    await processWeixinDirectMessage({
      cfg: {
        session: { store: { type: "jsonl" } },
        commands: { useAccessGroups: true },
      } as never,
      account: {
        accountId: "work",
        enabled: true,
        configured: true,
        baseUrl: "https://wx.example.com",
        token: "bot-token",
        authFile: "/tmp/weixin-auth.json",
        syncBufFile: "/tmp/weixin-sync.json",
        pollIntervalMs: 1000,
        botType: "3",
        dmPolicy: "open",
      } satisfies ResolvedWeixinAccount,
      message: {
        message_id: 111,
        from_user_id: "wx-user-5",
        to_user_id: "wx-bot-1",
        create_time_ms: 1_710_000_000_004,
        message_type: 1,
        context_token: "ctx-token-5",
        item_list: [
          {
            type: 2,
            image_item: {
              media: {
                encrypt_query_param: "broken-image-only",
              },
            },
          },
        ],
      } as never,
      log: {
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
        debug: debugLog,
      },
    });

    expect(finalizeInboundContext).not.toHaveBeenCalled();
    expect(dispatchReplyWithBufferedBlockDispatcher).not.toHaveBeenCalled();
    expect(debugLog).toHaveBeenCalledWith(
      expect.stringContaining("dropping image-only WeChat DM after media download failure"),
    );
  });

  it("polls updates, persists sync buffers, and stops cleanly on abort", async () => {
    const tempDir = mkdtempSync(path.join(os.tmpdir(), "openclaw-weixin-sync-"));
    const abortController = new AbortController();
    const syncBufFile = path.join(tempDir, "sync-buf.txt");
    const statusSnapshots: Array<Record<string, unknown>> = [];
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse({
          ret: 0,
          get_updates_buf: "buf-1",
          msgs: [
            {
              message_id: 7,
              from_user_id: "wx-user-2",
              to_user_id: "wx-bot-1",
              create_time_ms: 1_710_000_000_100,
              message_type: 1,
              context_token: "ctx-token-2",
              item_list: [{ type: 1, text_item: { text: "ping" } }],
            },
          ],
        }),
      )
      .mockResolvedValueOnce(jsonResponse({ ret: 0 }));
    const recordInboundSession = vi.fn(async () => {});
    const dispatchReplyWithBufferedBlockDispatcher = vi.fn(async ({ dispatcherOptions }) => {
      await dispatcherOptions.deliver({ text: "pong" });
      abortController.abort();
    });

    vi.stubGlobal("fetch", fetchMock);
    setWeixinRuntime({
      channel: {
        routing: {
          resolveAgentRoute: vi.fn(({ accountId, peer }) => ({
            agentId: "agent-main",
            accountId,
            sessionKey: `dm:${peer.id}`,
          })),
        },
        session: {
          resolveStorePath: vi.fn(() => "/tmp/weixin-session-store"),
          readSessionUpdatedAt: vi.fn(() => 1234),
          recordInboundSession,
          recordSessionMetaFromInbound: vi.fn(),
          updateLastRoute: vi.fn(),
        },
        reply: {
          resolveEnvelopeFormatOptions: vi.fn(() => ({ mode: "agent" })),
          formatAgentEnvelope: vi.fn(({ body }) => `env:${body}`),
          finalizeInboundContext: vi.fn((ctx) => ctx),
          dispatchReplyWithBufferedBlockDispatcher,
        },
        text: {
          resolveMarkdownTableMode: vi.fn(() => "off"),
          convertMarkdownTables: vi.fn((text) => text),
        },
        commands: {
          shouldComputeCommandAuthorized: vi.fn(() => false),
          resolveCommandAuthorizedFromAuthorizers: vi.fn(() => false),
        },
        pairing: {
          readAllowFromStore: vi.fn(async () => []),
          upsertPairingRequest: vi.fn(async () => {}),
        },
      },
    } as unknown as PluginRuntime);

    const { monitorWeixinAccount } = await import("./monitor.js");

    try {
      await monitorWeixinAccount(
        createStartAccountContext({
          account: {
            accountId: "work",
            enabled: true,
            configured: true,
            baseUrl: "https://wx.example.com",
            token: "bot-token",
            authFile: "/tmp/weixin-auth.json",
            syncBufFile,
            pollIntervalMs: 1000,
            botType: "3",
            dmPolicy: "open",
          },
          cfg: {
            session: { store: { type: "jsonl" } },
            commands: { useAccessGroups: true },
          } as never,
          abortSignal: abortController.signal,
          statusPatchSink: (snapshot) => {
            statusSnapshots.push({ ...snapshot });
          },
        }),
      );

      expect(readFileSync(syncBufFile, "utf-8")).toBe("buf-1");
      expect(recordInboundSession).toHaveBeenCalledTimes(1);
      expect(fetchMock).toHaveBeenCalledTimes(2);
      expect(statusSnapshots.at(-1)).toMatchObject({
        accountId: "work",
        connected: false,
        lastInboundAt: 1_710_000_000_100,
        lastOutboundAt: expect.any(Number),
        lastError: null,
      });
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it("keeps a second monitor passive while the same WeChat account is already locked", async () => {
    const abortFirst = new AbortController();
    const abortSecond = new AbortController();
    const tempDir = mkdtempSync(path.join(os.tmpdir(), "openclaw-weixin-lock-monitor-"));
    const syncBufFile = path.join(tempDir, "sync-buf.txt");
    const secondSnapshots: Array<Record<string, unknown>> = [];
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
      await new Promise<void>((resolve, reject) => {
        const signal = init?.signal;
        if (!signal) {
          return;
        }
        if (signal.aborted) {
          const error = new Error("aborted");
          error.name = "AbortError";
          reject(error);
          return;
        }
        signal.addEventListener(
          "abort",
          () => {
            const error = new Error("aborted");
            error.name = "AbortError";
            reject(error);
          },
          { once: true },
        );
      });
      return jsonResponse({ ret: 0 });
    });

    vi.stubGlobal("fetch", fetchMock);

    const { monitorWeixinAccount } = await import("./monitor.js");

    const account: ResolvedWeixinAccount = {
      accountId: "work",
      enabled: true,
      configured: true,
      baseUrl: "https://wx.example.com",
      token: "bot-token",
      userId: "wx-bot-1",
      authFile: path.join(tempDir, "auth.json"),
      syncBufFile,
      pollIntervalMs: 25,
      botType: "3",
      dmPolicy: "open",
    };

    const firstPromise = monitorWeixinAccount(
      createStartAccountContext({
        account,
        abortSignal: abortFirst.signal,
        cfg: {
          session: { store: { type: "jsonl" } },
          commands: { useAccessGroups: true },
        } as never,
      }),
    );

    await new Promise((resolve) => setTimeout(resolve, 10));

    const secondPromise = monitorWeixinAccount(
      createStartAccountContext({
        account,
        abortSignal: abortSecond.signal,
        cfg: {
          session: { store: { type: "jsonl" } },
          commands: { useAccessGroups: true },
        } as never,
        statusPatchSink: (snapshot) => {
          secondSnapshots.push({ ...snapshot });
        },
      }),
    );

    await new Promise((resolve) => setTimeout(resolve, 40));

    expect(secondSnapshots).toContainEqual(
      expect.objectContaining({
        accountId: "work",
        running: false,
        connected: false,
        lastError: expect.stringMatching(/already monitored/i),
      }),
    );

    abortSecond.abort();
    abortFirst.abort();
    await Promise.all([secondPromise, firstPromise]);

    rmSync(tempDir, { recursive: true, force: true });
  });
});
