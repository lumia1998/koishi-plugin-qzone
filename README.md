# koishi-plugin-qzone

使用 TypeScript 编写的 Koishi QQ 空间插件。核心逻辑来自对
`astrbot_plugin_qzone` 的重新设计，不依赖 Python 运行时，并将空间能力注册为
ChatLuna 原生工具。

## 已实现

- 读取好友动态和指定 QQ 的说说
- 获取说说详情与评论
- 发布、删除、点赞、评论、回复
- 查询最近访客
- Koishi Database 持久化，未安装数据库插件时使用内存仓库
- Cron 自动评论、点赞和发布，默认全部关闭
- OneBot、OneBot HTTP、二维码登录、手动 Cookie 四种认证适配器
- Cookie TTL 刷新和登录失效重试
- JSON、JSONP、JSON5 与好友动态 HTML 解析
- 发布图片的域名白名单、私网地址拦截、重定向检查和大小限制
- 9 个 ChatLuna 工具，支持查询、点赞、评论、回复、发布和删除

暂未移植 AstrBot 版本的 LLM 生成、表白墙、图片卡片渲染和 Dashboard。

## 环境

- Node.js 18 或更高版本
- Koishi 4.18+
- 必需 `koishi-plugin-chatluna` 1.3.36+ 或 1.4 alpha
- 推荐 `@koishijs/plugin-adapter-onebot` 6.0+
- 可选 Koishi Database 插件

当前 OneBot 适配器类型已经包含：

```ts
bot.internal.getCookies(domain?: string): Promise<string>
bot.internal.getCredentials(domain?: string): Promise<{
  cookies: string
  csrf_token: number
}>
```

因此通常使用 `authMode: auto` 即可。如果具体 QQ 实现没有开放上述
Action，插件会继续尝试 OneBot HTTP、已保存的扫码凭据和手动 Cookie。

## 安装

在 Koishi 工作区安装本地插件：

```bash
npm install koishi-plugin-chatluna
npm install /path/to/koishi-plugin-qzone
```

ChatLuna 是必需服务。Koishi 必须先加载并成功启动 ChatLuna，否则本插件不会
加载。QQ 空间动态的数据库持久化仍为可选能力。

开发构建：

```bash
npm install
npm run check
npm test
npm run test:integration
npm run build
```

## 认证方式

### 自动模式

```yaml
authMode: auto
botId: ''
onebotHttpUrl: ''
onebotAccessToken: ''
allowInsecureOnebotHttp: false
qrCredentialPath: data/qzone/credentials.json
qrLoginTimeoutSeconds: 120
qrPollIntervalMs: 2000
manualCookie: ''
```

顺序为：

1. Koishi 机器人上的 `bot.internal.getCookies()`
2. 配置了地址时调用 OneBot HTTP `get_cookies`
3. 使用插件二维码登录保存的 Qzone Cookie
4. 配置了 Cookie 时使用手动 Cookie 适配器

首次运行时，如果前两项都无法提供 Cookie，管理员需要私聊机器人执行：

```text
qzone.login
```

插件会发送 QQ 登录二维码并轮询扫码状态。手机 QQ 确认登录后，Cookie
自动解析并保存，后续启动不需要重复扫码。二维码只允许在私聊中显示。

### OneBot HTTP

```yaml
authMode: onebot-http
onebotHttpUrl: http://127.0.0.1:3000
onebotAccessToken: TOKEN
allowInsecureOnebotHttp: false
```

插件会请求：

```text
POST /get_cookies
POST /get_login_info
```

非回环地址默认要求 HTTPS。局域网内确需使用明文 HTTP 时，需要显式设置
`allowInsecureOnebotHttp: true`，该模式会在网络上传输 OneBot Token。

### 二维码登录

```yaml
authMode: qrcode
qrCredentialPath: data/qzone/credentials.json
qrLoginTimeoutSeconds: 120
qrPollIntervalMs: 2000
```

也可以保留默认的 `authMode: auto`，仅在 OneBot 无法提供 Cookie 时使用扫码
凭据。管理员在与机器人的私聊中执行 `qzone.login`，使用手机 QQ 扫描图片并
确认。二维码过期后重新执行命令即可。

凭据默认保存在 Koishi 工作目录下的 `data/qzone/credentials.json`，插件会在
支持 POSIX 权限的平台上将目录设为 `0700`、文件设为 `0600`。该文件包含
QQ 登录 Cookie，应当与 Koishi 配置文件采用相同的备份和访问控制策略。

相关命令：

```text
qzone.login             # 开始扫码
qzone.login --cancel    # 取消当前扫码
qzone.logout            # 清除插件保存的扫码凭据
```

### 独立 Qzone Cookie

```yaml
authMode: manual
manualCookie: uin=oQQ号; skey=...; p_skey=...
```

Cookie 至少需要 `uin` 和 `p_skey`，缺少 `p_skey` 时会尝试使用 `skey`。
Cookie 属于登录凭据，应只写入 Koishi 的私密配置。

## 命令

| 命令 | 中文别名 | 权限 | 说明 |
| --- | --- | --- | --- |
| `qzone.status` | `空间状态` | 普通 | 查看认证来源和账号 |
| `qzone.refresh` | `刷新空间登录` | 管理员 | 强制刷新 Cookie |
| `qzone.login` | `扫码登录空间` | 管理员 | 私聊扫码并自动保存 Cookie |
| `qzone.logout` | `退出空间登录` | 管理员 | 清除插件保存的扫码凭据 |
| `qzone.feed [范围]` | `看说说`、`查看说说` | 普通 | 查看好友动态 |
| `qzone.like [引用]` | `赞说说` | 普通 | 点赞动态 |
| `qzone.comment <引用> <内容>` | `评说说`、`评论说说` | 普通 | 评论动态 |
| `qzone.reply <引用> <评论序号> <内容>` | `回评`、`回复评论` | 普通 | 回复评论 |
| `qzone.publish <内容>` | `发说说` | 管理员 | 发布说说 |
| `qzone.delete <引用>` | `删说说` | 管理员 | 删除自己的说说 |
| `qzone.visitors` | `查看访客` | 管理员 | 查看最近访客 |

动态范围从 `0` 开始，例如：

```text
看说说
看说说 0
看说说 2~5
看说说 -u 12345678 0
```

点赞、评论等命令中的纯数字引用表示最近一次查询结果的序号。持久化编号
使用 `#12`，远端引用使用 `12345678:tid`。

## ChatLuna 工具

插件启动时会向 `ctx.chatluna.platform` 注册以下原生工具：

| 工具 | 权限 | 作用 |
| --- | --- | --- |
| `qzone_status` | 普通 | 查看登录账号与认证来源，不返回 Cookie |
| `qzone_feed` | 普通 | 查询好友动态或指定 QQ 的说说 |
| `qzone_post` | 普通 | 读取已经保存的单条动态 |
| `qzone_like` | 普通 | 点赞动态 |
| `qzone_comment` | 普通 | 评论动态 |
| `qzone_reply` | 普通 | 回复评论 |
| `qzone_publish` | 管理员 | 发布文字或图片说说 |
| `qzone_delete` | 管理员 | 删除自己的说说，要求 `confirm: true` |
| `qzone_visitors` | 管理员 | 查询最近访客 |

普通和管理员分别使用 `commandAuthority`、`adminAuthority` 配置。ChatLuna 在
选择工具时检查会话权限，工具执行时还会再次检查。点赞、评论、回复和发布的
工具描述要求模型仅在用户明确提出对应操作时调用。
动态、评论和访客内容会标记为外部不可信数据，并限制字段长度、评论数量与
单次工具返回体积；上游 API 异常不会把 Cookie 或 Token 原文透传给模型。

二维码登录、取消登录、刷新 Cookie 和登出不会注册为 ChatLuna 工具，必须由
管理员通过 Koishi 命令完成。

## 定时任务

所有 Cron 默认留空，不会主动发布或评论：

```yaml
autoCommentCron: ''
autoCommentText: ''
autoLikeWithComment: true
autoPublishCron: ''
autoPublishText: ''
cronTimezone: Asia/Shanghai
randomOffsetSeconds: 0
```

启用自动任务前应先通过 `qzone.status` 和手动命令验证登录与 Qzone API。

## 目录

```text
src/
├── adapters/       # OneBot、HTTP、二维码、手动 Cookie
├── qzone/          # 会话、HTTP、API、解析、图片边界
├── chatluna.ts     # ChatLuna StructuredTool 注册
├── config.ts       # Koishi Schema
├── repository.ts   # Database/内存仓库
├── service.ts      # 业务服务
├── scheduler.ts    # 随机偏移 Cron
└── index.ts        # Koishi 插件入口和命令
```

## 来源与许可

本项目是 [Zhalslar/astrbot_plugin_qzone](https://github.com/Zhalslar/astrbot_plugin_qzone)
的 TypeScript/Koishi 重写版本，感谢原作者 Zhalslar 的工作。

上游仓库的 `LICENSE` 文件采用 GNU GPL v3，本项目相应使用
`GPL-3.0-only` 发布。详细条款见 [LICENSE](./LICENSE)。

## 已知限制

- QQ 空间接口不是稳定的公开业务 API，QQ 更新后可能需要调整参数或解析器。
- 图片发布默认只接受 QQ 相关 CDN；其他图片域名需要显式加入白名单。
- 自定义图片域名属于信任边界；下载器会固定已校验的公网 DNS 地址并在重定向后重新校验。
- 扫码 Cookie 失效后需要重新执行 `qzone.login`；手动 Cookie 到期后需要重新配置。
- 内存仓库会在插件重载后清空，生产环境建议安装数据库插件。
