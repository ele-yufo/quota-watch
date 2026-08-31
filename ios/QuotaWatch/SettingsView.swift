import SwiftUI

/// 设置 —— 连接信息以可核对的等宽文本呈现，token 默认遮罩；
/// Demo 模式与真实连接清楚分离，避免误把示例值当成生产数据。
struct SettingsView: View {
    @Environment(AppModel.self) private var model

    @State private var testState: TestState = .idle
    @State private var showPairing = false
    @State private var scannedTick = 0

    private enum TestState: Equatable {
        case idle, testing
        case success(providerCount: Int)
        case failure(String)
    }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 0) {
                connectionSection
                SectionHeader("配对另一台 Mac")
                pairingButton
                SectionHeader("监控")
                monitoringSection
                SectionHeader("显示")
                displaySection
                SectionHeader("Demo 模式")
                demoSection
                SectionHeader("关于")
                aboutSection
                helpSection
            }
            .padding(.horizontal, QWPagePadding)
            .padding(.bottom, 40)
        }
        .scrollIndicators(.hidden)
        .background(QWColor.background)
        .navigationTitle("设置")
        .navigationBarTitleDisplayMode(.inline)
        .sheet(isPresented: $showPairing) { PairingSheetView() }
        .sensoryFeedback(trigger: testState) { _, new in
            switch new {
            case .success: return .success
            case .failure: return .error
            default: return nil
            }
        }
        .sensoryFeedback(.success, trigger: scannedTick)
    }

    // ── 连接 ────────────────────────────────────────────────────────────

    private var connectionSection: some View {
        VStack(alignment: .leading, spacing: 0) {
            SectionHeader("连接")

            HStack(spacing: 8) {
                Circle()
                    .fill(statusColor)
                    .frame(width: 6, height: 6)
                Text(statusTitle)
                    .font(.system(size: 15, weight: .medium))
                    .foregroundStyle(QWColor.foreground)
                Spacer()
                if testState == .testing {
                    ProgressView().tint(QWColor.accent)
                } else if case .success = testState {
                    Text("最近同步 · 刚刚")
                        .font(.system(size: 12))
                        .foregroundStyle(QWColor.subtle)
                } else if case .failure = testState {
                    Text("测试失败")
                        .font(.system(size: 12))
                        .foregroundStyle(QWColor.danger)
                }
            }
            .padding(.vertical, 10)
            Hairline()

            SettingRow(label: "Host", value: model.host.isEmpty ? "未设置" : model.host, mono: true)
            Hairline()
            SettingRow(label: "Port", value: "\(model.port)", mono: true)
            Hairline()
            SettingRow(label: "Token", value: maskedToken, mono: true)
            Hairline()

            Button {
                Task { await runTest() }
            } label: {
                HStack {
                    Text("测试连接")
                        .font(.system(size: 15, weight: .medium))
                        .foregroundStyle(QWColor.foreground)
                    Spacer()
                    if case let .success(count) = testState {
                        Text("\(count) 渠道 · 在线")
                            .font(.qwMono(11))
                            .foregroundStyle(QWColor.success)
                    } else if case let .failure(msg) = testState {
                        Text(msg)
                            .font(.qwMono(11))
                            .foregroundStyle(QWColor.danger)
                            .lineLimit(1)
                    }
                }
                .padding(.vertical, 12)
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .disabled(model.host.trimmingCharacters(in: .whitespaces).isEmpty || testState == .testing)

            DisclosureGroup {
                VStack(alignment: .leading, spacing: 12) {
                    StepRow(n: 1, text: "在 Mac 上启动采集 daemon（状态栏 app 或命令行）。", code: "quota-watch daemon start --lan")
                    StepRow(n: 2, text: "点 Mac 菜单栏的 quota-watch →「配对」，弹出二维码 + 6 位配对码。", code: nil)
                    StepRow(n: 3, text: "点上面的「扫描或输入配对码」完成连接。", code: nil)
                    StepRow(n: 4, text: "确保手机和 Mac 在同一个 Wi-Fi（或已配好隧道）。", code: nil)
                    TipRow("连不上？确认 daemon 用 --lan 启动（普通 start 只绑回环）；临时关掉 Mac 上的代理 / VPN。")
                }
                .padding(.vertical, 4)
            } label: {
                Text("如何连接 / 常见排查")
                    .font(.system(size: 14))
                    .foregroundStyle(QWColor.muted)
            }
            .padding(.vertical, 6)
        }
    }

    private var maskedToken: String {
        guard model.token.count > 8 else { return model.token.isEmpty ? "未设置" : "••••" }
        return "\(model.token.prefix(3))••••••••\(model.token.suffix(4))"
    }

    private var statusColor: Color {
        switch testState {
        case .success: return QWColor.success
        case .failure: return QWColor.danger
        default: return model.isConfigured ? QWColor.warning : QWColor.subtle
        }
    }
    private var statusTitle: String {
        switch testState {
        case .success: return "已连接"
        case .failure: return "连接失败"
        default: return model.isConfigured ? "已配置，未测试" : "未连接"
        }
    }

    // ── 配对 ────────────────────────────────────────────────────────────

    private var pairingButton: some View {
        Button {
            showPairing = true
        } label: {
            HStack {
                Text("扫描或输入配对码")
                    .font(.system(size: 15, weight: .medium))
                    .foregroundStyle(QWColor.accent)
                Spacer()
                Image(systemName: "chevron.right")
                    .font(.system(size: 12, weight: .semibold))
                    .foregroundStyle(QWColor.subtle)
            }
            .padding(.vertical, 12)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .padding(.bottom, QWTokens.Space.sm)
    }

    // ── 监控 ────────────────────────────────────────────────────────────

    private var monitoringSection: some View {
        VStack(alignment: .leading, spacing: 0) {
            SettingRow(label: "自动刷新", value: "近实时 · 每 10 秒")
            Hairline()
            SettingRow(label: "低配额提醒", value: "剩余低于 10% 置顶")
        }
    }

    // ── 显示 ────────────────────────────────────────────────────────────

    private var displaySection: some View {
        VStack(alignment: .leading, spacing: 0) {
            SettingRow(label: "外观", value: "跟随系统")
            Hairline()
            HStack {
                Text("默认视角")
                    .font(.system(size: 15))
                    .foregroundStyle(QWColor.foreground)
                Spacer()
                Picker("默认视角", selection: Binding(
                    get: { model.displayMode },
                    set: { model.displayMode = $0 }
                )) {
                    ForEach(QuotaDisplayMode.allCases, id: \.self) { m in
                        Text(m.label).tag(m)
                    }
                }
                .pickerStyle(.segmented)
                .frame(width: 130)
            }
            .padding(.vertical, 8)
        }
    }

    // ── Demo 模式 ───────────────────────────────────────────────────────

    private var demoSection: some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack(spacing: 8) {
                Text(model.demoMode ? "Demo 模式 · 未连接采集器" : "使用示例数据，不连接采集器")
                    .font(.system(size: 15))
                    .foregroundStyle(model.demoMode ? QWColor.warning : QWColor.muted)
                Spacer()
                Button(model.demoMode ? "退出示例模式" : "进入示例模式") {
                    withAnimation(QWTokens.Motion.reveal) {
                        if model.demoMode { model.exitDemo() } else { model.enterDemo() }
                    }
                }
                .font(.system(size: 14, weight: .medium))
                .foregroundStyle(model.demoMode ? QWColor.danger : QWColor.accent)
                .buttonStyle(.plain)
            }
            .padding(.vertical, 12)
        }
    }

    // ── 关于 ────────────────────────────────────────────────────────────

    private var aboutSection: some View {
        VStack(alignment: .leading, spacing: 0) {
            SettingRow(label: "版本", value: appVersion)
            Hairline()
            HStack(alignment: .top, spacing: 8) {
                Image(systemName: "lock.fill")
                    .font(.system(size: 11))
                    .foregroundStyle(QWColor.success)
                    .padding(.top, 12)
                Text("配额数据只在你的局域网 / 隧道内传输，不经任何云端。")
                    .font(.system(size: 13))
                    .foregroundStyle(QWColor.subtle)
                    .lineSpacing(3)
                    .padding(.vertical, 10)
            }
        }
    }

    private var helpSection: some View {
        DisclosureGroup {
            TipRow("Token 可以直接填在设置里（仅当你知道自己在做什么）；一般用配对码即可。")
        } label: {
            Text("高级：直接填 Token")
                .font(.system(size: 13))
                .foregroundStyle(QWColor.muted)
        }
        .padding(.vertical, 6)
    }

    private var appVersion: String {
        let v = Bundle.main.infoDictionary?["CFBundleShortVersionString"] as? String ?? "—"
        let b = Bundle.main.infoDictionary?["CFBundleVersion"] as? String ?? "—"
        return "\(v) (\(b))"
    }

    // ── 动作 ────────────────────────────────────────────────────────────

    private func runTest() async {
        testState = .testing
        switch await model.testConnection() {
        case let .success(health):
            testState = .success(providerCount: health.providers.count)
            await model.refresh()
        case let .failure(error):
            testState = .failure(error.errorDescription ?? "失败")
        }
    }
}

// ── 分区与行组件 ────────────────────────────────────────────────────────

private struct SectionHeader: View {
    let title: String
    init(_ title: String) { self.title = title }

    var body: some View {
        Text(title)
            .font(.system(size: 13, weight: .medium))
            .foregroundStyle(QWColor.subtle)
            .padding(.top, QWTokens.Space.xl)
            .padding(.bottom, QWTokens.Space.sm)
    }
}

private struct SettingRow: View {
    let label: String
    let value: String
    var mono = false

    var body: some View {
        HStack {
            Text(label)
                .font(.system(size: 15))
                .foregroundStyle(QWColor.foreground)
            Spacer()
            Text(value)
                .font(mono ? .qwMono(12) : .system(size: 15))
                .foregroundStyle(mono ? QWColor.muted : QWColor.muted)
                .lineLimit(1)
                .minimumScaleFactor(0.8)
        }
        .padding(.vertical, 10)
    }
}

private struct StepRow: View {
    let n: Int
    let text: String
    let code: String?

    var body: some View {
        HStack(alignment: .top, spacing: 10) {
            Text("\(n)")
                .font(.system(size: 12, weight: .bold))
                .foregroundStyle(QWColor.accent)
                .frame(width: 20, height: 20)
                .background(QWColor.accent.opacity(0.14), in: Circle())
            VStack(alignment: .leading, spacing: 5) {
                Text(text).font(.system(size: 13)).foregroundStyle(QWColor.foreground)
                if let code {
                    Text(code)
                        .font(.qwMono(11))
                        .foregroundStyle(QWColor.muted)
                        .padding(.horizontal, 8).padding(.vertical, 5)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .background(QWColor.surface2, in: RoundedRectangle(cornerRadius: 7))
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
            Image(systemName: "circle.fill")
                .font(.system(size: 5))
                .foregroundStyle(QWColor.subtle)
                .padding(.top, 6)
            Text(text).font(.system(size: 13)).foregroundStyle(QWColor.subtle)
        }
    }
}
