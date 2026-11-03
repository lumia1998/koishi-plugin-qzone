import { Schema } from 'koishi'

export interface Config {
  onebotSelfId: string
  debugLogging?: boolean
}

const onebotSelfId = Schema.string()
  .pattern(/^\d+$/)
  .required()
  .description('已连接 SnowLuma 的 OneBot 机器人 QQ 号')

const debugLogging = Schema.boolean()
  .default(false)
  .description('输出 SnowLuma Action 名称与参数键名（不会记录图片、Cookie 或 Token）')

export const Config = Schema.object({
  onebotSelfId,
  debugLogging,
}).description('SnowLuma') as Schema<Config>
