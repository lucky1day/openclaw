---
summary: "WeChat channel support, QR login, DM behavior, and current limitations"
read_when:
  - You want to connect WeChat to OpenClaw
  - You are configuring or operating the WeChat channel
title: "WeChat"
---

# WeChat

Status: direct-message WeChat bridge via the Tencent iLink Bot surface. Current OpenClaw builds support QR login, DM routing, inbound images, and live typing indicators.

## Current scope

- Direct messages only
- QR login through `openclaw channels login --channel weixin`
- DM access controls: `pairing`, `allowlist`, `open`, `disabled`
- Inbound images: the model can inspect an image and reply with text
- Typing indicators during reply generation

Not in scope yet:

- Group chats
- Outbound image/media replies
- Voice, file, and video flows

## Requirements

- A WeChat account/device where the Tencent iLink / ClawBot plugin surface is available
- A running Gateway for QR login and message delivery

OpenClaw uses the bundled WeChat channel id `weixin`. In the current repository and local builds, no separate Tencent plugin install is required.

## Quick setup

1. Start the gateway:

```bash
openclaw gateway
```

2. Scan the QR code:

```bash
openclaw channels login --channel weixin
```

3. Check channel status:

```bash
openclaw channels status --probe
```

If the QR login succeeds, the WeChat account becomes `linked`/`running`, and OpenClaw starts the WeChat monitor automatically.

## Configuration

Minimal config example:

```json5
{
  channels: {
    weixin: {
      dmPolicy: "pairing",
      accounts: {
        default: {
          authFile: ".local/share/openclaw/weixin/auth.json",
          syncBufFile: ".local/share/openclaw/weixin/sync-buf.json",
        },
      },
    },
  },
}
```

Useful account-level fields:

- `authFile`: where QR login credentials are stored
- `syncBufFile`: cursor/checkpoint file for long polling
- `pollIntervalMs`: long-poll cadence
- `dmPolicy`: DM access policy
- `allowFrom`: allowlist entries for DM access
- `routeTag`: optional routing tag into a specific agent path
- `defaultTo`: default recipient override for selected reply flows

Defaults:

- `authFile`: `.local/share/openclaw/weixin/auth.json`
- `syncBufFile`: `.local/share/openclaw/weixin/sync-buf.json`
- `dmPolicy`: `pairing`

## DM access control

WeChat uses the standard OpenClaw DM policy model:

- `pairing`: unknown senders get a pairing code; their message is not processed until approved
- `allowlist`: only configured/approved senders can talk to the bot
- `open`: allow any sender, typically together with `"*"` in `allowFrom`
- `disabled`: block inbound DMs

Approve a WeChat pairing request with:

```bash
openclaw pairing list weixin
openclaw pairing approve weixin <CODE>
```

## Runtime behavior

- WeChat is a direct-chat-only channel in the current implementation
- Message replies use the WeChat `context_token` path, so text replies map back to the active DM
- The channel keeps a sync buffer on disk to resume long polling cleanly
- A per-account lock prevents two gateway processes from consuming the same WeChat account at the same time
- Repeated inbound message ids are deduplicated before dispatch

## Media behavior

Current inbound media support focuses on images:

- mixed text + image messages preserve text and attach media context
- image-only messages enter the agent with a `<media:image>` placeholder body
- images are downloaded from WeChat CDN, decrypted when needed, and exposed through the standard OpenClaw media context

Current outbound behavior is text-only.

## Typing indicators

WeChat typing indicators are wired into OpenClaw's native reply lifecycle:

- typing starts when OpenClaw begins preparing the reply
- keepalive pulses continue while the model is still working
- typing is canceled when the reply completes or aborts

## Known limitations

- No group chat support yet
- No outbound image/media replies yet
- No voice/file/video ingestion yet
- WeChat access depends on Tencent's iLink/ClawBot availability for the logged-in account

## Troubleshooting

- If login fails, make sure the gateway is running before you call `channels login`
- If the channel shows `configured` but not `connected`, check the stored `authFile`
- If replies duplicate, verify that only one gateway process is running for the same WeChat account
- Use [Channel troubleshooting](/channels/troubleshooting) for cross-channel diagnostics
