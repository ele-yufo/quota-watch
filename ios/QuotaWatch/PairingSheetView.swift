import SwiftUI

/// 配对页 —— 扫码与手动代码是同一任务的两种路径，用分段控制切换；
/// 页面始终只有一个实心主按钮。
enum PairingMode: String {
    case scan, manual
}

struct PairingSheetView: View {
    @Environment(AppModel.self) private var model
    @Environment(\.dismiss) private var dismiss

    @State private var mode: PairingMode
    @State private var showScanner = false
    @State private var manualCode = ""
    @State private var manualHost = ""
    @State private var claiming = false
    @State private var errorText: String?
    @State private var pairedTick = 0

    init(initialMode: PairingMode = .scan) {
        _mode = State(initialValue: initialMode)
    }

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 0) {
                    modeSegment
                        .padding(.top, QWTokens.Space.lg)
                        .padding(.bottom, QWTokens.Space.xl)

                    switch mode {
                    case .scan: scanPane
                    case .manual: manualPane
                    }

                    if let errorText {
                        Text(errorText)
                            .font(.system(size: 13))
                            .foregroundStyle(QWColor.danger)
                            .padding(.top, QWTokens.Space.md)
                    }
                }
                .padding(.horizontal, QWPagePadding)
            }
            .scrollIndicators(.hidden)
            .background(QWColor.background)
            .navigationTitle("配对 Mac")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Button("完成") { dismiss() }
                        .foregroundStyle(QWColor.accent)
                }
            }
            .sheet(isPresented: $showScanner) {
                QRScannerView { payload in handleScanned(payload) }
            }
        }
        .presentationDetents([.medium, .large])
        .sensoryFeedback(.success, trigger: pairedTick)
    }

    // ── 分段：扫描配对码 / 手动配对 ─────────────────────────────────────

    private var modeSegment: some View {
        HStack(spacing: 2) {
            segment(.scan, label: "扫描配对码")
            segment(.manual, label: "手动配对")
        }
        .padding(2)
        .background(QWColor.surface2, in: RoundedRectangle(cornerRadius: QWTokens.Radius.control, style: .continuous))
    }

    private func segment(_ m: PairingMode, label: String) -> some View {
        let selected = m == mode
        return Button {
            withAnimation(QWTokens.Motion.reveal) { mode = m }
        } label: {
            Text(label)
                .font(.system(size: 14, weight: .medium))
                .foregroundStyle(selected ? QWColor.accentInk : QWColor.muted)
                .frame(maxWidth: .infinity)
                .frame(height: 40)
                .background(selected ? QWColor.accent : .clear,
                            in: RoundedRectangle(cornerRadius: QWTokens.Radius.control - 4, style: .continuous))
                .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
    }

    // ── 扫描 ────────────────────────────────────────────────────────────

    private var scanPane: some View {
        VStack(alignment: .leading, spacing: 0) {
            Text("将 Mac 上的配对码放入框内")
                .font(.system(size: 15, weight: .medium))
                .foregroundStyle(QWColor.foreground)
                .padding(.bottom, QWTokens.Space.md)

            primaryButton("开始扫描") { showScanner = true }

            Text("使用 VisionKit 识别二维码；画面不会保存。")
                .font(.system(size: 12))
                .foregroundStyle(QWColor.subtle)
                .padding(.top, QWTokens.Space.md)
                .padding(.bottom, QWTokens.Space.xl)

            Hairline()
                .padding(.bottom, QWTokens.Space.lg)

            Text("在 Mac 菜单栏的 quota-watch 采集器中打开「手动配对」，输入显示的 6 位代码。")
                .font(.system(size: 13))
                .foregroundStyle(QWColor.subtle)
                .lineSpacing(3)
        }
    }

    // ── 手动 ────────────────────────────────────────────────────────────

    private var manualPane: some View {
        VStack(alignment: .leading, spacing: 0) {
            LabeledContent("主机") {
                TextField("192.168.1.24", text: $manualHost)
                    .multilineTextAlignment(.trailing)
                    .textInputAutocapitalization(.never).autocorrectionDisabled()
                    .keyboardType(.URL)
                    .font(.qwMono(12))
                    .foregroundStyle(QWColor.foreground)
            }
            .padding(.vertical, 10)
            Hairline()

            LabeledContent("配对码") {
                TextField("6 位数字", text: $manualCode)
                    .multilineTextAlignment(.trailing)
                    .keyboardType(.numberPad)
                    .textContentType(.oneTimeCode)
                    .font(.qwMono(12, .bold))
                    .foregroundStyle(QWColor.foreground)
            }
            .padding(.vertical, 10)
            Hairline()
                .padding(.bottom, QWTokens.Space.xl)

            primaryButton("连接到 Mac", busy: claiming) { claimManualCode() }

            Text("连接成功后会自动写入主机、端口与 token；之后可在设置中检查和更新。")
                .font(.system(size: 12))
                .foregroundStyle(QWColor.subtle)
                .lineSpacing(3)
                .padding(.top, QWTokens.Space.md)
        }
        .onAppear {
            if manualHost.isEmpty {
                manualHost = model.host
            }
        }
    }

    private func primaryButton(_ title: String, busy: Bool = false, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            HStack(spacing: 8) {
                if busy { ProgressView().tint(QWColor.accentInk) }
                Text(title)
                    .font(.system(size: 16, weight: .semibold))
                    .foregroundStyle(QWColor.accentInk)
            }
            .frame(maxWidth: .infinity)
            .frame(height: 50)
            .background(QWColor.accent, in: RoundedRectangle(cornerRadius: QWTokens.Radius.control + 4, style: .continuous))
        }
        .buttonStyle(.plain)
        .disabled(busy)
        .opacity(busy ? 0.7 : 1)
    }

    // ── 动作 ────────────────────────────────────────────────────────────

    /// 扫码结果：短码走 /pair/claim，旧版 token 二维码直接存 token。
    private func handleScanned(_ payload: PairingPayload) {
        Task {
            if let code = payload.code {
                claiming = true
                defer { claiming = false }
                if let err = await model.applyPairingCode(host: payload.host, port: payload.port,
                                                          code: code, caFingerprint: payload.caFingerprint) {
                    errorText = err
                } else {
                    pairedTick += 1
                    dismiss()
                }
            } else {
                model.applyPairing(payload)
                pairedTick += 1
                dismiss()
            }
        }
    }

    private func claimManualCode() {
        guard !manualHost.trimmingCharacters(in: .whitespaces).isEmpty else {
            errorText = "请输入 Mac 的 IP 地址或主机名"
            return
        }
        guard manualCode.count == 6, manualCode.allSatisfy({ $0.isNumber }) else {
            errorText = "配对码是 6 位数字 — 在 Mac 菜单栏点「配对」重新生成"
            return
        }
        Task {
            claiming = true
            defer { claiming = false }
            errorText = nil
            if let err = await model.applyPairingCode(host: manualHost, port: model.port, code: manualCode) {
                errorText = err
            } else {
                pairedTick += 1
                dismiss()
            }
        }
    }
}
