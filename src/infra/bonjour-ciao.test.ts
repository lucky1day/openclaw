import { describe, expect, it } from "vitest";

const {
  classifyCiaoUnhandledRejection,
  classifyCiaoUncaughtException,
  ignoreCiaoUnhandledRejection,
  ignoreCiaoUncaughtException,
} = await import("./bonjour-ciao.js");

describe("bonjour-ciao", () => {
  it("classifies ciao cancellation rejections separately from side effects", () => {
    expect(classifyCiaoUnhandledRejection(new Error("CIAO PROBING CANCELLED"))).toEqual({
      kind: "cancellation",
      formatted: "CIAO PROBING CANCELLED",
    });
  });

  it("classifies ciao interface assertions separately from side effects", () => {
    expect(
      classifyCiaoUnhandledRejection(
        new Error("Reached illegal state! IPV4 address change from defined to undefined!"),
      ),
    ).toEqual({
      kind: "interface-assertion",
      formatted: "Reached illegal state! IPV4 address change from defined to undefined!",
    });
  });

  it("suppresses ciao announcement cancellation rejections", () => {
    expect(ignoreCiaoUnhandledRejection(new Error("Ciao announcement cancelled by shutdown"))).toBe(
      true,
    );
  });

  it("suppresses ciao probing cancellation rejections", () => {
    expect(ignoreCiaoUnhandledRejection(new Error("CIAO PROBING CANCELLED"))).toBe(true);
  });

  it("suppresses lower-case string cancellation reasons too", () => {
    expect(ignoreCiaoUnhandledRejection("ciao announcement cancelled during cleanup")).toBe(true);
  });

  it("suppresses ciao interface assertion rejections as non-fatal", () => {
    const error = Object.assign(
      new Error("Reached illegal state! IPV4 address change from defined to undefined!"),
      { name: "AssertionError" },
    );

    expect(ignoreCiaoUnhandledRejection(error)).toBe(true);
  });

  it("classifies ciao netmask assertions from uncaught exceptions", () => {
    const error = Object.assign(
      new Error(
        "IP address version must match. Netmask cannot have a version different from the address!",
      ),
      {
        name: "AssertionError",
        stack:
          "AssertionError: IP address version must match. Netmask cannot have a version different from the address!\n" +
          "    at getNetAddress (/Users/jiajie/dev/openclaw/node_modules/@homebridge/ciao/src/util/domain-formatter.ts:273:9)\n" +
          "    at MDNSServer.handleMessage (/Users/jiajie/dev/openclaw/node_modules/@homebridge/ciao/src/MDNSServer.ts:587:42)",
      },
    );

    expect(classifyCiaoUncaughtException(error)).toEqual({
      kind: "netmask-assertion",
      formatted:
        "AssertionError: IP address version must match. Netmask cannot have a version different from the address!",
    });
  });

  it("suppresses ciao netmask assertions as non-fatal uncaught exceptions", () => {
    const error = Object.assign(
      new Error(
        "IP address version must match. Netmask cannot have a version different from the address!",
      ),
      {
        name: "AssertionError",
        stack:
          "AssertionError: IP address version must match. Netmask cannot have a version different from the address!\n" +
          "    at getNetAddress (/Users/jiajie/dev/openclaw/node_modules/@homebridge/ciao/src/util/domain-formatter.ts:273:9)\n" +
          "    at MDNSServer.handleMessage (/Users/jiajie/dev/openclaw/node_modules/@homebridge/ciao/src/MDNSServer.ts:587:42)",
      },
    );

    expect(ignoreCiaoUncaughtException(error)).toBe(true);
  });

  it("keeps unrelated rejections visible", () => {
    expect(ignoreCiaoUnhandledRejection(new Error("boom"))).toBe(false);
  });
});
