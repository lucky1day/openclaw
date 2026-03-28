import { createCipheriv, randomBytes } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MessageItemType, type MessageItem } from "./protocol.js";

type SaveMediaFn = (
  buffer: Buffer,
  contentType?: string,
  subdir?: string,
  _maxBytes?: number,
  originalFilename?: string,
) => Promise<{ path: string }>;

function encryptAesEcb(plaintext: Buffer, key: Buffer): Buffer {
  const cipher = createCipheriv("aes-128-ecb", key, null);
  return Buffer.concat([cipher.update(plaintext), cipher.final()]);
}

async function saveMediaFixture(
  root: string,
  buffer: Buffer,
  contentType?: string,
  subdir?: string,
  _maxBytes?: number,
  originalFilename?: string,
): Promise<{ path: string }> {
  const dir = path.join(root, subdir ?? "inbound");
  await mkdir(dir, { recursive: true });
  const ext = originalFilename
    ? path.extname(originalFilename)
    : contentType === "image/png"
      ? ".png"
      : ".bin";
  const filePath = path.join(
    dir,
    `saved-${Date.now()}-${Math.random().toString(16).slice(2)}${ext}`,
  );
  await writeFile(filePath, buffer);
  return { path: filePath };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("weixin inbound image", () => {
  it("downloads and decrypts an encrypted WeChat image into a local file", async () => {
    const tempDir = mkdtempSync(path.join(os.tmpdir(), "openclaw-weixin-image-"));
    const plaintext = Buffer.from("fake-png-bytes");
    const rawKey = randomBytes(16);
    const encrypted = encryptAesEcb(plaintext, rawKey);
    const fetchMock = vi.fn(async () => new Response(new Uint8Array(encrypted), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const { downloadWeixinInboundImage } = await import("./weixin-inbound-image.js");

    try {
      const result = await downloadWeixinInboundImage(
        {
          type: MessageItemType.IMAGE,
          image_item: {
            media: {
              encrypt_query_param: "enc-query",
              aes_key: rawKey.toString("base64"),
            },
          },
        } satisfies MessageItem,
        {
          cdnBaseUrl: "https://cdn.weixin.example.com/c2c",
          saveMedia: ((...args) => saveMediaFixture(tempDir, ...args)) satisfies SaveMediaFn,
          label: "test-image",
        },
      );

      expect(result).toMatchObject({
        contentType: "image/*",
      });
      expect(fetchMock).toHaveBeenCalledWith(
        "https://cdn.weixin.example.com/c2c/download?encrypted_query_param=enc-query",
      );
      expect(readFileSync(result!.path)).toEqual(plaintext);
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it("downloads a plain WeChat image when no AES key is present", async () => {
    const tempDir = mkdtempSync(path.join(os.tmpdir(), "openclaw-weixin-image-plain-"));
    const plaintext = Buffer.from("plain-image");
    const fetchMock = vi.fn(async () => new Response(new Uint8Array(plaintext), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const { downloadWeixinInboundImage } = await import("./weixin-inbound-image.js");

    try {
      const result = await downloadWeixinInboundImage(
        {
          type: MessageItemType.IMAGE,
          image_item: {
            media: {
              encrypt_query_param: "plain-query",
            },
          },
        } satisfies MessageItem,
        {
          cdnBaseUrl: "https://cdn.weixin.example.com/c2c",
          saveMedia: ((...args) => saveMediaFixture(tempDir, ...args)) satisfies SaveMediaFn,
          label: "test-plain-image",
        },
      );

      expect(result).toMatchObject({
        contentType: "image/*",
      });
      expect(readFileSync(result!.path)).toEqual(plaintext);
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });
});
