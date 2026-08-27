# quota-watch Android

iOS 版（SwiftUI + WidgetKit）的 Android 移植：Jetpack Compose + Glance 小组件，
连接同一台 Mac 上的 quota-watch daemon（HTTPS + 本地 CA 指纹钉扎）。

## 构建与安装

```bash
# 依赖：JDK 17、Android SDK（cmdline-tools + platform-tools + platforms;android-34）
cd android
./gradlew :app:assembleDebug          # 产出 app/build/outputs/apk/debug/app-debug.apk
./gradlew :app:testDebugUnitTest      # JVM 单元测试（含真 TLS 钉扎测试）
adb install -r app/build/outputs/apk/debug/app-debug.apk
```

`sdk.dir` 写在 `local.properties`（已 gitignore），缺省时读 `ANDROID_HOME`。

## 配对

1. Mac 上 daemon 已启动（`quota-watch daemon start --lan`）。
2. Mac 菜单栏 quota-watch →「配对」（或 `quota-watch connect`）拿到二维码 /
   6 位配对码 + 64 位证书指纹。
3. App 内扫码，或「手动配对」填 主机 / 端口 / 配对码 / 证书指纹。

与 iOS 的差异：**手动配对必须填证书指纹**。daemon 只讲 HTTPS，iOS 的
「无指纹走 http 明文降级」路径在 Android 版不存在（那条路在新架构下本来
也不可能工作）。

## 架构对应

| iOS | Android |
|---|---|
| AppModel | `ui/QuotaViewModel.kt`（10s + 0–3s 抖动、前台才刷新、冷启动 3×2s 快重试） |
| SharedStore（App Group） | `data/SharedStore.kt`（SharedPreferences，同 key） |
| APIClient + PinningDelegate | `net/ApiClient.kt` + `net/PinnedHttpClients.kt`（钉 CA 根证书 DER 的 SHA-256） |
| PairingPayload.swift | `net/PairingPayload.kt`（`qw://pair`，6 位码保前导零） |
| QuotaListView / ProviderDetailView / SettingsView / PairingSheetView | `ui/*Screen.kt`（同一套文案与版面） |
| RingGauge / ProviderBadge / Hairline | `ui/components/*`（270° 开口环，同几何） |
| WidgetKit 小组件 | `widget/Widgets.kt`（Glance；Fraunces 数字与环形用 `WidgetBitmaps` 预渲染——RemoteViews 加载不了 res/font） |
| WidgetCenter.reloadAllTimelines | `widget/QuotaWidgetWorker.kt`（20 分钟 WorkManager；App 内刷新后 `updateAll`） |
| 锁屏小组件 | **未移植**（Android 无对应物） |

## 行为约定（与 iOS 一致）

- 只 HTTPS；证书指纹 = 本地 CA 根证书 DER 的 SHA-256，64 位小写十六进制。
- 告警：剩余 <10% 的窗口置顶 + 顶部告警条，消除后新窗口告急会再次出现。
- 离线：保留内存数据 + SharedPreferences 快照兜底，标「离线 · X 前缓存」，
  小组件快照 >20 分钟标离线。
- Demo 数据只在 App 内预览，不写入小组件缓存。
