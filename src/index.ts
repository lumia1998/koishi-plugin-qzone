import { Context, Logger } from 'koishi'
import type { Bot, Session } from 'koishi'

import { Config as ConfigSchema } from './config'
import type { Config as QzonePluginConfig } from './config'
import { createCredentialAdapter } from './adapters'
import { formatPost } from './formatter'
import { createRepository, defineDatabaseModel } from './repository'
import type { Post, RangeSelection } from './types'
import { QzoneApi } from './qzone/api'
import { SafeImageDownloader } from './qzone/image'
import { QzoneSession } from './qzone/session'
import { QzoneService } from './service'
import { RandomizedCronTask } from './scheduler'
import {
  collectImageSources,
  findMentionedUser,
  parsePostReference,
  parseRange,
} from './utils'

export const name = 'qzone'
export const inject = { optional: ['database'] }
export const Config = ConfigSchema
export interface Config extends QzonePluginConfig {}
export { ManualCookieAdapter } from './adapters/manual'
export { KoishiOneBotAdapter, OneBotHttpAdapter } from './adapters/onebot'
export { QzoneApi } from './qzone/api'
export { QzoneSession } from './qzone/session'
export { QzoneService } from './service'
export type {
  ApiResponse,
  Comment,
  CredentialAdapter,
  CredentialResult,
  Post,
  QzoneCredentials,
} from './types'

function selectBot(ctx: Context, configuredId: string): Bot | undefined {
  const bots = [...ctx.bots]
  if (configuredId) return bots.find((bot) => bot.selfId === configuredId)
  return bots.find((bot) => {
    const internal = bot.internal as Record<string, unknown> | undefined
    return typeof internal?.getCookies === 'function'
      || typeof internal?.getCredentials === 'function'
  }) || bots[0]
}

function sessionCacheKey(session: Session): string {
  return [session.platform, session.selfId, session.guildId, session.channelId, session.userId].join(':')
}

async function sendPosts(session: Session, posts: Post[]): Promise<void> {
  if (!posts.length) {
    await session.send('查询结果为空。')
    return
  }
  for (const [index, post] of posts.entries()) {
    await session.send(formatPost(post, index))
  }
}

export function apply(ctx: Context, config: QzonePluginConfig): void {
  const logger = new Logger('qzone')
  defineDatabaseModel(ctx)

  const adapter = createCredentialAdapter(config, () => selectBot(ctx, config.botId))
  const qzoneSession = new QzoneSession(adapter, config.cookieTtlSeconds)
  const api = new QzoneApi(qzoneSession, config.timeoutMs)
  const repository = createRepository(ctx)
  const downloader = new SafeImageDownloader({
    allowedHosts: config.allowedImageHosts,
    maxBytes: config.maxImageBytes,
    timeoutMs: config.timeoutMs,
  })
  const service = new QzoneService(api, qzoneSession, repository, downloader, config.maxImages)
  const recentPosts = new Map<string, Post[]>()

  async function resolveCommandPost(session: Session, reference = '0'): Promise<Post> {
    const normalized = reference.trim()
    if (/^\d+$/.test(normalized)) {
      const cached = recentPosts.get(sessionCacheKey(session)) || []
      const index = Number(normalized)
      if (cached[index]) return cached[index]
      throw new Error(`动态序号 ${index} 不在最近查询结果中`)
    }
    return service.resolvePost(parsePostReference(normalized))
  }

  ctx.command('qzone.status', '查看 QQ 空间登录状态', {
    authority: config.commandAuthority,
  }).alias('空间状态').action(async () => {
    const context = await qzoneSession.getContext()
    return `QQ 空间已连接：${context.credentials.nickname || context.uin} (${context.uin})，认证来源：${context.credentials.source}`
  })

  ctx.command('qzone.refresh', '刷新 QQ 空间 Cookie', {
    authority: config.adminAuthority,
  }).alias('刷新空间登录').action(async () => {
    qzoneSession.invalidate()
    const context = await qzoneSession.getContext(true)
    return `QQ 空间登录已刷新：${context.uin}，来源：${context.credentials.source}`
  })

  ctx.command('qzone.feed [range:string]', '查看 QQ 空间动态', {
    authority: config.commandAuthority,
  }).alias('看说说').alias('查看说说')
    .option('user', '-u <user:string> 指定 QQ 号')
    .option('detail', '-d 获取完整评论')
    .action(async ({ session, options }, range) => {
      if (!session) return
      const selection: RangeSelection = parseRange(range, config.defaultFeedCount)
      const target = options?.user || findMentionedUser(session)
      if (target && !/^\d+$/.test(target)) return 'QQ 号必须为纯数字。'
      const posts = await service.queryFeeds({
        targetId: target,
        offset: selection.offset,
        limit: selection.limit,
        withDetail: options?.detail,
      })
      recentPosts.set(sessionCacheKey(session), posts)
      await sendPosts(session, posts)
    })

  ctx.command('qzone.like [reference:string]', '点赞动态，默认最近查询的第 0 条', {
    authority: config.commandAuthority,
  }).alias('赞说说').action(async ({ session }, reference) => {
    if (!session) return
    const post = await resolveCommandPost(session, reference)
    await service.like(post)
    return `已点赞 ${post.name || post.uin} 的动态 #${post.id || post.tid}。`
  })

  ctx.command('qzone.comment <reference:string> <content:text>', '评论动态', {
    authority: config.commandAuthority,
  }).alias('评说说').alias('评论说说').action(async ({ session }, reference, content) => {
    if (!session) return
    const post = await resolveCommandPost(session, reference)
    await service.comment(post, content)
    return `已评论 ${post.name || post.uin} 的动态。`
  })

  ctx.command('qzone.reply <reference:string> <commentIndex:number> <content:text>', '回复动态评论', {
    authority: config.commandAuthority,
  }).alias('回评').alias('回复评论').action(async ({ session }, reference, commentIndex, content) => {
    if (!session) return
    const post = await resolveCommandPost(session, reference)
    await service.reply(post, commentIndex, content)
    return '回复已发送。'
  })

  ctx.command('qzone.publish <content:text>', '发布 QQ 空间说说', {
    authority: config.adminAuthority,
  }).alias('发说说').action(async ({ session }, content) => {
    if (!session) return
    const post = await service.publish(content, collectImageSources(session))
    return `说说已发布：#${post.id || post.tid}`
  })

  ctx.command('qzone.delete <reference:string>', '删除当前账号发布的说说', {
    authority: config.adminAuthority,
  }).alias('删说说').action(async ({ session }, reference) => {
    if (!session) return
    const post = await resolveCommandPost(session, reference)
    await service.delete(post)
    return '说说已删除。'
  })

  ctx.command('qzone.visitors', '查看最近访客', {
    authority: config.adminAuthority,
  }).alias('查看访客').action(() => service.visitors())

  const scheduledTasks: RandomizedCronTask[] = []
  if (config.autoCommentCron.trim()) {
    const task = new RandomizedCronTask(
      ctx,
      logger,
      'Qzone 自动评论',
      config.autoCommentCron,
      config.cronTimezone,
      config.randomOffsetSeconds,
      async () => {
        if (!config.autoCommentText.trim()) return
        const posts = await service.queryFeeds({
          limit: 20,
          excludeSelf: true,
          excludeCommented: true,
        })
        for (const post of posts) {
          await service.comment(post, config.autoCommentText)
          if (config.autoLikeWithComment) await service.like(post)
        }
      },
    )
    try {
      task.start()
      scheduledTasks.push(task)
    } catch (error) {
      logger.warn('自动评论任务配置无效，已禁用：%s', error instanceof Error ? error.message : String(error))
    }
  }

  if (config.autoPublishCron.trim()) {
    const task = new RandomizedCronTask(
      ctx,
      logger,
      'Qzone 自动发布',
      config.autoPublishCron,
      config.cronTimezone,
      config.randomOffsetSeconds,
      async () => {
        if (config.autoPublishText.trim()) await service.publish(config.autoPublishText)
      },
    )
    try {
      task.start()
      scheduledTasks.push(task)
    } catch (error) {
      logger.warn('自动发布任务配置无效，已禁用：%s', error instanceof Error ? error.message : String(error))
    }
  }

  ctx.on('dispose', () => {
    for (const task of scheduledTasks) task.dispose()
    recentPosts.clear()
  })
}
