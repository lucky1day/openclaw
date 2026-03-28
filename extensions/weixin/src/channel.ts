import {
  buildChannelConfigSchema,
  buildPassiveChannelStatusSummary,
  buildTrafficStatusSummary,
  collectStatusIssuesFromLastError,
  createComputedAccountStatusAdapter,
  createDefaultChannelRuntimeState,
  createScopedChannelConfigAdapter,
  describeAccountSnapshot,
  formatTrimmedAllowFromEntries,
  type ChannelPlugin,
} from "../runtime-api.js";
import {
  DEFAULT_ACCOUNT_ID,
  listWeixinAccountIds,
  resolveDefaultWeixinAccountId,
  resolveWeixinAccount,
  upsertWeixinAccount,
  WEIXIN_CHANNEL,
  type ResolvedWeixinAccount,
} from "./accounts.js";
import { WeixinConfigSchema } from "./config-schema.js";
import { startWeixinLoginWithQr, waitForWeixinLogin } from "./login-qr.js";
import { monitorWeixinAccount } from "./monitor.js";

const weixinConfigAdapter = createScopedChannelConfigAdapter<ResolvedWeixinAccount>({
  sectionKey: WEIXIN_CHANNEL,
  listAccountIds: listWeixinAccountIds,
  resolveAccount: resolveWeixinAccount,
  defaultAccountId: resolveDefaultWeixinAccountId,
  clearBaseFields: [
    "name",
    "baseUrl",
    "authFile",
    "syncBufFile",
    "pollIntervalMs",
    "routeTag",
    "botType",
    "dmPolicy",
    "allowFrom",
    "defaultTo",
  ],
  resolveAllowFrom: (account) => account.allowFrom,
  formatAllowFrom: (allowFrom) => formatTrimmedAllowFromEntries(allowFrom),
  resolveDefaultTo: (account) => account.defaultTo,
});

export const weixinPlugin = {
  id: WEIXIN_CHANNEL,
  meta: {
    id: WEIXIN_CHANNEL,
    label: "WeChat",
    selectionLabel: "WeChat",
    docsPath: "/channels/weixin",
    blurb: "WeChat direct-message bridge",
    quickstartAllowFrom: true,
    forceAccountBinding: true,
  },
  capabilities: {
    chatTypes: ["direct"],
    media: true,
  },
  reload: {
    configPrefixes: [`channels.${WEIXIN_CHANNEL}`],
  },
  configSchema: buildChannelConfigSchema(WeixinConfigSchema),
  config: {
    ...weixinConfigAdapter,
    isEnabled: (account) => account.enabled,
    isConfigured: (account) => account.configured,
    describeAccount: (account) =>
      describeAccountSnapshot({
        account,
        configured: account.configured,
        extra: {
          baseUrl: account.baseUrl,
          dmPolicy: account.dmPolicy,
          allowFrom: account.allowFrom,
        },
      }),
  },
  setup: {
    applyAccountConfig: ({ cfg, accountId, input }) => upsertWeixinAccount(cfg, accountId, input),
  },
  status: createComputedAccountStatusAdapter<ResolvedWeixinAccount>({
    defaultRuntime: createDefaultChannelRuntimeState(DEFAULT_ACCOUNT_ID, {
      connected: false,
      lastInboundAt: null,
      lastOutboundAt: null,
    }),
    collectStatusIssues: (accounts) => collectStatusIssuesFromLastError(WEIXIN_CHANNEL, accounts),
    buildChannelSummary: ({ snapshot }) =>
      buildPassiveChannelStatusSummary(snapshot, {
        connected: snapshot.connected ?? false,
        baseUrl: snapshot.baseUrl ?? null,
        ...buildTrafficStatusSummary(snapshot),
      }),
    resolveAccountSnapshot: ({ account, runtime }) => ({
      accountId: account.accountId,
      name: account.name,
      enabled: account.enabled,
      configured: account.configured,
      extra: {
        connected: runtime?.connected ?? false,
        baseUrl: account.baseUrl,
        authFile: account.authFile,
        syncBufFile: account.syncBufFile,
        dmPolicy: account.dmPolicy,
        allowFrom: account.allowFrom,
        ...buildTrafficStatusSummary(runtime),
      },
    }),
    resolveAccountState: ({ enabled, configured }) => {
      if (!enabled) {
        return "disabled";
      }
      return configured ? "linked" : "not linked";
    },
  }),
  gatewayMethods: ["web.login.start", "web.login.wait"],
  gateway: {
    startAccount: async (ctx) => await monitorWeixinAccount(ctx),
    loginWithQrStart: async ({ accountId, force, timeoutMs, verbose }) =>
      await startWeixinLoginWithQr({ accountId, force, timeoutMs, verbose }),
    loginWithQrWait: async ({ accountId, timeoutMs }) =>
      await waitForWeixinLogin({ sessionKey: accountId ?? DEFAULT_ACCOUNT_ID, timeoutMs }),
  },
} satisfies ChannelPlugin<ResolvedWeixinAccount>;
