import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

const loadConfigMock = vi.hoisted(() => vi.fn());

vi.mock("openclaw/plugin-sdk/config-runtime", () => ({
  loadConfig: loadConfigMock,
}));

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

afterEach(() => {
  loadConfigMock.mockReset();
  vi.unstubAllGlobals();
});

describe("weixin QR login", () => {
  it("starts a QR login and persists the confirmed token into the account auth file", async () => {
    const tempDir = mkdtempSync(path.join(os.tmpdir(), "openclaw-weixin-login-"));
    const authFile = path.join(tempDir, "auth.json");
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    loadConfigMock.mockReturnValue({
      channels: {
        weixin: {
          accounts: {
            work: {
              authFile,
              baseUrl: "https://wx.example.com",
            },
          },
        },
      },
    });

    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        qrcode: "qr-1",
        qrcode_img_content: "data:image/png;base64,abc",
      }),
    );
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        status: "confirmed",
        bot_token: "bot-token",
        baseurl: "https://wx.example.com",
        ilink_user_id: "wx-user-1",
      }),
    );

    try {
      const { startWeixinLoginWithQr, waitForWeixinLogin } = await import("./login-qr.js");

      const start = await startWeixinLoginWithQr({ accountId: "work" });
      const result = await waitForWeixinLogin({ sessionKey: start.sessionKey, timeoutMs: 1000 });
      const persisted = JSON.parse(readFileSync(authFile, "utf-8")) as Record<string, string>;

      expect(start).toMatchObject({
        sessionKey: "work",
        qrcodeUrl: "data:image/png;base64,abc",
      });
      expect(result).toMatchObject({
        connected: true,
        accountId: "work",
        userId: "wx-user-1",
      });
      expect(persisted).toMatchObject({
        token: "bot-token",
        baseUrl: "https://wx.example.com",
        userId: "wx-user-1",
      });
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });
});
