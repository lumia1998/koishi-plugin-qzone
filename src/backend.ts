import type { Comment, Post } from './types'

export interface QzoneLoginInfo {
  uin: string
  nickname: string
}

export interface QzoneCommentResult {
  commentId?: string
}

export interface QzonePublishResult {
  tid: string
  createTime: number
}

/**
 * QQ 空间能力的抽象。当前实现为 SnowLuma（通过 OneBot WebSocket），
 * 业务层不依赖任何 Cookie 或 HTTP CGI 细节。
 */
export interface QzoneBackend {
  getLoginInfo(): Promise<QzoneLoginInfo>
  getFriendFeeds(offset: number, limit: number): Promise<Post[]>
  getUserPosts(targetUin: string, offset: number, limit: number): Promise<Post[]>
  getDetail(post: Post): Promise<Post>
  like(post: Post): Promise<void>
  unlike(post: Post): Promise<void>
  comment(post: Post, content: string, images?: string[]): Promise<QzoneCommentResult>
  reply(post: Post, target: Comment, content: string): Promise<QzoneCommentResult>
  publish(text: string, images: string[]): Promise<QzonePublishResult>
  delete(post: Post): Promise<void>
}
