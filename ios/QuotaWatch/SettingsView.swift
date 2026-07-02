import SwiftUI

/// Connection settings — QR pairing (primary), manual entry, a live connection
/// test, and genuine step-by-step help + troubleshooting so a first-time user
/// can actually get connected.
struct SettingsView: View {
    @Environment(AppModel.self) private var model

    @State private var testState: TestState = .idle
    @State private var showScanner = false
    @State private var scannedTick = 0

    private enum TestState: Equatable {
        case idle, testing
        case success(providerCount: Int, uptimeSec: Int)
        case failure(String)
    }

    var body: some View {
        @Bindable var model = model

        Form {
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
                model.applyPairing(payload)
                scannedTick += 1
                testState = .idle
                Task { await runTest() }
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
            Text("在 Mac 上运行 `quota-watch connect --qr`，用「扫码配对」扫终端里的二维码，主机 / 端口 / Token 会自动填好。")
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
            LabeledContent("Token") {
                SecureField("可选", text: model.token)
                    .multilineTextAlignment(.trailing)
                    .textInputAutocapitalization(.never).autocorrectionDisabled()
            }
        } header: {
            Text("手动填写")
        } footer: {
            Text("`quota-watch connect` 会打印这三项。回环 / 同机免 Token；局域网或公网需要 Token。")
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
                    StepRow(n: 1, text: "在 Mac 上开启局域网采集：", code: "quota-watch daemon start --lan")
                    StepRow(n: 2, text: "生成配对二维码：", code: "quota-watch connect --qr")
                    StepRow(n: 3, text: "点上面的「扫码配对」，扫终端里那张二维码。", code: nil)
                    StepRow(n: 4, text: "确保手机和 Mac 在同一个 Wi-Fi。", code: nil)
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
