import type { ApiResponse } from '../types'
import { asNumber, asRecord, asString } from '../types'
import {
  QZONE_CODE_OK,
  QZONE_CODE_UNKNOWN,
  QZONE_HTTP_STATUS_KEY,
  QZONE_META_KEY,
} from './constants'

export interface ApiResponseOptions {
  codeKey?: string
  /** 按顺序检查多个字段，取第一个存在的值作为 code。优先级高于 codeKey */
  codeKeys?: string[]
  messageKeys?: string[]
  dataKey?: string
  successCode?: number
}

export function toApiResponse(
  raw: Record<string, unknown>,
  options: ApiResponseOptions = {},
): ApiResponse {
  const codeKeys = options.codeKeys || [options.codeKey || 'code']
  const messageKeys = options.messageKeys || ['message', 'msg']
  const successCode = options.successCode ?? QZONE_CODE_OK
  let code = QZONE_CODE_UNKNOWN
  for (const key of codeKeys) {
    if (key in raw) {
      code = asNumber(raw[key], QZONE_CODE_UNKNOWN)
      break
    }
  }
  const meta = asRecord(raw[QZONE_META_KEY])
  const statusValue = Number(meta[QZONE_HTTP_STATUS_KEY])
  const httpStatus = Number.isInteger(statusValue) ? statusValue : undefined

  let message: string | undefined
  for (const key of messageKeys) {
    const value = asString(raw[key]).trim() || asString(asRecord(raw.data)[key]).trim()
    if (value) {
      message = value
      break
    }
  }

  if (code !== successCode) {
    return { ok: false, code, message, data: {}, raw, httpStatus }
  }

  let data: Record<string, unknown>
  if (options.dataKey) {
    data = asRecord(raw[options.dataKey])
  } else {
    data = { ...raw }
    delete data[QZONE_META_KEY]
  }
  return { ok: true, code, data, raw, httpStatus }
}
