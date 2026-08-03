# koishi-plugin-qzone

使用 TypeScript 编写的 Koishi QQ 空间插件。核心逻辑来自对
`astrbot_plugin_qzone` 的重新设计，不依赖 Python 运行时。

## 已实现

- 读取好友动态和指定 QQ 的说说
- 获取说说详情与评论
- 发布、删除、点赞、评论、回复
- 查询最近访客
- Koishi Database 持久化，未安装数据库插件时使用内存仓库
- Cron 自动评论、点赞和发布，默认全部关闭
- OneBot、OneBot HTTP、手动 Cookie 三种认证适配器
- Cookie TTL 刷新和登录失效重试
- JSON、JSONP、JSON5 与好友动态 HTML 解析
- 发布图片的域名白名单、私网地址拦截、重定向检查和大小限制

暂未移植 AstrBot 版本的 LLM 生成、表白墙、图片卡片渲染和 Dashboard。

## 环境

- Node.js 18 或更高版本
- Koishi 4.18+
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
Action，插件会继续尝试 OneBot HTTP 和手动 Cookie。

## 安装

在 Koishi 工作区安装本地插件：

```bash
npm install /path/to/koishi-plugin-qzone
```

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
manualCookie: ''
```

顺序为：

1. Koishi 机器人上的 `bot.internal.getCookies()`
2. 配置了地址时调用 OneBot HTTP `get_cookies`
3. 配置了 Cookie 时使用独立 Qzone Cookie 适配器

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
├── adapters/       # OneBot、HTTP、手动 Cookie
├── qzone/          # 会话、HTTP、API、解析、图片边界
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
- 手动 Cookie 到期后需要重新配置。
- 内存仓库会在插件重载后清空，生产环境建议安装数据库插件。
