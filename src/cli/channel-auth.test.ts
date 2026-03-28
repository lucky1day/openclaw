import { beforeEach, describe, expect, it, vi } from "vitest";
import { runChannelLogin, runChannelLogout } from "./channel-auth.js";

const mocks = vi.hoisted(() => ({
  resolveAgentWorkspaceDir: vi.fn(),
  resolveDefaultAgentId: vi.fn(),
  getChannelPluginCatalogEntry: vi.fn(),
  listChannelPluginCatalogEntries: vi.fn(),
  resolveChannelDefaultAccountId: vi.fn(),
  getChannelPlugin: vi.fn(),
  listChannelPlugins: vi.fn(),
  normalizeChannelId: vi.fn(),
  loadConfig: vi.fn(),
  writeConfigFile: vi.fn(),
  setVerbose: vi.fn(),
  createClackPrompter: vi.fn(),
  ensureChannelSetupPluginInstalled: vi.fn(),
  loadChannelSetupPluginRegistrySnapshotForChannel: vi.fn(),
  callGatewayFromCli: vi.fn(),
  renderQrToTerminal: vi.fn(),
  writeQrDataUrlToTempFile: vi.fn(),
  login: vi.fn(),
  logoutAccount: vi.fn(),
  resolveAccount: vi.fn(),
}));

vi.mock("../agents/agent-scope.js", () => ({
  resolveAgentWorkspaceDir: mocks.resolveAgentWorkspaceDir,
  resolveDefaultAgentId: mocks.resolveDefaultAgentId,
}));

vi.mock("../channels/plugins/catalog.js", () => ({
  getChannelPluginCatalogEntry: mocks.getChannelPluginCatalogEntry,
  listChannelPluginCatalogEntries: mocks.listChannelPluginCatalogEntries,
}));

vi.mock("../channels/plugins/helpers.js", () => ({
  resolveChannelDefaultAccountId: mocks.resolveChannelDefaultAccountId,
}));

vi.mock("../channels/plugins/index.js", () => ({
  getChannelPlugin: mocks.getChannelPlugin,
  listChannelPlugins: mocks.listChannelPlugins,
  normalizeChannelId: mocks.normalizeChannelId,
}));

vi.mock("../config/config.js", () => ({
  loadConfig: mocks.loadConfig,
  writeConfigFile: mocks.writeConfigFile,
}));

vi.mock("../globals.js", () => ({
  setVerbose: mocks.setVerbose,
}));

vi.mock("../wizard/clack-prompter.js", () => ({
  createClackPrompter: mocks.createClackPrompter,
}));

vi.mock("./gateway-rpc.js", () => ({
  callGatewayFromCli: mocks.callGatewayFromCli,
}));

vi.mock("./channel-auth-qr.js", () => ({
  renderQrToTerminal: mocks.renderQrToTerminal,
  writeQrDataUrlToTempFile: mocks.writeQrDataUrlToTempFile,
}));

vi.mock("../commands/channel-setup/plugin-install.js", () => ({
  ensureChannelSetupPluginInstalled: mocks.ensureChannelSetupPluginInstalled,
  loadChannelSetupPluginRegistrySnapshotForChannel:
    mocks.loadChannelSetupPluginRegistrySnapshotForChannel,
}));

describe("channel-auth", () => {
  const runtime = { log: vi.fn(), error: vi.fn(), exit: vi.fn() };
  const plugin = {
    id: "whatsapp",
    auth: { login: mocks.login },
    gateway: { logoutAccount: mocks.logoutAccount },
    config: {
      listAccountIds: vi.fn().mockReturnValue(["default"]),
      resolveAccount: mocks.resolveAccount,
    },
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.normalizeChannelId.mockReturnValue("whatsapp");
    mocks.getChannelPlugin.mockReturnValue(plugin);
    mocks.getChannelPluginCatalogEntry.mockReturnValue(undefined);
    mocks.listChannelPluginCatalogEntries.mockReturnValue([]);
    mocks.loadConfig.mockReturnValue({ channels: { whatsapp: {} } });
    mocks.writeConfigFile.mockResolvedValue(undefined);
    mocks.listChannelPlugins.mockReturnValue([plugin]);
    mocks.resolveDefaultAgentId.mockReturnValue("main");
    mocks.resolveAgentWorkspaceDir.mockReturnValue("/tmp/workspace");
    mocks.resolveChannelDefaultAccountId.mockReturnValue("default-account");
    mocks.createClackPrompter.mockReturnValue({} as object);
    mocks.ensureChannelSetupPluginInstalled.mockResolvedValue({
      cfg: { channels: { whatsapp: {} } },
      installed: true,
      pluginId: "whatsapp",
    });
    mocks.callGatewayFromCli.mockResolvedValue(undefined);
    mocks.renderQrToTerminal.mockResolvedValue(false);
    mocks.writeQrDataUrlToTempFile.mockResolvedValue("/tmp/openclaw-weixin-qr-default.png");
    mocks.loadChannelSetupPluginRegistrySnapshotForChannel.mockReturnValue({
      channels: [{ plugin }],
      channelSetups: [],
    });
    mocks.resolveAccount.mockReturnValue({ id: "resolved-account" });
    mocks.login.mockResolvedValue(undefined);
    mocks.logoutAccount.mockResolvedValue(undefined);
  });

  it("runs login with explicit trimmed account and verbose flag", async () => {
    await runChannelLogin({ channel: "wa", account: "  acct-1  ", verbose: true }, runtime);

    expect(mocks.setVerbose).toHaveBeenCalledWith(true);
    expect(mocks.resolveChannelDefaultAccountId).not.toHaveBeenCalled();
    expect(mocks.login).toHaveBeenCalledWith(
      expect.objectContaining({
        cfg: { channels: { whatsapp: {} } },
        accountId: "acct-1",
        runtime,
        verbose: true,
        channelInput: "wa",
      }),
    );
  });

  it("auto-picks the single configured channel that supports login when opts are empty", async () => {
    await runChannelLogin({}, runtime);

    expect(mocks.normalizeChannelId).toHaveBeenCalledWith("whatsapp");
    expect(mocks.login).toHaveBeenCalledWith(
      expect.objectContaining({
        channelInput: "whatsapp",
      }),
    );
  });

  it("falls back to web login RPC for gateway-backed QR channels", async () => {
    const weixinPlugin = {
      id: "weixin",
      auth: {},
      gatewayMethods: ["web.login.start", "web.login.wait"],
      gateway: {
        loginWithQrStart: vi.fn(),
        loginWithQrWait: vi.fn(),
        logoutAccount: mocks.logoutAccount,
      },
      config: {
        listAccountIds: vi.fn().mockReturnValue(["default"]),
        resolveAccount: mocks.resolveAccount,
      },
    };
    mocks.normalizeChannelId.mockImplementation((value) => value);
    mocks.getChannelPlugin.mockImplementation((value) =>
      value === "weixin" ? (weixinPlugin as unknown as typeof plugin) : plugin,
    );
    mocks.listChannelPlugins.mockReturnValue([weixinPlugin]);
    mocks.loadConfig.mockReturnValue({ channels: { weixin: {} } });
    mocks.resolveChannelDefaultAccountId.mockReturnValue("default");
    mocks.callGatewayFromCli
      .mockResolvedValueOnce({
        qrcodeUrl: "data:image/png;base64,abc",
        message: "使用微信扫描以下二维码，以完成连接。",
      })
      .mockResolvedValueOnce({
        connected: true,
        accountId: "default",
        message: "微信账号已连接。",
      });

    await runChannelLogin({ channel: "weixin" }, runtime);

    expect(mocks.setVerbose).toHaveBeenCalledWith(false);
    expect(mocks.callGatewayFromCli).toHaveBeenNthCalledWith(
      1,
      "web.login.start",
      {},
      {
        channel: "weixin",
        accountId: "default",
        verbose: false,
      },
    );
    expect(mocks.writeQrDataUrlToTempFile).toHaveBeenCalledWith(
      "data:image/png;base64,abc",
      "weixin",
      "default",
    );
    expect(mocks.callGatewayFromCli).toHaveBeenNthCalledWith(
      2,
      "web.login.wait",
      { timeout: "315000" },
      {
        channel: "weixin",
        accountId: "default",
        timeoutMs: 300000,
      },
    );
    expect(runtime.log).toHaveBeenCalledWith("使用微信扫描以下二维码，以完成连接。");
    expect(runtime.log).toHaveBeenCalledWith(
      "QR image saved to: /tmp/openclaw-weixin-qr-default.png",
    );
    expect(runtime.log).toHaveBeenCalledWith("Waiting for QR scan confirmation...");
    expect(runtime.log).toHaveBeenCalledWith("微信账号已连接。");
    expect(mocks.login).not.toHaveBeenCalled();
  });

  it("forwards gateway client opts for gateway-backed QR login", async () => {
    const weixinPlugin = {
      id: "weixin",
      auth: {},
      gatewayMethods: ["web.login.start", "web.login.wait"],
      gateway: {
        loginWithQrStart: vi.fn(),
        loginWithQrWait: vi.fn(),
        logoutAccount: mocks.logoutAccount,
      },
      config: {
        listAccountIds: vi.fn().mockReturnValue(["default"]),
        resolveAccount: mocks.resolveAccount,
      },
    };
    mocks.normalizeChannelId.mockImplementation((value) => value);
    mocks.getChannelPlugin.mockImplementation((value) =>
      value === "weixin" ? (weixinPlugin as unknown as typeof plugin) : plugin,
    );
    mocks.listChannelPlugins.mockReturnValue([weixinPlugin]);
    mocks.loadConfig.mockReturnValue({ channels: { weixin: {} } });
    mocks.resolveChannelDefaultAccountId.mockReturnValue("default");
    mocks.callGatewayFromCli
      .mockResolvedValueOnce({
        qrcodeUrl: "data:image/png;base64,abc",
        message: "scan",
      })
      .mockResolvedValueOnce({
        connected: true,
        accountId: "default",
        message: "linked",
      });

    await runChannelLogin(
      {
        channel: "weixin",
        url: "ws://127.0.0.1:19001",
        token: "gateway-token",
        timeout: "450000",
      } as never,
      runtime,
    );

    expect(mocks.callGatewayFromCli).toHaveBeenNthCalledWith(
      1,
      "web.login.start",
      {
        url: "ws://127.0.0.1:19001",
        token: "gateway-token",
        timeout: "450000",
      },
      {
        channel: "weixin",
        accountId: "default",
        verbose: false,
      },
    );
    expect(mocks.callGatewayFromCli).toHaveBeenNthCalledWith(
      2,
      "web.login.wait",
      {
        url: "ws://127.0.0.1:19001",
        token: "gateway-token",
        timeout: "450000",
      },
      {
        channel: "weixin",
        accountId: "default",
        timeoutMs: 300000,
      },
    );
  });

  it("renders remote QR URLs inline in the terminal instead of saving a file", async () => {
    const weixinPlugin = {
      id: "weixin",
      auth: {},
      gatewayMethods: ["web.login.start", "web.login.wait"],
      gateway: {
        loginWithQrStart: vi.fn(),
        loginWithQrWait: vi.fn(),
        logoutAccount: mocks.logoutAccount,
      },
      config: {
        listAccountIds: vi.fn().mockReturnValue(["default"]),
        resolveAccount: mocks.resolveAccount,
      },
    };
    mocks.normalizeChannelId.mockImplementation((value) => value);
    mocks.getChannelPlugin.mockImplementation((value) =>
      value === "weixin" ? (weixinPlugin as unknown as typeof plugin) : plugin,
    );
    mocks.listChannelPlugins.mockReturnValue([weixinPlugin]);
    mocks.loadConfig.mockReturnValue({ channels: { weixin: {} } });
    mocks.resolveChannelDefaultAccountId.mockReturnValue("default");
    mocks.renderQrToTerminal.mockResolvedValueOnce(true);
    mocks.callGatewayFromCli
      .mockResolvedValueOnce({
        qrcodeUrl: "https://liteapp.weixin.qq.com/q/example",
        message: "使用微信扫描以下二维码，以完成连接。",
      })
      .mockResolvedValueOnce({
        connected: true,
        accountId: "default",
        message: "微信账号已连接。",
      });

    await runChannelLogin({ channel: "weixin" }, runtime);

    expect(mocks.renderQrToTerminal).toHaveBeenCalledWith(
      runtime,
      "https://liteapp.weixin.qq.com/q/example",
    );
    expect(mocks.writeQrDataUrlToTempFile).not.toHaveBeenCalled();
    expect(runtime.log).not.toHaveBeenCalledWith(
      "QR image saved to: /tmp/openclaw-weixin-qr-default.png",
    );
  });

  it("floors the wait RPC timeout for gateway-backed QR login", async () => {
    const weixinPlugin = {
      id: "weixin",
      auth: {},
      gatewayMethods: ["web.login.start", "web.login.wait"],
      gateway: {
        loginWithQrStart: vi.fn(),
        loginWithQrWait: vi.fn(),
        logoutAccount: mocks.logoutAccount,
      },
      config: {
        listAccountIds: vi.fn().mockReturnValue(["default"]),
        resolveAccount: mocks.resolveAccount,
      },
    };
    mocks.normalizeChannelId.mockImplementation((value) => value);
    mocks.getChannelPlugin.mockImplementation((value) =>
      value === "weixin" ? (weixinPlugin as unknown as typeof plugin) : plugin,
    );
    mocks.listChannelPlugins.mockReturnValue([weixinPlugin]);
    mocks.loadConfig.mockReturnValue({ channels: { weixin: {} } });
    mocks.resolveChannelDefaultAccountId.mockReturnValue("default");
    mocks.callGatewayFromCli
      .mockResolvedValueOnce({
        qrcodeUrl: "data:image/png;base64,abc",
        message: "scan",
      })
      .mockResolvedValueOnce({
        connected: true,
        accountId: "default",
        message: "linked",
      });

    await runChannelLogin(
      {
        channel: "weixin",
        timeout: "30000",
      } as never,
      runtime,
    );

    expect(mocks.callGatewayFromCli).toHaveBeenNthCalledWith(
      1,
      "web.login.start",
      {
        timeout: "30000",
      },
      {
        channel: "weixin",
        accountId: "default",
        verbose: false,
      },
    );
    expect(mocks.callGatewayFromCli).toHaveBeenNthCalledWith(
      2,
      "web.login.wait",
      {
        timeout: "315000",
      },
      {
        channel: "weixin",
        accountId: "default",
        timeoutMs: 300000,
      },
    );
  });

  it("logs the raw QR URL when no local QR image file is produced", async () => {
    const weixinPlugin = {
      id: "weixin",
      auth: {},
      gatewayMethods: ["web.login.start", "web.login.wait"],
      gateway: {
        loginWithQrStart: vi.fn(),
        loginWithQrWait: vi.fn(),
        logoutAccount: mocks.logoutAccount,
      },
      config: {
        listAccountIds: vi.fn().mockReturnValue(["default"]),
        resolveAccount: mocks.resolveAccount,
      },
    };
    mocks.normalizeChannelId.mockImplementation((value) => value);
    mocks.getChannelPlugin.mockImplementation((value) =>
      value === "weixin" ? (weixinPlugin as unknown as typeof plugin) : plugin,
    );
    mocks.listChannelPlugins.mockReturnValue([weixinPlugin]);
    mocks.loadConfig.mockReturnValue({ channels: { weixin: {} } });
    mocks.resolveChannelDefaultAccountId.mockReturnValue("default");
    mocks.renderQrToTerminal.mockResolvedValueOnce(false);
    mocks.writeQrDataUrlToTempFile.mockResolvedValueOnce(null);
    mocks.callGatewayFromCli
      .mockResolvedValueOnce({
        qrcodeUrl: "https://liteapp.weixin.qq.com/q/example",
        message: "使用微信扫描以下二维码，以完成连接。",
      })
      .mockResolvedValueOnce({
        connected: true,
        accountId: "default",
        message: "微信账号已连接。",
      });

    await runChannelLogin({ channel: "weixin" }, runtime);

    expect(runtime.log).toHaveBeenCalledWith("QR URL: https://liteapp.weixin.qq.com/q/example");
  });

  it("ignores configured channels that do not support login when channel is omitted", async () => {
    const telegramPlugin = {
      id: "telegram",
      auth: {},
      gateway: {},
      config: {
        listAccountIds: vi.fn().mockReturnValue(["default"]),
        resolveAccount: vi.fn().mockReturnValue({ enabled: true }),
      },
    };
    mocks.loadConfig.mockReturnValue({ channels: { whatsapp: {}, telegram: {} } });
    mocks.listChannelPlugins.mockReturnValue([telegramPlugin, plugin]);

    await runChannelLogin({}, runtime);

    expect(mocks.normalizeChannelId).toHaveBeenCalledWith("whatsapp");
    expect(mocks.login).toHaveBeenCalled();
  });

  it("propagates auth-channel ambiguity when multiple configured channels support login", async () => {
    const zaloPlugin = {
      id: "zalouser",
      auth: { login: vi.fn() },
      gateway: {},
      config: {
        listAccountIds: vi.fn().mockReturnValue(["default"]),
        resolveAccount: vi.fn().mockReturnValue({ enabled: true }),
      },
    };
    mocks.loadConfig.mockReturnValue({ channels: { whatsapp: {}, zalouser: {} } });
    mocks.listChannelPlugins.mockReturnValue([plugin, zaloPlugin]);
    mocks.normalizeChannelId.mockImplementation((value) => value);
    mocks.getChannelPlugin.mockImplementation((value) =>
      value === "whatsapp"
        ? plugin
        : value === "zalouser"
          ? (zaloPlugin as typeof plugin)
          : undefined,
    );

    await expect(runChannelLogin({}, runtime)).rejects.toThrow(
      "multiple configured channels support login: whatsapp, zalouser",
    );
    expect(mocks.login).not.toHaveBeenCalled();
  });

  it("ignores plugins with prototype-chain IDs like __proto__", async () => {
    const protoPlugin = {
      id: "__proto__",
      auth: { login: vi.fn() },
      gateway: {},
      config: {
        listAccountIds: vi.fn().mockReturnValue(["default"]),
        resolveAccount: vi.fn().mockReturnValue({ enabled: true }),
      },
    };
    mocks.listChannelPlugins.mockReturnValue([protoPlugin, plugin]);

    await runChannelLogin({}, runtime);

    expect(mocks.normalizeChannelId).toHaveBeenCalledWith("whatsapp");
    expect(mocks.login).toHaveBeenCalled();
  });

  it("throws for unsupported channel aliases", async () => {
    mocks.normalizeChannelId.mockImplementation(() => undefined);

    await expect(runChannelLogin({ channel: "bad-channel" }, runtime)).rejects.toThrow(
      "Unsupported channel: bad-channel",
    );
    expect(mocks.login).not.toHaveBeenCalled();
  });

  it("throws when channel does not support login", async () => {
    mocks.getChannelPlugin.mockReturnValueOnce({
      auth: {},
      gateway: { logoutAccount: mocks.logoutAccount },
      config: { resolveAccount: mocks.resolveAccount },
    });

    await expect(runChannelLogin({ channel: "whatsapp" }, runtime)).rejects.toThrow(
      "Channel whatsapp does not support login",
    );
  });

  it("installs a catalog-backed channel plugin on demand for login", async () => {
    const catalogEntry = {
      id: "whatsapp",
      pluginId: "@openclaw/whatsapp",
      meta: {
        id: "whatsapp",
        label: "WhatsApp",
        selectionLabel: "WhatsApp",
        docsPath: "/channels/whatsapp",
        blurb: "wa",
      },
      install: {
        npmSpec: "@openclaw/whatsapp",
      },
    };
    mocks.getChannelPlugin.mockReturnValueOnce(undefined);
    mocks.listChannelPluginCatalogEntries.mockReturnValueOnce([catalogEntry]);
    mocks.loadChannelSetupPluginRegistrySnapshotForChannel
      .mockReturnValueOnce({
        channels: [],
        channelSetups: [],
      })
      .mockReturnValueOnce({
        channels: [{ plugin }],
        channelSetups: [],
      });

    await runChannelLogin({ channel: "whatsapp" }, runtime);

    expect(mocks.ensureChannelSetupPluginInstalled).toHaveBeenCalledWith(
      expect.objectContaining({
        entry: catalogEntry,
        runtime,
        workspaceDir: "/tmp/workspace",
      }),
    );
    expect(mocks.loadChannelSetupPluginRegistrySnapshotForChannel).toHaveBeenCalledWith(
      expect.objectContaining({
        channel: "whatsapp",
        pluginId: "whatsapp",
        workspaceDir: "/tmp/workspace",
      }),
    );
    expect(mocks.writeConfigFile).toHaveBeenCalledWith({ channels: { whatsapp: {} } });
    expect(mocks.login).toHaveBeenCalled();
  });

  it("resolves explicit channel login through the catalog when registry normalize misses", async () => {
    mocks.normalizeChannelId.mockReturnValueOnce(undefined).mockReturnValue("whatsapp");
    mocks.getChannelPlugin.mockReturnValueOnce(undefined);
    mocks.listChannelPluginCatalogEntries.mockReturnValueOnce([
      {
        id: "whatsapp",
        pluginId: "@openclaw/whatsapp",
        meta: {
          id: "whatsapp",
          label: "WhatsApp",
          selectionLabel: "WhatsApp",
          docsPath: "/channels/whatsapp",
          blurb: "wa",
        },
        install: {
          npmSpec: "@openclaw/whatsapp",
        },
      },
    ]);
    mocks.loadChannelSetupPluginRegistrySnapshotForChannel
      .mockReturnValueOnce({
        channels: [],
        channelSetups: [],
      })
      .mockReturnValueOnce({
        channels: [{ plugin }],
        channelSetups: [],
      });

    await runChannelLogin({ channel: "whatsapp" }, runtime);

    expect(mocks.ensureChannelSetupPluginInstalled).toHaveBeenCalledWith(
      expect.objectContaining({
        entry: expect.objectContaining({ id: "whatsapp" }),
        runtime,
        workspaceDir: "/tmp/workspace",
      }),
    );
    expect(mocks.login).toHaveBeenCalledWith(
      expect.objectContaining({
        channelInput: "whatsapp",
      }),
    );
  });

  it("runs logout with resolved account and explicit account id", async () => {
    await runChannelLogout({ channel: "whatsapp", account: " acct-2 " }, runtime);

    expect(mocks.resolveAccount).toHaveBeenCalledWith({ channels: { whatsapp: {} } }, "acct-2");
    expect(mocks.logoutAccount).toHaveBeenCalledWith({
      cfg: { channels: { whatsapp: {} } },
      accountId: "acct-2",
      account: { id: "resolved-account" },
      runtime,
    });
    expect(mocks.setVerbose).not.toHaveBeenCalled();
  });

  it("throws when channel does not support logout", async () => {
    mocks.getChannelPlugin.mockReturnValueOnce({
      auth: { login: mocks.login },
      gateway: {},
      config: { resolveAccount: mocks.resolveAccount },
    });

    await expect(runChannelLogout({ channel: "whatsapp" }, runtime)).rejects.toThrow(
      "Channel whatsapp does not support logout",
    );
  });
});
