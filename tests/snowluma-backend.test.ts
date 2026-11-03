import { describe, expect, it, vi } from 'vitest'

import type { QzoneBackend } from '../src/backend'
import { SnowLumaBackend } from '../src/snowluma/backend'
import type { SnowLumaClient } from '../src/snowluma/client'
import {
  mergeDetail,
  parseDetailComments,
  parseFeed,
  parseMsgList,
} from '../src/snowluma/parser'
import { createEmptyPost } from '../src/types'

function createClient(handler: (action: string, params: Record<string, unknown>) => unknown) {
  const call = vi.fn(async (action: string, params: Record<string, unknown> = {}) => handler(action, params))
  return { client: { call } as unknown as SnowLumaClient, call }
}

describe('SnowLuma parser', () => {
  it('extracts media and text from feed html', () => {
    const post = parseFeed({
      uin: 20002,
      nickname: 'Alice',
      tid: 'feed-tid',
      time: 1_700_000_000,
      html: `
        <div class="f-info">html text</div>
        <div class="img-box"><img src="//a.qpic.cn/a.jpg" /></div>
        <div class="video-img"><img src="https://b.qpic.cn/cover.jpg" /></div>
        <div class="img-box f-video-wrap play" url3="//v.qpic.cn/v.mp4"></div>
        <div class="txt-box">转发了某某：repost text</div>
      `,
    })

    expect(post).toMatchObject({
      uin: '20002',
      name: 'Alice',
      tid: 'feed-tid',
      text: 'html text',
      createTime: 1_700_000_000,
      images: [
        'https://a.qpic.cn/a.jpg',
        'https://b.qpic.cn/cover.jpg',
      ],
      videos: ['https://v.qpic.cn/v.mp4'],
      repostContent: 'repost text',
    })
  })

  it('flattens first-level comments and replies', () => {
    const comments = parseDetailComments([{
      comment_id: '100',
      uin: 30003,
      name: 'Bob',
      time: 10,
      content: 'top',
      replies: [{
        comment_id: '101',
        uin: 40004,
        name: 'Carol',
        time: 11,
        content: 'nested',
        parent_comment_id: '100',
        images: ['//a.qpic.cn/comment.jpg'],
      }],
    }])

    expect(comments).toEqual([
      {
        tid: '100',
        uin: '30003',
        nickname: 'Bob',
        content: 'top',
        createTime: 10,
        parentTid: undefined,
      },
      {
        tid: '101',
        uin: '40004',
        nickname: 'Carol',
        content: 'nested',
        createTime: 11,
        parentTid: '100',
        images: ['https://a.qpic.cn/comment.jpg'],
      },
    ])
  })

  it('parses own-post summaries and merges detail comments', () => {
    const posts = parseMsgList({
      msglist: [{
        tid: 'tid-1',
        content: 'own post',
        time: 1_700_000_000_000,
        images: ['https://a.qpic.cn/a.jpg'],
      }],
    }, '10001')

    expect(posts[0]).toMatchObject({
      tid: 'tid-1',
      uin: '10001',
      text: 'own post',
      images: ['https://a.qpic.cn/a.jpg'],
      createTime: 1_700_000_000,
    })

    const merged = mergeDetail(posts[0], {
      content: 'full text',
      images: ['https://b.qpic.cn/b.jpg'],
      comments: [{ comment_id: 'c1', uin: 20002, name: 'Bob', content: 'hi', time: 1 }],
    })
    expect(merged.text).toBe('full text')
    expect(merged.images).toEqual(['https://b.qpic.cn/b.jpg'])
    expect(merged.comments).toHaveLength(1)
  })
})

describe('SnowLumaBackend', () => {
  it('reads the SnowLuma login account', async () => {
    const { client } = createClient(() => ({ user_id: 10001, nickname: 'Self' }))
    const backend = new SnowLumaBackend(client)
    await expect(backend.getLoginInfo()).resolves.toEqual({ uin: '10001', nickname: 'Self' })
  })

  it('follows cursor pagination until the requested window is covered', async () => {
    const { client, call } = createClient((_action, params) => {
      if (!params.cursor) {
        return {
          feeds: [{ tid: 'first', uin: 1 }],
          has_more: true,
          next_cursor: 'cursor-1',
        }
      }
      return {
        feeds: [{ tid: 'second', uin: 2 }],
        has_more: false,
      }
    })
    const backend = new SnowLumaBackend(client, { feedPageSize: 1, maxFeedPages: 5 })

    const posts = await backend.getFriendFeeds(1, 1)

    expect(posts.map((post) => post.tid)).toEqual(['second'])
    expect(call).toHaveBeenNthCalledWith(1, 'get_qzone_feeds', { count: 1, page_num: 1 })
    expect(call).toHaveBeenNthCalledWith(2, 'get_qzone_feeds', { count: 1, cursor: 'cursor-1' })
  })

  it('queries a target account with offset pagination', async () => {
    const { client, call } = createClient(() => ({
      msglist: [{ tid: 'tid-1', content: 'hello', time: 1 }],
    }))
    const backend = new SnowLumaBackend(client)

    const posts = await backend.getUserPosts('20002', 5, 10)

    expect(call).toHaveBeenCalledWith('get_qzone_msg_list', {
      target_uin: 20002,
      pos: 5,
      num: 10,
    })
    expect(posts[0]).toMatchObject({ tid: 'tid-1', uin: '20002', text: 'hello' })
  })

  it('replies to a nested comment through its first-level parent', async () => {
    const { client, call } = createClient(() => ({ comment_id: 'new-id' }))
    const backend = new SnowLumaBackend(client)
    const post = createEmptyPost({
      uin: '20002',
      tid: 'post-tid',
      comments: [
        { tid: '100', uin: '30003', nickname: 'Bob', content: 'top', createTime: 1 },
        {
          tid: '101',
          uin: '40004',
          nickname: 'Carol',
          content: 'nested',
          createTime: 2,
          parentTid: '100',
        },
      ],
    })

    await backend.reply(post, post.comments[1], 'thanks')

    expect(call).toHaveBeenCalledWith('comment_qzone', {
      tid: 'post-tid',
      content: 'thanks',
      comment_id: 100,
      comment_uin: 30003,
      reply_uin: 40004,
      reply_name: 'Carol',
      target_uin: 20002,
    }, { write: true })
  })

  it('cancels a like with the post timestamp', async () => {
    const { client, call } = createClient(() => null)
    const backend = new SnowLumaBackend(client)
    const post = createEmptyPost({
      uin: '20002',
      tid: 'post-tid',
      createTime: 123,
    })

    await backend.unlike(post)

    expect(call).toHaveBeenCalledWith('unlike_qzone', {
      tid: 'post-tid',
      target_uin: 20002,
      abstime: 123,
    }, { write: true })
  })

  it('sends comment images and uses a zero-width space for image-only comments', async () => {
    const { client, call } = createClient(() => ({ comment_id: 'new-id' }))
    const backend = new SnowLumaBackend(client)
    const post = createEmptyPost({ uin: '20002', tid: 'post-tid' })

    const result = await backend.comment(post, '  ', ['base64://AAAA'])

    expect(result).toEqual({ commentId: 'new-id' })
    const params = call.mock.calls[0][1] as Record<string, unknown>
    expect(params).toMatchObject({
      tid: 'post-tid',
      target_uin: 20002,
      images: ['base64://AAAA'],
    })
    expect((params.content as string).codePointAt(0)).toBe(0x200b)
  })

  it('does not send an images field for text-only comments', async () => {
    const { client, call } = createClient(() => ({ comment_id: 'new-id' }))
    const backend = new SnowLumaBackend(client)
    const post = createEmptyPost({ uin: '20002', tid: 'post-tid' })

    await backend.comment(post, 'hello', [])

    const params = call.mock.calls[0][1] as Record<string, unknown>
    expect(params.content).toBe('hello')
    expect(params).not.toHaveProperty('images')
  })

  it('uses a zero-width space when publishing images without text', async () => {
    const { client, call } = createClient(() => ({ tid: 'new-tid', time: 123 }))
    const backend = new SnowLumaBackend(client)

    const result = await backend.publish('   ', ['base64://AAAA'])

    expect(result).toEqual({ tid: 'new-tid', createTime: 123 })
    const params = call.mock.calls[0][1] as Record<string, unknown>
    expect(params.images).toEqual(['base64://AAAA'])
    expect((params.content as string).codePointAt(0)).toBe(0x200b)
  })
})

describe('QzoneBackend contract', () => {
  it('is implemented by SnowLumaBackend', () => {
    const { client } = createClient(() => ({}))
    const backend: QzoneBackend = new SnowLumaBackend(client)
    expect(backend).toBeInstanceOf(SnowLumaBackend)
  })
})
