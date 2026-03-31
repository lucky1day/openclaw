---
read_when:
  - 你想把微信接入 OpenClaw
  - 你正在配置或排查微信渠道
summary: 微信渠道支持、二维码登录、私聊行为与当前限制
title: 微信
---

# 微信

状态：基于腾讯 iLink Bot 能力的微信私聊桥接。当前 OpenClaw 已支持二维码登录、私聊路由、入站图片识别和回复中的“正在输入中”提示。

## 当前范围

- 仅支持私聊
- 通过 `openclaw channels login --channel weixin` 扫码登录
- 私聊访问控制：`pairing`、`allowlist`、`open`、`disabled`
- 入站图片：模型可以看图并回复文本
- 回复生成时显示 typing 指示

当前尚未支持：

- 群聊
- 出站图片或其他媒体回复
- 语音、文件、视频链路

## 前置条件

- 你的微信账号/设备需要具备腾讯 iLink / ClawBot 对应能力
- Gateway 网关需要先运行，二维码登录和消息收发都依赖它

OpenClaw 当前使用内置的微信渠道 id `weixin`。在当前仓库和本地构建里，不需要再额外安装旧的腾讯插件。

## 快速开始

1. 启动 Gateway 网关：

```bash
openclaw gateway
```

2. 扫码登录：

```bash
openclaw channels login --channel weixin
```

3. 查看渠道状态：

```bash
openclaw channels status --probe
```

扫码成功后，微信账户会进入 `linked` / `running` 状态，OpenClaw 会自动启动微信 monitor。

## 配置示例

最小配置示例：

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

常用账户级字段：

- `authFile`：二维码登录凭据存储位置
- `syncBufFile`：长轮询游标/断点文件
- `pollIntervalMs`：轮询间隔
- `dmPolicy`：私聊访问策略
- `allowFrom`：私聊允许列表
- `routeTag`：可选的 agent 路由标签
- `defaultTo`：部分回复流程使用的默认接收方覆写

默认值：

- `authFile`：`.local/share/openclaw/weixin/auth.json`
- `syncBufFile`：`.local/share/openclaw/weixin/sync-buf.json`
- `dmPolicy`：`pairing`

## 私聊访问控制

微信复用 OpenClaw 标准私聊策略模型：

- `pairing`：未知发送者先收到配对码，消息不会进入模型
- `allowlist`：只有已配置或已批准的发送者能与机器人对话
- `open`：允许任意发送者，通常配合 `allowFrom: ["*"]`
- `disabled`：禁用入站私聊

批准微信配对请求：

```bash
openclaw pairing list weixin
openclaw pairing approve weixin <CODE>
```

## 运行时行为

- 当前实现只支持微信私聊
- 回复依赖微信的 `context_token`，文本回复会回到当前私聊会话
- 渠道会把同步游标写到磁盘，便于长轮询恢复
- 每个微信账户都有单实例锁，避免两个 gateway 同时消费同一个账号
- 入站消息会按 message id 去重，避免重复回复

## 图片行为

当前入站媒体支持聚焦在图片：

- 图文混合消息会保留文字，并附带图片媒体上下文
- 纯图片消息会以 `<media:image>` 占位正文进入 agent
- 图片会从微信 CDN 下载，必要时解密，并通过 OpenClaw 标准媒体上下文提供给模型

当前出站仍然只支持文本回复。

## 正在输入中

微信 typing 指示已经接到 OpenClaw 原生回复生命周期：

- OpenClaw 开始准备回复时启动 typing
- 模型仍在处理时会持续 keepalive
- 回复完成或中止时发送 cancel

## 已知限制

- 还不支持群聊
- 还不支持出站图片/媒体回复
- 还不支持语音、文件、视频接入
- 微信可用性取决于腾讯侧 iLink / ClawBot 能力是否对该账号开放

## 排查建议

- 登录失败时，先确认 `openclaw gateway` 已经运行
- 如果渠道显示 `configured` 但不是 `connected`，先检查 `authFile`
- 如果出现重复回复，先确认同一微信账号只被一个 gateway 进程消费
- 通用排查见 [渠道故障排除](/channels/troubleshooting)
