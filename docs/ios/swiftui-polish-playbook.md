# quota-watch iOS 精致化调研（Playbook）

调研对象：`/Users/yufo/Projects/quota-watch/ios`（SwiftUI, iOS 17+ 部署目标）。
现状代码基础（引用于下文各主题）：`QuotaWatch/AppModel.swift`（`@Observable` + Keychain + 10s 轮询）、
`QuotaWatch/QuotaListView.swift`（`List` + `.refreshable` + `ContentUnavailableView` + scenePhase 驱动的自动刷新）、
`QuotaWatch/SettingsView.swift`（`Form` + `@Bindable` + 测试连接状态机）。

调研方式：WebSearch/WebFetch，优先 developer.apple.com 官方文档 / WWDC 23-24 session，其次高质量社区文章（Hacking with Swift、Swift by Sundell、Sarunw、Fatbobman、Donny Wals、useyourloaf、createwithswift 等）。所有 API 名称/签名均逐条核实，不确定处已在正文标注。

---

## 目录

1. [触感反馈 Haptics](#1-触感反馈-haptics)
2. [QR 扫码配对](#2-qr-扫码配对)
3. [网络可达性 / 私网 IP 判断](#3-网络可达性--私网-ip-判断)
4. [动效与过渡](#4-动效与过渡)
5. [下拉刷新与加载态](#5-下拉刷新与加载态)
6. [视觉精致度](#6-视觉精致度)
7. [App 结构与状态](#7-app-结构与状态)
8. [Widget / Live Activity](#8-widget--live-activity)
9. [性价比排序 Top 3](#9-性价比排序-top-3)

---

## 1. 触感反馈 Haptics

**结论：** iOS 17 的 `.sensoryFeedback` 家族共 4 个重载：`sensoryFeedback(_:trigger:)`、`sensoryFeedback(_:trigger:condition:)`、以及两个闭包变体 `sensoryFeedback(trigger:_:)`（一个固定返回值，一个接收 `(oldValue, newValue)` 返回 `SensoryFeedback?`）。四者都要求 `trigger: T where T: Equatable`——这是设计上的硬约束，只在 trigger 值**变化的瞬间**触发一次，不适合连续手势。

`SensoryFeedback` 无 `.path` case，正确名字是 `.pathComplete`；`.impact` 是无参数 `static let`，另有 `.impact(weight:intensity:)`、`.impact(flexibility:intensity:)` 两个工厂方法。**`.increase`/`.decrease` 官方文档明确写"仅在 watchOS/visionOS 播放"，`.selection`/`.impact` 仅在 iOS/watchOS 播放**——iPhone-only app 选错 case 不报错但静默无效，这是最容易踩的坑。

对应本 app 5 个触发点的具体建议：
1. 下拉刷新完成 → `.success`，trigger 用 `isPolling`，用 `condition:`/闭包过滤只在 `true→false` 沿触发（避免"开始刷新"也误触发）
2. 配额窗口"新出现" warn/low → 用派生的 `worstLevel`（需 Equatable + `severity: Int`）做 trigger，闭包里判断"变严重才反馈"，`.warn`→`.warning`、`.low`→`.error`，好转/不变返回 `nil`（避免掩盖"更严重"与"没那么严重"的差异）
3. 测试连接成功 → `.success`
4. 测试连接失败 → `.error`（不是 `.warning`，语义上 error 才对应"失败"）
5. Tab 切换 → **不建议加**。SwiftUI `TabView` 默认不自带切换触觉；Apple HIG（Playing Haptics）核心原则是避免过度使用稀释重要反馈的价值，2 个 tab 的低频导航属于"为了加而加"

旧的命令式 `UIImpactFeedbackGenerator`/`UINotificationFeedbackGenerator`/`UISelectionFeedbackGenerator` 仍有价值的场景：绑定**连续手势**、无法自然落到离散 Equatable 状态变化上的反馈（如自定义拖拽排序中每移动 N pt 触发一次的"棘轮感"，或需要 `.prepare()` 预热降低首触延迟的场景）——`sensoryFeedback` 做不到逐帧/连续调用。本 app 目前没有这类交互，全部用 `.sensoryFeedback` 即可。

**代码：**
```swift
enum UsageLevel: Equatable, Comparable {
    case ok, warn, low
    var severity: Int { switch self { case .ok: 0; case .warn: 1; case .low: 2 } }
    static func < (lhs: UsageLevel, rhs: UsageLevel) -> Bool { lhs.severity < rhs.severity }
}

struct QuotaListView: View {
    @Environment(AppModel.self) private var model
    private var worstLevel: UsageLevel { model.providers.flatMap(\.windows).map { UsageLevel(remainingPct: $0.remainingPct) }.max() ?? .ok }

    var body: some View {
        List { /* ... */ }
        .refreshable { await model.pollNow() }
        // 下拉刷新完成才反馈，不是"开始刷新"也反馈
        .sensoryFeedback(.success, trigger: model.isPolling) { old, new in old == true && new == false }
        // 只在"变严重"时反馈；low 用 error 和 warn 拉开差异
        .sensoryFeedback(trigger: worstLevel) { old, new in
            guard new.severity > old.severity else { return nil }
            return new == .low ? .error : .warning
        }
    }
}

// SettingsView.swift
.sensoryFeedback(trigger: testState) { _, new in
    switch new {
    case .success: .success
    case .failure: .error
    case .idle, .testing: nil
    }
}
```

**iOS 版本：** `SensoryFeedback` 及全部 4 个 modifier 重载最低 **iOS 17.0**（对应 macOS 14 / watchOS 10 / tvOS 17）。项目部署目标 iOS 17+ 完全覆盖，无需 `@available` 判断。

**注意事项：**
- Simulator 不产生真实触觉（硬件限制），必须真机验证。
- `.increase`/`.decrease` 只在 watchOS/visionOS 有效，`.selection`/`.impact` 只在 iOS/watchOS 有效，本 app 只用后者相关的 `.success`/`.warning`/`.error`/`.impact` 系列。
- 系统「设置 → 声音与触感 → 系统触感」是全局总闸，用户关闭后 `sensoryFeedback` 自动静默，无需也无法在代码里绕过。
- HIG 三原则：causality（对应真实事件）、harmony（与视觉/听觉一致）、utility（真的有用）——这是不给 tab 切换加触觉的依据。

---

## 2. QR 扫码配对

**结论：** 推荐 **`VisionKit.DataScannerViewController`**（iOS 16+）而非 `AVCaptureMetadataOutput`，用于"设置页点一个按钮、扫一次配对二维码、扫到即关闭"这种一次性场景。理由：
- 代码量显著更少，取景框/对焦引导/识别高亮全部系统提供，天然贴合 HIG 一致性
- `DataScannerViewController.isSupported`（约需 A12 Bionic/Neural Engine 起步）在本项目场景下几乎恒真——凡是能装 iOS 17 app 的机型硬件上都为 true
- 唯一代价：不支持 Simulator（须真机联调），拿不到自定义品牌化取景 UI——对一次性入口都不是硬伤

若未来需要自定义扫描界面外观、或需要在 Simulator 里跑自动化测试，`AVCaptureSession + AVCaptureMetadataOutput`（`AVMetadataObject.ObjectType.qr`）是备选，但要自己搭 `AVCaptureVideoPreviewLayer`、手写取景框，工作量明显更大。**两条路径在 Simulator 摄像头缺失这点上其实半斤八两**——`AVCaptureDevice.default(for: .video)` 在 Simulator 上也返回 nil，测不出真实扫码效果。

**代码：**
```swift
import SwiftUI
import VisionKit

struct PairingPayload: Equatable { let host: String; let port: Int; let token: String }

enum PairingQRError: LocalizedError, Equatable {
    case deviceUnsupported, unrecognizedFormat, missingField(String), invalidPort
    var errorDescription: String? {
        switch self {
        case .deviceUnsupported: "此设备不支持扫码，请手动输入"
        case .unrecognizedFormat: "这不是有效的配对二维码"
        case .missingField(let name): "二维码缺少字段：\(name)"
        case .invalidPort: "二维码中的端口号无效"
        }
    }
}

enum PairingQRParser {
    /// 解析 "qw://pair?host=192.168.1.10&port=3737&token=abc123"
    static func parse(_ raw: String) throws -> PairingPayload {
        guard let components = URLComponents(string: raw),
              components.scheme == "qw", components.host == "pair" else {
            throw PairingQRError.unrecognizedFormat
        }
        let items = components.queryItems ?? []
        func field(_ name: String) throws -> String {
            guard let value = items.first(where: { $0.name == name })?.value, !value.isEmpty else {
                throw PairingQRError.missingField(name)
            }
            return value
        }
        let host = try field("host")
        guard let port = Int(try field("port")), (1...65535).contains(port) else { throw PairingQRError.invalidPort }
        return PairingPayload(host: host, port: port, token: try field("token"))
    }
}

struct QRPairingScannerView: UIViewControllerRepresentable {
    var onScan: (String) -> Void

    func makeUIViewController(context: Context) -> DataScannerViewController {
        let controller = DataScannerViewController(
            recognizedDataTypes: [.barcode(symbologies: [.qr])],
            qualityLevel: .balanced,
            recognizesMultipleItems: false,
            isHighFrameRateTrackingEnabled: false,
            isPinchToZoomEnabled: false,
            isGuidanceEnabled: true,
            isHighlightingEnabled: true
        )
        controller.delegate = context.coordinator
        return controller
    }

    func updateUIViewController(_ controller: DataScannerViewController, context: Context) {
        guard !context.coordinator.isScanning else { return }
        context.coordinator.isScanning = true
        try? controller.startScanning()
    }

    static func dismantleUIViewController(_ controller: DataScannerViewController, coordinator: Coordinator) {
        controller.stopScanning()
    }

    func makeCoordinator() -> Coordinator { Coordinator(onScan: onScan) }

    final class Coordinator: NSObject, DataScannerViewControllerDelegate {
        var isScanning = false
        private var didDeliver = false
        let onScan: (String) -> Void
        init(onScan: @escaping (String) -> Void) { self.onScan = onScan }

        func dataScanner(_ dataScanner: DataScannerViewController, didAdd items: [RecognizedItem], allItems: [RecognizedItem]) {
            guard !didDeliver, let item = items.first,
                  case let .barcode(barcode) = item,
                  let payload = barcode.payloadStringValue else { return }
            didDeliver = true
            dataScanner.stopScanning()
            onScan(payload)
        }
    }
}

// SettingsView 集成
struct SettingsView: View {
    @Environment(AppModel.self) private var model
    @State private var isShowingScanner = false
    @State private var scanError: PairingQRError?

    var body: some View {
        Form {
            Section {
                Button {
                    guard DataScannerViewController.isSupported, DataScannerViewController.isAvailable else {
                        scanError = .deviceUnsupported; return
                    }
                    isShowingScanner = true
                } label: { Label("扫描配对二维码", systemImage: "qrcode.viewfinder") }
            }
            // ...原有 host/port/token 字段与"测试连接"按钮...
        }
        .sheet(isPresented: $isShowingScanner) {
            NavigationStack {
                QRPairingScannerView { raw in
                    isShowingScanner = false
                    do {
                        let payload = try PairingQRParser.parse(raw)
                        model.host = payload.host; model.port = payload.port; model.token = payload.token
                    } catch let error as PairingQRError { scanError = error }
                    catch { scanError = .unrecognizedFormat }
                }
                .ignoresSafeArea()
                .toolbar { ToolbarItem(placement: .cancellationAction) { Button("取消") { isShowingScanner = false } } }
            }
        }
        .alert("扫描失败", isPresented: Binding(get: { scanError != nil }, set: { if !$0 { scanError = nil } }), presenting: scanError) { _ in
            Button("好", role: .cancel) {}
        } message: { error in Text(error.errorDescription ?? "未知错误") }
    }
}
```

`Info.plist` 需新增键（区分大小写）：`NSCameraUsageDescription`
建议中文文案：`需要访问相机以扫描 Mac 端 quota-watch 生成的配对二维码，用于自动填写连接地址与令牌。`

**iOS 版本：** `DataScannerViewController` 最低 **iOS 16.0**（项目 iOS 17+ 完全覆盖）。`AVCaptureMetadataOutput` 最低 iOS 6.0。

**注意事项：**
- `isSupported`（硬件是否支持数据扫描）与 `isAvailable`（相机权限/系统限制）需一起检查再决定是否展示入口。
- `DataScannerViewController` 不支持 Simulator，必须真机测试。
- 缺少 `NSCameraUsageDescription` 时 App 访问相机会直接**崩溃**（进程终止，非权限弹窗被拒），是硬性必须项。
- App Store 审核会核对 `NSCameraUsageDescription` 文案是否真实反映用途——"扫描配对二维码"这类具体描述比泛泛的"需要相机权限"更容易通过；只要不上传图像数据，App Privacy Details 通常不需要额外声明数据收集类型（非法律建议，仅通用提醒）。

---

## 3. 网络可达性 / 私网 IP 判断

**结论：** `NWPathMonitor`（Network framework，**iOS 12.0+**）是官方推荐的可达性检测方案，取代旧 `SCNetworkReachability`。关键规则：`start(queue:)` 必须传入**非主线程的专用 serial DispatchQueue**——`pathUpdateHandler` 在该队列上调用，绝非主线程，桥接到 `@Observable`/`@MainActor` 属性时必须显式跳回主线程。必须持有 monitor 的**强引用**（否则 ARC 释放时框架自动 cancel，监听意外停止），显式 `start()`/`cancel()` 配合 scenePhase（不要依赖 `.task{}`，因为 App 切后台时 view 并不消失，`.task` 不会自动取消）。

`isPrivateHost` 判断优先用 **`Network.framework` 的 `IPv4Address`/`IPv6Address`** 结构化解析，而非手写 `split(".")`——`IPv4Address(String)` 是真正的语法校验器，会拒绝 `"10.0.0.1.1"`、`"999.1.1.1"`、前导零、十六进制写法等手写 parser 容易漏判的畸形输入，且自带 `isLoopback`/`isLinkLocal`，只需自己再判断 RFC1918 三段（10/8、172.16/12、192.168/16）。手写 octet 拆分仅作解析失败时的兜底防御。

**代码：**
```swift
import Network
import Observation

@Observable
@MainActor
final class NetworkMonitor {
    private(set) var isConnected: Bool = true
    private(set) var connectionType: NWInterface.InterfaceType?

    @ObservationIgnored private let monitor = NWPathMonitor()
    @ObservationIgnored private let queue = DispatchQueue(label: "com.quotawatch.NetworkMonitor")
    @ObservationIgnored private var started = false

    init() {
        monitor.pathUpdateHandler = { [weak self] path in
            let connected = path.status == .satisfied
            let type: NWInterface.InterfaceType? = [.wifi, .cellular, .wiredEthernet, .loopback, .other]
                .first { path.usesInterfaceType($0) }
            Task { @MainActor [weak self] in
                self?.isConnected = connected
                self?.connectionType = type
            }
        }
    }

    func start() { guard !started else { return }; started = true; monitor.start(queue: queue) }
    func stop() { guard started else { return }; started = false; monitor.cancel() }
}

/// 判断 host 是否属于「私网/本机可达」范围。false（含未知主机名、公网字面量）→ 上层应提示走 Tailscale 等隧道。
func isPrivateHost(_ host: String) -> Bool {
    let trimmed = host.trimmingCharacters(in: .whitespacesAndNewlines)
    guard !trimmed.isEmpty else { return false }
    if trimmed.lowercased().hasSuffix(".local") { return true }

    if let ipv4 = IPv4Address(trimmed) { return isPrivateIPv4(ipv4) }
    if let ipv6 = IPv6Address(trimmed) { return isPrivateIPv6(ipv6) }

    // 兜底：仅在上面两条路径都判定"不是合法 IP 字面量"时才会走到
    if let octets = parseIPv4Octets(trimmed) { return isPrivateIPv4Octets(octets) }
    return false
}

private func isPrivateIPv4(_ address: IPv4Address) -> Bool {
    if address.isLoopback || address.isLinkLocal { return true }
    let b = [UInt8](address.rawValue)
    guard b.count == 4 else { return false }
    if b[0] == 10 { return true }
    if b[0] == 172, (16...31).contains(b[1]) { return true }
    if b[0] == 192, b[1] == 168 { return true }
    return false
}

private func isPrivateIPv6(_ address: IPv6Address) -> Bool {
    if address.isLoopback || address.isLinkLocal { return true }
    let b = [UInt8](address.rawValue)
    guard b.count == 16 else { return false }
    return (b[0] & 0xFE) == 0xFC   // fc00::/7 唯一本地地址
}

private func parseIPv4Octets(_ host: String) -> [UInt8]? {
    let parts = host.split(separator: ".", omittingEmptySubsequences: false)
    guard parts.count == 4 else { return nil }
    var octets: [UInt8] = []
    for part in parts {
        guard !part.isEmpty, part.count <= 3,
              part.allSatisfy({ $0.isASCII && $0.isNumber }),
              let value = UInt8(part) else { return nil }
        octets.append(value)
    }
    return octets
}

private func isPrivateIPv4Octets(_ o: [UInt8]) -> Bool {
    if o[0] == 127 || (o[0] == 169 && o[1] == 254) { return true }
    if o[0] == 10 { return true }
    if o[0] == 172, (16...31).contains(o[1]) { return true }
    if o[0] == 192, o[1] == 168 { return true }
    return false
}
```

**iOS 版本：** `NWPathMonitor`、`IPv4Address`/`IPv6Address`：**iOS 12.0+**。`@Observable`/`@ObservationIgnored`：iOS 17.0+（与项目部署目标一致）。

**注意事项：**
- `pathUpdateHandler` 绝不在主线程跑，需自己的 `DispatchQueue`（不要传 `.main`）。
- 不持有 `NWPathMonitor` 强引用会导致 ARC 释放时静默 cancel。
- **已知编译器 bug**（[swiftlang/swift#79551](https://github.com/swiftlang/swift/issues/79551)，Swift 6 严格并发下仍开放）：`@MainActor @Observable` 类若在 `deinit` 里直接访问被 Observation 宏转换过的属性会报错——规避方式是显式 `stop()` 配合 scenePhase，不依赖 `deinit`，与本项目现有 `AppModel.stopAutoRefresh()` 模式一致。
- `NWEndpoint.Host(string)` 是**待 DNS 解析的主机名**，不是 IP 字面量强类型判定，不要用它判断"是不是 IP"；应用 `IPv4Address(string)`/`IPv6Address(string)` 可失败构造器。
- `.local` 后缀判断是纯字符串匹配，不做真实 mDNS 解析，足够满足"用户输入 `xxx.local` 就当局域网"的产品需求。

---

## 4. 动效与过渡

**结论：** `.contentTransition(.numericText(value:))` 是 iOS 17.0+（带 `value:` 的重载，让 SwiftUI 提前知道升降方向做数位滚动而非交叉淡入淡出；不带 `value:` 的 `numericText(countsDown:)` 重载 iOS 16.0 起就有但需手动指定方向）。**必须包在 `withAnimation` 里才会触发滚动效果，不包退化为默认 fade**——这是最容易踩的坑。

`UsageBar` 宽度变化推荐 iOS 17.0+ 具名 spring 预设中的 **`.smooth`**（零回弹）而非 `.bouncy`/`.snappy`——配额进度条是精确数值展示，回弹会让宽度短暂"超冲"造成误导性视觉噪音。

`symbolEffect` 家族：`.bounce`/`.pulse`/`.variableColor`/`.scale`/`.appear`/`.disappear`/`.replace` 是 **iOS 17.0**（SF Symbols 5）；**`.rotate`/`.wiggle`/`.breathe` 是 iOS 18.0+ 专属**（SF Symbols 6，WWDC24 新增）——本 app 部署目标 iOS 17+，若用 `.rotate` 做刷新图标旋转，**必须 `#available(iOS 18, *)` 分支**，iOS 17 兜底用手写 `.rotationEffect` + `.repeatForever`。不支持某效果的符号该修饰符会静默 no-op（无崩溃无警告）。

`matchedGeometryEffect` 跨 `NavigationStack` push 场景本身较脆弱（层级/时序耦合重），iOS 18+ 的 `NavigationTransition`/`.zoom(sourceID:in:)` 更简洁可靠但同样要求 iOS 18+ 起点——**v1（iOS 17 最低部署）建议直接跳过 hero 过渡**，用默认 push 动画，等提升最低部署目标到 iOS 18 时再补。List 行增删动画不需要额外机制，只要数据 `Identifiable` 且变更在动画事务里（`withAnimation` 或 `.animation(_:value:)`），SwiftUI 自动按 id diff。

**代码：**
```swift
// 1) usedPct 数位滚动 — iOS 17.0+
Text("\(Int(window.usedPct.rounded()))")
    .font(.title3.monospacedDigit().bold())
    .foregroundStyle(level.color)
    .contentTransition(.numericText(value: window.usedPct))
// 触发端必须包 withAnimation，否则退化为 fade：
// withAnimation(.smooth) { self.window = newWindow }

// 2) UsageBar 宽度变化 — iOS 17.0+ 具名 spring
Capsule().fill(level.color)
    .frame(width: geo.size.width * min(1, max(0, usedPct / 100)))
    .animation(.smooth(duration: 0.35), value: usedPct)
    // 避免 .bouncy/.snappy：回弹会让进度条宽度短暂超出真实百分比

// 3) 刷新按钮图标旋转 — .rotate 是 iOS 18.0+ 专属，需版本分支
Button {
    Task { await model.pollNow() }
} label: {
    Group {
        if #available(iOS 18.0, *) {
            Image(systemName: "arrow.clockwise")
                .symbolEffect(.rotate, isActive: model.isPolling)
        } else {
            Image(systemName: "arrow.clockwise")
                .rotationEffect(.degrees(model.isPolling ? 360 : 0))
                .animation(
                    model.isPolling ? .linear(duration: 1).repeatForever(autoreverses: false) : .default,
                    value: model.isPolling
                )
        }
    }
    .labelStyle(.titleAndIcon)
}
.disabled(model.isPolling)

// 4) List 行增删动画
List {
    ForEach(model.providers) { provider in
        ProviderRowView(provider: provider)
            .transition(.opacity.combined(with: .move(edge: .top)))
    }
}
.animation(.default, value: model.providers.map(\.id))
```

**iOS 版本：**
- `contentTransition(_:)`：iOS 16.0+；`.numericText(value:)`：**iOS 17.0+**；`.numericText(countsDown:)`：iOS 16.0+
- `.smooth`/`.snappy`/`.bouncy` 具名 spring：**iOS 17.0+**
- `.symbolEffect(.bounce/.pulse/.variableColor/.scale/.appear/.disappear/.replace, ...)`：**iOS 17.0+**
- `.symbolEffect(.rotate/.wiggle/.breathe, ...)`：**iOS 18.0+ 专属**
- `NavigationTransition`/`.zoom(sourceID:in:)`：**iOS 18.0+ 专属**
- `matchedGeometryEffect`：iOS 14.0+（一直存在，不推荐跨 NavigationStack 用）

**注意事项：**
- numericText 不包 `withAnimation` 就是纯 fade，不是数位滚动。
- `.rotate`/`.wiggle`/`.breathe` 在 iOS 17 设备上直接调用**编译失败**（API 不存在），必须 `#available` 分支。
- `symbolEffect(_:options:value:)`（离散触发一次）与 `symbolEffect(_:options:isActive:)`（持续型 Bool 开关）是两族不同签名，`.rotate` 属于持续型。
- 不支持效果的符号静默失效，需用 Xcode 自带 SF Symbols App 逐个预览确认（`arrow.clockwise` 官方常用于 rotate，可信支持）。

---

## 5. 下拉刷新与加载态

**结论：** 现有 `.refreshable { await model.pollNow() }` 用法正确——`.refreshable(action:)` 要求 `async` 闭包，支持容器为 `List`（iOS 15.0+）和 `ScrollView`（iOS 16.0+，需内部有可滚动内容）。已知实际坑：闭包返回过快时转圈指示器可能一闪而过（Apple 无"最小展示时长"官方 API），社区做法是额外 race 一个 `Task.sleep` 兜底（纯体验优化，非正确性问题）；手动刷新按钮与下拉刷新都调用同一 `pollNow()`，需确保内部对 `isPolling` 做重入保护避免竞态（现有代码已做到）。

首次加载骨架屏没有系统内建实现：`redacted(reason: .placeholder)`（**iOS 14.0+**）自动级联到子视图，但**Apple 到 iOS 18 为止都没有内建 shimmer 高光扫过效果**，需自建（对角渐变 + `.mask` + `.linear repeatForever`），这是 markiv/SwiftUI-Shimmer 等社区库的标准手法。三态叠加（loading→骨架屏、not-configured/error→`ContentUnavailableView`、loaded→真实行）构成完整状态机；现有 `ContentUnavailableView`（label+description+actions 闭包式）用法正确，是官方三种初始化器之一（另两种：`.search`/`.search(text:)` 静态属性，及 `init(_:systemImage:description:)` 简单字符串式）。

**代码：**
```swift
// 首次加载骨架屏
private struct SkeletonWindowRow: View {
    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack {
                Text("5H").font(.caption2.monospaced().bold())
                    .padding(.horizontal, 5).padding(.vertical, 1)
                    .background(Color.secondary.opacity(0.12), in: Capsule())
                Text("Provider Name").font(.subheadline)
                Spacer()
                Text("2h 30m").font(.caption2.monospaced())
            }
            Text("42%").font(.title3.monospacedDigit().bold())
            Capsule().fill(Color.secondary.opacity(0.15)).frame(height: 6)
        }
        .padding(.vertical, 2)
    }
}

private struct LoadingSkeletonView: View {
    var body: some View {
        VStack(spacing: 12) { ForEach(0..<3, id: \.self) { _ in SkeletonWindowRow() } }
            .redacted(reason: .placeholder)
            .shimmering()
            .padding()
    }
}

// 三态机接入
Group {
    if model.providers.isEmpty && model.isRefreshing {
        LoadingSkeletonView()
    } else if model.providers.isEmpty {
        NotConfiguredView()   // 已有的 ContentUnavailableView
    } else {
        List(model.providers) { provider in ProviderRowView(provider: provider) }
            .refreshable { await model.pollNow() }
    }
}

// 自定义 shimmer — Apple 无内建等价物
private struct ShimmerModifier: ViewModifier {
    @State private var phase: CGFloat = -1.2
    func body(content: Content) -> some View {
        content.overlay {
            GeometryReader { geo in
                LinearGradient(colors: [.clear, .white.opacity(0.6), .clear], startPoint: .top, endPoint: .bottom)
                    .rotationEffect(.degrees(70))
                    .frame(width: geo.size.width * 0.5)
                    .offset(x: phase * geo.size.width)
            }
            .mask(content)
            .allowsHitTesting(false)
        }
        .onAppear {
            withAnimation(.linear(duration: 1.25).repeatForever(autoreverses: false)) { phase = 2.0 }
        }
    }
}
extension View { func shimmering() -> some View { modifier(ShimmerModifier()) } }
```

**iOS 版本：**
- `.refreshable(action:)`：`List` iOS 15.0+，`ScrollView` **iOS 16.0+**
- `redacted(reason:)`/`unredacted()`：iOS 14.0+
- `ContentUnavailableView`：**iOS 17.0+**（现有代码用法正确）
- 自定义 shimmer：纯手写，无版本依赖

**注意事项：**
- 没有任何官方 shimmer API，需自建或引入第三方库。
- `redacted` 级联自动，若骨架行混了品牌色图标需 `.unredacted()` 局部豁免。
- `.refreshable` 指示器无最小展示时长控制 API，本地请求常 <200ms 时可能"闪一下"，可选优化非必需。
- 三态判定条件必须互斥且覆盖所有分支，避免边界情况出现短暂空白闪烁。

---

## 6. 视觉精致度

**结论：**

1. **Material 层级：** 5 档 `.ultraThinMaterial` < `.thinMaterial` < `.regularMaterial` < `.thickMaterial` < `.ultraThickMaterial`，另有语义化 `.bar`（均 iOS 15.0+）。现有状态栏 `.background(.bar)` 已正确，无需改。给每个 Provider Section 做浮动卡片：**技术上与 `.insetGrouped` 兼容但要打架**——需 `.listRowBackground(...)` + `.listRowSeparator(.hidden)` + `.scrollContentBackground(.hidden)`，圆角/间距/阴影都要跟 insetGrouped 自身 inset 逻辑较劲。**若要精确控制视觉，更干净的路径是切到 `ScrollView + VStack` 自绘卡片**（结构性改动，失去 List 自带 swipe/编辑行为，但视觉上限更高）。两条路都能走，如实列出取舍，不代为决策。

2. **`.background(_:in:fillStyle:)`：** 实际最低版本 **iOS 15.0**（非 16+）。Apple 官方文档只说这是"a convenience method for placing a single shape behind a view"，**没有逐字背书"避免额外合成层"的性能论据**——那是社区推论，不要引用成 Apple 原话。

3. **连续圆角：** `RoundedRectangle(cornerRadius:style:)` 的 `style` 参数**默认值是 `.circular`，不是 `.continuous`**——必须显式传 `.continuous` 才能拿到 App 图标那种 squircle 曲率。建议本 app 所有新增卡片背景显式写 `style: .continuous`。

4. **Dynamic Type：** 现有 `.title3`/`.caption`/`.subheadline`/`.headline` 均可缩放，做法已正确。`UsageBar` 的 `.frame(height: 6)` 是纯装饰性进度条，不随 Dynamic Type 缩放可接受（HIG 对装饰元素无强制缩放要求），无需 `@ScaledMetric`。

5. **深浅色语义色：** `Color.orange`/`Color.red` 是 UIColor 动态系统色，自动响应深浅色和"增强对比度"，不需要 Asset Catalog 自定义颜色集。**建议 `UsageLevel.ok` 由 `.primary` 改为 `Color.green`**：运维/监控类 app 的红黄绿交通灯是认知负担最低的成熟惯例；`.primary` 会让"OK"状态看起来像"没数据/没样式"；三档统一用系统语义色能保持同一视觉家族。反面论点（`.primary` 更克制不花哨）如实列出，但 `Color.green`（`.systemGreen`）是低饱和成熟绿非霓虹绿，和已用的 orange/red 同视觉语域，综合推荐 `.green`。

6. **Gauge vs 自绘 UsageBar（本次最有分量的一个决定）：结论——保留自绘 `UsageBar`，不切换到 `Gauge`。** 已确认样式清单（全部 iOS 16.0+）：非 accessory 系列 `.automatic`/`.linear`/`.linearCapacity`/`.circular` 在普通全屏 iPhone App 视图里可用；accessory 系列 `.accessoryCircular`/`.accessoryCircularCapacity`/`.accessoryLinear`/`.accessoryLinearCapacity` 技术上哪里都能编译，但语义上是为 Lock Screen widget/Watch complication 的"vibrant rendering"设计，放进普通 App 视图只是普通细环/细条，拿不到特殊处理，显得单薄。决策依据：非 accessory 系列的布局是 Apple 定死的（title + currentValueLabel + min/max label 固定排布），和现有"大号等宽数字% + 下方胶囊条"是两套设计语言；自绘 `UsageBar` 已和 caption badge 的 Capsule 语言统一；Gauge 的"免费 VoiceOver/Dynamic Type"优势可用一行 `.accessibilityValue("\(Int(usedPct))%")` 低成本替代。

**代码：**
```swift
// 推荐路径：ScrollView + VStack 自绘卡片，continuous 圆角 Material 背景
struct ProviderCardView: View {
    let provider: Provider
    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text(provider.name).font(.headline)
            ForEach(provider.windows) { window in WindowRowView(window: window) }
        }
        .padding(16)
        .background(.regularMaterial, in: RoundedRectangle(cornerRadius: 16, style: .continuous))
    }
}

// List + insetGrouped 的兼容折衷路径
List {
    Section { WindowRowView(window: window) }
        .listRowBackground(RoundedRectangle(cornerRadius: 16, style: .continuous).fill(.regularMaterial))
        .listRowSeparator(.hidden)
}
.scrollContentBackground(.hidden)   // 去掉系统默认灰底，否则和 Material 叠两层
.listStyle(.insetGrouped)

// 语义色调整
enum UsageLevel {
    case ok, warn, low
    var color: Color {
        switch self {
        case .ok: return .green   // 由 .primary 改为 .green，明确交通灯语义
        case .warn: return .orange
        case .low: return .red
        }
    }
}

// Gauge 对比示例（仅作对比，不建议采用）
Gauge(value: window.usedPct, in: 0...100) {
    Text(window.label)
} currentValueLabel: { Text("\(Int(window.usedPct))%") }
.gaugeStyle(.linearCapacity)
.tint(level.color)
```

**iOS 版本：**
- Material static members / `.bar`：iOS 15.0+
- `.background(_:in:fillStyle:)`：**iOS 15.0+**
- `RoundedRectangle(cornerRadius:style:)`：默认 `.circular`（需显式传 `.continuous`）
- `Gauge`/`GaugeStyle` 全部样式：iOS 16.0+
- `.scrollContentBackground(_:)`：iOS 16.0+

**注意事项：**
- List + Material 卡片路径必须搭配 `.scrollContentBackground(.hidden)`，否则灰底透出造成两层背景冲突。
- `.background(_:in:)` 的性能论据是社区推论，非 Apple 官方原话。
- `RoundedRectangle` 默认 `.circular`，忘记显式 `.continuous` 会拿到四分之一圆角而非 squircle。
- Gauge 的 accessory 系列在非 widget 上下文视觉"平淡"，不要误用为轻量进度条方案。

---

## 7. App 结构与状态

**结论：**

1. **@Observable vs ObservableObject：** 对 iOS 17 起步的新 app，**没有理由再用 `ObservableObject`/`@Published`/`@StateObject`**。机制差异：`ObservableObject` 是对象级订阅（任何 `@Published` 变化都让读了这个 object 的所有 view 重算 body）；`@Observable` 是编译期生成的属性级依赖追踪，只有真正读过那个被改属性的 view 才重渲染。注入方式对应 `@Environment(AppModel.self)`（替代 `@EnvironmentObject`）+ `@Bindable`（替代 `@ObservedObject`），本项目 `SettingsView` 已在用，用法正确。已知坑：(a) `@MainActor @Observable` 类在 `deinit` 里访问属性的编译器 bug（见 Topic 3）；(b) `@Observable` 本身不隐含 `@MainActor`，需显式标注（`AppModel.refresh()` 已正确标注）；(c) SwiftData `@Model` 底层也生成 Observable 一致性但不能与手写 `@Observable` 无脑互换（本项目不涉及，可忽略）。

2. **scenePhase：** 现有 `.onChange(of: scenePhase) { _, phase in ... }` 双参数写法是**当前正确、非弃用**的 API。iOS 17 引入零参数和双参数两个新 `onChange` 重载；旧的单参数 `onChange(of:perform:)`（iOS 14 起）在 iOS 17 被标记 deprecated。现有代码已用双参数版本，无需改。

3. **Task 生命周期：** 现有 `startAutoRefresh`/`stopAutoRefresh` 手动配对模式**合理且必要，不应简化为单纯依赖 `.task{}`**。`.task{}` 自动取消只绑定"view 是否在树上"，而这里要表达的是"scenePhase 是否 active"这一正交维度——App 切后台时 view 仍在树里不会 disappear，`.task{}` 不会自动取消，只有手动 `stopAutoRefresh()` 才能真正省电停止轮询。`.task { model.startAutoRefresh() }` 与 `.onChange(scenePhase)` 两条路径共存时，`startAutoRefresh()` 内部先 `refreshTask?.cancel()` 再起新任务，已是正确的防重入模式，不会产生双循环。轮询体 `while !Task.isCancelled { try? await Task.sleep(...); if Task.isCancelled { break }; ... }` 是 Swift 结构化并发标准写法（`Task.sleep` 在取消后抛 `CancellationError`，`try?` 吞掉后靠 `Task.isCancelled` 退出）。

4. **BGAppRefreshTask（go/no-go）：v1 不建议做。** `BGAppRefreshTaskRequest`（iOS 13.0+）执行时机由系统调度、无固定保证（实测从 20 分钟内到超一小时不等），每次执行仅约 30 秒窗口；即便触发，手机在后台唤醒时是否仍连着 Mac daemon 同一 Wi-Fi 完全不可控。对纯局域网配额监控器，投入的工程成本（Info.plist 声明、`BGTaskScheduler` 注册、每次进后台前重新 submit、处理 30 秒超时内的取消）换来的价值很低——用户真正关心的是"打开 app 时看到最新配额"，前台 10 秒轮询已覆盖得很好。**若未来 Mac daemon 换成公网隧道/中继可达**（如 Tailscale funnel），calculus 会变：后台刷新不再受"是否同一 Wi-Fi"制约，配合 push notification（真正的"配额即将耗尽"预警场景）会比轮询式 BGAppRefreshTask 更合适，值得重新评估。

**代码：**
```swift
// @Observable + @Environment + @Bindable 全套（现有模式正确，无需改动）
@main
struct QuotaWatchApp: App {
    @State private var model = AppModel()
    var body: some Scene {
        WindowGroup { QuotaListView().environment(model) }   // @Environment(Type.self) 注入
    }
}
@Environment(AppModel.self) private var model          // 只读场景
@Bindable var model = model                              // 双向绑定场景（SettingsView 已用）

// scenePhase — 双参数写法是当前非弃用 API
.onChange(of: scenePhase) { _, phase in
    if phase == .active { model.startAutoRefresh() } else { model.stopAutoRefresh() }
}
// 对照：已弃用（编译警告，不要用）
// .onChange(of: scenePhase) { phase in ... }

// Task 轮询体 — 结构化并发标准写法，保持现状
private func pollLoop() async {
    while !Task.isCancelled {
        try? await Task.sleep(nanoseconds: Self.refreshInterval)
        if Task.isCancelled { break }
        await refresh()
    }
}
```

**iOS 版本：**
- Observation framework（`@Observable`/`@Bindable`/`@ObservationIgnored`）：**iOS 17.0**（与项目部署目标一致）
- 双参数 `onChange(of:initial:_:)`：iOS 17.0+；单参数版：iOS 14.0 起，iOS 17.0 起 deprecated
- `BGAppRefreshTaskRequest`：iOS 13.0+（可用，但见 go/no-go，v1 不建议接入）

**注意事项：**
- **BGAppRefreshTask：v1 明确 No-Go**——触发时机不可控 + 局域网可达性不可控 + 工程成本/收益比低。
- `@Observable` 类默认非 `Sendable`，Swift 6 严格并发下跨 actor 传递需额外处理（本项目 `AppModel` 整体标 `@MainActor` 已规避）。
- `@Bindable` 只在"写"场景使用，纯读取用 `@Environment(AppModel.self)` 即可，避免不必要的写权限暴露。
- 避免给 `@MainActor @Observable` 类加 `deinit` 里直接访问属性的清理逻辑（编译器已知 bug），继续用显式 `stop()` 方法配合 scenePhase。

---

## 8. Widget / Live Activity

**结论：Widget（主屏）v1 不做（defer）；Live Activity v1 不做（defer），标记为 v2+ 候选（仅限"倒计时到重置时刻"这一窄场景，不是通用仪表盘）。**

推理链（针对本 app"Mac daemon 仅 LAN 可达，无公网服务器，无 push 基建"这一具体约束）：

1. **Widget 侧：** 官方文档确认常被浏览的 widget 每 24 小时约 **40–70 次**刷新（约每 15–60 分钟一次），由系统按使用习惯动态调节，App 不可控；`getTimeline` 在 widget extension **独立进程**里择时触发。WidgetKit 官方文档（"Keeping a widget up to date"、"Making network requests in a widget extension"）**没有任何"是否与某 LAN 主机同网"的可靠信号**——系统选择刷新的任意时刻，若手机不在家里 Wi-Fi（用户最想看状态的场景），请求直接超时/失败，widget 只能显示旧缓存且无内建"数据可能过期"标识，需自建 App Group 时间戳判断。额外隐患：Local Network 权限弹窗通常由主 App 首次发起局域网请求触发，widget extension 是 headless（无法弹 UI），若用户没先打开过主 App 授权，widget 自己连 daemon 大概率静默失败。结论是自我拆台式的：widget 恰好在"最想看它"的场景（离家）最不可靠，在"最不需要它"的场景（在家）最可靠。**v1 不值得做**，待公网可达方案（Tailscale funnel/云端 relay）出现后再评估。

2. **Live Activity 侧：** 官方确认最长 8 小时活跃（Dynamic Island），结束后 Lock Screen 再留最多 4 小时，总计最多 **12 小时**——设计初衷是有明确终点的一次性事件（外卖配送/计时器），不是永久仪表盘，语义完全不匹配。**更致命的技术性硬阻断**：ActivityKit 官方文档原话——"Each Live Activity runs in its own sandbox, and — unlike a widget — it can't access the network."——Live Activity **自身完全不能发网络请求**，只能靠宿主 App 调用 `Activity.update()` 或服务器端 ActivityKit push；本 app 无 push 基建，意味着 Live Activity 比 widget **更没有独立轮询 LAN daemon 的能力**，不是退而求其次的方案，是技术上更差的方案。**未来 v2 窄场景**（本次范围外）：针对"倒计时到某个 rate-limit 窗口重置"——时间有界（远小于 8 小时），可用 `Text(timerInterval:countsDown:)` 做纯本地倒计时，App 前台抓一次重置时间戳后无需持续轮询/push。

**代码：**
```swift
import WidgetKit
import SwiftUI

struct LowestQuotaEntry: TimelineEntry {
    let date: Date
    let providerName: String
    let usedPct: Double
    let isStale: Bool
}

struct LowestQuotaProvider: TimelineProvider {
    func placeholder(in context: Context) -> LowestQuotaEntry {
        LowestQuotaEntry(date: .now, providerName: "Claude", usedPct: 42, isStale: false)
    }
    func getSnapshot(in context: Context, completion: @escaping (LowestQuotaEntry) -> Void) {
        completion(LowestQuotaEntry(date: .now, providerName: "Claude", usedPct: 42, isStale: false))
    }
    func getTimeline(in context: Context, completion: @escaping (Timeline<LowestQuotaEntry>) -> Void) {
        Task {
            let entry = await fetchEntry()
            let nextRefresh = Calendar.current.date(byAdding: .minute, value: 30, to: .now) ?? .now
            completion(Timeline(entries: [entry], policy: .after(nextRefresh)))
        }
    }
    private func fetchEntry() async -> LowestQuotaEntry {
        guard let daemonURL = SharedSettings.daemonBaseURL else {
            return LowestQuotaEntry(date: .now, providerName: "未配置", usedPct: 0, isStale: true)
        }
        do {
            var request = URLRequest(url: daemonURL.appendingPathComponent("quota"))
            request.timeoutInterval = 5
            let (data, _) = try await URLSession.shared.data(for: request)
            let windows = try JSONDecoder().decode([QuotaWindow].self, from: data)
            guard let worst = windows.max(by: { $0.usedPct < $1.usedPct }) else {
                return LowestQuotaEntry(date: .now, providerName: "无数据", usedPct: 0, isStale: true)
            }
            SharedSettings.lastKnownEntry = worst
            return LowestQuotaEntry(date: .now, providerName: worst.providerName, usedPct: worst.usedPct, isStale: false)
        } catch {
            // 手机不在 Mac 所在局域网时会走到这里 — 回退缓存并标 stale
            let cached = SharedSettings.lastKnownEntry
            return LowestQuotaEntry(date: .now, providerName: cached?.providerName ?? "离线", usedPct: cached?.usedPct ?? 0, isStale: true)
        }
    }
}

struct LowestQuotaWidgetView: View {
    var entry: LowestQuotaProvider.Entry
    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(entry.providerName).font(.caption).foregroundStyle(.secondary)
            Text("\(Int(entry.usedPct))%").font(.title2.monospacedDigit().bold())
            if entry.isStale {
                Label("可能已过期", systemImage: "wifi.slash").font(.caption2).foregroundStyle(.orange)
            }
        }
        .padding()
        .containerBackground(.fill.tertiary, for: .widget)   // iOS 17+ 必须项
    }
}

struct LowestQuotaWidget: Widget {
    let kind = "LowestQuotaWidget"
    var body: some WidgetConfiguration {
        StaticConfiguration(kind: kind, provider: LowestQuotaProvider()) { entry in
            LowestQuotaWidgetView(entry: entry)
        }
        .configurationDisplayName("配额状态")
        .description("显示占用最高的配额窗口。")
        .supportedFamilies([.systemSmall])
    }
}
```

**iOS 版本：**
- `TimelineProvider`/`Widget`/`StaticConfiguration`：iOS 14.0+
- `.containerBackground(_:for:)`（iOS 17+ 强制要求，替代旧隐式背景）：**iOS 17.0+**
- `AppIntentTimelineProvider`：iOS 17.0+
- `ActivityKit`/`Activity<Attributes>`/`Text(timerInterval:countsDown:)`：iOS 16.1+

**注意事项：**
- Widget Extension 需新建 Target（Xcode "Widget Extension" 模板自带 `NSExtensionPointIdentifier`，无需手动填）。
- **关键前置工作**：widget/Live Activity 进程与主 App 沙盒分离，要共享 host/port/token 配置必须迁移到 **App Group 共享容器**或 Keychain access group——这是接入前必须先做的架构改动，不是 widget 本身的代码量。
- Live Activity 需要：主 App Info.plist 加 `NSSupportsLiveActivities`；`import ActivityKit`；定义 `ActivityAttributes`；UI 在同一 Widget Extension target 里用 `ActivityConfiguration` 声明。
- ActivityKit 官方原话确认 Live Activity "can't access the network"——是判定其不适合"通用配额仪表盘"的关键技术依据，不仅是语义不匹配。

---

## 9. 性价比排序 Top 3

综合"实现成本 vs 感知精致度提升"，性价比最高的三项（详细理由见对应主题正文）：

1. **数字滚动 + 进度条动画（Topic 4）**——`Text(...).contentTransition(.numericText(value:))` + `UsageBar` 宽度 `.animation(.smooth(...))`，几行代码就把每 10 秒一次的"数字硬跳"变成有生命感的滚动过渡，是这个 app 里出现频率最高的画面（每次轮询都触发），投入产出比最高。
2. **触感反馈（Topic 1）**——`.sensoryFeedback` 覆盖刷新完成/配额告警/测试连接成功失败，几乎零架构风险（现有状态机已天然提供了合适的 Equatable trigger），却能让"轮询式监控工具"第一次有"活的"手感。
3. **首屏骨架屏 + 完整三态机（Topic 5）**——现在首次加载是空白，`redacted(.placeholder)` + 简单 shimmer 补上"正在加载"的视觉承诺，配合已有的 `ContentUnavailableView`，让 loading/empty/error/loaded 四态第一次形成完整闭环，对"这个 app 是不是能打"的第一印象影响最大。

QR 扫码（Topic 2）体验提升也很大，但涉及新增 Info.plist 权限、相机 UI、URL scheme 解析，实现成本明显高于以上三项，建议排在其后。视觉重排（Topic 6 的 Material 卡片化）价值介于两者之间，但如果选择"ScrollView 自绘卡片"路径是结构性改动，建议与 QR 扫码一起放入下一批。

---

## Sources（按主题）

**Haptics / QR：**
- https://developer.apple.com/documentation/swiftui/view/sensoryfeedback(_:trigger:)
- https://developer.apple.com/documentation/swiftui/sensoryfeedback
- https://developer.apple.com/design/human-interface-guidelines/playing-haptics
- https://developer.apple.com/documentation/visionkit/datascannerviewcontroller
- https://developer.apple.com/documentation/visionkit/datascannerviewcontrollerdelegate
- https://developer.apple.com/documentation/avfoundation/avcapturemetadataoutput
- https://swiftwithmajid.com/2023/10/10/sensory-feedback-in-swiftui/
- https://useyourloaf.com/blog/swiftui-sensory-feedback/

**网络 / 架构：**
- https://developer.apple.com/documentation/network/nwpathmonitor
- https://developer.apple.com/documentation/network/ipv4address
- https://developer.apple.com/documentation/network/ipv6address
- https://developer.apple.com/documentation/swiftui/migrating-from-the-observable-object-protocol-to-the-observable-macro
- https://developer.apple.com/documentation/backgroundtasks/bgapprefreshtaskrequest
- https://developer.apple.com/documentation/backgroundtasks/choosing-background-strategies-for-your-app
- https://github.com/swiftlang/swift/issues/79551
- https://fatbobman.com/en/posts/mastering-observation/
- https://www.donnywals.com/comparing-observable-to-observableobjects/
- https://useyourloaf.com/blog/swiftui-onchange-deprecation/

**动效 / 加载态：**
- https://developer.apple.com/documentation/swiftui/contenttransition
- https://developer.apple.com/documentation/swiftui/contenttransition/numerictext(value:)
- https://developer.apple.com/videos/play/wwdc2023/10158/ （Animate with springs）
- https://developer.apple.com/documentation/swiftui/view/symboleffect(_:options:isactive:)
- https://developer.apple.com/videos/play/wwdc2024/10188/ （What's new in SF Symbols 6）
- https://developer.apple.com/documentation/swiftui/zoomnavigationtransition
- https://developer.apple.com/documentation/swiftui/contentunavailableview
- https://github.com/markiv/SwiftUI-Shimmer
- https://sarunw.com/posts/content-unavailable-view-in-swiftui/

**视觉 / Widget：**
- https://developer.apple.com/documentation/swiftui/view/background(_:in:fillstyle:)
- https://developer.apple.com/documentation/swiftui/gauge
- https://developer.apple.com/documentation/widgetkit
- https://developer.apple.com/documentation/activitykit
