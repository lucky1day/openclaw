import { Command } from "commander";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createCliRuntimeCapture } from "./test-runtime-capture.js";

const runChannelLogin = vi.fn();
const runChannelLogout = vi.fn();
const { defaultRuntime, resetRuntimeCapture } = createCliRuntimeCapture();

vi.mock("../globals.js", () => ({
  danger: (value: string) => value,
}));

vi.mock("../runtime.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../runtime.js")>()),
  defaultRuntime,
}));

vi.mock("./channel-auth.js", () => ({
  runChannelLogin,
  runChannelLogout,
}));

vi.mock("./channel-options.js", () => ({
  formatCliChannelOptions: () => "whatsapp|weixin",
}));

vi.mock("../terminal/links.js", () => ({
  formatDocsLink: (_path: string, full: string) => `https://${full}`,
}));

vi.mock("../terminal/theme.js", () => ({
  theme: {
    heading: (value: string) => value,
    muted: (value: string) => value,
  },
}));

vi.mock("./help-format.js", () => ({
  formatHelpExamples: (rows: Array<[string, string]>) =>
    rows.map(([command, description]) => `${command} ${description}`).join("\n"),
}));

vi.mock("./command-options.js", () => ({
  hasExplicitOptions: () => false,
}));

vi.mock("./cli-utils.js", () => ({
  runCommandWithRuntime: async (
    runtime: { error: (message: string) => void; exit: (code: number) => void },
    action: () => Promise<void>,
    onError?: (error: unknown) => void,
  ) => {
    try {
      await action();
    } catch (error) {
      if (onError) {
        onError(error);
        return;
      }
      runtime.error(String(error));
      runtime.exit(1);
    }
  },
}));

const { registerChannelsCli } = await import("./channels-cli.js");

describe("channels-cli", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetRuntimeCapture();
    runChannelLogin.mockResolvedValue(undefined);
    runChannelLogout.mockResolvedValue(undefined);
  });

  it("forwards gateway client options to channel login", async () => {
    const program = new Command();
    registerChannelsCli(program);

    await program.parseAsync(
      [
        "channels",
        "login",
        "--channel",
        "weixin",
        "--url",
        "ws://127.0.0.1:19001",
        "--token",
        "gateway-token",
        "--timeout",
        "450000",
        "--verbose",
      ],
      { from: "user" },
    );

    expect(runChannelLogin).toHaveBeenCalledWith(
      {
        channel: "weixin",
        account: undefined,
        verbose: true,
        url: "ws://127.0.0.1:19001",
        token: "gateway-token",
        timeout: "450000",
      },
      defaultRuntime,
    );
  });
});
