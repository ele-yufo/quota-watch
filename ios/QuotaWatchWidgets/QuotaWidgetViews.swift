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

// MARK: - Small (home screen)

struct SmallWidgetView: View {
    let entry: QuotaEntry

    var body: some View {
        Group {
            if let f = entry.featured {
                SmallDial(item: f, stale: entry.isStale)
            } else {
                WidgetEmptyView()
            }
        }
        .containerBackground(for: .widget) { WidgetBG() }
    }
}

private struct SmallDial: View {
    let item: RankedWindow
    let stale: Bool

    var body: some View {
        VStack(spacing: 7) {
            HStack(spacing: 5) {
                ProviderBadge(style: .of(item.provider.providerType), size: 20)
                Text(item.provider.displayName)
                    .font(.qwLabel(10)).foregroundStyle(Theme.ink2)
                    .lineLimit(1).minimumScaleFactor(0.8)
                Spacer(minLength: 0)
            }

            RingGauge(usedPct: item.window.usedPct, level: item.level,
                      caption: item.window.windowKind.label,
                      diameter: 74, lineWidth: 7, animated: false)

            HStack(spacing: 4) {
                Circle().fill(item.level.color).frame(width: 5, height: 5)
                Text(item.level.label).font(.qwLabel(9)).foregroundStyle(item.level.color)
                Spacer(minLength: 0)
                if stale {
                    Text("缓存").font(.qwLabel(8)).foregroundStyle(Theme.ink3)
                } else if let reset = Formatting.resetCountdown(item.window.resetDate) {
                    Image(systemName: "clock").font(.system(size: 8)).foregroundStyle(Theme.ink3)
                    Text(reset).font(.qwNum(9, .medium)).foregroundStyle(Theme.ink3)
                }
            }
        }
        .padding(.horizontal, 2)
    }
}

// MARK: - Medium (home screen overview)

struct MediumWidgetView: View {
    let entry: QuotaEntry

    var body: some View {
        Group {
            if entry.overviewRows.isEmpty {
                WidgetEmptyView()
            } else {
                VStack(alignment: .leading, spacing: 7) {
                    HStack(alignment: .firstTextBaseline) {
                        Text("quota·watch").font(.qwDisplay(15)).foregroundStyle(Theme.ink)
                        Spacer()
                        if let u = entry.lastUpdated {
                            Text((entry.isStale ? "缓存 · " : "") + Formatting.ago(u) + " 前")
                                .font(.qwLabel(9)).foregroundStyle(Theme.ink3)
                        }
                    }
                    ForEach(Array(entry.overviewRows.prefix(4))) { row in
                        OverviewRow(item: row)
                    }
                    Spacer(minLength: 0)
                }
            }
        }
        .containerBackground(for: .widget) { WidgetBG() }
    }
}

private struct OverviewRow: View {
    let item: RankedWindow

    var body: some View {
        HStack(spacing: 9) {
            ProviderBadge(style: .of(item.provider.providerType), size: 22)
            VStack(alignment: .leading, spacing: 3) {
                HStack(spacing: 5) {
                    Text(item.provider.displayName)
                        .font(.qwLabel(11)).foregroundStyle(Theme.ink).lineLimit(1)
                    Text(item.window.windowKind.label)
                        .font(.qwLabel(8)).foregroundStyle(Theme.ink3)
                        .padding(.horizontal, 4).padding(.vertical, 1)
                        .background(Capsule().fill(Color.white.opacity(0.08)))
                    Spacer(minLength: 0)
                }
                MiniBar(fraction: item.window.usedPct / 100, color: item.level.color)
            }
            Text("\(Int(item.window.usedPct.rounded()))%")
                .font(.qwNum(13, .bold)).foregroundStyle(item.level.color)
                .frame(width: 42, alignment: .trailing)
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
                    .frame(width: geo.size.width * max(0, min(1, fraction)))
            }
        }
        .frame(height: 4)
    }
}

// MARK: - Lock screen / Dynamic Island (accessory)
// Accessory widgets render in a tinted/vibrant style — use system fonts + Gauge
// so they read correctly on the lock screen and in the Smart Stack.

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
                        if let reset = Formatting.resetCountdown(f.window.resetDate) {
                            Text(reset)
                        }
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
