import type {
  QzoneBackend,
  QzoneCommentResult,
  QzoneLoginInfo,
  QzonePublishResult,
} from '../backend'
import type { Comment, Post } from '../types'
import { asNumber, asRecord, asString } from '../types'
import type { SnowLumaClient } from './client'
import { mergeDetail, parseFeed, parseFeedPage, parseMsgList } from './parser'

export interface SnowLumaBackendOptions {
  feedPageSize?: number
  maxFeedPages?: number
  detailCommentLimit?: number
}

function toOptionalUin(value: string): number | undefined {
  if (!/^\d+$/.test(value)) return undefined
  const uin = Number(value)
  return Number.isSafeInteger(uin) && uin > 0 ? uin : undefined
}

function requireUin(value: string, label: string): number {
  const uin = toOptionalUin(value)
  if (uin === undefined) throw new Error(`${label}不是有效的 QQ 号`)
  return uin
}

function toCommentId(value: string): number | string | undefined {
  if (!value) return undefined
  if (!/^\d+$/.test(value)) return value
  const id = Number(value)
  return Number.isSafeInteger(id) ? id : value
}

function withTargetUin(
  params: Record<string, unknown>,
  uin: string,
): Record<string, unknown> {
  const target = toOptionalUin(uin)
  if (target !== undefined) params.target_uin = target
  return params
}

export class SnowLumaBackend implements QzoneBackend {
  private readonly feedPageSize: number
  private readonly maxFeedPages: number
  private readonly detailCommentLimit: number

  constructor(
    private readonly client: SnowLumaClient,
    options: SnowLumaBackendOptions = {},
  ) {
    this.feedPageSize = Math.min(50, Math.max(1, options.feedPageSize ?? 50))
    this.maxFeedPages = Math.max(1, options.maxFeedPages ?? 10)
    this.detailCommentLimit = Math.min(100, Math.max(1, options.detailCommentLimit ?? 100))
  }

  async getLoginInfo(): Promise<QzoneLoginInfo> {
    const data = asRecord(await this.client.call('get_login_info'))
    const uin = asString(data.user_id)
    if (!uin) throw new Error('SnowLuma 未返回登录 QQ 号')
    return { uin, nickname: asString(data.nickname) }
  }

  async getFriendFeeds(offset: number, limit: number): Promise<Post[]> {
    const wanted = offset + limit
    const items: unknown[] = []
    let cursor: string | undefined

    for (let page = 0; page < this.maxFeedPages && items.length < wanted; page += 1) {
      const remaining = wanted - items.length
      const params: Record<string, unknown> = {
        count: Math.min(this.feedPageSize, remaining),
      }
      if (cursor) params.cursor = cursor
      else params.page_num = page + 1

      const pageData = parseFeedPage(await this.client.call('get_qzone_feeds', params))
      items.push(...pageData.feeds)
      if (!pageData.hasMore || !pageData.nextCursor || pageData.nextCursor === cursor) break
      cursor = pageData.nextCursor
    }

    return items.slice(offset, offset + limit).map(parseFeed)
  }

  async getUserPosts(targetUin: string, offset: number, limit: number): Promise<Post[]> {
    const data = await this.client.call('get_qzone_msg_list', {
      target_uin: requireUin(targetUin, '目标 QQ 号'),
      pos: offset,
      num: Math.min(100, Math.max(1, limit)),
    })
    return parseMsgList(data, targetUin)
  }

  async getDetail(post: Post): Promise<Post> {
    const params = withTargetUin({
      tid: post.tid,
      pos: 0,
      num: this.detailCommentLimit,
    }, post.uin)
    return mergeDetail(post, await this.client.call('get_qzone_msg_detail', params))
  }

  async like(post: Post): Promise<void> {
    const params = withTargetUin({ tid: post.tid }, post.uin)
    if (post.createTime > 0) params.abstime = post.createTime
    await this.client.call('like_qzone', params, { write: true })
  }

  async unlike(post: Post): Promise<void> {
    const params = withTargetUin({ tid: post.tid }, post.uin)
    if (post.createTime > 0) params.abstime = post.createTime
    await this.client.call('unlike_qzone', params, { write: true })
  }

  async comment(post: Post, content: string, images: string[] = []): Promise<QzoneCommentResult> {
    const text = content.trim()
    if (!text && !images.length) throw new Error('评论内容不能为空')
    const params = withTargetUin({
      tid: post.tid,
      // SnowLuma 要求 content 至少 1 个字符；纯图片评论使用零宽空格占位。
      content: text || '​',
    }, post.uin)
    if (images.length) params.images = images

    const data = asRecord(await this.client.call('comment_qzone', params, { write: true }))
    return { commentId: asString(data.comment_id) || undefined }
  }

  async reply(post: Post, target: Comment, content: string): Promise<QzoneCommentResult> {
    if (!target.tid) throw new Error('目标评论缺少 comment_id，无法回复')

    // SnowLuma 要求 comment_id/comment_uin 指向一级评论；回复二级评论时，
    // 还需要用 reply_uin/reply_name 指定实际被回复的人。
    const parent = target.parentTid
      ? post.comments.find((comment) => comment.tid === target.parentTid && !comment.parentTid)
      : undefined
    if (target.parentTid && !parent) {
      throw new Error('未找到父评论，无法回复二级评论')
    }
    const anchor = parent || target
    if (!anchor.tid) throw new Error('目标评论缺少 comment_id，无法回复')
    const commentUin = requireUin(anchor.uin, '评论作者 QQ 号')

    const params = withTargetUin({
      tid: post.tid,
      content,
      comment_id: toCommentId(anchor.tid),
      comment_uin: commentUin,
    }, post.uin)

    if (parent) {
      params.reply_uin = requireUin(target.uin, '被回复用户 QQ 号')
      params.reply_name = target.nickname || target.uin
    }

    const data = asRecord(await this.client.call('comment_qzone', params, { write: true }))
    return { commentId: asString(data.comment_id) || undefined }
  }

  async publish(text: string, images: string[]): Promise<QzonePublishResult> {
    const params: Record<string, unknown> = {
      // SnowLuma 要求 content 至少 1 个字符；纯图片说说使用零宽空格占位。
      content: text.trim() || '​',
    }
    if (images.length) params.images = images

    const data = asRecord(await this.client.call('send_qzone_msg', params, { write: true }))
    const tid = asString(data.tid || data.key)
    if (!tid) throw new Error('SnowLuma 未返回新说说的 tid')
    return {
      tid,
      createTime: asNumber(data.time, Math.floor(Date.now() / 1000)),
    }
  }

  async delete(post: Post): Promise<void> {
    await this.client.call('delete_qzone_msg', { tid: post.tid }, { write: true })
  }
}
