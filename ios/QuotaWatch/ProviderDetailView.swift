import SwiftUI

/// Per-provider detail — a big dial per window with its full readout
/// (used/remaining, absolute reset time). Dark instrument aesthetic.
struct ProviderDetailView: View {
    let provider: QuotaProvider
    private var style: ProviderStyle { ProviderStyle.of(provider.providerType) }

    var body: some View {
        ZStack {
            Theme.canvas
            ScrollView {
                VStack(spacing: 16) {
                    header
                    if provider.windows.isEmpty {
                        ContentUnavailableView("等待采集", systemImage: "hourglass",
                                               description: Text("daemon 还没为该渠道采集到数据"))
                            .padding(.top, 40)
                    } else {
                        ForEach(provider.sortedWindows) { window in
                            WindowDetailCard(window: window)
                        }
                    }
                }
                .padding(.horizontal, 16)
                .padding(.bottom, 30)
            }
            .scrollIndicators(.hidden)
        }
        .navigationTitle(provider.displayName)
        .navigationBarTitleDisplayMode(.inline)
    }

    private var header: some View {
        HStack(spacing: 13) {
            ProviderBadge(style: style, size: 48)
            VStack(alignment: .leading, spacing: 2) {
                Text(provider.displayName).font(.qwDisplay(20)).foregroundStyle(Theme.ink)
                Text(provider.providerType).font(.qwLabel(11)).foregroundStyle(Theme.ink3)
            }
            Spacer()
        }
        .padding(.top, 8)
    }
}

private struct WindowDetailCard: View {
    let window: QuotaWindow

    var body: some View {
        let level = UsageLevel(remainingPct: window.remainingPct)
        HStack(spacing: 18) {
            RingGauge(usedPct: window.usedPct, level: level,
                      caption: window.windowKind.label, diameter: 96, lineWidth: 10)

            VStack(alignment: .leading, spacing: 8) {
                HStack(spacing: 7) {
                    Text(window.windowName).font(.system(size: 16, weight: .semibold))
                        .foregroundStyle(Theme.ink)
                    Text(level.label)
                        .font(.qwLabel(10)).foregroundStyle(level.color)
                        .padding(.horizontal, 7).padding(.vertical, 2)
                        .background(level.color.opacity(0.14), in: Capsule())
                }
                infoRow("已用", "\(Int(window.usedPct.rounded()))%")
                infoRow("剩余", "\(Int(window.remainingPct.rounded()))%")
                if window.unit != "percent" {
                    infoRow("用量", "\(fmt(window.used)) / \(fmt(window.total)) \(window.unit)")
                }
                infoRow("重置", absoluteReset(window))
            }
            Spacer(minLength: 0)
        }
        .padding(18)
        .frame(maxWidth: .infinity)
        .background(InstrumentCard(shape: RoundedRectangle(cornerRadius: 22, style: .continuous)))
    }

    private func infoRow(_ label: String, _ value: String) -> some View {
        HStack {
            Text(label).font(.qwLabel(11)).foregroundStyle(Theme.ink3)
            Spacer()
            Text(value).font(.qwNum(12, .medium)).foregroundStyle(Theme.ink2)
        }
    }

    private func fmt(_ v: Double) -> String {
        v >= 1_000_000 ? String(format: "%.1fM", v / 1_000_000)
            : v >= 1_000 ? String(format: "%.1fK", v / 1_000)
            : v == v.rounded() ? String(format: "%.0f", v)
            : String(format: "%.1f", v)
    }

    private func absoluteReset(_ window: QuotaWindow) -> String {
        guard let date = window.resetDate else { return "—" }
        let f = DateFormatter()
        f.dateFormat = "MM-dd HH:mm"
        let rel = Formatting.resetCountdown(date).map { "（\($0)后）" } ?? ""
        return f.string(from: date) + rel
    }
}
