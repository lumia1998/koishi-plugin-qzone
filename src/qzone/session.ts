import type { CredentialAdapter } from '../types'
import { parseCredentials, QzoneContext } from './context'

export class QzoneSession {
  private context?: QzoneContext
  private refreshedAt = 0
  private refreshPromise?: Promise<QzoneContext>

  constructor(
    private readonly adapter: CredentialAdapter,
    private readonly ttlSeconds: number,
  ) {}

  async getContext(force = false): Promise<QzoneContext> {
    if (!force && this.context && !this.isExpired()) return this.context
    if (this.refreshPromise) return this.refreshPromise

    this.refreshPromise = this.refresh()
    try {
      return await this.refreshPromise
    } finally {
      this.refreshPromise = undefined
    }
  }

  async getUin(): Promise<string> {
    return (await this.getContext()).uin
  }

  async getNickname(): Promise<string> {
    const context = await this.getContext()
    return context.credentials.nickname || context.uin
  }

  invalidate(): void {
    this.context = undefined
    this.refreshedAt = 0
  }

  async refreshAfterAuthFailure(): Promise<QzoneContext> {
    const source = this.context?.credentials.source
    this.invalidate()
    await this.adapter.invalidateCredential?.(source)
    return this.getContext(true)
  }

  private async refresh(): Promise<QzoneContext> {
    const result = await this.adapter.getCredential()
    this.context = new QzoneContext(
      parseCredentials(result.cookie, result.source, result.nickname),
    )
    this.refreshedAt = Date.now()
    return this.context
  }

  private isExpired(): boolean {
    const ttlMs = Math.max(0, this.ttlSeconds) * 1000
    return ttlMs > 0 && Date.now() - this.refreshedAt >= ttlMs
  }
}
