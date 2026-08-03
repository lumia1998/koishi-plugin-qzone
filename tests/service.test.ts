import { describe, expect, it } from 'vitest'

import { MemoryPostRepository } from '../src/repository'
import type { QzoneApi } from '../src/qzone/api'
import type { SafeImageDownloader } from '../src/qzone/image'
import type { QzoneSession } from '../src/qzone/session'
import { QzoneService } from '../src/service'

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
})
