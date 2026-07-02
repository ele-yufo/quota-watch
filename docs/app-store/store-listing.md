# App Store 提交材料（草稿）

给 `ios/QuotaWatch`（bundle id `io.quotawatch.app`）用。文案可直接复制到 App
Store Connect，按需再润色。

## 基本信息

| 字段 | 值 |
|---|---|
| App Name（≤30 字符，App Store 全局唯一） | `quota·watch` 或 `quota watch` |
| Subtitle（≤30 字符） | `AI 订阅配额监控` / `Watch your AI quota` |
| Bundle ID | `io.quotawatch.app`（首次提交需在 Developer 门户注册该 App ID） |
| Primary Category | Developer Tools（开发工具）/ 备选 Utilities |
| Secondary Category | Utilities |
| Age Rating | 4+ |
| Price | Free |
| Privacy Policy URL | https://github.com/ele-yufo/quota-watch/blob/main/PRIVACY.md |
| Support URL | https://github.com/ele-yufo/quota-watch |
| Marketing URL（可选） | https://github.com/ele-yufo/quota-watch |

## Promotional Text（≤170 字符，可随时改，不需重新审核）

> 一屏盯住 Claude、Codex、GLM、Kimi 等所有 AI 订阅的配额用量与重置时间。连接你自己电脑上的 quota-watch，扫码即用。数据只在本地。

## Description（应用描述）

> quota·watch 让你随时掌握每个 AI 编程订阅还剩多少额度、多久重置——Claude Code、Codex、GLM、OpenCode Go、Kimi、Antigravity 等都能一屏看全。
>
> 它连接你自己电脑上运行的 quota-watch 采集程序（开源），通过局域网或你自建的隧道读取真实配额，数据从不经过任何云端。
>
> 功能：
> • 各渠道的 5h / 7d / 1mo 窗口用量，环形量表一目了然
> • 配额告急时置顶提醒，可一键清除
> • 约 10 秒近实时刷新
> • 扫码配对，连接零配置
> • 真实厂商图标、深色仪表界面、触感反馈
> • 内置「示例数据」模式，配置前先预览
>
> 需要先在你的 Mac/PC 上运行开源的 quota-watch daemon（见 GitHub）。凭据只留在你自己的设备上。
>
> 开源地址：https://github.com/ele-yufo/quota-watch

## Keywords（≤100 字符，逗号分隔，无空格）

> quota,AI,claude,codex,GLM,kimi,usage,token,monitor,dashboard,配额,用量,订阅

## What's New（本版更新，首版可写）

> 首个版本：多渠道 AI 配额监控、扫码配对、示例模式。

## App Privacy（隐私营养标签）

- Data Collection: **Data Not Collected**（不收集任何数据）
- 说明：app 不含账号/分析/追踪；凭据与配额数据只在用户自己设备与其自建 daemon 之间传输。

## App Review Notes（给审核员的备注 —— 关键，避免拒审）

> This app is a companion to a self-hosted, open-source daemon that the user runs
> on their own computer; it reads the user's own AI-subscription quota over their
> local network. Reviewers do not need to set anything up:
>
> **Tap "先看示例数据 / Preview sample data" on the first screen to see the full
> app running with built-in demo data — no server, no account, no network
> needed.**
>
> Source & docs: https://github.com/ele-yufo/quota-watch

## 需要的截图（App Store 规格）

至少提供 6.7"（或当前要求的最大 iPhone 尺寸）截图 1–10 张。建议：
1. 主屏（示例数据，环形量表）
2. 某渠道详情页
3. 告警横幅
4. 欢迎/引导页
5. 设置/扫码配对页

用 Demo 模式截图最干净（无真实账号信息）。命令：
`xcrun simctl io booted screenshot out.png`（模拟器需选对应机型尺寸）。

---

## 提交前检查清单（你要做的）

- [ ] 加入 **Apple Developer Program**（$99/年）—— 免费账号无法上架
- [ ] 在 developer.apple.com 注册 App ID `io.quotawatch.app`（Capabilities 无需特殊项）
- [ ] App Store Connect 新建 App，填上面元数据 + 隐私标签 + Review Notes
- [ ] Xcode：Product → Archive（Release，Distribution 签名）→ 上传到 App Store Connect
- [ ] 传 5+ 张截图（Demo 模式）
- [ ] 提交审核
