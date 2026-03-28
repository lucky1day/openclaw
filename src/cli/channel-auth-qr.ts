import fsp from "node:fs/promises";
import path from "node:path";
import qrcode from "qrcode-terminal";
import { resolvePreferredOpenClawTmpDir } from "../infra/tmp-openclaw-dir.js";
import { writeRuntimeStdout, type RuntimeEnv } from "../runtime.js";

function sanitizeSegment(value: string): string {
  return value.replace(/[^a-zA-Z0-9_-]+/g, "-") || "default";
}

async function resolveQrImageBytes(qrDataUrl: string): Promise<Buffer | null> {
  const trimmed = qrDataUrl.trim();
  const dataUrlMatch = trimmed.match(/^data:image\/png;base64,(.+)$/i);
  const base64 = (dataUrlMatch?.[1] ?? "").trim();
  if (base64) {
    return Buffer.from(base64, "base64");
  }
  if (!/^https?:\/\//i.test(trimmed)) {
    return null;
  }

  try {
    const response = await fetch(trimmed);
    if (!response.ok) {
      return null;
    }
    return Buffer.from(await response.arrayBuffer());
  } catch {
    return null;
  }
}

function renderQrAscii(data: string): Promise<string> {
  return new Promise((resolve) => {
    qrcode.generate(data, { small: true }, (output: string) => {
      resolve(output);
    });
  });
}

export async function renderQrToTerminal(runtime: RuntimeEnv, qrDataUrl: string): Promise<boolean> {
  const trimmed = qrDataUrl.trim();
  if (!/^https?:\/\//i.test(trimmed)) {
    return false;
  }
  const ascii = await renderQrAscii(trimmed);
  if (!ascii.trim()) {
    return false;
  }
  writeRuntimeStdout(runtime, ascii);
  return true;
}

export async function writeQrDataUrlToTempFile(
  qrDataUrl: string,
  channelId: string,
  accountId: string,
): Promise<string | null> {
  const imageBytes = await resolveQrImageBytes(qrDataUrl);
  if (!imageBytes) {
    return null;
  }

  const filePath = path.join(
    resolvePreferredOpenClawTmpDir(),
    `openclaw-${sanitizeSegment(channelId)}-qr-${sanitizeSegment(accountId)}.png`,
  );
  await fsp.writeFile(filePath, imageBytes);
  return filePath;
}
