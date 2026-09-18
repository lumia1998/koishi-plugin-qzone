import { describe, expect, it, vi } from 'vitest'

import { MemoryPostRepository } from '../src/repository'
import type { QzoneApi } from '../src/qzone/api'
import type { SafeImageDownloader } from '../src/qzone/image'
import type { QzoneSession } from '../src/qzone/session'
import { QzoneService } from '../src/service'
import { createEmptyPost } from '../src/types'

describe('QzoneService', () => {
  it('rejects excessive images before downloading or publishing', async () => {
    const service = new QzoneService(
      {} as QzoneApi,
      {} as QzoneSession,
      new MemoryPostRepository(),
      {} as SafeImageDownloader,
      2,
    )
    await expect(service.publish('text', ['a', 'b', 'c'])).rejects.toThrow('最多发布 2 张')
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

    const api = {
      deletePost: vi.fn(async () => ({ ok: true, code: 0, data: {}, raw: {} })),
    } as unknown as QzoneApi
    const session = {
      getUin: vi.fn(async () => '10001'),
    } as unknown as QzoneSession

    const service = new QzoneService(
      api,
      session,
      repo,
      {} as SafeImageDownloader,
    )

    await service.delete(saved)
    expect(api.deletePost).toHaveBeenCalledWith('test_tid')
    expect(await repo.getById(saved.id!)).toBeUndefined()
  })
})
