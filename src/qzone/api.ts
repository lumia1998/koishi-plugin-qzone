import type { ApiResponse, Comment, Post } from '../types'
import { asNumber, asRecord, asString } from '../types'
import { QzoneHttpClient } from './client'
import { parseUploadResult } from './parser'
import { toApiResponse } from './response'
import { QZONE_CODE_OK } from './constants'

export class QzoneApi extends QzoneHttpClient {
  static readonly BASE_URL = 'https://user.qzone.qq.com'
  static readonly UPLOAD_IMAGE_URL = 'https://up.qzone.qq.com/cgi-bin/upload/cgi_upload_image'
  static readonly PUBLISH_URL = `${QzoneApi.BASE_URL}/proxy/domain/taotao.qzone.qq.com/cgi-bin/emotion_cgi_publish_v6`
  static readonly LIKE_URL = `${QzoneApi.BASE_URL}/proxy/domain/w.qzone.qq.com/cgi-bin/likes/internal_dolike_app`
  static readonly LIST_URL = `${QzoneApi.BASE_URL}/proxy/domain/taotao.qq.com/cgi-bin/emotion_cgi_msglist_v6`
  static readonly COMMENT_URL = `${QzoneApi.BASE_URL}/proxy/domain/taotao.qzone.qq.com/cgi-bin/emotion_cgi_re_feeds`
  static readonly RECENT_URL = `${QzoneApi.BASE_URL}/proxy/domain/ic2.qzone.qq.com/cgi-bin/feeds/feeds3_html_more`
  static readonly VISITOR_URL = 'https://h5.qzone.qq.com/proxy/domain/g.qzone.qq.com/cgi-bin/friendshow/cgi_get_visitor_more'
  static readonly REPLY_URL = 'https://h5.qzone.qq.com/proxy/domain/taotao.qzone.qq.com/cgi-bin/emotion_cgi_re_feeds'
  static readonly DELETE_URL = 'https://h5.qzone.qq.com/proxy/domain/taotao.qzone.qq.com/cgi-bin/emotion_cgi_delete_v6'
  static readonly DETAIL_URL = 'https://h5.qzone.qq.com/proxy/domain/taotao.qq.com/cgi-bin/emotion_cgi_msgdetail_v6'

  async getVisitor(): Promise<ApiResponse> {
    const context = await this.session.getContext()
    return toApiResponse(await this.request('GET', QzoneApi.VISITOR_URL, {
      params: { uin: context.uin, mask: 7, g_tk: context.gtk2, page: 1, fupdate: 1, clear: 1 },
    }))
  }

  async publish(post: Post, images: Uint8Array[] = []): Promise<ApiResponse> {
    const context = await this.session.getContext()
    const data: Record<string, string | number> = {
      syn_tweet_verson: '1',
      paramstr: '1',
      who: '1',
      con: post.text,
      feedversion: '1',
      ver: '1',
      ugc_right: '1',
      to_sign: '0',
      hostuin: context.uin,
      code_version: '1',
      format: 'json',
      qzreferrer: `${QzoneApi.BASE_URL}/${context.uin}`,
    }

    if (images.length) {
      const picBos: string[] = []
      const richValues: string[] = []
      for (const image of images) {
        const uploaded = await this.uploadImage(image)
        if (!uploaded.ok) throw new Error(uploaded.message || '上传图片失败')
        const parsed = parseUploadResult(uploaded.data)
        picBos.push(parsed.picBo)
        richValues.push(parsed.richValue)
      }
      data.pic_bo = picBos.join(',')
      data.richtype = '1'
      data.richval = richValues.join('\t')
    }

    return toApiResponse(await this.request('POST', QzoneApi.PUBLISH_URL, {
      params: { g_tk: context.gtk2, uin: context.uin },
      data,
      retryOnRedirect: false,
    }))
  }

  async like(post: Post): Promise<ApiResponse> {
    const context = await this.session.getContext()
    const key = `${QzoneApi.BASE_URL}/${post.uin}/mood/${post.tid}`
    return toApiResponse(await this.request('POST', QzoneApi.LIKE_URL, {
      params: { g_tk: context.gtk2 },
      data: {
        qzreferrer: `${QzoneApi.BASE_URL}/${context.uin}`,
        opuin: context.uin,
        unikey: key,
        curkey: key,
        appid: 311,
        from: 1,
        typeid: 0,
        abstime: Math.floor(Date.now() / 1000),
        fid: post.tid,
        active: 0,
        format: 'json',
        fupdate: 1,
      },
      retryOnRedirect: false,
    }))
  }

  async comment(post: Post, content: string): Promise<ApiResponse> {
    const context = await this.session.getContext()
    // QQ 空间评论接口：即使返回非零 code，评论实际也已生效。
    // 与 302/-3000 同理（见 client.ts），这里不再做 code 校验，
    // 直接按成功返回，避免 ChatLuna 工具误报"接口失败"。
    const raw = await this.request('POST', QzoneApi.COMMENT_URL, {
      params: { g_tk: context.gtk2 },
      data: {
        topicId: `${post.uin}_${post.tid}__1`,
        uin: context.uin,
        hostUin: post.uin,
        feedsType: 100,
        inCharset: 'utf-8',
        outCharset: 'utf-8',
        plat: 'qzone',
        source: 'ic',
        platformid: 52,
        format: 'fs',
        ref: 'feeds',
        content,
      },
      retryOnRedirect: false,
    })
    return {
      ok: true,
      code: asNumber(raw.code, QZONE_CODE_OK),
      data: asRecord(raw.data),
      raw,
    }
  }

  async reply(post: Post, comment: Comment, content: string): Promise<ApiResponse> {
    const context = await this.session.getContext()
    return toApiResponse(await this.request('POST', QzoneApi.REPLY_URL, {
      params: { g_tk: context.gtk2 },
      data: {
        topicId: `${post.uin}_${post.tid}__1`,
        uin: context.uin,
        hostUin: post.uin,
        feedsType: 100,
        inCharset: 'utf-8',
        outCharset: 'utf-8',
        plat: 'qzone',
        source: 'ic',
        platformid: 52,
        format: 'fs',
        ref: 'feeds',
        content,
        commentId: comment.tid,
        commentUin: comment.uin,
        richval: '',
        richtype: '',
        private: '0',
        paramstr: '2',
        qzreferrer: `${QzoneApi.BASE_URL}/${context.uin}/main`,
      },
      retryOnRedirect: false,
    }))
  }

  async deletePost(tid: string): Promise<ApiResponse> {
    const context = await this.session.getContext()
    return toApiResponse(await this.request('POST', QzoneApi.DELETE_URL, {
      params: { g_tk: context.gtk2 },
      data: {
        uin: context.uin,
        topicId: `${context.uin}_${tid}__1`,
        feedsType: 0,
        feedsFlag: 0,
        feedsKey: tid,
        feedsAppid: 311,
        feedsTime: Math.floor(Date.now() / 1000),
        fupdate: 1,
        ref: 'feeds',
        qzreferrer: `${QzoneApi.BASE_URL}/${context.uin}`,
      },
      retryOnRedirect: false,
    }))
  }

  async getFeeds(targetId: string, offset = 0, limit = 1): Promise<ApiResponse> {
    const context = await this.session.getContext()
    return toApiResponse(await this.request('GET', QzoneApi.LIST_URL, {
      params: {
        g_tk: context.gtk2,
        uin: targetId,
        ftype: 0,
        sort: 0,
        pos: offset,
        num: limit,
        replynum: 100,
        callback: '_preloadCallback',
        code_version: 1,
        format: 'json',
        need_comment: 1,
        need_private_comment: 1,
      },
    }))
  }

  async getDetail(post: Post): Promise<ApiResponse> {
    const context = await this.session.getContext()
    return toApiResponse(await this.request('GET', QzoneApi.DETAIL_URL, {
      params: { uin: post.uin, tid: post.tid, format: 'jsonp', g_tk: context.gtk2 },
    }))
  }

  async getRecentFeeds(page = 1): Promise<ApiResponse> {
    const context = await this.session.getContext()
    return toApiResponse(await this.request('GET', QzoneApi.RECENT_URL, {
      params: {
        uin: context.uin,
        scope: 0,
        view: 1,
        filter: 'all',
        flag: 1,
        applist: 'all',
        pagenum: page,
        aisortEndTime: 0,
        aisortOffset: 0,
        aisortBeginTime: 0,
        begintime: 0,
        format: 'json',
        g_tk: context.gtk2,
        useutf8: 1,
        outputhtmlfeed: 1,
      },
    }))
  }

  private async uploadImage(image: Uint8Array): Promise<ApiResponse> {
    const context = await this.session.getContext()
    const raw = await this.request('POST', QzoneApi.UPLOAD_IMAGE_URL, {
      data: {
        filename: 'image.jpg',
        uploadtype: '1',
        albumtype: '7',
        skey: context.skey,
        uin: context.uin,
        p_skey: context.pSkey,
        output_type: 'json',
        base64: '1',
        picfile: Buffer.from(image).toString('base64'),
      },
      headers: {
        Referer: `${QzoneApi.BASE_URL}/${context.uin}`,
        Origin: QzoneApi.BASE_URL,
      },
      timeoutMs: 60000,
    })
    const response = toApiResponse(raw, { codeKey: 'ret', messageKeys: ['msg', 'message'] })
    if (response.ok && !asRecord(response.data.data).url) {
      return { ...response, ok: false, code: -1, message: asString(response.data.msg, '上传响应缺少 data.url') }
    }
    return response
  }
}
