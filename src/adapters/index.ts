import type { Bot, Context } from 'koishi'

import type { Config } from '../config'
import type { CredentialAdapter, CredentialResult } from '../types'
import { QrLoginRequiredError } from './qrcode'
import { KoishiOneBotAdapter } from './onebot'

export class AutoCredentialAdapter implements CredentialAdapter {
  readonly name = 'auto'
  private skipSourceOnce?: string

  constructor(
    private readonly onebot: CredentialAdapter,
    private readonly qrcode: CredentialAdapter,
  ) {}

  async getCredential(): Promise<CredentialResult> {
    const skipped = this.skipSourceOnce
    this.skipSourceOnce = undefined
    let onebotError: unknown

    if (skipped !== this.onebot.name) {
      try {
        return await this.onebot.getCredential()
      } catch (error) {
        onebotError = error
      }
    }

    try {
      return await this.qrcode.getCredential()
    } catch (error) {
      if (onebotError && error instanceof QrLoginRequiredError) {
        const detail = onebotError instanceof Error ? onebotError.message : String(onebotError)
        throw new QrLoginRequiredError(`OneBot 认证不可用（${detail}）；${error.message}`)
      }
      throw error
    }
  }

  async invalidateCredential(source?: string): Promise<void> {
    if (source === this.onebot.name) {
      this.skipSourceOnce = source
      return
    }
    await this.qrcode.invalidateCredential?.(source)
  }
}

function resolveOneBot(ctx: Context, selfId: string): Bot | undefined {
  return [...ctx.bots].find((bot) => bot.platform === 'onebot' && bot.selfId === selfId)
}

export function createCredentialAdapter(
  ctx: Context,
  config: Config,
  qrcode: CredentialAdapter,
): CredentialAdapter {
  if (config.authMode === 'qrcode') return qrcode

  const selfId = config.onebotSelfId?.trim() || ''
  if (!/^\d+$/.test(selfId)) {
    throw new Error('auto 或 onebot 认证模式必须填写纯数字 onebotSelfId')
  }
  const onebot = new KoishiOneBotAdapter(
    () => resolveOneBot(ctx, selfId),
    selfId,
  )
  if (config.authMode === 'onebot') return onebot
  return new AutoCredentialAdapter(onebot, qrcode)
}
