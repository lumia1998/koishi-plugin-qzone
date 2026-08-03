import { randomInt } from 'node:crypto'

import { CronExpressionParser } from 'cron-parser'
import type { Context, Logger } from 'koishi'

export class RandomizedCronTask {
  private disposeTimer?: () => void
  private disposed = false

  constructor(
    private readonly ctx: Context,
    private readonly logger: Logger,
    private readonly taskName: string,
    private readonly expression: string,
    private readonly timezone: string,
    private readonly offsetSeconds: number,
    private readonly callback: () => Promise<void>,
  ) {}

  start(): void {
    CronExpressionParser.parse(this.expression, {
      currentDate: new Date(),
      tz: this.timezone,
    })
    this.scheduleNext()
  }

  dispose(): void {
    this.disposed = true
    this.disposeTimer?.()
    this.disposeTimer = undefined
  }

  private scheduleNext(): void {
    if (this.disposed) return
    const now = new Date()
    const interval = CronExpressionParser.parse(this.expression, {
      currentDate: now,
      tz: this.timezone,
    })
    const baseTime = interval.next().toDate()
    const offset = this.offsetSeconds > 0
      ? randomInt(-this.offsetSeconds, this.offsetSeconds + 1)
      : 0
    let targetTime = new Date(baseTime.getTime() + offset * 1000)
    if (targetTime <= now) targetTime = new Date(now.getTime() + 1000)

    this.logger.info('%s 下一次执行时间：%s', this.taskName, targetTime.toISOString())
    this.disposeTimer = this.ctx.setTimeout(async () => {
      try {
        await this.callback()
      } catch (error) {
        this.logger.warn('%s 执行失败：%s', this.taskName, error instanceof Error ? error.message : String(error))
      } finally {
        this.scheduleNext()
      }
    }, Math.max(1, targetTime.getTime() - Date.now()))
  }
}
