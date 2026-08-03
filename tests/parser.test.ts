import { describe, expect, it } from 'vitest'

import { parseFeeds, parseRecentFeeds, parseResponse } from '../src/qzone/parser'

describe('Qzone parser', () => {
  it('parses JSONP and JSON5 payloads', () => {
    const payload = parseResponse('_preloadCallback({code: 0, data: undefined, trailing: true,});')
    expect(payload).toMatchObject({ code: 0, data: null, trailing: true })
  })

  it('returns structured errors for empty and malformed responses', () => {
    expect(parseResponse('')).toMatchObject({ code: -1, message: '响应内容为空' })
    expect(parseResponse('<html>denied</html>')).toMatchObject({ code: -1, message: '响应内容格式异常' })
  })

  it('maps normal feeds, nested comments, images, and videos', () => {
    const posts = parseFeeds([{
      tid: 't1',
      uin: 123,
      name: 'Alice',
      content: 'hello',
      created_time: 100,
      portrait: '//q.qlogo.cn/a.jpg',
      pic: [{ url2: 'https://a.qpic.cn/1.jpg' }],
      video: [{ url1: 'https://a.qpic.cn/v.jpg', url3: 'https://video.qq.com/v.mp4' }],
      rt_con: { content: 'forwarded' },
      commentlist: [{
        tid: 10,
        uin: 456,
        name: 'Bob',
        content: 'main',
        list_3: [{ tid: 11, uin: 789, name: 'Carol', content: 'reply' }],
      }],
    }])
    expect(posts).toHaveLength(1)
    expect(posts[0]).toMatchObject({ tid: 't1', uin: '123', name: 'Alice', text: 'hello' })
    expect(posts[0].images).toHaveLength(2)
    expect(posts[0].comments[1].parentTid).toBe('10')
  })

  it('parses recent feed HTML without replacing the author with comment nickname', () => {
    const html = `
      <div class="f-info">recent text</div>
      <div class="txt-box">Alice：forwarded</div>
      <div class="img-box"><img src="//a.qpic.cn/1.jpg"></div>
      <ul><li class="comments-item bor3" data-uin="456" data-tid="10" data-nick="Bob">
        <div class="comments-content">Bob: comment<div class="comments-op">reply</div></div>
      </li></ul>`
    const posts = parseRecentFeeds({
      data: {
        data: [{
          appid: 311,
          uin: 123,
          key: 't1',
          nickname: 'Alice',
          abstime: 100,
          html,
        }],
      },
    })
    expect(posts).toHaveLength(1)
    expect(posts[0].name).toBe('Alice')
    expect(posts[0].repostContent).toBe('forwarded')
    expect(posts[0].comments[0]).toMatchObject({ nickname: 'Bob', content: 'comment' })
  })
})
