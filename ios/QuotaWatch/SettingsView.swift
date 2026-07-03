import SwiftUI

/// Connection settings — QR pairing (primary), manual entry, a live connection
/// test, and genuine step-by-step help + troubleshooting so a first-time user
/// can actually get connected.
struct SettingsView: View {
    @Environment(AppModel.self) private var model

    @State private var testState: TestState = .idle
    @State private var showScanner = false
    @State private var scannedTick = 0
    @State private var manualCode = ""
    @State private var claiming = false

    private enum TestState: Equatable {
        case idle, testing
        case success(providerCount: Int, uptimeSec: Int)
        case failure(String)
    }

    var body: some View {
        @Bindable var model = model

        Form {
            if model.demoMode {
                Section {
                    Label {
                        Text("当前显示的是示例数据。配对你的 Mac 后即可看到真实配额。")
                            .font(.footnote)
                    } icon: {
                        Image(systemName: "wand.and.stars").foregroundStyle(UsageLevel.warn.color)
                    }
                    Button("退出示例模式", role: .destructive) {
                        model.exitDemo()
                    }
                } header: {
                    Text("示例模式")
                }
            }
            connectionStatusSection
            pairingSection(model: $model)
            manualSection(model: $model)
            if model.isConfigured && model.hostReachability == .publicNetwork {
                publicWarningSection
            }
            helpSection
            troubleshootingSection
            aboutSection
        }
        .navigationTitle("连接设置")
        .navigationBarTitleDisplayMode(.inline)
        .sheet(isPresented: $showScanner) {
            QRScannerView { payload in
                handleScanned(payload)
            }
        }
        .sensoryFeedback(.success, trigger: scannedTick)
        .sensoryFeedback(trigger: testState) { _, new in
            switch new {
            case .success: return .success
            case .failure: return .error
            default: return nil
            }
        }
    }

    // ── Connection status ───────────────────────────────────────────────

    private var connectionStatusSection: some View {
        Section {
            HStack(spacing: 12) {
                ZStack {
                    Circle().fill(statusColor.opacity(0.18)).frame(width: 42, height: 42)
                    Image(systemName: statusSymbol).foregroundStyle(statusColor)
                }
                VStack(alignment: .leading, spacing: 2) {
                    Text(statusTitle).font(.system(size: 16, weight: .semibold))
                    Text(statusDetail).font(.caption).foregroundStyle(.secondary)
                }
                Spacer()
                if testState == .testing { ProgressView() }
            }
        }
    }

    private var statusColor: Color {
        switch testState {
        case .success: return UsageLevel.ok.color
        case .failure: return UsageLevel.low.color
        default: return model.isConfigured ? UsageLevel.warn.color : .secondary
        }
    }
    private var statusSymbol: String {
        switch testState {
        case .success: return "checkmark.circle.fill"
        case .failure: return "xmark.circle.fill"
        default: return model.isConfigured ? "wifi" : "wifi.slash"
        }
    }
    private var statusTitle: String {
        switch testState {
        case .success: return "已连接"
        case .failure: return "连接失败"
        default: return model.isConfigured ? "已配置，未测试" : "未连接"
        }
    }
    private var statusDetail: String {
        switch testState {
        case let .success(count, uptime): return "\(count) 个渠道 · daemon 运行 \(uptime)s"
        case let .failure(msg): return msg
        default: return model.isConfigured ? "\(model.host):\(model.port)" : "扫码或手动填写 Mac 的地址"
        }
    }

    // ── Pairing (primary) ───────────────────────────────────────────────

    private func pairingSection(model: Bindable<AppModel>) -> some View {
        Section {
            Button {
                showScanner = true
            } label: {
                Label("扫码配对", systemImage: "qrcode.viewfinder")
                    .font(.body.weight(.semibold))
            }
            Button {
                Task { await runTest() }
            } label: {
                HStack {
                    Label("测试连接", systemImage: "bolt.horizontal")
                    Spacer()
                    testInlineResult
                }
            }
            .disabled(model.wrappedValue.host.trimmingCharacters(in: .whitespaces).isEmpty || testState == .testing)
        } header: {
            Text("配对")
        } footer: {
            Text("在 Mac 菜单栏点 quota·watch →「配对」弹出二维码，用「扫码配对」一扫即连——Token 全程隐身，不用管。")
        }
    }

    @ViewBuilder
    private var testInlineResult: some View {
        switch testState {
        case let .success(count, _):
            Label("\(count) 渠道", systemImage: "checkmark").font(.caption).foregroundStyle(.green).labelStyle(.titleAndIcon)
        case .failure:
            Image(systemName: "xmark").font(.caption).foregroundStyle(.red)
        default: EmptyView()
        }
    }

    // ── Manual entry ────────────────────────────────────────────────────

    private func manualSection(model: Bindable<AppModel>) -> some View {
        Group {
            Section {
                LabeledContent("主机") {
                    TextField("192.168.1.10", text: model.host)
                        .multilineTextAlignment(.trailing)
                        .textInputAutocapitalization(.never).autocorrectionDisabled()
                        .keyboardType(.URL)
                }
                LabeledContent("端口") {
                    TextField("3737", value: model.port, format: .number.grouping(.never))
                        .multilineTextAlignment(.trailing).keyboardType(.numberPad)
                }
                LabeledContent("配对码") {
                    TextField("6 位数字", text: $manualCode)
                        .multilineTextAlignment(.trailing).keyboardType(.numberPad)
                        .textContentType(.oneTimeCode)
                }
                Button {
                    claimManualCode()
                } label: {
                    HStack {
                        Label("用配对码连接", systemImage: "key.horizontal")
                        Spacer()
                        if claiming { ProgressView() }
                    }
                }
                .disabled(model.wrappedValue.host.trimmingCharacters(in: .whitespaces).isEmpty
                          || manualCode.count < 6 || claiming)
            } header: {
                Text("手动配对")
            } footer: {
                Text("在 Mac 菜单栏点「配对」，把地址和 6 位配对码填在这里——和扫码等效。")
            }

            Section {
                DisclosureGroup("高级：直接填 Token") {
                    LabeledContent("Token") {
                        SecureField("可选", text: model.token)
                            .multilineTextAlignment(.trailing)
                            .textInputAutocapitalization(.never).autocorrectionDisabled()
                    }
                }
            } footer: {
                Text("一般用不到。仅当你已有 API Token（如 `quota-watch connect` 打印的）时手动填。")
            }
        }
    }

    private var publicWarningSection: some View {
        Section {
            Label {
                Text("这看起来是公网地址。明文 HTTP 会让 Token 在传输中暴露——建议用 Tailscale / Cloudflare Tunnel 等隧道，而不是直接暴露端口。")
                    .font(.footnote)
            } icon: {
                Image(systemName: "exclamationmark.shield").foregroundStyle(.orange)
            }
        }
    }

    // ── Help ────────────────────────────────────────────────────────────

    private var helpSection: some View {
        Section("如何连接？") {
            DisclosureGroup {
                VStack(alignment: .leading, spacing: 12) {
                    StepRow(n: 1, text: "在 Mac 上启动采集 daemon（状态栏 app 或命令行）。", code: "quota-watch daemon start --lan")
                    StepRow(n: 2, text: "点 Mac 菜单栏的 quota·watch →「配对」，弹出二维码 + 6 位配对码。", code: nil)
                    StepRow(n: 3, text: "点上面的「扫码配对」扫它，或在「手动配对」填地址 + 配对码。", code: nil)
                    StepRow(n: 4, text: "确保手机和 Mac 在同一个 Wi-Fi（或已配好隧道）。", code: nil)
                }
                .padding(.vertical, 4)
            } label: {
                Label("4 步搞定", systemImage: "list.number")
            }
        }
    }

    private var troubleshootingSection: some View {
        Section("连不上？") {
            DisclosureGroup {
                VStack(alignment: .leading, spacing: 10) {
                    TipRow("手机和 Mac 是否连的是同一个 Wi-Fi？")
                    TipRow("Mac 上是否用的 `daemon start --lan`（普通 `start` 只绑回环，手机连不上）？")
                    TipRow("Mac 上开了代理 / VPN（Clash、Surge 等）？它们常拦截局域网请求——临时关掉，或改用隧道。")
                    TipRow("公网访问：用 Tailscale / Cloudflare Tunnel 打通，别把端口裸露到公网。")
                }
                .padding(.vertical, 4)
            } label: {
                Label("常见排查", systemImage: "wrench.and.screwdriver")
            }
        }
    }

    private var aboutSection: some View {
        Section("关于") {
            LabeledContent("版本", value: appVersion)
            Label {
                Text("配额数据只在你的局域网 / 隧道内传输，不经任何云端。")
                    .font(.footnote).foregroundStyle(.secondary)
            } icon: {
                Image(systemName: "lock.fill").foregroundStyle(UsageLevel.ok.color)
            }
        }
    }

    private var appVersion: String {
        let v = Bundle.main.infoDictionary?["CFBundleShortVersionString"] as? String ?? "—"
        let b = Bundle.main.infoDictionary?["CFBundleVersion"] as? String ?? "—"
        return "\(v) (\(b))"
    }

    // ── Actions ─────────────────────────────────────────────────────────

    private func runTest() async {
        testState = .testing
        switch await model.testConnection() {
        case let .success(health):
            testState = .success(providerCount: health.providers.count, uptimeSec: health.uptimeSec)
            await model.refresh()
        case let .failure(error):
            testState = .failure(error.errorDescription ?? "失败")
        }
    }

    /// A scanned QR: claim its short-lived code (menu-bar flow) or, for a legacy
    /// token QR, store the token directly. Then test the connection.
    private func handleScanned(_ payload: PairingPayload) {
        Task {
            if let code = payload.code {
                testState = .testing
                if let err = await model.applyPairingCode(host: payload.host, port: payload.port, code: code) {
                    testState = .failure(err)
                } else {
                    scannedTick += 1
                    await runTest()
                }
            } else {
                model.applyPairing(payload)
                scannedTick += 1
                testState = .idle
                await runTest()
            }
        }
    }

    /// Manual pairing-code entry → claim → test.
    private func claimManualCode() {
        Task {
            claiming = true
            defer { claiming = false }
            testState = .testing
            if let err = await model.applyPairingCode(host: model.host, port: model.port, code: manualCode) {
                testState = .failure(err)
            } else {
                manualCode = ""
                scannedTick += 1
                await runTest()
            }
        }
    }
}

// ── Help sub-views ──────────────────────────────────────────────────────

private struct StepRow: View {
    let n: Int
    let text: String
    let code: String?

    var body: some View {
        HStack(alignment: .top, spacing: 10) {
            Text("\(n)")
                .font(.caption.monospaced().bold())
                .foregroundStyle(UsageLevel.ok.color)
                .frame(width: 20, height: 20)
                .background(UsageLevel.ok.color.opacity(0.15), in: Circle())
            VStack(alignment: .leading, spacing: 5) {
                Text(text).font(.footnote)
                if let code {
                    Text(code)
                        .font(.caption.monospaced())
                        .foregroundStyle(.secondary)
                        .padding(.horizontal, 8).padding(.vertical, 5)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .background(Color.white.opacity(0.06), in: RoundedRectangle(cornerRadius: 7))
                        .textSelection(.enabled)
                }
            }
        }
    }
}

private struct TipRow: View {
    let text: String
    init(_ text: String) { self.text = text }
    var body: some View {
        HStack(alignment: .top, spacing: 8) {
            Image(systemName: "circle.fill").font(.system(size: 5)).foregroundStyle(.secondary).padding(.top, 6)
            Text(text).font(.footnote)
        }
    }
}
