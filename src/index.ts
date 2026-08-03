import { resolve } from 'node:path'

import { Context, h } from 'koishi'
import type { Session } from 'koishi'

import { Config as ConfigSchema } from './config'
import type { Config as QzonePluginConfig } from './config'
import { createCredentialAdapter } from './adapters'
import {
  QrCodeCredentialAdapter,
  QrLoginError,
} from './adapters/qrcode'
import { registerChatLunaTools } from './chatluna'
import { DEFAULT_QZONE_SETTINGS } from './defaults'
import { formatPost } from './formatter'
import { createRepository, defineDatabaseModel } from './repository'
import type { Post, RangeSelection } from './types'
import { QzoneApi } from './qzone/api'
import { parseCredentials } from './qzone/context'
import { SafeImageDownloader } from './qzone/image'
import { QzoneSession } from './qzone/session'
import { QzoneService } from './service'
import {
  collectImageSources,
  findMentionedUser,
  parsePostReference,
  parseRange,
} from './utils'

export const name = 'qzone'
export const inject = { required: ['chatluna'], optional: ['database'] }
export const Config = ConfigSchema
export interface Config extends QzonePluginConfig {}
export { KoishiOneBotAdapter } from './adapters/onebot'
export {
  QrCodeCredentialAdapter,
  QrLoginError,
  QrLoginRequiredError,
  hash33 as qrcodeHash33,
  parsePtuiCallback,
} from './adapters/qrcode'
export type {
  PtuiCallback,
  QrCodeCredentialAdapterOptions,
  QrLoginCallbacks,
  QrLoginChallenge,
} from './adapters/qrcode'
export { createQzoneToolDefinitions, registerChatLunaTools } from './chatluna'
export { QzoneApi } from './qzone/api'
export { QzoneSession } from './qzone/session'
export { QzoneService } from './service'
export type {
  AuthMode,
  ApiResponse,
  Comment,
  CredentialAdapter,
  CredentialResult,
  Post,
  QzoneCredentials,
} from './types'

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
  defineDatabaseModel(ctx)

  const baseDir = (ctx as Context & { baseDir?: string }).baseDir || process.cwd()
  const qrCodeAdapter = new QrCodeCredentialAdapter({
    credentialPath: resolve(baseDir, DEFAULT_QZONE_SETTINGS.credentialPath),
    timeoutMs: DEFAULT_QZONE_SETTINGS.timeoutMs,
    loginTimeoutSeconds: DEFAULT_QZONE_SETTINGS.qrLoginTimeoutSeconds,
    pollIntervalMs: DEFAULT_QZONE_SETTINGS.qrPollIntervalMs,
  })
  const credentialAdapter = createCredentialAdapter(ctx, config, qrCodeAdapter)
  const qzoneSession = new QzoneSession(
    credentialAdapter,
    DEFAULT_QZONE_SETTINGS.cookieTtlSeconds,
  )
  const api = new QzoneApi(qzoneSession, DEFAULT_QZONE_SETTINGS.timeoutMs)
  const repository = createRepository(ctx)
  const downloader = new SafeImageDownloader({
    allowedHosts: [...DEFAULT_QZONE_SETTINGS.allowedImageHosts],
    maxBytes: DEFAULT_QZONE_SETTINGS.maxImageBytes,
    timeoutMs: DEFAULT_QZONE_SETTINGS.timeoutMs,
  })
  const service = new QzoneService(
    api,
    qzoneSession,
    repository,
    downloader,
    DEFAULT_QZONE_SETTINGS.maxImages,
  )
  const recentPosts = new Map<string, Post[]>()
  registerChatLunaTools(ctx, service, config)

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
    const source = context.credentials.source === 'onebot' ? 'OneBot' : '二维码'
    return `QQ 空间已连接：${context.credentials.nickname || context.uin} (${context.uin})，认证来源：${source}`
  })

  ctx.command('qzone.login', '使用 QQ 二维码登录空间', {
    authority: config.adminAuthority,
  }).alias('扫码登录空间')
    .option('cancel', '--cancel 取消正在进行的扫码登录')
    .action(async ({ session, options }) => {
      if (!session) return
      if (options?.cancel) {
        return qrCodeAdapter.cancelLogin() ? '已取消二维码登录。' : '当前没有进行中的二维码登录。'
      }
      if (!session.isDirect) return '请在与机器人的私聊中执行 qzone.login，避免二维码被其他人扫描。'

      try {
        const result = await qrCodeAdapter.login({
          async onQrCode(challenge) {
            await session.send(`请使用手机 QQ 扫描二维码并确认登录，有效期至 ${new Date(challenge.expiresAt).toLocaleTimeString('zh-CN')}。`)
            await session.send(h.image(challenge.image, challenge.contentType))
          },
          async onStatus(status) {
            if (status === 'scanned') await session.send('二维码已扫描，请在手机 QQ 中确认登录。')
          },
        })
        qzoneSession.invalidate()
        const credential = parseCredentials(result.cookie, result.source, result.nickname)
        return `QQ 空间扫码登录成功：${credential.nickname || credential.uin} (${credential.uin})。`
      } catch (error) {
        return error instanceof QrLoginError ? error.message : '二维码登录失败，请稍后重试。'
      }
    })

  ctx.command('qzone.logout', '清除插件保存的 QQ 空间扫码凭据', {
    authority: config.adminAuthority,
  }).alias('退出空间登录').action(async () => {
    try {
      await qrCodeAdapter.clearCredential()
      qzoneSession.invalidate()
      return '已清除插件保存的扫码凭据；OneBot 登录状态不受影响。'
    } catch (error) {
      return error instanceof QrLoginError ? error.message : '扫码凭据清理失败。'
    }
  })

  ctx.command('qzone.feed [range:string]', '查看 QQ 空间动态', {
    authority: config.commandAuthority,
  }).alias('看说说')
    .option('user', '-u <user:string> 指定 QQ 号')
    .option('detail', '-d 获取完整评论')
    .action(async ({ session, options }, range) => {
      if (!session) return
      const selection: RangeSelection = parseRange(range, DEFAULT_QZONE_SETTINGS.defaultFeedCount)
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
  }).alias('评论说说').action(async ({ session }, reference, content) => {
    if (!session) return
    const post = await resolveCommandPost(session, reference)
    await service.comment(post, content)
    return `已评论 ${post.name || post.uin} 的动态。`
  })

  ctx.command('qzone.reply <reference:string> <commentIndex:number> <content:text>', '回复动态评论', {
    authority: config.commandAuthority,
  }).alias('回复评论').action(async ({ session }, reference, commentIndex, content) => {
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

  ctx.on('dispose', async () => {
    recentPosts.clear()
    await qrCodeAdapter.dispose()
  })
}
