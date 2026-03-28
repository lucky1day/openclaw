import { MessageItemType, type MessageItem } from "./protocol.js";
import {
  downloadAndDecryptWeixinCdnBuffer,
  downloadPlainWeixinCdnBuffer,
} from "./weixin-cdn-image.js";

export const DEFAULT_WEIXIN_CDN_BASE_URL = "https://novac2c.cdn.weixin.qq.com/c2c";
const WEIXIN_MEDIA_MAX_BYTES = 100 * 1024 * 1024;

type SaveMediaFn = (
  buffer: Buffer,
  contentType?: string,
  subdir?: string,
  maxBytes?: number,
  originalFilename?: string,
) => Promise<{ path: string }>;

export type WeixinInboundImage = {
  path: string;
  contentType: "image/*";
};

export function findWeixinInboundImageItem(itemList?: MessageItem[]): MessageItem | undefined {
  if (!itemList?.length) {
    return undefined;
  }
  return itemList.find(
    (item) => item.type === MessageItemType.IMAGE && item.image_item?.media?.encrypt_query_param,
  );
}

export async function downloadWeixinInboundImage(
  item: MessageItem,
  deps: {
    cdnBaseUrl?: string;
    saveMedia: SaveMediaFn;
    label?: string;
  },
): Promise<WeixinInboundImage | null> {
  if (item.type !== MessageItemType.IMAGE) {
    return null;
  }
  const media = item.image_item?.media;
  if (!media?.encrypt_query_param) {
    return null;
  }

  const label = deps.label ?? "weixin inbound image";
  const aesKeyBase64 = item.image_item?.aeskey
    ? Buffer.from(item.image_item.aeskey, "hex").toString("base64")
    : media.aes_key;

  const buffer = aesKeyBase64
    ? await downloadAndDecryptWeixinCdnBuffer({
        encryptedQueryParam: media.encrypt_query_param,
        aesKeyBase64,
        cdnBaseUrl: deps.cdnBaseUrl ?? DEFAULT_WEIXIN_CDN_BASE_URL,
        label,
      })
    : await downloadPlainWeixinCdnBuffer({
        encryptedQueryParam: media.encrypt_query_param,
        cdnBaseUrl: deps.cdnBaseUrl ?? DEFAULT_WEIXIN_CDN_BASE_URL,
        label,
      });

  const saved = await deps.saveMedia(buffer, "image/*", "inbound", WEIXIN_MEDIA_MAX_BYTES);
  return {
    path: saved.path,
    contentType: "image/*",
  };
}
