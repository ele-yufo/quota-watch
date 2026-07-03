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

## 小组件（主屏 + 锁屏 / 灵动岛）

`QuotaWatchWidgets` 这个 WidgetKit extension target 提供三类小组件：

- **配额 · 单窗口**（主屏小号）：一个大号环形表盘显示「最紧张窗口」的已用%，
  下面是渠道名 + 窗口徽标（5h/7d）+ reset 倒计时。**长按可指定盯某个渠道**
  （AppIntent 配置），留空则自动盯全局最紧张的。
- **配额 · 概览**（主屏中号）：每个渠道最紧张的窗口一览，按紧张度排序（最紧的在上）。
- **锁屏 / 灵动岛**（accessory）：圆形表盘（最紧张%）、矩形一行（渠道·窗口·%·reset）、
  inline 一行，锁屏与息屏常显、Smart Stack 可用。

取数策略：**网络优先 + 缓存兜底**——小组件的 TimelineProvider 用共享的主机/端口/Token
直接拉 `/quota`（配了公网隧道后任何网络都能取实时数据），拉不到就显示 app 上次写入
的缓存快照；每 ~20 分钟刷新一次（WidgetKit 预算内），app 每次刷新时也会主动
`reloadAllTimelines`。视觉复用 app 的 `RingGauge` / `ProviderBadge` / 配色。

> ⚠️ **需要付费 Apple Developer 账号**：小组件靠 **App Group**
> (`group.io.quotawatch.app`) 在 app 与 extension 间共享主机/端口/Token + 快照，
> App Group 能力需付费账号才能签名。生成工程后在 Xcode 的
> **Signing & Capabilities** 里给 `QuotaWatch` 和 `QuotaWatchWidgets` 两个 target
> 都确认勾上 App Group（entitlements 已在仓库里配好，选好 Team 即可）。

## 命令行构建（可选）

```bash
xcodegen generate --spec ios/project.yml
xcodebuild -project ios/QuotaWatch.xcodeproj -scheme QuotaWatch \
  -destination 'generic/platform=iOS Simulator' build
```

> 构建 asset catalog（actool）要求所用 **Xcode 版本与已安装的模拟器 runtime 匹配**。
> 若报 `No simulator runtime version ... available`，说明装了更高版本的模拟器
> runtime（如 iOS 27）却用了旧版 Xcode——用匹配的 Xcode 即可，例如
> `DEVELOPER_DIR=/path/to/Xcode-beta.app/Contents/Developer xcodebuild …`。

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
├── project.yml                 XcodeGen 工程定义（app + widget 两个 target）
├── QuotaWatch/                 主 app
│   ├── QuotaWatchApp.swift      App 入口（@main）
│   ├── AppModel.swift           连接设置 + 配额状态 + 10s 自动刷新 + 告警计数；刷新后写共享快照并 reload 小组件
│   ├── SharedStore.swift        App Group 桥接：app 写主机/端口/Token + 快照，widget 读（app 与 widget 共用）
│   ├── Models.swift             Codable 模型（WindowKind 带 unknown 容错）
│   ├── APIClient.swift          async/await URLSession 客户端（typed error）
│   ├── PairingPayload.swift     qw://pair 二维码解析 + 私网/公网判定
│   ├── QRScannerView.swift      VisionKit 扫码（DataScannerViewController）
│   ├── KeychainHelper.swift     Token 的 Keychain 读写
│   ├── Formatting.swift         倒计时 / 相对时间格式化
│   ├── RingGauge.swift          环形表盘（widget 传 animated:false 静态渲染）
│   ├── ProviderStyle.swift      品牌图标 + 配色（app 与 widget 共用）
│   ├── Theme.swift              设计系统：配色 / 品牌字体 / UsageLevel（app 与 widget 共用）
│   ├── QuotaListView.swift      主页列表（数字滚动 / 骨架屏 / 触感）
│   ├── SettingsView.swift       连接设置页（扫码 + 手动 + 公网警告）
│   ├── QuotaWatch.entitlements  App Group 能力
│   └── Info.plist               ATS 明文例外 + 相机/本地网络用途说明
└── QuotaWatchWidgets/          WidgetKit extension
    ├── QuotaWatchWidgetBundle.swift  @main，两个 widget 配置
    ├── QuotaWidgetViews.swift        各族视图（小号环形 / 中号概览 / accessory）
    ├── QuotaTimeline.swift           取数（网络优先+缓存兜底）+ entry + TimelineProvider
    ├── SelectProviderIntent.swift    AppIntent 配置：选渠道 / 留空=自动最紧张
    ├── QuotaWatchWidgets.entitlements App Group 能力
    └── Info.plist               WidgetKit extension point + 字体 + ATS 例外
```

> 共享文件（SharedStore / Models / APIClient / Formatting / RingGauge /
> ProviderStyle / Theme / DemoData）同时编入两个 target，见 `project.yml` 的
> `QuotaWatchWidgets.sources`。
