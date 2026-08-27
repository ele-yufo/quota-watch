# quota-watch — 开机自启 + 公网代理（macOS）

把三个后台服务注册成 macOS **launchd 用户级 agent**(`~/Library/LaunchAgents/`),
登录即启动、崩溃自动拉起:

| Label | 作用 | 端口 |
|---|---|---|
| `io.quotawatch.daemon` | 采集 daemon + **HTTPS** API(iOS 配对/取数、web、菜单栏都读它) | `3737` |
| `io.quotawatch.web` | Next.js 仪表盘 | `3000` |
| `io.quotawatch.frpc` | frp 隧道,把上面两个映射到你的云服务器(公网访问) | — |

## TLS(自签 CA + 指纹 pin)

daemon 首次启动会在 `~/.quota-watch/certs/` 用系统 `/usr/bin/openssl` 生成:
本地 CA(EC P-256,10 年)+ 服务器证书(EC P-256,3 年)。API **只走 HTTPS**,
没有明文回退。

- 所有客户端(CLI / web / macOS 菜单栏 / iOS)都通过 **CA 指纹**信任这条链,
  不装 CA 到系统钥匙串
- 配对时 `/pair/start` 和 `/pair/claim` 把 CA 指纹带给 iPhone,QR 里也带
  `fp=` 参数——iPhone 从**第一个请求**起就 pin 证书,不存在首次信任窗口
- **轮换证书**:删掉 `~/.quota-watch/certs/` 后重启 daemon 会重新生成;
  已配对的 iPhone 会因指纹不匹配报「证书已更换,请重新配对」,重新扫码即可

## 安装

前提:已 `pnpm install` 且 `pnpm --filter @quota-watch/cli build`、
`pnpm --filter @quota-watch/web build`(daemon-worker 和 `.next` 产物存在)。

```bash
./deploy/mac/install-services.sh
```

- 幂等,可反复跑;会先停掉手动起的 daemon/web,再交给 launchd 接管
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

`frpc.toml` 默认映射 `3737`(必需,iOS 配对)和 `3000`(可选,web;不想公开就删掉
那个 `[[proxies]]` 块——web 无鉴权,暴露即等于公开你的配额视图)。

> **注意**:`~/.quota-watch/frpc.toml` 含 frps token,**不入 git**(仓库里只有
> `.example` 占位)。frpc↔frps 这一跳在 frp 0.52+ 默认 TLS 加密;手机→frps
> 的公网那一跳也已是 TLS(daemon 全链路 HTTPS + CA 指纹 pin),Bearer token
> 仍作为第二道访问控制。

## 配对 iOS(公网)

frpc 起来后,用**云服务器的公网地址**生成配对二维码:

```bash
node packages/cli/dist/index.js connect --qr --host <你的云服务器域名或IP>
# Host=<云服务器地址>  Port=3737  Code=<6 位配对码>(QR 里带 CA 指纹)
```

手机端 App「扫码配对」即可通过公网读取配额。Token 不再出现在配对输出里——
CLI 通过 `/pair/start` 拿 6 位短码,手机用短码换 token。

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
