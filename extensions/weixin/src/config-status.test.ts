import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

describe("weixin gateway-facing config and status", () => {
  it("publishes a channel config schema and CRUD-ready config adapter for gateway surfaces", async () => {
    const { weixinPlugin } = await import("./channel.js");

    expect(weixinPlugin.reload).toMatchObject({
      configPrefixes: ["channels.weixin"],
    });
    expect(weixinPlugin.configSchema?.schema).toMatchObject({
      type: "object",
      properties: expect.objectContaining({
        enabled: expect.any(Object),
        baseUrl: expect.any(Object),
        authFile: expect.any(Object),
        syncBufFile: expect.any(Object),
        pollIntervalMs: expect.any(Object),
        routeTag: expect.any(Object),
        botType: expect.any(Object),
        dmPolicy: expect.any(Object),
        allowFrom: expect.any(Object),
        defaultTo: expect.any(Object),
        accounts: expect.any(Object),
        defaultAccount: expect.any(Object),
      }),
    });
    expect(typeof weixinPlugin.config.setAccountEnabled).toBe("function");
    expect(typeof weixinPlugin.config.deleteAccount).toBe("function");
    expect(typeof weixinPlugin.config.describeAccount).toBe("function");
  });

  it("builds linked/running account snapshots with traffic fields for gateway status surfaces", async () => {
    const { weixinPlugin } = await import("./channel.js");
    const tempDir = mkdtempSync(path.join(os.tmpdir(), "openclaw-weixin-status-"));
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
                  allowFrom: ["wx-user-1"],
                  dmPolicy: "allowlist",
                },
              },
            },
          },
        } as never,
        "work",
      );

      const snapshot = await weixinPlugin.status?.buildAccountSnapshot?.({
        account,
        cfg: {} as never,
        runtime: {
          accountId: "work",
          running: true,
          connected: true,
          lastInboundAt: 101,
          lastOutboundAt: 202,
          lastError: null,
        },
      });

      expect(weixinPlugin.status?.defaultRuntime).toMatchObject({
        accountId: "default",
        running: false,
        connected: false,
        lastInboundAt: null,
        lastOutboundAt: null,
      });
      expect(snapshot).toMatchObject({
        accountId: "work",
        configured: true,
        running: true,
        connected: true,
        lastInboundAt: 101,
        lastOutboundAt: 202,
        dmPolicy: "allowlist",
        allowFrom: ["wx-user-1"],
      });
      expect(
        weixinPlugin.status?.resolveAccountState?.({
          account,
          cfg: {} as never,
          configured: true,
          enabled: true,
        }),
      ).toBe("linked");
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });
});
