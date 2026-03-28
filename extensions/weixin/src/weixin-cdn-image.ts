import { decryptWeixinAesEcb } from "./weixin-aes-ecb.js";

function buildWeixinCdnDownloadUrl(encryptedQueryParam: string, cdnBaseUrl: string): string {
  return `${cdnBaseUrl}/download?encrypted_query_param=${encodeURIComponent(encryptedQueryParam)}`;
}

async function fetchWeixinCdnBytes(url: string, label: string): Promise<Buffer> {
  let response: Response;
  try {
    response = await fetch(url);
  } catch (error) {
    throw new Error(`${label}: CDN fetch failed: ${String(error)}`);
  }
  if (!response.ok) {
    const body = await response.text().catch(() => "(unreadable)");
    throw new Error(
      `${label}: CDN download ${response.status} ${response.statusText} body=${body}`,
    );
  }
  return Buffer.from(await response.arrayBuffer());
}

function parseWeixinAesKey(aesKeyBase64: string, label: string): Buffer {
  const decoded = Buffer.from(aesKeyBase64, "base64");
  if (decoded.length === 16) {
    return decoded;
  }
  if (decoded.length === 32 && /^[0-9a-fA-F]{32}$/.test(decoded.toString("ascii"))) {
    return Buffer.from(decoded.toString("ascii"), "hex");
  }
  throw new Error(
    `${label}: aes_key must decode to 16 raw bytes or a 32-char hex string, got ${decoded.length} bytes`,
  );
}

export async function downloadAndDecryptWeixinCdnBuffer(params: {
  encryptedQueryParam: string;
  aesKeyBase64: string;
  cdnBaseUrl: string;
  label: string;
}): Promise<Buffer> {
  const key = parseWeixinAesKey(params.aesKeyBase64, params.label);
  const url = buildWeixinCdnDownloadUrl(params.encryptedQueryParam, params.cdnBaseUrl);
  const encrypted = await fetchWeixinCdnBytes(url, params.label);
  return decryptWeixinAesEcb(encrypted, key);
}

export async function downloadPlainWeixinCdnBuffer(params: {
  encryptedQueryParam: string;
  cdnBaseUrl: string;
  label: string;
}): Promise<Buffer> {
  const url = buildWeixinCdnDownloadUrl(params.encryptedQueryParam, params.cdnBaseUrl);
  return await fetchWeixinCdnBytes(url, params.label);
}
