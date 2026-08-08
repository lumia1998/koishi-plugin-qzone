import type { Bot, Context } from 'koishi'

import type { Config } from '../config'
import type { CredentialAdapter, CredentialResult } from '../types'
import { QrLoginRequiredError } from './qrcode'
import { KoishiOneBotAdapter } from './onebot'

export class AutoCredentialAdapter implements CredentialAdapter {
  readonly name = 'auto'

  constructor(
    private readonly onebot: CredentialAdapter,
    private readonly qrcode: CredentialAdapter,
  ) {}

  async getCredential(): Promise<CredentialResult> {
    // 优先 OneBot：get_cookies 每次都会从 QQ 客户端实时拿最新 cookie
    let onebotError: unknown

    try {
      return await this.onebot.getCredential()
    } catch (error) {
      onebotError = error
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
    // OneBot cookie 失效时应重新从 OneBot 获取新 cookie（get_cookies 实时返回），
    // 而不是跳过 OneBot 转向 QR 登录——QR 通常不可用，会导致重试必然失败。
    if (source === this.onebot.name) return
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
