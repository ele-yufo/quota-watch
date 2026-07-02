# quota·watch — macOS 菜单栏

一个常驻菜单栏的小 app,读取本机 `~/.quota-watch/data.db`(由 daemon 写入),在菜单栏
显示所有渠道里**最紧张窗口的已用%**,点开是每渠道的进度条弹层。纯 Swift / SwiftUI,
无第三方依赖。

## 运行

```bash
cd mac
./build-app.sh --run     # 编译 + 打包 QuotaWatch.app + 启动
```

启动后看屏幕**右上角菜单栏**,会出现类似 `⚠ 100%` / `◐ 42%` 的项(图标 + 已用%,
颜色随紧张度:充足=默认，偏紧=橙，告急=红)。

> ⚠️ 不要直接跑 `.build/debug/QuotaWatchMenubar`——裸可执行文件没有 app bundle,
> `NSApplication` / 通知会崩溃。必须用 `build-app.sh` 打成 `.app` 再运行。

前提:先启动采集 daemon(`quota-watch daemon start`),菜单栏才有数据。

## 用法

- **菜单栏项**:最紧张窗口的已用%,一眼看有没有快用完的。
- **点开弹层**:按 provider 分组,每窗口一条进度条 + kind 徽标 + reset 倒计时;
  底部 `Refresh` / `Open web`(打开 http://localhost:3000)/ `Quit`。
- **通知(早报警,只报一次)**:某窗口剩余**首次跌破 20%** 时弹一条可执行的本地
  通知(建议切渠道 / 放慢 + 重置倒计时),之后本窗口周期内不再重复,直到窗口重置
  后才可能再次触发;启动时已处于低位的窗口不发(菜单栏颜色已反映)。
- 每 60 秒从 SQLite 刷新一次(daemon 负责真正的采集)。

## 开机自启

把 `mac/QuotaWatch.app` 拖进 **系统设置 → 通用 → 登录项**(或拖进 `/Applications`
后再加登录项)。

## 结构

```
mac/
├── Package.swift
├── build-app.sh                 编译 + 打包成 QuotaWatch.app
└── Sources/QuotaWatchMenubar/
    ├── QuotaWatchApp.swift       @main，MenuBarExtra + 菜单栏标签
    ├── MenuBarView.swift         弹层（按 provider 分组的进度条）
    ├── QuotaStore.swift          直读 ~/.quota-watch/data.db（SQLite）
    └── Notifier.swift            低配额本地通知
```
