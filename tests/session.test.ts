import { describe, expect, it, vi } from 'vitest'

import type { CredentialAdapter } from '../src/types'
import { QzoneSession } from '../src/qzone/session'

describe('QzoneSession', () => {
  it('deduplicates concurrent credential refreshes', async () => {
    const getCredential = vi.fn(async () => {
      await new Promise((resolve) => setTimeout(resolve, 5))
      return { cookie: 'uin=o10001; skey=s; p_skey=p', source: 'test' }
    })
    const adapter: CredentialAdapter = { name: 'test', getCredential }
    const session = new QzoneSession(adapter, 600)

    const [first, second, third] = await Promise.all([
      session.getContext(),
      session.getContext(),
      session.getContext(),
    ])
    expect(first).toBe(second)
    expect(second).toBe(third)
    expect(getCredential).toHaveBeenCalledTimes(1)
  })

  it('refreshes after TTL expiration and on force', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-01-01T00:00:00Z'))
    let counter = 0
    const adapter: CredentialAdapter = {
      name: 'test',
      async getCredential() {
        counter += 1
        return { cookie: `uin=o10001; skey=s; p_skey=p${counter}`, source: 'test' }
      },
    }
    const session = new QzoneSession(adapter, 10)
    await session.getContext()
    vi.advanceTimersByTime(9000)
    await session.getContext()
    expect(counter).toBe(1)
    vi.advanceTimersByTime(1000)
    await session.getContext()
    expect(counter).toBe(2)
    await session.getContext(true)
    expect(counter).toBe(3)
    vi.useRealTimers()
  })

  it('invalidates the credential source after an authentication failure', async () => {
    const invalidateCredential = vi.fn(async () => undefined)
    const adapter: CredentialAdapter = {
      name: 'test',
      invalidateCredential,
      async getCredential() {
        return { cookie: 'uin=o10001; skey=s; p_skey=p', source: 'qrcode' }
      },
    }
    const session = new QzoneSession(adapter, 600)
    await session.getContext()
    await session.refreshAfterAuthFailure()
    expect(invalidateCredential).toHaveBeenCalledWith('qrcode')
  })
})
