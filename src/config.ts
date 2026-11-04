import { Schema } from 'koishi'

import { DEFAULT_QZONE_SETTINGS } from './defaults'

export interface Config {
  onebotSelfId: string
  debugLogging?: boolean
  imageHosts?: string[]
}

const onebotSelfId = Schema.string()
  .pattern(/^\d+$/)
  .required()
  .description('已连接 SnowLuma 的 OneBot 机器人 QQ 号')

const debugLogging = Schema.boolean()
  .default(false)
  .description('输出 SnowLuma Action 名称与参数键名（不会记录图片、Cookie 或 Token）')

// 只接受域名或 *.example.com 通配符；IP、端口、路径和协议头都不符合该格式。
const imageHostPattern = /^(\*\.)?(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/i

const imageHosts = Schema.array(Schema.string().pattern(imageHostPattern))
  .default([...DEFAULT_QZONE_SETTINGS.allowedImageHosts])
  .description(
    '图片下载与发布的域名白名单，仅支持公网域名；不支持内网地址、IP、端口或路径',
  )

export const Config = Schema.object({
  onebotSelfId,
  debugLogging,
  imageHosts,
}).description('SnowLuma') as Schema<Config>
