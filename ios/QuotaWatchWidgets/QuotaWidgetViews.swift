import SwiftUI
import WidgetKit

// MARK: - Helpers

private struct WidgetBG: View {
    var body: some View {
        LinearGradient(colors: [Theme.bgTop, Theme.bgBottom], startPoint: .top, endPoint: .bottom)
    }
}

private func cleanWindowName(_ name: String) -> String {
    guard let r = name.range(of: #"\s*\([^)]*\)\s*$"#, options: .regularExpression) else { return name }
    return String(name[..<r.lowerBound])
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
                Capsule().fill(Color.white.opacity(0.10))
                Capsule().fill(color).frame(width: geo.size.width * max(0.02, min(1, fraction)))
            }
        }
        .frame(height: 4)
    }
}

// MARK: - Window gauge (a single window: chip + value + bar), side-by-side

private struct WindowGauge: View {
    let window: QuotaWindow
    let mode: QuotaDisplayMode

    var body: some View {
        let level = UsageLevel(remainingPct: window.remainingPct)
        VStack(alignment: .leading, spacing: 2) {
            HStack(spacing: 4) {
                Text(window.windowKind.label)
                    .font(.qwLabel(8.5)).foregroundStyle(Theme.ink2)
                Text("\(Int(window.displayPct(mode).rounded()))%")
                    .font(.qwNum(11, .bold)).foregroundStyle(level.color)
                Spacer(minLength: 0)
            }
            MiniBar(fraction: window.displayFraction(mode), color: level.color)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}

// MARK: - Provider row (name + its windows side by side) — overview

private struct ProviderRow: View {
    let provider: QuotaProvider
    let mode: QuotaDisplayMode
    var maxWindows = 2

    var body: some View {
        HStack(spacing: 9) {
            ProviderBadge(style: .of(provider.providerType), size: 24)
            VStack(alignment: .leading, spacing: 3) {
                Text(provider.displayName)
                    .font(.qwLabel(11.5)).foregroundStyle(Theme.ink)
                    .lineLimit(1).minimumScaleFactor(0.85)
                HStack(alignment: .top, spacing: 12) {
                    ForEach(provider.sortedWindows.prefix(maxWindows)) { w in
                        WindowGauge(window: w, mode: mode)
                    }
                    if provider.sortedWindows.count < maxWindows { Spacer(minLength: 0) }
                }
            }
        }
    }
}

// MARK: - Compact stat row (small widget) — one window per line

private struct StatRow: View {
    let item: RankedWindow
    let mode: QuotaDisplayMode
    var pinned = false

    private var label: String {
        pinned ? cleanWindowName(item.window.windowName) : item.provider.displayName
    }

    var body: some View {
        HStack(spacing: 8) {
            if pinned {
                Text(item.window.windowKind.label)
                    .font(.qwLabel(9)).foregroundStyle(Theme.ink2)
                    .frame(width: 26).padding(.vertical, 3)
                    .background(Capsule().fill(Color.white.opacity(0.08)))
            } else {
                ProviderBadge(style: .of(item.provider.providerType), size: 20)
            }
            VStack(alignment: .leading, spacing: 3) {
                HStack(spacing: 5) {
                    Text(label).font(.qwLabel(10.5)).foregroundStyle(Theme.ink)
                        .lineLimit(1).minimumScaleFactor(0.85)
                    Spacer(minLength: 4)
                    Text("\(Int(item.window.displayPct(mode).rounded()))%")
                        .font(.qwNum(11.5, .bold)).foregroundStyle(item.level.color)
                }
                MiniBar(fraction: item.window.displayFraction(mode), color: item.level.color)
            }
        }
    }
}

// MARK: - Header (wordmark + mode chip + paging)

private struct PagedHeader: View {
    let mode: QuotaDisplayMode
    let page: Int
    let total: Int

    var body: some View {
        HStack(alignment: .center, spacing: 6) {
            Text("quota").font(.qwDisplay(15)).foregroundStyle(Theme.ink)
            Text("·").font(.qwDisplay(15)).foregroundStyle(UsageLevel.low.color)
            Text("watch").font(.qwDisplayItalic(15)).foregroundStyle(Theme.ink)
            Text(mode.label).font(.qwLabel(8.5)).foregroundStyle(Theme.ink3)
                .padding(.horizontal, 5).padding(.vertical, 2)
                .background(Capsule().fill(Color.white.opacity(0.08)))
            Spacer(minLength: 4)
            if total > 1 {
                Button(intent: NextPageIntent()) {
                    HStack(spacing: 4) {
                        Text("\(page + 1)/\(total)").font(.qwNum(10.5, .bold)).foregroundStyle(Theme.ink)
                        Image(systemName: "chevron.forward").font(.system(size: 9.5, weight: .bold)).foregroundStyle(Theme.ink)
                    }
                    .padding(.horizontal, 9).padding(.vertical, 4)
                    .background(Capsule().fill(UsageLevel.ok.color.opacity(0.22)))
                    .overlay(Capsule().strokeBorder(UsageLevel.ok.color.opacity(0.5)))
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

// MARK: - Small (compact — top 3 providers, or a pinned provider's windows)

struct SmallWidgetView: View {
    let entry: QuotaEntry

    private var pinnedProvider: QuotaProvider? {
        guard let sel = entry.selectedProviderId else { return nil }
        return entry.providers.first { $0.providerId == sel }
    }
    private var rows: [RankedWindow] {
        if let p = pinnedProvider {
            return p.sortedWindows.map { RankedWindow(provider: p, window: $0) }
        }
        return entry.overviewRows
    }

    var body: some View {
        Group {
            if rows.isEmpty {
                WidgetEmptyView()
            } else {
                VStack(alignment: .leading, spacing: 9) {
                    HStack(alignment: .firstTextBaseline, spacing: 5) {
                        Text(pinnedProvider?.displayName ?? "quota·watch")
                            .font(pinnedProvider == nil ? .qwDisplay(14) : .qwLabel(13))
                            .foregroundStyle(Theme.ink).lineLimit(1)
                        Spacer(minLength: 3)
                        Text(entry.displayMode.label).font(.qwLabel(8)).foregroundStyle(Theme.ink3)
                    }
                    Rectangle().fill(Theme.hairline).frame(height: 1)
                    ForEach(rows.prefix(3)) { StatRow(item: $0, mode: entry.displayMode, pinned: pinnedProvider != nil) }
                    if rows.count > 3 {
                        Text("+\(rows.count - 3) 个渠道").font(.qwLabel(9)).foregroundStyle(Theme.ink3)
                    }
                    Spacer(minLength: 0)
                }
            }
        }
        .containerBackground(for: .widget) { WidgetBG() }
    }
}

// MARK: - Overview (medium + large) — each provider with both windows, paginated

struct OverviewWidgetView: View {
    @Environment(\.widgetFamily) private var family
    let entry: QuotaEntry

    var body: some View {
        let large = family == .systemLarge
        let perPage = large ? 5 : 3
        let maxWindows = large ? 3 : 2
        Group {
            if entry.sortedProviders.isEmpty {
                WidgetEmptyView()
            } else {
                let p = pagedSlice(entry.sortedProviders, page: entry.page, perPage: perPage)
                VStack(alignment: .leading, spacing: large ? 12 : 9) {
                    PagedHeader(mode: entry.displayMode, page: p.page, total: p.total)
                    Rectangle().fill(Theme.hairline).frame(height: 1)
                    ForEach(p.slice) { ProviderRow(provider: $0, mode: entry.displayMode, maxWindows: maxWindows) }
                    Spacer(minLength: 0)
                }
                .padding(large ? 15 : 12)
            }
        }
        .containerBackground(for: .widget) { WidgetBG() }
    }
}

// MARK: - Lock screen / Dynamic Island (accessory)

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
                        Text(f.window.windowKind.label).font(.caption2).foregroundStyle(.secondary)
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
                Text("quota·watch — 未配对")
            }
        }
        .containerBackground(.clear, for: .widget)
    }
}

struct AccessoryInlineView: View {
    let entry: QuotaEntry
    var body: some View {
        if let f = entry.featured {
            Label("\(f.provider.displayName) \(Int(f.window.displayPct(entry.displayMode).rounded()))%",
                  systemImage: "gauge.with.dots.needle.bottom.50percent")
        } else {
            Label("quota·watch", systemImage: "gauge.with.dots.needle.bottom.50percent")
        }
    }
}

// MARK: - Empty state

private struct WidgetEmptyView: View {
    var body: some View {
        VStack(spacing: 6) {
            Image(systemName: "gauge.with.dots.needle.bottom.50percent")
                .font(.title2).foregroundStyle(Theme.ink3)
            Text("未配对").font(.qwLabel(11)).foregroundStyle(Theme.ink2)
            Text("在 App 中连接 Mac").font(.qwLabel(9)).foregroundStyle(Theme.ink3)
                .multilineTextAlignment(.center)
        }
    }
}
