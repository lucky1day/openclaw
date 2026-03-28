import { describe, expect, it, vi } from "vitest";
import { createStartAccountContext } from "../../../test/helpers/extensions/start-account-context.js";

const startWeixinLoginWithQrMock = vi.hoisted(() => vi.fn());
const waitForWeixinLoginMock = vi.hoisted(() => vi.fn());
const monitorWeixinAccountMock = vi.hoisted(() => vi.fn());

vi.mock("./login-qr.js", () => ({
  startWeixinLoginWithQr: startWeixinLoginWithQrMock,
  waitForWeixinLogin: waitForWeixinLoginMock,
}));

vi.mock("./monitor.js", () => ({
  monitorWeixinAccount: monitorWeixinAccountMock,
}));

describe("weixin gateway wiring", () => {
  it("delegates QR login and account startup to the WeChat runtime helpers", async () => {
    const { weixinPlugin } = await import("./channel.js");

    startWeixinLoginWithQrMock.mockResolvedValue({
      sessionKey: "work",
      qrcodeUrl: "data:image/png;base64,abc",
      message: "scan",
    });
    waitForWeixinLoginMock.mockResolvedValue({
      connected: true,
      accountId: "work",
      message: "linked",
    });
    monitorWeixinAccountMock.mockResolvedValue(undefined);

    await expect(
      weixinPlugin.gateway?.loginWithQrStart?.({ accountId: "work", force: true, timeoutMs: 5000 }),
    ).resolves.toMatchObject({ sessionKey: "work" });
    await expect(
      weixinPlugin.gateway?.loginWithQrWait?.({ accountId: "work", timeoutMs: 3000 }),
    ).resolves.toMatchObject({ connected: true, accountId: "work" });
    await weixinPlugin.gateway?.startAccount?.(
      createStartAccountContext({
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
        },
      }),
    );

    expect(startWeixinLoginWithQrMock).toHaveBeenCalledWith({
      accountId: "work",
      force: true,
      timeoutMs: 5000,
      verbose: undefined,
    });
    expect(waitForWeixinLoginMock).toHaveBeenCalledWith({
      sessionKey: "work",
      timeoutMs: 3000,
    });
    expect(monitorWeixinAccountMock).toHaveBeenCalledTimes(1);
  });
});
