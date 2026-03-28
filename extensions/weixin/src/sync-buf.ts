import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

export function readWeixinSyncBuf(syncBufFile: string): string {
  try {
    return readFileSync(syncBufFile, "utf-8").trim();
  } catch {
    return "";
  }
}

export function writeWeixinSyncBuf(syncBufFile: string, syncBuf: string): void {
  mkdirSync(path.dirname(syncBufFile), { recursive: true });
  writeFileSync(syncBufFile, syncBuf, "utf-8");
}
