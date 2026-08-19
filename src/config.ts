import { Schema } from 'koishi'

import type { AuthMode } from './types'

export interface Config {
  authMode: AuthMode
  onebotSelfId?: string
  debugLogging?: boolean
}

function onebotSelfIdSchema() {
  return Schema.string()
    .pattern(/^\d+$/)
    .required()
    .description('提供 QQ 空间 Cookie 的 OneBot 机器人 QQ 号')
}

const authMode = Schema.union([
  Schema.const('auto').description('优先 OneBot，认证失败后使用二维码凭据'),
  Schema.const('onebot').description('仅使用指定 OneBot 机器人'),
  Schema.const('qrcode').description('仅使用二维码凭据'),
]).default('auto').description('认证方式')

const debugLogging = Schema.boolean()
  .default(false)
  .description('输出 QQ 空间请求/响应调试日志（含接口 URL、状态码、原始响应）。工具调用失败时基础错误信息始终记录，不受此开关影响')

export const Config = Schema.intersect([
  Schema.object({ authMode }).description('认证'),
  Schema.union([
    Schema.object({
      authMode: Schema.const('auto').default('auto'),
      onebotSelfId: onebotSelfIdSchema(),
    }),
    Schema.object({
      authMode: Schema.const('onebot').required(),
      onebotSelfId: onebotSelfIdSchema(),
    }),
    Schema.object({
      authMode: Schema.const('qrcode').required(),
    }),
  ]),
]) as Schema<Config>
