# koishi-plugin-qzone

> 测试中，不推荐用于重要账号。QQ 空间接口并非稳定的公开业务 API。

面向 Koishi 与 ChatLuna 的 QQ 空间插件，使用 TypeScript 实现，不依赖 Python
运行时。插件支持从指定 OneBot 机器人自动获取 Cookie，也可以使用内置二维码
登录，提供查询、点赞、评论、回复、发布、删除和最近访客等能力。

## 功能

- 从指定 OneBot 机器人获取 Cookie，并按固定 TTL 自动刷新
- 使用手机 QQ 扫码登录，凭据自动保存并可作为备用认证
- 查询好友动态和指定 QQ 的说说
- 获取说说详情与评论
- 点赞、评论、回复、发布和删除说说
- 查询最近访客
- 向 ChatLuna 注册 9 个原生工具
- 支持 Koishi Database；未安装数据库插件时使用内存仓库
- 图片域名白名单、私网地址拦截、重定向检查和大小限制

插件不包含独立 OneBot HTTP、手动 Cookie 或定时发布/评论功能。

## 环境

- Node.js 18 或更高版本
- Koishi 4.18+
- `koishi-plugin-chatluna` 1.3.36+ 或 1.4 alpha
- 使用 OneBot 时需要 `@koishijs/plugin-adapter-onebot`，建议 6.0.2+
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

配置面板包含认证方式、指定的 OneBot QQ 号和权限等级：

```yaml
plugins:
  qzone:
    authMode: auto
    onebotSelfId: '123456789'
    commandAuthority: 1
    adminAuthority: 3
```

| 配置 | 默认值 | 说明 |
| --- | --- | --- |
| `authMode` | `auto` | `auto`、`onebot` 或 `qrcode` |
| `onebotSelfId` | 无 | `auto`、`onebot` 模式必填，只允许纯数字 QQ 号 |
| `commandAuthority` | `1` | 查询、点赞、评论命令与 ChatLuna 工具权限 |
| `adminAuthority` | `3` | 扫码登录、发布和删除命令与 ChatLuna 工具权限 |

其余参数使用插件内部默认值，不显示在 Koishi 配置面板：

- 扫码凭据：`data/qzone/credentials.json`
- OneBot Cookie 刷新 TTL：10 分钟
- 二维码登录超时：120 秒
- 二维码轮询间隔：2 秒
- 请求超时：10 秒
- 默认动态数量：5 条
- 单次最多发布 9 张图片，每张最多 8 MiB
- 图片域名：`*.qpic.cn`、`*.qlogo.cn`、`*.qq.com`、`*.gtimg.cn`

从 `0.0.3` 升级时，必须填写 `onebotSelfId`，或者将 `authMode` 明确设置为
`qrcode`。插件不会在 QQ 号为空时选择任意在线机器人。

## 认证方式

### 自动模式

`auto` 优先调用指定机器人的 `bot.internal.getCookies()`；OneBot 不在线、未实现
`get_cookies` 或没有返回 Cookie 时，使用已保存的二维码凭据。

```yaml
authMode: auto
onebotSelfId: '123456789'
```

插件每 10 分钟在下一次请求前从 OneBot 重新获取 Cookie。遇到 HTTP `401`、
Qzone `code=-3000` 或图片接口 `ret=-100` 时会立即刷新并重试；连续失效时，
`auto` 模式会尝试二维码备用凭据。

### 仅 OneBot

```yaml
authMode: onebot
onebotSelfId: '123456789'
```

该模式不回退二维码。正向和反向 Universal WebSocket 都受支持，连接地址和 Token
由 Koishi OneBot 适配器管理，本插件不重复配置。

### 仅二维码

```yaml
authMode: qrcode
```

管理员与机器人私聊并执行：

```text
qzone.login
```

插件会发送 QQ 登录二维码。手机 QQ 确认后，凭据保存到 Koishi 工作目录下的
`data/qzone/credentials.json`，后续启动会自动读取。

```text
qzone.login --cancel    # 取消当前扫码
qzone.logout           # 清除已保存的扫码凭据
```

二维码只允许在私聊中发送。凭据文件包含 QQ 登录 Cookie，应限制访问并谨慎备份。
扫码 Cookie 失效后，执行 `qzone.logout`，再重新执行 `qzone.login`。在 `auto`
模式中，扫码凭据仅作为 OneBot 不可用或连续登录失效时的备用认证。

## 命令

| 命令 | 中文别名 | 权限 | 说明 |
| --- | --- | --- | --- |
| `qzone.status` | `空间状态` | 普通 | 查看当前登录账号 |
| `qzone.login` | `扫码登录空间` | 管理员 | 私聊扫码并保存凭据 |
| `qzone.logout` | `退出空间登录` | 管理员 | 清除扫码凭据 |
| `qzone.feed [范围]` | `看说说` | 普通 | 查看好友动态 |
| `qzone.like [引用]` | `赞说说` | 普通 | 点赞动态 |
| `qzone.comment <引用> <内容>` | `评论说说` | 普通 | 评论动态 |
| `qzone.reply <引用> <评论序号> <内容>` | `回复评论` | 普通 | 回复评论 |
| `qzone.publish <内容>` | `发说说` | 管理员 | 发布说说 |
| `qzone.delete <引用>` | `删说说` | 管理员 | 删除自己的说说 |
| `qzone.visitors` | `查看访客` | 管理员 | 查看最近访客 |

已移除与二维码登录重复的 `qzone.refresh`，每个操作只保留一个中文别名。

动态范围从 `0` 开始：

```text
看说说
看说说 0
看说说 2~5
看说说 -u 12345678 0
```

点赞、评论等命令中的纯数字引用表示最近一次查询结果的序号；持久化编号使用
`#12`，远端引用使用 `12345678:tid`。

## ChatLuna 工具

| 工具 | 权限 | 作用 |
| --- | --- | --- |
| `qzone_status` | 普通 | 查看登录账号，不返回 Cookie |
| `qzone_feed` | 普通 | 查询好友动态或指定 QQ 的说说 |
| `qzone_post` | 普通 | 读取已经保存的单条动态 |
| `qzone_like` | 普通 | 点赞动态 |
| `qzone_comment` | 普通 | 评论动态 |
| `qzone_reply` | 普通 | 回复评论 |
| `qzone_publish` | 管理员 | 发布文字或图片说说 |
| `qzone_delete` | 管理员 | 删除自己的说说，要求 `confirm: true` |
| `qzone_visitors` | 管理员 | 查询最近访客 |

工具会在选择和执行时分别检查权限。动态、评论和访客内容会标记为外部不可信
数据，并限制字段长度、评论数量和总返回体积；上游异常不会把 Cookie 或 Token
原文返回给模型。

## 目录

```text
src/
├── adapters/           # OneBot、自动回退、二维码登录与凭据保存
├── qzone/              # 会话、HTTP、API、解析和图片安全边界
├── chatluna.ts         # ChatLuna StructuredTool 注册
├── config.ts           # 认证与权限 Schema
├── defaults.ts         # 内部固定参数
├── repository.ts       # Database/内存仓库
├── service.ts          # 业务服务
└── index.ts            # Koishi 插件入口和命令
```

## 来源与许可

本项目是 [Zhalslar/astrbot_plugin_qzone](https://github.com/Zhalslar/astrbot_plugin_qzone)
的 TypeScript/Koishi 重写版本，使用 `GPL-3.0-only` 发布，详细条款见
[LICENSE](./LICENSE)。

## 已知限制

- QQ 空间接口发生变化后，可能需要同步调整请求参数或解析器。
- 图片发布只接受内置 QQ CDN 域名。
- OneBot 后端必须实现 `get_cookies` 或 `get_credentials` Action。
- 内存仓库会在插件重载后清空，生产环境建议安装数据库插件。
- 扫码凭据失效后需要重新登录。
