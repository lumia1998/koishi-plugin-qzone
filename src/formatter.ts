import type { Comment, Post } from './types'

function cleanQzoneText(value: string): string {
  return value.replace(/\[em\].*?\[\/em\]/g, '').trim()
}

function formatTime(timestamp: number): string {
  if (!timestamp) return '未知时间'
  return new Date(timestamp * 1000).toLocaleString('zh-CN', { hour12: false })
}

export function formatComment(comment: Comment, index: number): string {
  const prefix = comment.parentTid ? '  回复' : '评论'
  return `${prefix} ${index}: ${comment.nickname || comment.uin}：${cleanQzoneText(comment.content)}`
}

export function formatPost(post: Post, index?: number): string {
  const reference = post.id ? `#${post.id}` : `${post.uin}:${post.tid}`
  const heading = index === undefined ? `动态 ${reference}` : `[${index}] 动态 ${reference}`
  const lines = [
    `${heading}  ${post.name || post.uin}  ${formatTime(post.createTime)}`,
  ]
  if (post.text) lines.push(cleanQzoneText(post.text))
  if (post.repostContent) lines.push(`转发：${cleanQzoneText(post.repostContent)}`)
  if (post.images.length) lines.push(`图片：${post.images.join('\n')}`)
  if (post.videos.length) lines.push(`视频：${post.videos.join('\n')}`)
  if (post.comments.length) {
    lines.push('评论区：')
    post.comments.forEach((comment, commentIndex) => {
      lines.push(formatComment(comment, commentIndex))
    })
  }
  return lines.join('\n')
}
