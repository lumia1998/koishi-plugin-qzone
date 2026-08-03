import { load } from 'cheerio'
import JSON5 from 'json5'

import type { Comment, Post } from '../types'
import { asNumber, asRecord, asString, createEmptyPost, isRecord } from '../types'
import { QZONE_CODE_UNKNOWN, QZONE_ERROR } from './constants'

function errorPayload(message: string): Record<string, unknown> {
  return { code: QZONE_CODE_UNKNOWN, message, data: {} }
}

function normalizeUrl(value: unknown): string {
  const url = asString(value).trim()
  if (url.startsWith('//')) return `https:${url}`
  return url
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values.filter(Boolean))]
}

function parseComment(raw: Record<string, unknown>, parentTid?: string): Comment {
  return {
    tid: asString(raw.tid),
    uin: asString(raw.uin, '0'),
    nickname: asString(raw.name || raw.nickname),
    content: asString(raw.content),
    createTime: asNumber(raw.create_time),
    parentTid,
  }
}

function parseComments(value: unknown): Comment[] {
  if (!Array.isArray(value)) return []
  const comments: Comment[] = []
  for (const item of value) {
    if (!isRecord(item)) continue
    const main = parseComment(item)
    comments.push(main)
    if (!Array.isArray(item.list_3)) continue
    for (const reply of item.list_3) {
      if (isRecord(reply)) comments.push(parseComment(reply, main.tid || undefined))
    }
  }
  return comments
}

export function parseResponse(text: string): Record<string, unknown> {
  if (!text?.trim()) return errorPayload(QZONE_ERROR.empty)

  const start = text.indexOf('{')
  const end = text.lastIndexOf('}')
  if (start < 0 || end < start) return errorPayload(QZONE_ERROR.invalid)

  const candidate = text.slice(start, end + 1).replace(/\bundefined\b/g, 'null')
  try {
    const parsed: unknown = JSON5.parse(candidate)
    return isRecord(parsed) ? parsed : errorPayload(QZONE_ERROR.nonObject)
  } catch {
    return errorPayload(QZONE_ERROR.parse)
  }
}

export function parseUploadResult(payload: Record<string, unknown>): {
  picBo: string
  richValue: string
} {
  const data = asRecord(payload.data)
  const url = asString(data.url)
  const marker = '&bo='
  const markerIndex = url.indexOf(marker)
  if (markerIndex < 0) throw new Error('上传响应缺少图片标识')

  const picBo = url.slice(markerIndex + marker.length)
  const richValue = [
    '',
    data.albumid,
    data.lloc,
    data.sloc,
    data.type,
    data.height,
    data.width,
    '',
    data.height,
    data.width,
  ].map((value) => asString(value)).join(',')
  return { picBo, richValue }
}

export function parseFeeds(value: unknown): Post[] {
  if (!Array.isArray(value)) return []
  const posts: Post[] = []

  for (const item of value) {
    if (!isRecord(item)) continue
    const images: string[] = []
    if (Array.isArray(item.pic)) {
      for (const image of item.pic) {
        const data = asRecord(image)
        const url = ['url2', 'url3', 'url1', 'smallurl']
          .map((key) => normalizeUrl(data[key]))
          .find(Boolean)
        if (url) images.push(url)
      }
    }

    const videos: string[] = []
    if (Array.isArray(item.video)) {
      for (const video of item.video) {
        const data = asRecord(video)
        const cover = normalizeUrl(data.url1 || data.pic_url)
        const source = normalizeUrl(data.url3)
        if (cover) images.push(cover)
        if (source) videos.push(source)
      }
    }

    posts.push(createEmptyPost({
      tid: asString(item.tid),
      uin: asString(item.uin, '0'),
      name: asString(item.name),
      avatarUrl: normalizeUrl(item.portrait),
      text: asString(item.content).trim(),
      images: uniqueStrings(images),
      videos: uniqueStrings(videos),
      createTime: asNumber(item.created_time),
      repostContent: asString(asRecord(item.rt_con).content),
      comments: parseComments(item.commentlist),
      extraText: asString(item.source_name),
    }))
  }
  return posts
}

export function parseRecentFeeds(payload: Record<string, unknown>): Post[] {
  const outer = asRecord(payload.data)
  const nested = asRecord(outer.data)
  const feeds = Array.isArray(nested.data)
    ? nested.data
    : Array.isArray(outer.data)
      ? outer.data
      : []
  const posts: Post[] = []

  for (const value of feeds) {
    if (!isRecord(value) || asString(value.appid) !== '311') continue
    const uin = asString(value.uin)
    const tid = asString(value.key)
    const html = asString(value.html)
    if (!uin || !tid || !html) continue

    const $ = load(html)
    const images: string[] = []
    $('div.img-box img').each((_, element) => {
      const source = normalizeUrl($(element).attr('src'))
      if (source && !source.startsWith('http://qzonestyle.gtimg.cn')) images.push(source)
    })
    const videoCover = normalizeUrl($('div.video-img img').first().attr('src'))
    if (videoCover) images.push(videoCover)

    const videos: string[] = []
    const videoUrl = normalizeUrl($('div.img-box.f-video-wrap.play').first().attr('url3'))
    if (videoUrl) videos.push(videoUrl)

    let repostContent = $('div.txt-box').first().text().trim()
    const separator = repostContent.indexOf('：')
    if (separator >= 0) repostContent = repostContent.slice(separator + 1).trim()

    const comments: Comment[] = []
    $('li.comments-item.bor3').each((_, element) => {
      const item = $(element)
      const contentNode = item.find('div.comments-content').first().clone()
      contentNode.find('div.comments-op').remove()
      const contentText = contentNode.text().trim()
      const parent = item.parents('li.comments-item').first()
      comments.push({
        tid: asString(item.attr('data-tid')),
        uin: asString(item.attr('data-uin'), '0'),
        nickname: asString(item.attr('data-nick')),
        content: contentText.includes(':')
          ? contentText.slice(contentText.indexOf(':') + 1).trim()
          : contentText,
        createTime: 0,
        parentTid: parent.length ? asString(parent.attr('data-tid')) || undefined : undefined,
      })
    })

    posts.push(createEmptyPost({
      tid,
      uin,
      name: asString(value.nickname),
      avatarUrl: normalizeUrl(value.pic),
      text: $('div.f-info').first().text().trim(),
      images: uniqueStrings(images),
      videos: uniqueStrings(videos),
      createTime: asNumber(value.abstime),
      repostContent,
      comments,
    }))
  }
  return posts
}

export function formatVisitors(payload: Record<string, unknown>): string {
  const data = asRecord(payload.data)
  const items = Array.isArray(data.items) ? data.items : []
  if (!items.length) return '最近 30 天暂无访客记录。'

  const sourceNames: Record<string, string> = {
    '0': '访问空间',
    '13': '查看动态',
    '32': '手机 QQ',
    '41': '国际版 QQ/TIM',
  }
  const lines = ['最近来访：']
  for (const value of items) {
    const item = asRecord(value)
    const timestamp = asNumber(item.time)
    const time = timestamp
      ? new Date(timestamp * 1000).toLocaleString('zh-CN', { hour12: false })
      : '未知时间'
    const source = sourceNames[asString(item.src)] || `来源 ${asString(item.src, '未知')}`
    lines.push(`${time}  ${asString(item.name, '匿名')}  ${source}`)
  }
  lines.push(`今日 ${asNumber(data.todaycount)} 人，最近 30 天 ${asNumber(data.totalcount)} 人。`)
  return lines.join('\n')
}
