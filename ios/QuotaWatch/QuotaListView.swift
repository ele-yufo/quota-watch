import SwiftUI

/// 主界面 —— 开放版面替代卡片墙。
/// 信息语法：窗口名称先于百分比，百分比先于用量，重置倒计时以等宽数字贴近数据。
/// 顶部：页面标题 + 全局视角分段；最紧张窗口置顶（大表盘）；下方 hairline
/// 分隔的 provider 列表行。异常用颜色 + 文字 + 结构多通道表达。
struct QuotaListView: View {
    @Environment(AppModel.self) private var model
    @Environment(\.scenePhase) private var scenePhase

    @State private var pullTick = 0
    @State private var detail: QuotaProvider?

    var body: some View {
        NavigationStack {
            Group {
                if !model.isConfigured {
                    WelcomeView()
                } else if model.providers.isEmpty && model.lastUpdated == nil && !model.initialLoadFailed {
                    LoadingStateView()
                } else if model.providers.isEmpty {
                    ErrorStateView(error: model.lastAPIError) {
                        Task { await model.refresh() }
                    }
                } else {
                    quotaContent
                }
            }
            .background(QWColor.background)
            .toolbar(.hidden, for: .navigationBar)
            .navigationDestination(item: $detail) { ProviderDetailView(provider: $0) }
        }
        .onChange(of: scenePhase) { _, phase in
            if phase == .active { model.startAutoRefresh() } else { model.stopAutoRefresh() }
        }
        .task { model.startAutoRefresh() }
        .sensoryFeedback(.impact(weight: .light), trigger: pullTick)
        .sensoryFeedback(.selection, trigger: detail?.id)
        .sensoryFeedback(trigger: model.criticalCount) { old, new in new > old ? .warning : nil }
    }

    // ── 版面 ────────────────────────────────────────────────────────────

    private var quotaContent: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 0) {
                titleRow
                statusRow
                Hairline()

                if model.showAlert {
                    QuotaAlert(
                        count: model.criticalCount,
                        urgent: model.criticalWindows.min { $0.window.remainingPct < $1.window.remainingPct },
                        mode: model.displayMode,
                        onDismiss: { withAnimation(QWTokens.Motion.reveal) { model.dismissAlert() } }
                    )
                    .transition(.move(edge: .top).combined(with: .opacity))
                }

                if model.loadError != nil {
                    StaleBanner(updatedAt: model.lastUpdated)
                }

                if let hero = model.mostUrgent {
                    HeroWindow(provider: hero.provider, window: hero.window,
                               mode: model.displayMode) { detail = hero.provider }
                        .padding(.top, QWTokens.Space.xl)
                        .qwStale(model.loadError != nil)
                }

                providerList
            }
            .padding(.horizontal, QWPagePadding)
            .padding(.bottom, 40)
        }
        .scrollIndicators(.hidden)
        .refreshable {
            await model.pollNow()
            pullTick += 1
        }
    }

    private var titleRow: some View {
        HStack(alignment: .center, spacing: QWTokens.Space.md) {
            Text("配额")
                .font(.qwDisplay(34))
                .foregroundStyle(QWColor.foreground)
            Spacer(minLength: 0)
            ModeSegment(mode: model.displayMode) {
                withAnimation(QWTokens.Motion.reveal) { model.toggleDisplayMode() }
            }
        }
        .padding(.top, QWTokens.Space.lg)
    }

    private var statusRow: some View {
        HStack(spacing: QWTokens.Space.sm) {
            HStack(spacing: 6) {
                Circle()
                    .fill(model.isPolling ? QWColor.success : QWColor.muted)
                    .frame(width: 6, height: 6)
                Text(model.isPolling ? "采集中" : "实时")
                    .font(.system(size: 13))
                    .foregroundStyle(QWColor.muted)
                if let updatedAt = model.lastUpdated {
                    Text("· \(Formatting.ago(updatedAt)) 前")
                        .font(.qwMono(11))
                        .foregroundStyle(QWColor.subtle)
                }
            }
            Spacer()
            Button { Task { await model.pollNow() } } label: {
                IconCircle(system: "arrow.clockwise")
            }
            .buttonStyle(.plain)
            NavigationLink(destination: SettingsView()) {
                IconCircle(system: "gearshape")
            }
            .buttonStyle(.plain)
        }
        .padding(.vertical, QWTokens.Space.sm)
    }

    private var providerList: some View {
        VStack(alignment: .leading, spacing: 0) {
            ForEach(Array(model.providers.enumerated()), id: \.element.id) { idx, provider in
                if idx > 0 { Hairline() }
                ProviderRow(provider: provider, mode: model.displayMode,
                            stale: model.loadError != nil) { detail = provider }
            }
        }
        .qwStale(model.loadError != nil)
    }
}

// ── 标题行：全局视角分段（剩余 / 已用） ─────────────────────────────────

private struct ModeSegment: View {
    let mode: QuotaDisplayMode
    let onToggle: () -> Void

    var body: some View {
        HStack(spacing: 2) {
            segment(.used)
            segment(.remaining)
        }
        .padding(2)
        .background(QWColor.surface2, in: RoundedRectangle(cornerRadius: QWTokens.Radius.control, style: .continuous))
    }

    private func segment(_ m: QuotaDisplayMode) -> some View {
        let selected = m == mode
        return Button {
            if !selected { onToggle() }
        } label: {
            Text(m.label)
                .font(.system(size: 14, weight: .medium))
                .foregroundStyle(selected ? QWColor.accentInk : QWColor.muted)
                .frame(width: 68, height: 40)
                .background(selected ? QWColor.accent : .clear,
                            in: RoundedRectangle(cornerRadius: QWTokens.Radius.control - 4, style: .continuous))
                .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
    }
}

// ── 告警：插入信息流的一段有上下边界的短消息，不是圆角卡片 ───────────────

private struct QuotaAlert: View {
    let count: Int
    let urgent: (provider: QuotaProvider, window: QuotaWindow)?
    var mode: QuotaDisplayMode = .used
    let onDismiss: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            HStack(alignment: .firstTextBaseline, spacing: 8) {
                Text(headline)
                    .font(.system(size: 16, weight: .semibold))
                    .foregroundStyle(QWColor.danger)
                Spacer(minLength: 4)
                Button(action: onDismiss) {
                    Image(systemName: "xmark")
                        .font(.system(size: 12, weight: .bold))
                        .foregroundStyle(QWColor.subtle)
                        .frame(width: 32, height: 32)
                }
                .buttonStyle(.plain)
                .accessibilityLabel("消除告警")
            }
            if let urgent, let reset = Formatting.resetCountdown(urgent.window.resetDate) {
                HStack(spacing: 5) {
                    Text(reset)
                        .font(.qwMono(12, .bold))
                        .foregroundStyle(QWColor.muted)
                    Text("后重置 · 已置顶")
                        .font(.system(size: 13))
                        .foregroundStyle(QWColor.subtle)
                }
            }
        }
        .padding(.vertical, QWTokens.Space.lg)
        .overlay(alignment: .bottom) { Hairline() }
        .contentShape(Rectangle())
    }

    private var headline: String {
        guard let urgent else { return "\(count) 个窗口额度告急" }
        let pct = Int(urgent.window.displayPct(mode).rounded())
        if count > 1 {
            return "\(count) 个窗口告急 · 最紧张 \(urgent.provider.displayName) \(urgent.window.windowKind.displayName) 只剩 \(pct)%"
        }
        return "\(urgent.provider.displayName) \(urgent.window.windowKind.displayName)额度只剩 \(pct)%"
    }
}

// ── 最紧张窗口（hero）：大表盘 + 编辑级数字 ──────────────────────────────

private struct HeroWindow: View {
    let provider: QuotaProvider
    let window: QuotaWindow
    var mode: QuotaDisplayMode = .used
    let onTap: () -> Void

    private var level: UsageLevel { UsageLevel(remainingPct: window.remainingPct) }

    var body: some View {
        Button(action: onTap) {
            HStack(alignment: .center, spacing: QWTokens.Space.xl) {
                RingGauge(pct: window.displayPct(mode), level: level, diameter: 116)
                VStack(alignment: .leading, spacing: 5) {
                    Text("\(provider.displayName) · 最紧张窗口")
                        .font(.system(size: 13))
                        .foregroundStyle(QWColor.subtle)
                    HStack(alignment: .firstTextBaseline, spacing: 6) {
                        Text("\(Int(window.displayPct(mode).rounded()))")
                            .font(.qwDisplay(44))
                            .foregroundStyle(level.color)
                            .contentTransition(.numericText(value: window.displayPct(mode)))
                            .animation(QWTokens.Motion.number, value: window.displayPct(mode))
                        Text(mode.label)
                            .font(.qwDisplay(20))
                            .foregroundStyle(QWColor.muted)
                    }
                    if let reset = Formatting.resetCountdown(window.resetDate) {
                        HStack(spacing: 5) {
                            Text(window.windowKind.rawValue.uppercased())
                                .font(.qwMono(11, .bold))
                                .foregroundStyle(QWColor.muted)
                            Text("· \(reset) 后重置")
                                .font(.qwMono(12))
                                .foregroundStyle(QWColor.subtle)
                        }
                    }
                }
                Spacer(minLength: 0)
            }
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .padding(.vertical, QWTokens.Space.xl)
    }
}

// ── Provider 列表行：64pt，图标 + 最需要关注的窗口 + 重置时间 + 小表盘 ───

private struct ProviderRow: View {
    let provider: QuotaProvider
    var mode: QuotaDisplayMode = .used
    var stale = false
    let onTap: () -> Void

    private var style: ProviderStyle { ProviderStyle.of(provider.providerType) }

    var body: some View {
        Button(action: onTap) {
            HStack(spacing: QWTokens.Space.md) {
                ProviderBadge(style: style, size: 34)
                VStack(alignment: .leading, spacing: 3) {
                    Text(provider.displayName)
                        .font(.system(size: 16, weight: .semibold))
                        .foregroundStyle(QWColor.foreground)
                    if let w = provider.primary {
                        HStack(spacing: 5) {
                            Text(w.windowKind.displayName)
                                .font(.system(size: 13))
                                .foregroundStyle(QWColor.muted)
                            if let reset = Formatting.resetCountdown(w.resetDate) {
                                Text("· \(reset) 后重置")
                                    .font(.qwMono(11))
                                    .foregroundStyle(QWColor.subtle)
                            }
                        }
                    } else {
                        Text("等待采集…")
                            .font(.system(size: 13))
                            .foregroundStyle(QWColor.subtle)
                    }
                }
                Spacer(minLength: 4)
                if let w = provider.primary {
                    RingGauge(pct: w.displayPct(mode),
                              level: UsageLevel(remainingPct: w.remainingPct),
                              diameter: 40, lineWidth: 5)
                }
            }
            .frame(minHeight: 64)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .qwStale(stale)
    }
}

// ── 工具按钮 ────────────────────────────────────────────────────────────

struct IconCircle: View {
    let system: String
    var body: some View {
        Image(systemName: system)
            .font(.system(size: 16, weight: .medium))
            .foregroundStyle(QWColor.muted)
            .frame(width: 44, height: 44)
            .background(QWColor.surface, in: Circle())
            .overlay(Circle().strokeBorder(QWColor.border))
    }
}
