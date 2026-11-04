# koishi-plugin-qzone

> 测试中，不推荐用于重要账号。QQ 空间接口并非稳定的公开业务 API。

面向 Koishi 与 ChatLuna 的 QQ 空间插件。插件本身不再维护 Cookie、二维码登录或
CGI 请求，而是通过已经连接到 SnowLuma 的 OneBot 适配器调用 QQ 空间 Action。

## 功能

- 查询好友动态和指定 QQ 的说说
- 获取说说详情与评论
- 点赞、取消点赞、评论（支持带图）、回复、发布和删除说说
- 向 ChatLuna 注册 9 个原生工具
- 支持 Koishi Database；未安装数据库插件时使用内存仓库
- 媒体域名白名单、私网地址拦截、重定向检查和大小限制
- ChatLuna 查询动态时下载图片并作为视觉内容传给支持图片输入的模型
- Koishi `看说说` 命令会将图片和视频下载到本地缓存后，以二进制图片/视频元素发送

插件不包含空间资料、权限设置、推荐流、公众号流和最近访客功能。

## 工作方式

SnowLuma 开启 WebSocket 服务端，Koishi 通过 OneBot 适配器连接：

```text
Koishi --OneBot WS--> SnowLuma --QQ 空间--> QQ
```

本插件在收到命令或 ChatLuna 工具调用时，通过指定机器人实例的
`bot.internal._request(action, params)` 调用 SnowLuma。因此：

- 插件配置中只需要填写已连接 SnowLuma 的 OneBot 机器人 QQ 号。
- 不需要配置 SnowLuma 的 HTTP 地址、端口或 Token。
- 登录状态由 SnowLuma 维护，插件只读取 `get_login_info`。
- 只有 OneBot 动作返回 `retcode === 0` 才视为成功；HTTP 200 不代表业务成功。

## 环境

- Node.js 18 或更高版本
- Koishi 4.18+
- `koishi-plugin-chatluna` 1.3.36+ 或 1.4 alpha
- `@koishijs/plugin-adapter-onebot`
- 已启动并登录 QQ 空间的 SnowLuma，且开启 WebSocket 服务端
- 可选 Koishi Database 插件

ChatLuna 是必需服务，必须先加载并成功启动。

## 安装

```bash
npm install koishi-plugin-chatluna
npm install koishi-plugin-qzone
```

开发构建：

```bash
npm install
npm run check
npm test
npm run test:integration
npm run build
```

## 配置

```yaml
plugins:
  qzone:
    onebotSelfId: '123456789'
    debugLogging: false
    imageHosts:
      - '*.qpic.cn'
      - '*.qlogo.cn'
      - '*.qq.com'
      - '*.gtimg.cn'
```

| 配置 | 默认值 | 说明 |
| --- | --- | --- |
| `onebotSelfId` | 无 | 必填，已连接 SnowLuma 的 OneBot 机器人 QQ 号，只允许纯数字 |
| `debugLogging` | `false` | 输出 SnowLuma Action 名称与参数键名，不记录图片、Cookie 或 Token |
| `imageHosts` | `*.qpic.cn`、`*.qlogo.cn`、`*.qq.com`、`*.gtimg.cn` | 图片下载与发布的域名白名单，仅支持公网域名；不支持内网地址、IP、端口或路径 |

插件不会在 QQ 号为空时选择任意在线机器人。找不到匹配的 `onebot` 平台机器人时，
所有空间操作都会返回连接错误。

其余参数使用插件内部默认值，不显示在 Koishi 配置面板：

- 普通请求超时：30 秒
- 写操作超时：120 秒，超时不代表操作未执行
- 登录信息缓存：60 秒
- 好友动态分页大小：50 条/页，最多读取 10 页
- 动态详情评论上限：100 条
- 默认动态数量：5 条
- 媒体缓存：`data/qzone/temp/{image,model,video}/`，默认保留 7 天并每天清理
- 每次最多向 ChatLuna 传递 9 张图片，总大小最多 16 MiB，单张最多 4 MiB
- 单次最多发布或评论 9 张图片，每张最多 8 MiB，总计最多 16 MiB
- `看说说` 每条动态最多发送 9 张图片（单张 8 MiB）和 3 个视频（单个 32 MiB）
- 图片下载与发布默认允许的域名：`*.qpic.cn`、`*.qlogo.cn`、`*.qq.com`、`*.gtimg.cn`；可通过 `imageHosts` 修改，内网地址会被拒绝
- 视频下载默认允许的域名与图片默认白名单相同

## 命令

| 命令 | 中文别名 | 权限 | 说明 |
| --- | --- | --- | --- |
| `qzone.status` | `空间状态` | 普通 | 查看 SnowLuma 当前登录账号 |
| `qzone.feed [范围]` | `看说说` | 普通 | 查看好友动态或指定 QQ 的说说 |
| `qzone.like [引用]` | `赞说说` | 普通 | 点赞动态 |
| `qzone.unlike [引用]` | `取消赞说说` | 普通 | 取消点赞 |
| `qzone.comment <引用> [内容]` | `评论说说` | 普通 | 评论动态，可附带图片 |
| `qzone.reply <引用> <评论序号> <内容>` | `回复评论` | 普通 | 回复评论 |
| `qzone.publish [内容]` | `发说说` | 管理员 | 发布说说，可附带图片 |
| `qzone.delete <引用>` | `删说说` | 管理员 | 删除自己的说说 |

动态范围从 `0` 开始：

```text
看说说
看说说 0
看说说 2~5
看说说 -u 12345678 0
```

`看说说` 的原始媒体 URL 会保留在文本中便于追溯；插件同时将配置的图片域名白名单
和默认视频域名白名单内的媒体下载至本地缓存，并通过 `h.image(buffer, mime)`、
`h.video(buffer, mime)` 发送。因此不依赖
QQ 媒体直链是否能被目标适配器转发。最终是否显示为原生视频仍取决于所使用的平台和
OneBot 实现对视频元素的支持。

点赞、评论等命令中的纯数字引用表示最近一次查询结果的序号；持久化编号使用
`#12`，远端引用使用 `12345678:tid`。

发布命令和评论命令都会收集当前消息中的图片元素：

- 图片 URL 会先校验公网地址和配置的 `imageHosts` 域名白名单，再交给 SnowLuma 下载。
- 本地图片路径或 `file://` 地址会读取并转换为 `base64://`。
- 纯图片说说/评论没有文本时，插件会发送一个零宽空格，以满足 SnowLuma
  “`content` 至少 1 个字符”的要求。
- 带图评论只支持一级评论；楼中楼回复仍只支持文字。
- 写操作超时后结果可能已经生效，请先确认空间内容，不要直接重复发布、评论、点赞或取消点赞。

## ChatLuna 工具

| 工具 | 作用 |
| --- | --- |
| `qzone_status` | 查看 SnowLuma 当前登录账号 |
| `qzone_feed` | 查询好友动态或指定 QQ 的说说 |
| `qzone_post` | 读取已经保存的单条动态 |
| `qzone_like` | 点赞动态 |
| `qzone_unlike` | 取消点赞 |
| `qzone_comment` | 评论动态，可附带公网图片 URL |
| `qzone_reply` | 回复评论 |
| `qzone_publish` | 发布文字或图片说说 |
| `qzone_delete` | 删除自己的说说，要求 `confirm: true` |

动态、评论内容会标记为外部不可信数据，并限制字段长度、评论数量和总返回体积；
上游异常不会把 Cookie 或 Token 原文返回给模型。`qzone_feed` 和 `qzone_post` 会把缓存的
图片作为多模态内容附加到工具结果；如果当前 ChatLuna 模型不支持图片输入，图片会被
模型适配器丢弃，但仍保留图片 URL。

ChatLuna 发布和评论图片只接受公网 `http(s)` URL 或 base64 数据，不接受本机文件。
所有 URL 必须命中配置的图片域名白名单。

## SnowLuma Action

插件使用以下 Action：

```text
get_login_info
get_qzone_feeds
get_qzone_msg_list
get_qzone_msg_detail
like_qzone
unlike_qzone
comment_qzone
send_qzone_msg
delete_qzone_msg
```

好友动态使用游标分页；指定 QQ 的说说和详情评论使用 `pos`/`num` 偏移分页。
回复二级评论时，插件会先找到它的一级父评论作为 `comment_id`/`comment_uin`，
再通过 `reply_uin`/`reply_name` 指定实际被回复的用户。

## 目录

```text
src/
├── snowluma/           # OneBot Action 客户端、解析与后端实现
├── qzone/              # 图片/视频下载与安全缓存
├── chatluna.ts         # ChatLuna StructuredTool 注册
├── backend.ts          # 业务后端抽象
├── config.ts           # 配置 Schema
├── defaults.ts         # 内部固定参数
├── publish-images.ts   # 发布图片格式归一化
├── repository.ts       # Database/内存仓库
├── service.ts          # 业务服务
└── index.ts            # Koishi 插件入口和命令
```

## 来源与许可

本项目是 [Zhalslar/astrbot_plugin_qzone](https://github.com/Zhalslar/astrbot_plugin_qzone)
的 TypeScript/Koishi 重写版本，使用 `GPL-3.0-only` 发布，详细条款见
[LICENSE](./LICENSE)。

## 已知限制

- 依赖 SnowLuma 及其 QQ 空间实现，Action 字段变化时需要同步调整解析器。
- SnowLuma 将 `unlike_qzone` 标注为“取消赞端点待真机核实”，取消点赞可能失败。
- SnowLuma 必须保持 WebSocket 在线；插件不会自行登录 QQ 空间。
- 发布图片只接受配置白名单内的公网域名（默认仅 QQ CDN）；ChatLuna 不接受本地文件。
- 内存仓库会在插件重载后清空，生产环境建议安装数据库插件。
- 图片视觉理解依赖当前 ChatLuna 模型支持图片输入；仅支持文本的模型无法分析图片内容。
