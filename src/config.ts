import { Schema } from 'koishi'

import type { AuthMode } from './types'

export interface Config {
  authMode: AuthMode
  botId: string
  manualCookie: string
  onebotHttpUrl: string
  onebotAccessToken: string
  allowInsecureOnebotHttp: boolean
  cookieTtlSeconds: number
  timeoutMs: number
  defaultFeedCount: number
  maxImageBytes: number
  maxImages: number
  allowedImageHosts: string[]
  commandAuthority: number
  adminAuthority: number
  autoCommentCron: string
  autoCommentText: string
  autoLikeWithComment: boolean
  autoPublishCron: string
  autoPublishText: string
  cronTimezone: string
  randomOffsetSeconds: number
}

const authModeSchema = Schema.union([
  Schema.const('auto').description('依次尝试 OneBot、HTTP Action、手动 Cookie'),
  Schema.const('onebot').description('Koishi OneBot 适配器'),
  Schema.const('onebot-http').description('独立 OneBot HTTP Action'),
  Schema.const('manual').description('独立 Qzone Cookie'),
])

export const Config: Schema<Config> = Schema.intersect([
  Schema.object({
    authMode: authModeSchema.default('auto').description('认证方式'),
    botId: Schema.string().description('指定获取 Cookie 的机器人 selfId，留空使用首个可用机器人'),
    manualCookie: Schema.string().role('secret').description('完整 QQ 空间 Cookie；manual 或 auto 回退时使用'),
    onebotHttpUrl: Schema.string().description('OneBot HTTP API 地址，例如 http://127.0.0.1:3000'),
    onebotAccessToken: Schema.string().role('secret').description('OneBot HTTP access token'),
    allowInsecureOnebotHttp: Schema.boolean().default(false).description('允许向非回环 HTTP 地址发送 OneBot Token'),
    cookieTtlSeconds: Schema.number().min(0).max(86400).step(60).default(600).description('Cookie 缓存时间，0 表示持续缓存'),
  }).description('认证'),
  Schema.object({
    timeoutMs: Schema.number().min(1000).max(120000).step(1000).default(10000).description('Qzone 请求超时'),
    defaultFeedCount: Schema.number().min(1).max(20).default(5).description('默认查询动态数量'),
    maxImageBytes: Schema.number().min(1024).max(20 * 1024 * 1024).default(8 * 1024 * 1024).description('发布图片下载上限'),
    maxImages: Schema.number().min(1).max(9).default(9).description('单次发布图片数量上限'),
    allowedImageHosts: Schema.array(Schema.string()).default([
      '*.qpic.cn',
      '*.qlogo.cn',
      '*.qq.com',
      '*.gtimg.cn',
    ]).description('允许下载并转发到 Qzone 的图片域名'),
  }).description('网络'),
  Schema.object({
    commandAuthority: Schema.number().min(0).max(5).default(1).description('查询、点赞、评论命令权限'),
    adminAuthority: Schema.number().min(0).max(5).default(3).description('发布、删除、定时任务权限'),
  }).description('权限'),
  Schema.object({
    autoCommentCron: Schema.string().default('').description('自动评论 Cron，留空关闭'),
    autoCommentText: Schema.string().default('').description('自动评论内容；为空时跳过评论'),
    autoLikeWithComment: Schema.boolean().default(true).description('自动评论后点赞'),
    autoPublishCron: Schema.string().default('').description('自动发布 Cron，留空关闭'),
    autoPublishText: Schema.string().default('').description('自动发布内容；为空时跳过发布'),
    cronTimezone: Schema.string().default('Asia/Shanghai').description('Cron 时区'),
    randomOffsetSeconds: Schema.number().min(0).max(3600).default(0).description('执行时间随机前后偏移秒数'),
  }).description('定时任务'),
])
