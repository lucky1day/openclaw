import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

describe("weixinPlugin metadata", () => {
  it("declares a DM-only WeChat channel with QR gateway hooks", async () => {
    const { weixinPlugin } = await import("./channel.js");

    expect(weixinPlugin.id).toBe("weixin");
    expect(weixinPlugin.meta).toMatchObject({
      id: "weixin",
      label: "WeChat",
      docsPath: "/channels/weixin",
    });
    expect(weixinPlugin.capabilities).toMatchObject({
      chatTypes: ["direct"],
      media: true,
    });
    expect(typeof weixinPlugin.gateway?.loginWithQrStart).toBe("function");
    expect(typeof weixinPlugin.gateway?.loginWithQrWait).toBe("function");
    expect(typeof weixinPlugin.gateway?.startAccount).toBe("function");
  });

  it("reads token-backed account state from auth files", async () => {
    const { weixinPlugin } = await import("./channel.js");
    const tempDir = mkdtempSync(path.join(os.tmpdir(), "openclaw-weixin-auth-"));
    const authFile = path.join(tempDir, "auth.json");

    try {
      writeFileSync(
        authFile,
        JSON.stringify({ token: "bot-token", baseUrl: "https://wx.example.com" }),
        "utf-8",
      );

      const account = weixinPlugin.config.resolveAccount(
        {
          channels: {
            weixin: {
              accounts: {
                work: {
                  authFile,
                },
              },
            },
          },
        } as never,
        "work",
      );

      expect(account).toMatchObject({
        accountId: "work",
        configured: true,
        token: "bot-token",
        baseUrl: "https://wx.example.com",
      });
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it("exports a channel plugin entry from the extension root", async () => {
    const entryModule = await import("../index.ts");

    expect(entryModule.weixinPlugin.id).toBe("weixin");
    expect(entryModule.default).toMatchObject({
      id: "weixin",
      name: "WeChat",
      description: "WeChat channel plugin",
    });
    expect(typeof entryModule.default.register).toBe("function");
  });
});
