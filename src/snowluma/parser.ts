import { load } from 'cheerio'

import type { Comment, Post } from '../types'
import { asNumber, asRecord, asString, createEmptyPost, isRecord } from '../types'

function normalizeUrl(value: unknown): string {
  const url = asString(value).trim()
  if (url.startsWith('//')) return `https:${url}`
  return url
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values.filter(Boolean))]
}

function stringList(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value.map(normalizeUrl).filter(Boolean)
}

function epochSeconds(value: unknown): number {
  const time = asNumber(value)
  // 兼容秒和毫秒时间戳。
  return time > 10_000_000_000 ? Math.floor(time / 1000) : time
}

interface FeedHtml {
  text: string
  images: string[]
  videos: string[]
  repostContent: string
}

function parseFeedHtml(html: string): FeedHtml {
  if (!html.trim()) return { text: '', images: [], videos: [], repostContent: '' }
  const $ = load(html)

  const images: string[] = []
  $('div.img-box img').each((_, element) => {
    const source = normalizeUrl($(element).attr('src'))
    if (source && !source.startsWith('http://qzonestyle.gtimg.cn')) images.push(source)
  })
  const videoCover = normalizeUrl($('div.video-img img').first().attr('src'))
  if (videoCover) images.push(videoCover)

  const videos: string[] = []
  $('div.img-box.f-video-wrap.play').each((_, element) => {
    const source = normalizeUrl($(element).attr('url3'))
    if (source) videos.push(source)
  })

  let repostContent = $('div.txt-box').first().text().trim()
  const separator = repostContent.indexOf('：')
  if (separator >= 0) repostContent = repostContent.slice(separator + 1).trim()

  return {
    text: $('div.f-info').first().text().trim(),
    images,
    videos,
    repostContent,
  }
}

export interface FeedPage {
  feeds: unknown[]
  hasMore: boolean
  nextCursor?: string
}

export function parseFeedPage(value: unknown): FeedPage {
  const raw = asRecord(value)
  const feeds = Array.isArray(raw.feeds) ? raw.feeds : []
  const nextCursor = raw.next_cursor == null ? undefined : asString(raw.next_cursor)
  return {
    feeds,
    hasMore: raw.has_more !== false && Boolean(nextCursor),
    nextCursor,
  }
}

export function parseFeed(value: unknown): Post {
  const raw = asRecord(value)
  const html = asString(raw.html)
  const parsedHtml = parseFeedHtml(html)
  const images = [
    ...stringList(raw.images),
    ...parsedHtml.images,
  ]
  const videos = [
    ...stringList(raw.videos),
    ...parsedHtml.videos,
  ]

  return createEmptyPost({
    tid: asString(raw.tid || raw.key),
    uin: asString(raw.uin, '0'),
    name: asString(raw.nickname),
    avatarUrl: '',
    text: asString(raw.content).trim() || parsedHtml.text,
    images: uniqueStrings(images),
    videos: uniqueStrings(videos),
    createTime: epochSeconds(raw.time ?? raw.abstime),
    repostContent: parsedHtml.repostContent,
  })
}

export function parseMsgList(value: unknown, targetUin: string): Post[] {
  const raw = asRecord(value)
  const messages = Array.isArray(raw.msglist) ? raw.msglist : []
  const posts: Post[] = []
  for (const item of messages) {
    if (!isRecord(item)) continue
    posts.push(createEmptyPost({
      tid: asString(item.tid),
      uin: targetUin,
      name: '',
      text: asString(item.content).trim(),
      images: uniqueStrings(stringList(item.images)),
      createTime: epochSeconds(item.time),
    }))
  }
  return posts
}

function parseComment(raw: Record<string, unknown>, parentTid?: string): Comment {
  const parent = parentTid
    || asString(raw.parent_comment_id)
    || undefined
  const images = uniqueStrings(stringList(raw.images))
  return {
    tid: asString(raw.comment_id ?? raw.tid),
    uin: asString(raw.uin, '0'),
    nickname: asString(raw.name ?? raw.nickname),
    content: asString(raw.content),
    createTime: epochSeconds(raw.time ?? raw.create_time),
    parentTid: parent,
    ...(images.length ? { images } : {}),
  }
}

export function parseDetailComments(value: unknown): Comment[] {
  if (!Array.isArray(value)) return []
  const comments: Comment[] = []
  for (const item of value) {
    if (!isRecord(item)) continue
    const main = parseComment(item)
    if (!main.tid && !main.content && !main.nickname) continue
    comments.push(main)
    if (!Array.isArray(item.replies)) continue
    for (const reply of item.replies) {
      if (isRecord(reply)) comments.push(parseComment(reply, main.tid || undefined))
    }
  }
  return comments
}

export function mergeDetail(post: Post, value: unknown): Post {
  const raw = asRecord(value)
  const content = asString(raw.content).trim()
  const images = uniqueStrings(stringList(raw.images))
  return {
    ...post,
    text: content || post.text,
    images: images.length ? images : post.images,
    comments: parseDetailComments(raw.comments),
  }
}
