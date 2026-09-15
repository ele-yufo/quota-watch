# quota-watch — 开机自启 + 公网代理（macOS）

把后台服务注册成 macOS **launchd 用户级 agent**(`~/Library/LaunchAgents/`),
登录即启动、崩溃自动拉起:

| Label | 作用 | 端口 |
|---|---|---|
| `io.quotawatch.daemon` | 采集 daemon + **HTTPS** API(web 仪表盘、远程 MCP 客户端都读它) | `3737` |
| `io.quotawatch.web` | Next.js 仪表盘 | `3000` |
| `io.quotawatch.frpc` | frp 隧道,把上面两个映射到你的云服务器(公网访问) | — |

## TLS(自签 CA + 指纹 pin)

daemon 首次启动会在 `~/.quota-watch/certs/` 用系统 `/usr/bin/openssl` 生成:
本地 CA(EC P-256,10 年)+ 服务器证书(EC P-256,3 年)。API **只走 HTTPS**,
没有明文回退。

- 客户端(CLI / web / 远程 MCP)通过 **CA 指纹**信任这条链,不装 CA 到系统钥匙串
- 远程机器手工分发 CA:`scp mac:~/.quota-watch/certs/ca.crt` 后用
  `NODE_EXTRA_CA_CERTS` 指过去(见根 README 的 Remote machines 段)
- **轮换证书**:删掉 `~/.quota-watch/certs/` 后重启 daemon 会重新生成;
  远程客户端重新拷贝 `ca.crt` 即可

## 安装

CLI 与 daemon 启动时优先使用 `HTTP_PROXY` / `HTTPS_PROXY`（含小写）环境变量；未设置时读取 macOS 已启用的 HTTP/HTTPS 系统代理。代理模式需要 Node 24.14+ 或 25.4+，使用 Node 原生代理支持，不关闭 TLS 校验。本机回环地址始终直连；额外绕过地址可用 `NO_PROXY` 设置。系统代理改动后需重启 daemon 才生效；不支持 PAC / 仅 SOCKS 配置。

前提:已 `pnpm install` 且 `pnpm --filter @quota-watch/cli build`、
`pnpm --filter @quota-watch/web build`(daemon-worker 和 `.next` 产物存在)。

```bash
./deploy/mac/install-services.sh
```

- 幂等,可反复跑;会先停掉手动起的 daemon/web,再交给 launchd 接管
- 存在 `frpc.toml` 时:自动签发 `api.token`(隧道会让公网流量看似回环,
  无 token 等于公网裸奔),并从 `serverAddr` 推导证书 SAN(IP: 或 DNS:,
  可用 `CERT_EXTRA_SANS` 环境变量覆盖;改 SAN 需删 `certs/server.{crt,key}`
  后重启 daemon 才生效)
- 会自检 `node` 能否加载 `better-sqlite3`(ABI 必须匹配);不匹配时用
  `NODE_BIN=/path/to/node ./deploy/mac/install-services.sh` 指定正确的 node
- 装完自动 `curl` 验证 `:3737/health` 和 `:3000`
- `frpc` 部分**只有存在 `~/.quota-watch/frpc.toml` 时才装**(见下)

## 公网代理(frpc → 云服务器)

前提:你的云服务器上已跑着 **frps**(`serverPort`/`auth.token` 已知)。本机已
`brew install frpc`。

```bash
cp deploy/mac/frpc.toml.example ~/.quota-watch/frpc.toml
$EDITOR ~/.quota-watch/frpc.toml     # 填 serverAddr / serverPort / auth.token
chmod 600 ~/.quota-watch/frpc.toml   # 内含密钥
./deploy/mac/install-services.sh     # 这次会把 frpc agent 一起装上
```

`frpc.toml` 默认映射 `3737`(daemon API / 远程 MCP)和 `3000`(可选,web;不想
公开就删掉那个 `[[proxies]]` 块)。

## Web 登录会话

web 有自己的应用层认证(2026-09-15 起,取代 ECS 侧 Basic Auth 门禁):首次访问
跳 `/login`,输入访问口令后种一枚 **30 天 HttpOnly 签名 cookie**,之后刷新、
重开浏览器都不再要认证。口令即 `~/.quota-watch/config.json` 的 `api.token`
(可用环境变量 `QW_SESSION_SECRET` 单独覆盖;config 无 token 的环回部署则完全
免认证,与 daemon 的模型一致)。所有页面与 `/api/*` 都被会话守卫——包括 frp
侧门直连 `:3000` 的路径,`/login`、`/api/auth/login|logout` 除外。

> **注意**:`~/.quota-watch/frpc.toml` 含 frps token,**不入 git**(仓库里只有
> `.example` 占位)。frpc↔frps 这一跳在 frp 0.52+ 默认 TLS 加密;客户端→frps
> 的公网那一跳也已是 TLS(daemon 全链路 HTTPS),Bearer token 仍作为第二道
> 访问控制。

## 远程 MCP(公网)

frpc 起来后,远程机器的 agent harness 通过云服务器地址访问 `/mcp`:

```bash
mkdir -p ~/.quota-watch && scp mac:~/.quota-watch/certs/ca.crt ~/.quota-watch/
echo 'export NODE_EXTRA_CA_CERTS="$HOME/.quota-watch/ca.crt"' >> ~/.shell_env
claude mcp add quota-watch --transport http https://<公网地址>:3737/mcp \
  --header "Authorization: Bearer <api token from ~/.quota-watch/config.json>"
```

## 管理

```bash
launchctl list | grep quotawatch                       # 看状态(PID / 上次退出码)
launchctl kickstart -k gui/$(id -u)/io.quotawatch.daemon   # 重启 daemon
launchctl bootout   gui/$(id -u)/io.quotawatch.web         # 停 web
tail -f ~/.quota-watch/daemon.log                      # 应用日志(自动轮转 10MB×3)
tail -f ~/.quota-watch/daemon.stderr.log               # launchd 级启动错误
```

健康检查(严格校验自签 CA):

```bash
curl --cacert ~/.quota-watch/certs/ca.crt \
  -H "Authorization: Bearer <config.json 里的 api.token>" \
  https://127.0.0.1:3737/health
```

## 卸载

```bash
./deploy/mac/uninstall-services.sh   # 停服务 + 删 plist；~/.quota-watch 数据保留
```

## 文件说明

```
deploy/mac/
├── install-services.sh              渲染模板 → 安装 + 加载 + 验证(幂等)
├── uninstall-services.sh            停服务 + 删 plist
├── io.quotawatch.daemon.plist.tmpl  daemon agent 模板(__占位符__)
├── io.quotawatch.web.plist.tmpl     web agent 模板
├── io.quotawatch.frpc.plist.tmpl    frpc agent 模板
└── frpc.toml.example                frpc 配置样例(占位,复制到 ~/.quota-watch)
```
