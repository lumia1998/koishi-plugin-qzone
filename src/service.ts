import type { Post, FeedQuery, Comment } from './types'
import { asNumber, asRecord, asString, createEmptyPost } from './types'
import type { PostRepository } from './repository'
import type { QzoneSession } from './qzone/session'
import type { QzoneApi } from './qzone/api'
import type { SafeImageDownloader } from './qzone/image'
import { formatVisitors, parseFeeds, parseRecentFeeds } from './qzone/parser'

export class QzoneService {
  constructor(
    readonly api: QzoneApi,
    readonly session: QzoneSession,
    readonly repository: PostRepository,
    readonly imageDownloader: SafeImageDownloader,
    readonly maxImages = 9,
  ) {}

  async queryFeeds(query: FeedQuery = {}): Promise<Post[]> {
    const offset = Math.max(0, query.offset || 0)
    const limit = Math.min(20, Math.max(1, query.limit || 1))
    let posts: Post[]

    if (query.targetId) {
      const response = await this.api.getFeeds(query.targetId, offset, limit)
      if (!response.ok) throw new Error(this.mapFeedError(response.code, response.message, response.httpStatus, query.targetId))
      posts = parseFeeds(response.data.msglist)
    } else {
      const response = await this.api.getRecentFeeds()
      if (!response.ok) throw new Error(this.mapFeedError(response.code, response.message, response.httpStatus))
      posts = parseRecentFeeds(response.data).slice(offset, offset + limit)
    }

    const selfUin = await this.session.getUin()
    if (query.excludeSelf) posts = posts.filter((post) => post.uin !== selfUin)

    if (query.withDetail) {
      const detailed: Post[] = []
      for (const post of posts) {
        const response = await this.api.getDetail(post)
        const parsed = response.ok ? parseFeeds([response.data])[0] : undefined
        detailed.push(parsed || post)
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
    const response = await this.api.like(post)
    if (!response.ok) throw new Error(response.message || `点赞失败：${response.code}`)
  }

  async comment(post: Post, content: string): Promise<Comment> {
    const text = content.trim()
    if (!post.tid) throw new Error('动态缺少 tid')
    if (!text) throw new Error('评论内容不能为空')
    const response = await this.api.comment(post, text)
    if (!response.ok) throw new Error(response.message || `评论失败：${response.code}`)

    const comment: Comment = {
      tid: asString(response.data.tid),
      uin: await this.session.getUin(),
      nickname: await this.session.getNickname(),
      content: text,
      createTime: Math.floor(Date.now() / 1000),
    }
    post.comments.push(comment)
    await this.repository.save(post)
    return comment
  }

  async reply(post: Post, commentIndex: number, content: string): Promise<Comment> {
    const text = content.trim()
    if (!post.tid) throw new Error('动态缺少 tid')
    if (!text) throw new Error('回复内容不能为空')
    const selfUin = await this.session.getUin()
    const candidates = post.comments.filter((comment) => comment.uin !== selfUin)
    const target = candidates.at(commentIndex)
    if (!target) throw new Error(`评论序号越界，当前可回复 ${candidates.length} 条`)

    const response = await this.api.reply(post, target, text)
    if (!response.ok) throw new Error(response.message || `回复失败：${response.code}`)
    const reply: Comment = {
      tid: asString(response.data.tid),
      uin: selfUin,
      nickname: await this.session.getNickname(),
      content: text,
      createTime: Math.floor(Date.now() / 1000),
      parentTid: target.tid,
    }
    post.comments.push(reply)
    await this.repository.save(post)
    return reply
  }

  async publish(text: string, imageSources: string[] = []): Promise<Post> {
    const content = text.trim()
    if (!content && !imageSources.length) throw new Error('说说内容和图片不能同时为空')
    if (imageSources.length > this.maxImages) {
      throw new Error(`单次最多发布 ${this.maxImages} 张图片`)
    }
    const images: Uint8Array[] = []
    for (const source of imageSources) images.push(await this.imageDownloader.download(source))

    const post = createEmptyPost({
      uin: await this.session.getUin(),
      name: await this.session.getNickname(),
      text: content,
      createTime: Math.floor(Date.now() / 1000),
    })
    const response = await this.api.publish(post, images)
    if (!response.ok) throw new Error(response.message || `发布失败：${response.code}`)
    post.tid = asString(response.data.tid)
    post.createTime = asNumber(response.data.now, post.createTime)
    return this.repository.save(post)
  }

  async delete(post: Post): Promise<void> {
    const selfUin = await this.session.getUin()
    if (post.uin !== selfUin) throw new Error('仅能删除当前账号发布的说说')
    if (!post.tid) throw new Error('动态缺少 tid')
    const response = await this.api.deletePost(post.tid)
    if (!response.ok) throw new Error(response.message || `删除失败：${response.code}`)
    if (post.id) await this.repository.remove(post.id)
  }

  async visitors(): Promise<string> {
    const response = await this.api.getVisitor()
    if (!response.ok) throw new Error(response.message || `获取访客失败：${response.code}`)
    return formatVisitors(response.data)
  }

  private mapFeedError(code: number, message?: string, httpStatus?: number, target?: string): string {
    const text = (message || '').toLowerCase()
    if (code === -3000 || /(登录|失效|cookie|skey|expired)/i.test(text)) {
      return '登录状态失效，请刷新 Cookie 后重试'
    }
    if (code === 403 || code === -403 || httpStatus === 403 || /(权限|私密|forbidden)/i.test(text)) {
      return target ? `无权限查看 QQ ${target} 的说说` : '无权限访问好友动态'
    }
    return message ? `查询说说失败：${message}` : `查询说说失败：code=${code}`
  }
}
