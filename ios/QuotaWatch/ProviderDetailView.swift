import SwiftUI

/// 单个订阅详情 —— 每个窗口是独立的信息段（hairline 分隔），不是独立卡片。
/// 阅读顺序统一：表盘 → 窗口名 → 用量 → 重置，避免把不同时间尺度混成"综合分"。
struct ProviderDetailView: View {
    @Environment(AppModel.self) private var model
    let provider: QuotaProvider
    private var style: ProviderStyle { ProviderStyle.of(provider.providerType) }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 0) {
                header
                if provider.windows.isEmpty {
                    ContentUnavailableView("等待采集", systemImage: "hourglass",
                                           description: Text("daemon 还没为该渠道采集到数据"))
                        .padding(.top, 40)
                } else {
                    ForEach(Array(provider.sortedWindows.enumerated()), id: \.element.id) { idx, window in
                        if idx > 0 { Hairline().padding(.vertical, QWTokens.Space.sm) }
                        WindowSegment(window: window, mode: model.displayMode)
                    }
                }
            }
            .padding(.horizontal, QWPagePadding)
            .padding(.bottom, 30)
        }
        .scrollIndicators(.hidden)
        .background(QWColor.background)
        .navigationTitle(provider.displayName)
        .navigationBarTitleDisplayMode(.inline)
    }

    private var header: some View {
        HStack(spacing: 13) {
            ProviderBadge(style: style, size: 44)
            VStack(alignment: .leading, spacing: 2) {
                Text(provider.displayName)
                    .font(.qwDisplay(20))
                    .foregroundStyle(QWColor.foreground)
                HStack(spacing: 8) {
                    if model.demoMode {
                        demoTag
                    }
                    if model.lastUpdated != nil {
                        Text("刚刚同步")
                            .font(.system(size: 12))
                            .foregroundStyle(QWColor.subtle)
                    }
                }
            }
            Spacer()
        }
        .padding(.vertical, QWTokens.Space.md)
    }

    private var demoTag: some View {
        Text("DEMO DATA")
            .font(.qwMono(10, .bold))
            .foregroundStyle(QWColor.warning)
            .padding(.horizontal, 6).padding(.vertical, 2)
            .overlay(RoundedRectangle(cornerRadius: 4).strokeBorder(QWColor.warning.opacity(0.6)))
    }
}

// ── 窗口信息段 ──────────────────────────────────────────────────────────

private struct WindowSegment: View {
    let window: QuotaWindow
    var mode: QuotaDisplayMode = .used

    private var level: UsageLevel { UsageLevel(remainingPct: window.remainingPct) }

    var body: some View {
        HStack(alignment: .center, spacing: QWTokens.Space.xl) {
            RingGauge(pct: window.displayPct(mode), level: level,
                      caption: mode.label, diameter: 84)
            VStack(alignment: .leading, spacing: 6) {
                Text(cleanName)
                    .font(.system(size: 17, weight: .semibold))
                    .foregroundStyle(QWColor.foreground)
                if window.unit != "percent" {
                    HStack(spacing: 5) {
                        Text(fmt(window.used))
                            .font(.qwMono(13, .bold))
                            .foregroundStyle(QWColor.foreground)
                        Text("/ \(fmt(window.total)) \(window.unit)")
                            .font(.qwMono(13))
                            .foregroundStyle(QWColor.subtle)
                    }
                }
                if let date = window.resetDate {
                    HStack(spacing: 5) {
                        Text("重置")
                            .font(.system(size: 12))
                            .foregroundStyle(QWColor.subtle)
                        Text(absoluteReset(date))
                            .font(.qwMono(12))
                            .foregroundStyle(QWColor.muted)
                    }
                }
            }
            Spacer(minLength: 0)
        }
        .padding(.vertical, QWTokens.Space.md)
    }

    /// "session (5h)" → "Session"；没有窗口名时退回类型中文
    private var cleanName: String {
        let trimmed = Formatting.cleanWindowName(window.windowName).trimmingCharacters(in: .whitespaces)
        if !trimmed.isEmpty {
            return trimmed.prefix(1).uppercased() + trimmed.dropFirst()
        }
        return window.windowKind.displayName
    }

    private func fmt(_ v: Double) -> String {
        v >= 1_000_000 ? String(format: "%.1fM", v / 1_000_000)
            : v >= 1_000 ? String(format: "%.1fK", v / 1_000)
            : v == v.rounded() ? String(format: "%.0f", v)
            : String(format: "%.1f", v)
    }

    /// 7 天内：周几 HH:mm；更远：M 月 d 日。倒计时补全大写。
    private func absoluteReset(_ date: Date) -> String {
        let days = Calendar.current.dateComponents([.day], from: Date(), to: date).day ?? 0
        let f = DateFormatter()
        f.locale = Locale(identifier: "zh_CN")
        f.dateFormat = days <= 7 ? "E HH:mm" : "M 月 d 日"
        let rel = Formatting.resetCountdown(date).map { $0.uppercased() } ?? ""
        return "\(f.string(from: date)) · \(rel)"
    }
}
