import SwiftUI
import WidgetKit

// MARK: - Helpers

/// Deep instrument-panel background for the home-screen widgets.
private struct WidgetBG: View {
    var body: some View {
        LinearGradient(colors: [Theme.bgTop, Theme.bgBottom], startPoint: .top, endPoint: .bottom)
    }
}

/// Strip the redundant "(5h)" tail a window name repeats (the chip shows it).
private func cleanWindowName(_ name: String) -> String {
    guard let r = name.range(of: #"\s*\([^)]*\)\s*$"#, options: .regularExpression) else { return name }
    return String(name[..<r.lowerBound])
}

/// Slice `all` into pages of `perPage`, wrapping `page` so the next-page button
/// cycles. Returns the current slice, the normalized page index, and page count.
private func pagedSlice<T>(_ all: [T], page: Int, perPage: Int) -> (slice: [T], page: Int, total: Int) {
    let total = max(1, Int(ceil(Double(all.count) / Double(perPage))))
    let cur = ((page % total) + total) % total
    return (Array(all.dropFirst(cur * perPage).prefix(perPage)), cur, total)
}

// MARK: - A single stat line (shared by small / medium / large)

/// One row: a leading glyph (provider badge, or window chip when pinned), then a
/// clean name line, then a bar + reset line — so long names never crowd the %.
private struct StatRow: View {
    let item: RankedWindow
    var compact = false
    var pinned = false
    var showReset = false

    private var label: String {
        pinned ? cleanWindowName(item.window.windowName) : item.provider.displayName
    }

    var body: some View {
        HStack(spacing: compact ? 8 : 10) {
            leading
            VStack(alignment: .leading, spacing: compact ? 3 : 5) {
                HStack(spacing: 5) {
                    Text(label)
                        .font(.qwLabel(compact ? 11 : 12.5))
                        .foregroundStyle(Theme.ink)
                        .lineLimit(1).minimumScaleFactor(0.85)
                    Spacer(minLength: 4)
                    Text("\(Int(item.window.usedPct.rounded()))%")
                        .font(.qwNum(compact ? 11.5 : 13, .bold))
                        .foregroundStyle(item.level.color)
                }
                HStack(spacing: 7) {
                    MiniBar(fraction: item.window.usedPct / 100, color: item.level.color)
                    if showReset, let reset = Formatting.resetCountdown(item.window.resetDate) {
                        Text("↻\(reset)")
                            .font(.qwLabel(9.5)).foregroundStyle(Theme.ink3).fixedSize()
                    }
                }
            }
        }
    }

    @ViewBuilder private var leading: some View {
        if pinned {
            Text(item.window.windowKind.label)
                .font(.qwLabel(compact ? 9 : 10)).foregroundStyle(Theme.ink2)
                .frame(width: compact ? 26 : 30).padding(.vertical, 3)
                .background(Capsule().fill(Color.white.opacity(0.08)))
        } else {
            ProviderBadge(style: .of(item.provider.providerType), size: compact ? 22 : 26)
        }
    }
}

private struct MiniBar: View {
    let fraction: Double
    let color: Color
    var body: some View {
        GeometryReader { geo in
            ZStack(alignment: .leading) {
                Capsule().fill(Color.white.opacity(0.10))
                Capsule().fill(color)
                    .frame(width: geo.size.width * max(0.02, min(1, fraction)))
            }
        }
        .frame(height: 4)
    }
}

/// Wordmark header. When there is more than one page, a prominent pill button
/// (`1/2 ▶`) pages the list; otherwise a compact updated-time is shown.
private struct PagedHeader: View {
    let updated: Date?
    let stale: Bool
    let count: Int
    let page: Int
    let total: Int

    var body: some View {
        HStack(alignment: .center, spacing: 6) {
            Text("quota").font(.qwDisplay(16)).foregroundStyle(Theme.ink)
            Text("·").font(.qwDisplay(16)).foregroundStyle(UsageLevel.low.color)
            Text("watch").font(.qwDisplayItalic(16)).foregroundStyle(Theme.ink)
            if let updated {
                Text((stale ? "缓存·" : "") + Formatting.ago(updated))
                    .font(.qwLabel(9)).foregroundStyle(Theme.ink3).lineLimit(1)
            }
            Spacer(minLength: 4)
            if total > 1 {
                Button(intent: NextPageIntent()) {
                    HStack(spacing: 5) {
                        Text("\(page + 1)/\(total)").font(.qwNum(11, .bold)).foregroundStyle(Theme.ink)
                        Image(systemName: "chevron.forward").font(.system(size: 10, weight: .bold)).foregroundStyle(Theme.ink)
                    }
                    .padding(.horizontal, 10).padding(.vertical, 6)
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

// MARK: - Small (mini dashboard — top 3)

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
                    HStack(alignment: .firstTextBaseline) {
                        Text(pinnedProvider?.displayName ?? "quota·watch")
                            .font(pinnedProvider == nil ? .qwDisplay(14) : .qwLabel(13))
                            .foregroundStyle(Theme.ink).lineLimit(1)
                        Spacer(minLength: 4)
                        if let u = entry.lastUpdated {
                            Text(entry.isStale ? "缓存" : Formatting.ago(u))
                                .font(.qwLabel(8.5)).foregroundStyle(Theme.ink3)
                        }
                    }
                    Rectangle().fill(Theme.hairline).frame(height: 1)
                    ForEach(rows.prefix(3)) { StatRow(item: $0, compact: true, pinned: pinnedProvider != nil) }
                    if rows.count > 3 {
                        Text("+\(rows.count - 3) 个渠道")
                            .font(.qwLabel(9)).foregroundStyle(Theme.ink3)
                    }
                    Spacer(minLength: 0)
                }
            }
        }
        .containerBackground(for: .widget) { WidgetBG() }
    }
}

// MARK: - Overview router (medium + large, both paginated)

struct OverviewWidgetView: View {
    @Environment(\.widgetFamily) private var family
    let entry: QuotaEntry

    var body: some View {
        let perPage = family == .systemLarge ? 7 : 4
        Group {
            if entry.overviewRows.isEmpty {
                WidgetEmptyView()
            } else {
                let p = pagedSlice(entry.overviewRows, page: entry.page, perPage: perPage)
                VStack(alignment: .leading, spacing: family == .systemLarge ? 11 : 8) {
                    PagedHeader(updated: entry.lastUpdated, stale: entry.isStale,
                                count: entry.providers.count, page: p.page, total: p.total)
                    Rectangle().fill(Theme.hairline).frame(height: 1)
                    ForEach(p.slice) { StatRow(item: $0, showReset: true) }
                    Spacer(minLength: 0)
                }
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
                Gauge(value: min(1, f.window.usedPct / 100)) {
                    Text(f.window.windowKind.label)
                } currentValueLabel: {
                    Text("\(Int(f.window.usedPct.rounded()))")
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
                    Gauge(value: min(1, f.window.usedPct / 100)) { EmptyView() }
                        .gaugeStyle(.accessoryLinearCapacity)
                        .tint(f.level.color)
                    HStack {
                        Text("\(Int(f.window.usedPct.rounded()))% 已用")
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
            Label("\(f.provider.displayName) \(Int(f.window.usedPct.rounded()))%",
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
