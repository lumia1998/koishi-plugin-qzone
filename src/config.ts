import { Schema } from 'koishi'

export interface Config {
  commandAuthority: number
  adminAuthority: number
}

export const Config: Schema<Config> = Schema.object({
  commandAuthority: Schema.number().min(0).max(5).default(1).description('查询、点赞、评论命令与工具权限'),
  adminAuthority: Schema.number().min(0).max(5).default(3).description('扫码登录、发布和删除命令与工具权限'),
}).description('权限')
