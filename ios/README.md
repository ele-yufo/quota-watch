# quota-watch iOS

一个 SwiftUI iOS app，通过**局域网或公网**连接 Mac 上运行的 quota-watch daemon，
读取各家 AI 订阅的配额并展示。零第三方依赖，iOS 17+。

## 它做什么

- **扫码配对**：扫描 `quota-watch connect --qr` 生成的二维码，自动填入主机/端口/Token；
  也可手动填。设置页一键「测试连接」（调 `/health`）
- 主页按 provider 分组展示每个配额窗口：窗口类型徽标（5h / 24h / 7d / 1mo）、
  已用百分比、进度条（≥30% 主色 / 10–30% 橙 / <10% 红）、reset 倒计时
- **精致化**：已用% 数字滚动动画、进度条弹性过渡、刷新图标旋转、首屏骨架屏；
  触感反馈（扫码/测试成功、失败、下拉刷新、新窗口跌入告警区）
- **公网/局域网**：填公网地址时警告明文 Token 传输风险，推荐用隧道
- 进入前台/出现时立即拉取，之后每 10 秒自动刷新，支持下拉「立即采集」（走 daemon `/poll`）
- Token 存 Keychain，主机/端口存 UserDefaults

## 先决条件

- 一台装了 [Xcode](https://developer.apple.com/xcode/)（不是 Command Line Tools）的 Mac
- [XcodeGen](https://github.com/yonaskolb/XcodeGen)：`brew install xcodegen`
- Mac 与 iPhone 在**同一局域网**

## Mac 端：启动 daemon 并开放局域网

```bash
# 在 quota-watch 仓库根目录
pnpm build

# 以 LAN 模式启动（绑定 0.0.0.0 + 自动生成 API Token）
node packages/cli/dist/index.js daemon start --lan

# 查看配对信息（主机 IP / 端口 / Token）
node packages/cli/dist/index.js connect
```

`connect` 会打印类似：

```
Host  192.168.1.23    Port  3737
Token 3f9a…（32 位十六进制）
```

> 已全局安装 `@quota-watch/cli` 的话，直接用 `quota-watch daemon start --lan` /
> `quota-watch connect`。

## iOS 端：生成工程并运行

```bash
cd ios
xcodegen generate            # 由 project.yml 生成 QuotaWatch.xcodeproj
open QuotaWatch.xcodeproj
```

在 Xcode 里：

1. 选中 `QuotaWatch` target → **Signing & Capabilities** 设置你的 Apple 开发者 Team
   （或在 `project.yml` 里填 `DEVELOPMENT_TEAM`）。
2. 选真机或模拟器，⌘R 运行。
   - **真机**推荐：手机和 Mac 同网，才能连到 `192.168.x.x`。扫码需要相机（真机才有）。
   - 模拟器只能连 Mac 自身，主机填 `127.0.0.1` 即可（同机回环免 Token）；模拟器无相机，用手动填。
3. app 里进「设置」→「扫码配对」扫 `quota-watch connect --qr` 的二维码（或手动填主机/端口/Token），
   点「测试连接」，成功后返回主页。

## 公网连接

一期也支持公网访问（用户自行解决公网可达：端口转发或隧道）：

```bash
# 用公网 IP/域名生成配对二维码
quota-watch connect --qr --host <公网IP或域名>
```

app 检测到非内网地址时会警告「明文 HTTP 会暴露 Token」，**强烈建议用隧道**
（Tailscale / Cloudflare Tunnel / WireGuard）而不是把端口裸露到公网。

## 命令行构建（可选）

```bash
xcodegen generate --spec ios/project.yml
xcodebuild -project ios/QuotaWatch.xcodeproj -scheme QuotaWatch \
  -destination 'generic/platform=iOS Simulator' build
```

## 与 daemon 的 API 契约

| 端点 | 用途 |
|---|---|
| `GET /health` | 测试连接，返回 provider 数量与 daemon 运行时长 |
| `GET /quota` | 每 provider×window 的最新快照（已按窗口 kind 排序） |
| `POST /poll` | 立即触发一次全 provider 采集 |

非回环访问需带 `Authorization: Bearer <token>`；回环（模拟器/本机）免 Token。

## 网络安全说明

daemon 服务明文 HTTP，用户可能经 LAN IP / 隧道（Tailscale 的 100.64/10 / WireGuard）/
公网访问——这些不都在 `NSAllowsLocalNetworking` 的私网范围内，因此 Info.plist 用
`NSAllowsArbitraryLoads=true` 放开明文。app 自身在非私网地址时警告并推荐隧道。
二期计划改 TLS 或签名配对通道，届时可收紧该例外。

## 目录结构

```
ios/
├── project.yml                 XcodeGen 工程定义
└── QuotaWatch/
    ├── QuotaWatchApp.swift      App 入口（@main）
    ├── AppModel.swift           连接设置 + 配额状态 + 10s 自动刷新 + 告警计数（@Observable）
    ├── Models.swift             Codable 模型（WindowKind 带 unknown 容错）
    ├── APIClient.swift          async/await URLSession 客户端（typed error）
    ├── PairingPayload.swift     qw://pair 二维码解析 + 私网/公网判定
    ├── QRScannerView.swift      VisionKit 扫码（DataScannerViewController）
    ├── KeychainHelper.swift     Token 的 Keychain 读写
    ├── Formatting.swift         倒计时 / 相对时间格式化
    ├── QuotaListView.swift      主页列表（数字滚动 / 骨架屏 / 触感）
    ├── SettingsView.swift       连接设置页（扫码 + 手动 + 公网警告）
    └── Info.plist               ATS 明文例外 + 相机/本地网络用途说明
```
