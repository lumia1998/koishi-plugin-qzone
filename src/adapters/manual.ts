import type { CredentialAdapter, CredentialResult } from '../types'

export class ManualCookieAdapter implements CredentialAdapter {
  readonly name = 'manual-cookie'

  constructor(private readonly cookie: string) {}

  async getCredential(): Promise<CredentialResult> {
    const cookie = this.cookie.trim()
    if (!cookie) throw new Error('未配置手动 Qzone Cookie')
    return { cookie, source: this.name }
  }
}
