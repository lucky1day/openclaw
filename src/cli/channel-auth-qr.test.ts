import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createCliRuntimeCapture } from "./test-runtime-capture.js";

const mocks = vi.hoisted(() => ({
  resolvePreferredOpenClawTmpDir: vi.fn(),
  qrGenerate: vi.fn((_input: unknown, _opts: unknown, cb: (output: string) => void) => {
    cb("ASCII-QR");
  }),
}));

vi.mock("../infra/tmp-openclaw-dir.js", () => ({
  resolvePreferredOpenClawTmpDir: mocks.resolvePreferredOpenClawTmpDir,
}));

vi.mock("qrcode-terminal", () => ({
  default: {
    generate: mocks.qrGenerate,
  },
}));

const { renderQrToTerminal, writeQrDataUrlToTempFile } = await import("./channel-auth-qr.js");
const runtimeCapture = createCliRuntimeCapture();

describe("channel-auth-qr", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(path.join(os.tmpdir(), "openclaw-channel-auth-qr-"));
    mocks.resolvePreferredOpenClawTmpDir.mockReturnValue(tempDir);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    mocks.resolvePreferredOpenClawTmpDir.mockReset();
    mocks.qrGenerate.mockClear();
    runtimeCapture.resetRuntimeCapture();
    rmSync(tempDir, { recursive: true, force: true });
  });

  it("renders remote QR URLs inline for terminal login flows", async () => {
    const rendered = await renderQrToTerminal(
      runtimeCapture.defaultRuntime,
      "https://liteapp.weixin.qq.com/q/example",
    );

    expect(rendered).toBe(true);
    expect(mocks.qrGenerate).toHaveBeenCalledWith(
      "https://liteapp.weixin.qq.com/q/example",
      { small: true },
      expect.any(Function),
    );
    expect(runtimeCapture.runtimeLogs).toContain("ASCII-QR");
  });

  it("writes a QR image fetched from a remote URL", async () => {
    const pngBytes = Uint8Array.from([0x89, 0x50, 0x4e, 0x47]);
    const fetchMock = vi.fn(async () => {
      return new Response(pngBytes, {
        status: 200,
        headers: { "content-type": "image/png" },
      });
    });
    vi.stubGlobal("fetch", fetchMock as unknown as typeof fetch);

    const filePath = await writeQrDataUrlToTempFile(
      "https://liteapp.weixin.qq.com/q/example",
      "weixin",
      "default",
    );

    expect(filePath).toBe(path.join(tempDir, "openclaw-weixin-qr-default.png"));
    expect(fetchMock).toHaveBeenCalledWith("https://liteapp.weixin.qq.com/q/example");
    expect(readFileSync(filePath ?? "", null)).toEqual(Buffer.from(pngBytes));
  });
});
