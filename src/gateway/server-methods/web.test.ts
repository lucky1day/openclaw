import { beforeEach, describe, expect, it, vi } from "vitest";
import type { GatewayRequestContext } from "./types.js";

const mocks = vi.hoisted(() => ({
  listChannelPlugins: vi.fn(),
  normalizeChannelId: vi.fn((value?: string | null) => value?.trim() || null),
}));

vi.mock("../../channels/plugins/index.js", () => ({
  listChannelPlugins: mocks.listChannelPlugins,
  normalizeChannelId: mocks.normalizeChannelId,
}));

let webHandlers: typeof import("./web.js").webHandlers;

async function loadFreshWebHandlers() {
  vi.resetModules();
  ({ webHandlers } = await import("./web.js"));
}

function createContext(): GatewayRequestContext {
  return {
    stopChannel: vi.fn(async () => {}),
    startChannel: vi.fn(async () => {}),
  } as unknown as GatewayRequestContext;
}

async function runWebLoginStart(
  params: Record<string, unknown>,
  context: GatewayRequestContext = createContext(),
) {
  const respond = vi.fn();
  await webHandlers["web.login.start"]({
    params,
    respond,
    context,
    req: { type: "req", id: "1", method: "web.login.start" },
    client: null,
    isWebchatConnect: () => false,
  });
  return { respond, context };
}

async function runWebLoginWait(
  params: Record<string, unknown>,
  context: GatewayRequestContext = createContext(),
) {
  const respond = vi.fn();
  await webHandlers["web.login.wait"]({
    params,
    respond,
    context,
    req: { type: "req", id: "1", method: "web.login.wait" },
    client: null,
    isWebchatConnect: () => false,
  });
  return { respond, context };
}

describe("web login handlers", () => {
  beforeEach(async () => {
    mocks.listChannelPlugins.mockReset();
    mocks.normalizeChannelId.mockReset();
    mocks.normalizeChannelId.mockImplementation((value?: string | null) => value?.trim() || null);
    await loadFreshWebHandlers();
  });

  it("keeps the existing behavior when no channel is specified", async () => {
    const whatsappLogin = vi.fn(async () => ({ connected: false, message: "scan" }));
    mocks.listChannelPlugins.mockReturnValue([
      {
        id: "whatsapp",
        gatewayMethods: ["web.login.start", "web.login.wait"],
        gateway: { loginWithQrStart: whatsappLogin },
      },
      {
        id: "weixin",
        gatewayMethods: ["web.login.start", "web.login.wait"],
        gateway: { loginWithQrStart: vi.fn() },
      },
    ]);

    const { respond, context } = await runWebLoginStart({ accountId: "default" });

    expect(context.stopChannel).toHaveBeenCalledWith("whatsapp", "default");
    expect(whatsappLogin).toHaveBeenCalledWith({
      accountId: "default",
      force: false,
      timeoutMs: undefined,
      verbose: false,
    });
    expect(respond).toHaveBeenCalledWith(true, { connected: false, message: "scan" }, undefined);
  });

  it("selects the requested channel for web.login.start", async () => {
    const whatsappLogin = vi.fn(async () => ({ connected: false, message: "wa" }));
    const weixinLogin = vi.fn(async () => ({ connected: false, message: "wx" }));
    mocks.listChannelPlugins.mockReturnValue([
      {
        id: "whatsapp",
        gatewayMethods: ["web.login.start", "web.login.wait"],
        gateway: { loginWithQrStart: whatsappLogin },
      },
      {
        id: "weixin",
        gatewayMethods: ["web.login.start", "web.login.wait"],
        gateway: { loginWithQrStart: weixinLogin },
      },
    ]);

    const { respond, context } = await runWebLoginStart({
      channel: "weixin",
      accountId: "work",
      force: true,
      timeoutMs: 5000,
      verbose: true,
    });

    expect(context.stopChannel).toHaveBeenCalledWith("weixin", "work");
    expect(weixinLogin).toHaveBeenCalledWith({
      accountId: "work",
      force: true,
      timeoutMs: 5000,
      verbose: true,
    });
    expect(whatsappLogin).not.toHaveBeenCalled();
    expect(respond).toHaveBeenCalledWith(true, { connected: false, message: "wx" }, undefined);
  });

  it("selects the requested channel for web.login.wait and starts it on connect", async () => {
    const whatsappWait = vi.fn(async () => ({ connected: true, message: "wa-linked" }));
    const weixinWait = vi.fn(async () => ({ connected: true, message: "wx-linked" }));
    mocks.listChannelPlugins.mockReturnValue([
      {
        id: "whatsapp",
        gatewayMethods: ["web.login.start", "web.login.wait"],
        gateway: { loginWithQrWait: whatsappWait },
      },
      {
        id: "weixin",
        gatewayMethods: ["web.login.start", "web.login.wait"],
        gateway: { loginWithQrWait: weixinWait },
      },
    ]);

    const { respond, context } = await runWebLoginWait({
      channel: "weixin",
      accountId: "work",
      timeoutMs: 3000,
    });

    expect(weixinWait).toHaveBeenCalledWith({ accountId: "work", timeoutMs: 3000 });
    expect(whatsappWait).not.toHaveBeenCalled();
    expect(context.startChannel).toHaveBeenCalledWith("weixin", "work");
    expect(respond).toHaveBeenCalledWith(
      true,
      { connected: true, message: "wx-linked" },
      undefined,
    );
  });
});
