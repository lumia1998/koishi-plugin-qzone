import { describe, expect, it, vi } from 'vitest'

import type { QzoneBackend } from '../src/backend'
import { MemoryPostRepository } from '../src/repository'
import { QzoneService } from '../src/service'
import { createEmptyPost } from '../src/types'

function createBackend(overrides: Partial<QzoneBackend> = {}): QzoneBackend {
  return {
    getLoginInfo: vi.fn(async () => ({ uin: '10001', nickname: 'Tester' })),
    getFriendFeeds: vi.fn(async () => []),
    getUserPosts: vi.fn(async () => []),
    getDetail: vi.fn(async (post) => post),
    like: vi.fn(async () => undefined),
    unlike: vi.fn(async () => undefined),
    comment: vi.fn(async () => ({ commentId: 'new-comment' })),
    reply: vi.fn(async () => ({ commentId: 'new-reply' })),
    publish: vi.fn(async () => ({ tid: 'new_tid', createTime: 123 })),
    delete: vi.fn(async () => undefined),
    ...overrides,
  }
}

describe('QzoneService', () => {
  it('rejects excessive images before preparing or publishing', async () => {
    const backend = createBackend()
    const service = new QzoneService(backend, new MemoryPostRepository(), {
      maxImages: 2,
      publishImages: {
        allowedHosts: ['*.qpic.cn'],
        maxImages: 2,
        maxBytes: 1024,
        maxTotalBytes: 2048,
      },
    })
    await expect(service.publish('text', [
      'base64://AAAA',
      'base64://BBBB',
      'base64://CCCC',
    ])).rejects.toThrow('最多发布 2 张')
    expect(backend.publish).not.toHaveBeenCalled()
  })

  it('deletes post and removes it from repository', async () => {
    const repo = new MemoryPostRepository()
    const saved = await repo.save(createEmptyPost({
      uin: '10001',
      tid: 'test_tid',
      name: 'Tester',
      text: 'hello',
      createTime: 123456,
    }))

    const backend = createBackend()
    const service = new QzoneService(backend, repo)

    await service.delete(saved)
    expect(backend.delete).toHaveBeenCalledWith(saved)
    expect(await repo.getById(saved.id!)).toBeUndefined()
  })

  it('refuses to delete posts from another account', async () => {
    const backend = createBackend()
    const service = new QzoneService(backend, new MemoryPostRepository())
    await expect(service.delete(createEmptyPost({
      uin: '20002',
      tid: 'other_tid',
    }))).rejects.toThrow('仅能删除当前账号发布的说说')
    expect(backend.delete).not.toHaveBeenCalled()
  })

  it('publishes prepared images and stores the returned tid', async () => {
    const backend = createBackend()
    const repo = new MemoryPostRepository()
    const service = new QzoneService(backend, repo, {
      publishImages: {
        allowedHosts: ['*.qpic.cn'],
        maxImages: 9,
        maxBytes: 1024,
        maxTotalBytes: 4096,
      },
    })

    const post = await service.publish('hello', ['http://a.qpic.cn/image.jpg'])

    expect(backend.publish).toHaveBeenCalledWith('hello', ['https://a.qpic.cn/image.jpg'])
    expect(post).toMatchObject({
      uin: '10001',
      name: 'Tester',
      tid: 'new_tid',
      text: 'hello',
      createTime: 123,
      images: ['https://a.qpic.cn/image.jpg'],
    })
    expect(await repo.getByRemote('10001', 'new_tid')).toBeDefined()
  })

  it('adds comments and replies to the saved post', async () => {
    const backend = createBackend()
    const repo = new MemoryPostRepository()
    const service = new QzoneService(backend, repo)
    const post = await repo.save(createEmptyPost({
      uin: '20002',
      tid: 'remote_tid',
      name: 'Alice',
      comments: [{
        tid: 'other-comment',
        uin: '30003',
        nickname: 'Bob',
        content: 'reply me',
        createTime: 2,
      }],
    }))

    const comment = await service.comment(post, 'nice')
    expect(backend.comment).toHaveBeenCalledWith(post, 'nice', [])
    expect(comment).toMatchObject({ tid: 'new-comment', uin: '10001', content: 'nice' })

    const reply = await service.reply(post, 0, 'thanks')
    expect(backend.reply).toHaveBeenCalledWith(post, post.comments[0], 'thanks')
    expect(reply).toMatchObject({
      tid: 'new-reply',
      uin: '10001',
      content: 'thanks',
      parentTid: 'other-comment',
    })
    expect((await repo.getById(post.id!))?.comments).toHaveLength(3)
  })

  it('prepares comment images and allows image-only comments', async () => {
    const backend = createBackend()
    const repo = new MemoryPostRepository()
    const service = new QzoneService(backend, repo, {
      publishImages: {
        allowedHosts: ['*.qpic.cn'],
        maxImages: 9,
        maxBytes: 1024,
        maxTotalBytes: 4096,
      },
    })
    const post = await repo.save(createEmptyPost({
      uin: '20002',
      tid: 'remote_tid',
      name: 'Alice',
    }))

    const comment = await service.comment(post, '', ['http://a.qpic.cn/comment.jpg'])

    expect(backend.comment).toHaveBeenCalledWith(
      post,
      '',
      ['https://a.qpic.cn/comment.jpg'],
    )
    expect(comment).toMatchObject({
      tid: 'new-comment',
      content: '',
      images: ['https://a.qpic.cn/comment.jpg'],
    })
  })

  it('rejects an empty comment without images', async () => {
    const backend = createBackend()
    const service = new QzoneService(backend, new MemoryPostRepository())
    const post = createEmptyPost({ uin: '20002', tid: 'remote_tid' })

    await expect(service.comment(post, '   ')).rejects.toThrow('评论内容和图片不能同时为空')
    expect(backend.comment).not.toHaveBeenCalled()
  })

  it('cancels a like through the backend', async () => {
    const backend = createBackend()
    const service = new QzoneService(backend, new MemoryPostRepository())
    const post = createEmptyPost({ uin: '20002', tid: 'remote_tid' })

    await service.unlike(post)
    expect(backend.unlike).toHaveBeenCalledWith(post)
  })
})
