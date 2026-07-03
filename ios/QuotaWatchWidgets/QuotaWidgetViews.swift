import SwiftUI
import WidgetKit

// MARK: - Background

/// Deep instrument-panel background for the home-screen widgets — a lighter
/// gradient than the app's full guilloché canvas (cheaper to render, same feel).
private struct WidgetBG: View {
    var body: some View {
        LinearGradient(colors: [Theme.bgTop, Theme.bgBottom], startPoint: .top, endPoint: .bottom)
    }
}

/// Strip the redundant "(5h)" tail a window name often repeats (the chip shows it).
private func cleanWindowName(_ name: String) -> String {
    guard let r = name.range(of: #"\s*\([^)]*\)\s*$"#, options: .regularExpression) else { return name }
    return String(name[..<r.lowerBound])
}

// MARK: - A single stat line (shared by small + medium)

/// One row: a leading glyph (provider badge in fleet mode, window chip in
/// pinned mode), a label, the used %, and a slim usage bar. Optionally a reset
/// countdown trailing the label (medium).
private struct StatRow: View {
    let item: RankedWindow
    var compact = false
    /// true when every row is a window of ONE pinned provider (lead with the
    /// window chip + window name); false for the multi-provider fleet view.
    var pinned = false
    var showReset = false

    private var label: String {
        pinned ? cleanWindowName(item.window.windowName) : item.provider.displayName
    }

    var body: some View {
        HStack(spacing: compact ? 7 : 9) {
            if pinned {
                Text(item.window.windowKind.label)
                    .font(.qwLabel(compact ? 8.5 : 9.5))
                    .foregroundStyle(Theme.ink2)
                    .frame(width: compact ? 24 : 28)
                    .padding(.vertical, 2)
                    .background(Capsule().fill(Color.white.opacity(0.08)))
            } else {
                ProviderBadge(style: .of(item.provider.providerType), size: compact ? 20 : 24)
            }

            VStack(alignment: .leading, spacing: compact ? 3 : 4) {
                HStack(spacing: 5) {
                    Text(label)
                        .font(.qwLabel(compact ? 10.5 : 12))
                        .foregroundStyle(Theme.ink)
                        .lineLimit(1).minimumScaleFactor(0.85)
                    if showReset, let reset = Formatting.resetCountdown(item.window.resetDate) {
                        Text("↻\(reset)").font(.qwLabel(9)).foregroundStyle(Theme.ink3)
                    }
                    Spacer(minLength: 2)
                    Text("\(Int(item.window.usedPct.rounded()))%")
                        .font(.qwNum(compact ? 11 : 13, .bold))
                        .foregroundStyle(item.level.color)
                }
                MiniBar(fraction: item.window.usedPct / 100, color: item.level.color)
            }
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

/// Small wordmark / provider title used as a widget header.
private struct WidgetHeader: View {
    let title: String
    let stale: Bool
    let updated: Date?
    var wordmark = false

    var body: some View {
        HStack(alignment: .firstTextBaseline) {
            Text(title)
                .font(wordmark ? .qwDisplay(14) : .qwLabel(13))
                .foregroundStyle(Theme.ink).lineLimit(1)
            Spacer(minLength: 4)
            if let updated {
                Text(stale ? "缓存" : Formatting.ago(updated))
                    .font(.qwLabel(9)).foregroundStyle(Theme.ink3)
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

// MARK: - Small (mini dashboard)

struct SmallWidgetView: View {
    let entry: QuotaEntry

    /// Pinned → that provider's own windows; otherwise the fleet's tightest.
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
                VStack(alignment: .leading, spacing: 8) {
                    WidgetHeader(
                        title: pinnedProvider?.displayName ?? "quota·watch",
                        stale: entry.isStale, updated: entry.lastUpdated,
                        wordmark: pinnedProvider == nil)
                    Rectangle().fill(Theme.hairline).frame(height: 1)
                    ForEach(rows.prefix(3)) { row in
                        StatRow(item: row, compact: true, pinned: pinnedProvider != nil)
                    }
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

// MARK: - Medium (fleet overview)

struct MediumWidgetView: View {
    let entry: QuotaEntry

    var body: some View {
        Group {
            if entry.overviewRows.isEmpty {
                WidgetEmptyView()
            } else {
                VStack(alignment: .leading, spacing: 8) {
                    HStack(alignment: .firstTextBaseline, spacing: 6) {
                        Text("quota").font(.qwDisplay(16)).foregroundStyle(Theme.ink)
                        Text("·").font(.qwDisplay(16)).foregroundStyle(UsageLevel.low.color)
                        Text("watch").font(.qwDisplayItalic(16)).foregroundStyle(Theme.ink)
                        Spacer()
                        if let u = entry.lastUpdated {
                            Text((entry.isStale ? "缓存 · " : "") + "\(entry.providers.count) 渠道 · " + Formatting.ago(u))
                                .font(.qwLabel(9)).foregroundStyle(Theme.ink3)
                        }
                    }
                    Rectangle().fill(Theme.hairline).frame(height: 1)
                    ForEach(entry.overviewRows.prefix(5)) { row in
                        StatRow(item: row, showReset: true)
                    }
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
