export const QZONE_CODE_OK = 0
export const QZONE_CODE_UNKNOWN = -1
export const QZONE_CODE_LOGIN_EXPIRED = -3000
export const QZONE_CODE_IMAGE_EXPIRED = -100
export const QZONE_META_KEY = '__qzone_internal__'
export const QZONE_HTTP_STATUS_KEY = 'httpStatus'

export const QZONE_ERROR = {
  empty: '响应内容为空',
  invalid: '响应内容格式异常',
  parse: 'JSON 解析失败',
  nonObject: 'JSON 根节点不是对象',
  forbidden: '权限不足',
} as const
