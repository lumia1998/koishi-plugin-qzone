import type { Logger } from 'koishi'

import type { QzoneBackend, QzoneLoginInfo } from './backend'
import { preparePublishImages } from './publish-images'
import type { PublishImageOptions } from './publish-images'
import type { PostRepository } from './repository'
import type { Comment, FeedQuery, Post } from './types'
import { createEmptyPost } from './types'

export interface QzoneServiceOptions {
  maxImages?: number
  loginInfoTtlMs?: number
  publishImages?: PublishImageOptions
  logger?: Logger
}

export interface QzoneStatus extends QzoneLoginInfo {
  connected: true
  source: 'SnowLuma'
}

export interface PublishOptions {
  /** ChatLuna 只允许公网 URL；命令可额外读取本机图片文件。 */
  allowLocalFiles?: boolean
}

export class QzoneService {
  private readonly maxImages: number
  private readonly loginInfoTtlMs: number
  private cachedLoginInfo?: { value: QzoneLoginInfo; expiresAt: number }

  constructor(
    readonly backend: QzoneBackend,
    readonly repository: PostRepository,
    private readonly options: QzoneServiceOptions = {},
  ) {
    this.maxImages = Math.max(1, options.maxImages ?? 9)
    this.loginInfoTtlMs = Math.max(0, options.loginInfoTtlMs ?? 60_000)
  }

  async getLoginInfo(): Promise<QzoneLoginInfo> {
    if (this.cachedLoginInfo && this.cachedLoginInfo.expiresAt > Date.now()) {
      return this.cachedLoginInfo.value
    }
    const value = await this.backend.getLoginInfo()
    this.cachedLoginInfo = { value, expiresAt: Date.now() + this.loginInfoTtlMs }
    return value
  }

  async getSelfUin(): Promise<string> {
    return (await this.getLoginInfo()).uin
  }

  async getStatus(): Promise<QzoneStatus> {
    const info = await this.getLoginInfo()
    return { connected: true, uin: info.uin, nickname: info.nickname, source: 'SnowLuma' }
  }

  async queryFeeds(query: FeedQuery = {}): Promise<Post[]> {
    const offset = Math.max(0, query.offset || 0)
    const limit = Math.min(20, Math.max(1, query.limit || 1))
    let posts: Post[]

    if (query.targetId) {
      posts = await this.backend.getUserPosts(query.targetId, offset, limit)
    } else {
      posts = await this.backend.getFriendFeeds(offset, limit)
    }

    const selfUin = await this.getSelfUin()
    if (query.excludeSelf) posts = posts.filter((post) => post.uin !== selfUin)

    if (query.withDetail) {
      const detailed: Post[] = []
      for (const post of posts) {
        try {
          detailed.push(await this.backend.getDetail(post))
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error)
          this.options.logger?.warn('[qzone] 获取动态详情失败 %s: %s', post.tid, message)
          detailed.push(post)
        }
      }
      posts = detailed
    }

    if (query.excludeCommented) {
      const filtered: Post[] = []
      for (const post of posts) {
        const saved = post.tid ? await this.repository.getByRemote(post.uin, post.tid) : undefined
        const comments = [...post.comments, ...(saved?.comments || [])]
        if (!comments.some((comment) => comment.uin === selfUin)) filtered.push(post)
      }
      posts = filtered
    }

    for (const post of posts) await this.repository.save(post)
    return posts
  }

  async resolvePost(reference: { id?: number; uin?: string; tid?: string }): Promise<Post> {
    const post = reference.id
      ? await this.repository.getById(reference.id)
      : reference.uin && reference.tid
        ? await this.repository.getByRemote(reference.uin, reference.tid)
        : undefined
    if (!post) throw new Error('未找到动态，请先执行看说说或使用 uin:tid')
    return post
  }

  async like(post: Post): Promise<void> {
    if (!post.tid) throw new Error('动态缺少 tid')
    await this.backend.like(post)
  }

  async unlike(post: Post): Promise<void> {
    if (!post.tid) throw new Error('动态缺少 tid')
    await this.backend.unlike(post)
  }

  private async prepareImages(
    imageSources: string[],
    publishOptions: PublishOptions,
  ): Promise<string[]> {
    return preparePublishImages(imageSources, {
      allowedHosts: this.options.publishImages?.allowedHosts ?? [],
      maxImages: this.maxImages,
      maxBytes: this.options.publishImages?.maxBytes ?? 0,
      maxTotalBytes: this.options.publishImages?.maxTotalBytes ?? 0,
      allowLocalFiles: publishOptions.allowLocalFiles === true,
    })
  }

  async comment(
    post: Post,
    content: string,
    imageSources: string[] = [],
    publishOptions: PublishOptions = {},
  ): Promise<Comment> {
    const text = content.trim()
    if (!post.tid) throw new Error('动态缺少 tid')
    if (!text && !imageSources.length) throw new Error('评论内容和图片不能同时为空')
    const images = await this.prepareImages(imageSources, publishOptions)
    const result = await this.backend.comment(post, text, images)
    const self = await this.getLoginInfo()

    const comment: Comment = {
      tid: result.commentId || '',
      uin: self.uin,
      nickname: self.nickname,
      content: text,
      createTime: Math.floor(Date.now() / 1000),
      images: images.filter((source) => source.startsWith('http')),
    }
    post.comments.push(comment)
    await this.repository.save(post)
    return comment
  }

  async reply(post: Post, commentIndex: number, content: string): Promise<Comment> {
    const text = content.trim()
    if (!post.tid) throw new Error('动态缺少 tid')
    if (!text) throw new Error('回复内容不能为空')
    const selfUin = await this.getSelfUin()
    const candidates = post.comments.filter((comment) => comment.uin !== selfUin)
    const target = candidates.at(commentIndex)
    if (!target) throw new Error(`评论序号越界，当前可回复 ${candidates.length} 条`)

    const result = await this.backend.reply(post, target, text)
    const self = await this.getLoginInfo()
    const reply: Comment = {
      tid: result.commentId || '',
      uin: self.uin,
      nickname: self.nickname,
      content: text,
      createTime: Math.floor(Date.now() / 1000),
      parentTid: target.tid,
    }
    post.comments.push(reply)
    await this.repository.save(post)
    return reply
  }

  async publish(
    text: string,
    imageSources: string[] = [],
    publishOptions: PublishOptions = {},
  ): Promise<Post> {
    const content = text.trim()
    if (!content && !imageSources.length) throw new Error('说说内容和图片不能同时为空')
    if (imageSources.length > this.maxImages) {
      throw new Error(`单次最多发布 ${this.maxImages} 张图片`)
    }

    const preparedImages = await this.prepareImages(imageSources, publishOptions)

    const self = await this.getLoginInfo()
    const result = await this.backend.publish(content, preparedImages)
    const post = createEmptyPost({
      uin: self.uin,
      name: self.nickname,
      text: content,
      images: preparedImages.filter((source) => source.startsWith('http')),
      createTime: result.createTime,
      tid: result.tid,
    })
    return this.repository.save(post)
  }

  async delete(post: Post): Promise<void> {
    const selfUin = await this.getSelfUin()
    if (post.uin !== selfUin) throw new Error('仅能删除当前账号发布的说说')
    if (!post.tid) throw new Error('动态缺少 tid')
    await this.backend.delete(post)
    if (post.id) await this.repository.remove(post.id)
  }
}
