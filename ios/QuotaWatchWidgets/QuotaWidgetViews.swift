import SwiftUI
import WidgetKit

// MARK: - Helpers

private struct WidgetBG: View {
    var body: some View {
        QWColor.background
    }
}

private func pagedSlice<T>(_ all: [T], page: Int, perPage: Int) -> (slice: [T], page: Int, total: Int) {
    let total = max(1, Int(ceil(Double(all.count) / Double(perPage))))
    let cur = ((page % total) + total) % total
    return (Array(all.dropFirst(cur * perPage).prefix(perPage)), cur, total)
}

private struct MiniBar: View {
    let fraction: Double
    let color: Color
    var body: some View {
        GeometryReader { geo in
            ZStack(alignment: .leading) {
                Capsule().fill(QWColor.surface2)
                Capsule().fill(color).frame(width: geo.size.width * max(0.02, min(1, fraction)))
            }
        }
        .frame(height: 3)
    }
}

/// 底部状态行：缓存/实时标识 + 视角 + 最近重置
private struct FootStatus: View {
    let entry: QuotaEntry
    let featured: RankedWindow?

    private var resetText: String? {
        featured.flatMap { Formatting.resetCountdown($0.window.resetDate) }
    }

    var body: some View {
        HStack(spacing: 4) {
            Text(entry.isStale ? "缓存" : "实时")
            if !entry.isStale, let updatedAt = entry.lastUpdated {
                Text("· \(Formatting.ago(updatedAt)) 前")
            }
            Text("· \(entry.displayMode.label)")
            if let resetText {
                Text("· \(resetText) 后重置")
            }
        }
        .font(.qwMono(9))
        .foregroundStyle(QWColor.subtle)
        .lineLimit(1)
        .minimumScaleFactor(0.7)
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}

// MARK: - Provider 行（badge + 名称 + 窗口 + 倒计时 + 百分比）— overview

private struct ProviderRow: View {
    let item: RankedWindow
    let mode: QuotaDisplayMode

    var body: some View {
        HStack(spacing: 8) {
            ProviderBadge(style: .of(item.provider.providerType), size: 22)
            VStack(alignment: .leading, spacing: 2) {
                Text(item.provider.displayName)
                    .font(.system(size: 12, weight: .semibold))
                    .foregroundStyle(QWColor.foreground)
                    .lineLimit(1).minimumScaleFactor(0.85)
                HStack(spacing: 4) {
                    Text(Formatting.cleanWindowName(item.window.windowName))
                        .font(.qwMono(9))
                        .foregroundStyle(QWColor.muted)
                        .lineLimit(1)
                    if let reset = Formatting.resetCountdown(item.window.resetDate) {
                        Text("· \(reset)")
                            .font(.qwMono(9))
                            .foregroundStyle(QWColor.subtle)
                            .lineLimit(1)
                    }
                }
            }
            Spacer(minLength: 4)
            VStack(alignment: .trailing, spacing: 2) {
                Text("\(Int(item.window.displayPct(mode).rounded()))%")
                    .font(.qwMono(12, .bold))
                    .foregroundStyle(item.level.color)
                    .contentTransition(.numericText(value: item.window.displayPct(mode)))
                MiniBar(fraction: item.window.displayFraction(mode), color: item.level.color)
                    .frame(width: 34)
            }
        }
    }
}

// MARK: - Header（wordmark + mode + paging）

private struct PagedHeader: View {
    let entry: QuotaEntry
    let page: Int
    let total: Int
    var large = false

    var body: some View {
        HStack(alignment: .center, spacing: 6) {
            Text("配额一览")
                .font(large ? .qwDisplay(17) : .qwDisplay(14))
                .foregroundStyle(QWColor.foreground)
            Text(entry.displayMode.label)
                .font(.qwMono(8.5))
                .foregroundStyle(QWColor.muted)
                .padding(.horizontal, 5).padding(.vertical, 2)
                .background(QWColor.surface2, in: Capsule())
            Spacer(minLength: 4)
            if total > 1 {
                Button(intent: NextPageIntent()) {
                    HStack(spacing: 4) {
                        Text("\(page + 1)/\(total)").font(.qwMono(10, .bold)).foregroundStyle(QWColor.foreground)
                        Image(systemName: "chevron.forward").font(.system(size: 9.5, weight: .bold)).foregroundStyle(QWColor.foreground)
                    }
                    .padding(.horizontal, 9).padding(.vertical, 4)
                    .background(QWColor.surface2, in: Capsule())
                    .overlay(Capsule().strokeBorder(QWColor.border))
                }
                .buttonStyle(.plain)
            }
        }
    }
}

// MARK: - Featured router (small + accessory)

struct FeaturedWidgetView: View {
    @Environment(\.widgetFamily) private var family
    let entry: QuotaEntry

    var body: some View {
        switch family {
        case .accessoryCircular:    AccessoryCircularView(entry: entry)
        case .accessoryRectangular: AccessoryRectangularView(entry: entry)
        case .accessoryInline:      AccessoryInlineView(entry: entry)
        default:                    SmallWidgetView(entry: entry)
        }
    }
}

// MARK: - Small（聚焦单一窗口：provider + 大数字 + 底部状态）

struct SmallWidgetView: View {
    let entry: QuotaEntry

    private var pinnedProvider: QuotaProvider? {
        guard let sel = entry.selectedProviderId else { return nil }
        return entry.providers.first { $0.providerId == sel }
    }
    private var featured: RankedWindow? {
        if let p = pinnedProvider {
            return p.primary.map { RankedWindow(provider: p, window: $0) }
        }
        return entry.featured
    }

    var body: some View {
        Group {
            if let f = featured {
                VStack(alignment: .leading, spacing: 4) {
                    HStack(spacing: 5) {
                        Text(f.provider.displayName)
                            .font(.system(size: 12, weight: .semibold))
                            .foregroundStyle(QWColor.foreground)
                            .lineLimit(1).minimumScaleFactor(0.8)
                        Text(f.level.label)
                            .font(.qwMono(9, .bold))
                            .foregroundStyle(f.level.color)
                            .lineLimit(1)
                        Spacer(minLength: 0)
                    }
                    Spacer(minLength: 0)
                    HStack(alignment: .firstTextBaseline, spacing: 4) {
                        Text("\(Int(f.window.displayPct(entry.displayMode).rounded()))")
                            .font(.qwDisplay(34))
                            .foregroundStyle(f.level.color)
                            .contentTransition(.numericText(value: f.window.displayPct(entry.displayMode)))
                        Text("%")
                            .font(.qwDisplay(15))
                            .foregroundStyle(QWColor.muted)
                        Text(entry.displayMode.label)
                            .font(.qwDisplay(15))
                            .foregroundStyle(QWColor.muted)
                    }
                    Spacer(minLength: 0)
                    FootStatus(entry: entry, featured: f)
                }
                .frame(maxWidth: .infinity, alignment: .leading)
            } else {
                WidgetEmptyView()
            }
        }
        .containerBackground(for: .widget) { WidgetBG() }
    }
}

// MARK: - Overview（中 / 大）— 每行一个 provider 的最紧张窗口，分页

struct OverviewWidgetView: View {
    @Environment(\.widgetFamily) private var family
    let entry: QuotaEntry

    var body: some View {
        // 真字体（Fraunces/JetBrains）比系统字体高 ~20%；单窗口行更矮，
        // systemMedium 放 3 行 + header，systemLarge 放 5 行 + hero。行数由
        // preview-widgets.sh 真字体红框自查验证。
        let large = family == .systemLarge
        let perPage = large ? 5 : 3
        Group {
            if entry.sortedProviders.isEmpty {
                WidgetEmptyView()
            } else {
                let p = pagedSlice(entry.sortedProviders, page: entry.page, perPage: perPage)
                VStack(alignment: .leading, spacing: large ? 10 : 8) {
                    PagedHeader(entry: entry, page: p.page, total: p.total, large: large)
                    if large, let f = entry.featured {
                        heroRow(f)
                    }
                    ForEach(p.slice) { provider in
                        if let w = provider.primary {
                            ProviderRow(item: RankedWindow(provider: provider, window: w),
                                        mode: entry.displayMode)
                        }
                    }
                    Spacer(minLength: 0)
                }
                .padding(large ? 16 : 14)
            }
        }
        .containerBackground(for: .widget) { WidgetBG() }
    }

    private func heroRow(_ f: RankedWindow) -> some View {
        HStack(spacing: 10) {
            Text("\(Int(f.window.displayPct(entry.displayMode).rounded()))%")
                .font(.qwDisplay(26))
                .foregroundStyle(f.level.color)
            VStack(alignment: .leading, spacing: 2) {
                Text("最紧张窗口")
                    .font(.system(size: 10))
                    .foregroundStyle(QWColor.subtle)
                HStack(spacing: 4) {
                    Text(f.provider.displayName)
                        .font(.system(size: 11, weight: .semibold))
                        .foregroundStyle(QWColor.foreground)
                    if let reset = Formatting.resetCountdown(f.window.resetDate) {
                        Text("· \(reset) 后重置")
                            .font(.qwMono(9))
                            .foregroundStyle(QWColor.subtle)
                    }
                }
            }
            Spacer(minLength: 0)
        }
        .padding(.vertical, 6)
        .overlay(alignment: .bottom) {
            Rectangle().fill(QWColor.border).frame(height: 1)
        }
    }
}

// MARK: - Lock screen / Dynamic Island（accessory）

struct AccessoryCircularView: View {
    let entry: QuotaEntry
    var body: some View {
        Group {
            if let f = entry.featured {
                Gauge(value: min(1, f.window.displayFraction(entry.displayMode))) {
                    Text(f.window.windowKind.label)
                } currentValueLabel: {
                    Text("\(Int(f.window.displayPct(entry.displayMode).rounded()))")
                }
                .gaugeStyle(.accessoryCircular)
                .tint(f.level.color)
            } else {
                Image(systemName: "gauge.with.dots.needle.bottom.50percent")
            }
        }
        .containerBackground(.clear, for: .widget)
    }
}

struct AccessoryRectangularView: View {
    let entry: QuotaEntry
    var body: some View {
        Group {
            if let f = entry.featured {
                VStack(alignment: .leading, spacing: 2) {
                    HStack(spacing: 4) {
                        Text(f.provider.displayName).font(.headline).lineLimit(1)
                        Text(Formatting.cleanWindowName(f.window.windowName)).font(.caption2).foregroundStyle(.secondary)
                    }
                    Gauge(value: min(1, f.window.displayFraction(entry.displayMode))) { EmptyView() }
                        .gaugeStyle(.accessoryLinearCapacity)
                        .tint(f.level.color)
                    HStack {
                        Text("\(Int(f.window.displayPct(entry.displayMode).rounded()))% \(entry.displayMode.label)")
                        Spacer()
                        if let reset = Formatting.resetCountdown(f.window.resetDate) { Text(reset) }
                    }
                    .font(.caption2).foregroundStyle(.secondary)
                }
            } else {
                Text("quota-watch — 未配对")
            }
        }
        .containerBackground(.clear, for: .widget)
    }
}

struct AccessoryInlineView: View {
    let entry: QuotaEntry
    var body: some View {
        if let f = entry.featured {
            Label("\(f.provider.displayName) \(Int(f.window.displayPct(entry.displayMode).rounded()))% \(entry.displayMode.label)",
                  systemImage: "gauge.with.dots.needle.bottom.50percent")
        } else {
            Label("quota-watch", systemImage: "gauge.with.dots.needle.bottom.50percent")
        }
    }
}

// MARK: - Empty state

private struct WidgetEmptyView: View {
    var body: some View {
        VStack(spacing: 6) {
            Image(systemName: "gauge.with.dots.needle.bottom.50percent")
                .font(.title2)
                .foregroundStyle(QWColor.subtle)
            Text("未配对")
                .font(.qwMono(11))
                .foregroundStyle(QWColor.muted)
            Text("在 App 中连接 Mac")
                .font(.qwMono(9))
                .foregroundStyle(QWColor.subtle)
                .multilineTextAlignment(.center)
        }
    }
}
