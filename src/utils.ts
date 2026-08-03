import type { Session } from 'koishi'

import type { RangeSelection } from './types'

export function parseRange(value: string | undefined, defaultLimit: number): RangeSelection {
  const text = (value || '').trim()
  if (!text) return { offset: 0, limit: defaultLimit }

  if (/^-?\d+$/.test(text)) {
    const index = Number(text)
    if (index < 0) throw new Error('动态序号必须大于或等于 0')
    return { offset: index, limit: 1 }
  }

  const match = /^(\d+)~(\d+)$/.exec(text)
  if (!match) throw new Error('范围格式应为 0、2~5')
  const start = Number(match[1])
  const end = Number(match[2])
  if (end < start) throw new Error('范围终点必须大于或等于起点')
  return { offset: start, limit: end - start + 1 }
}

export function findMentionedUser(session: Session): string | undefined {
  for (const element of session.elements || []) {
    if (element.type !== 'at') continue
    const id = String(element.attrs.id || '').trim()
    if (/^\d+$/.test(id)) return id
  }
  return undefined
}

export function collectImageSources(session: Session): string[] {
  const sources: string[] = []
  for (const element of session.elements || []) {
    if (!['img', 'image'].includes(element.type)) continue
    const source = String(element.attrs.src || element.attrs.url || '').trim()
    if (source) sources.push(source)
  }
  return [...new Set(sources)]
}

export function parsePostReference(value: string): { id?: number; uin?: string; tid?: string } {
  const reference = value.trim()
  if (/^#?\d+$/.test(reference)) return { id: Number(reference.replace(/^#/, '')) }
  const separator = reference.indexOf(':')
  if (separator > 0) {
    const uin = reference.slice(0, separator)
    const tid = reference.slice(separator + 1)
    if (/^\d+$/.test(uin) && tid) return { uin, tid }
  }
  throw new Error('动态引用应为本地编号 #12 或 uin:tid')
}
