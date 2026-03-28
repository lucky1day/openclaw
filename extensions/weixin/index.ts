import { defineChannelPluginEntry } from "openclaw/plugin-sdk/core";
import { weixinPlugin } from "./src/channel.js";
import { setWeixinRuntime } from "./src/runtime.js";

export { weixinPlugin } from "./src/channel.js";
export { setWeixinRuntime } from "./src/runtime.js";

export default defineChannelPluginEntry({
  id: "weixin",
  name: "WeChat",
  description: "WeChat channel plugin",
  plugin: weixinPlugin,
  setRuntime: setWeixinRuntime,
});
