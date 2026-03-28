import type { PluginRuntime } from "openclaw/plugin-sdk/core";
import { createPluginRuntimeStore } from "openclaw/plugin-sdk/runtime-store";

const { setRuntime: setWeixinRuntime, getRuntime: getWeixinRuntime } =
  createPluginRuntimeStore<PluginRuntime>("WeChat runtime not initialized");

export { getWeixinRuntime, setWeixinRuntime };
