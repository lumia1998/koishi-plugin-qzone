import { describe, expect, it } from 'vitest'

import { MemoryPostRepository } from '../src/repository'
import { createEmptyPost } from '../src/types'

describe('MemoryPostRepository', () => {
  it('deduplicates remote posts by uin and tid', async () => {
    const repository = new MemoryPostRepository()
    const first = await repository.save(createEmptyPost({ uin: '1', tid: 't1', text: 'old' }))
    const second = await repository.save(createEmptyPost({ uin: '1', tid: 't1', text: 'new' }))
    expect(second.id).toBe(first.id)
    expect((await repository.getByRemote('1', 't1'))?.text).toBe('new')
    expect(await repository.list()).toHaveLength(1)
  })
})
