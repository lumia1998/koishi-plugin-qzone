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
  messageKeys?: string[]
  dataKey?: string
  successCode?: number
}

export function toApiResponse(
  raw: Record<string, unknown>,
  options: ApiResponseOptions = {},
): ApiResponse {
  const codeKey = options.codeKey || 'code'
  const messageKeys = options.messageKeys || ['message', 'msg']
  const successCode = options.successCode ?? QZONE_CODE_OK
  const code = asNumber(raw[codeKey], QZONE_CODE_UNKNOWN)
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
