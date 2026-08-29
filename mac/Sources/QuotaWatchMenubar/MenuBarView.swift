import AppKit
import SwiftUI

/// The popover content displayed when clicking the menu bar icon.
/// Grouped by provider; each window gets a ring gauge + 24h sparkline.
struct MenuBarView: View {
    @ObservedObject var store: QuotaStore
    @StateObject private var pairing = PairingModel()
    @State private var showPairing = false
    @State private var showSettings = false

    var body: some View {
        Group {
            if showPairing {
                PairingView(model: pairing) {
                    showPairing = false
                    pairing.stop()
                }
            } else {
                VStack(alignment: .leading, spacing: 0) {
                    header
                    Divider().opacity(0.5)

                    if let error = store.errorMessage {
                        errorBanner(error)
                    }

                    content
                    Divider().opacity(0.5)
                    footer
                }
            }
        }
        .frame(width: 360)
        // Popover dismissed by clicking outside never calls the panel's close
        // handler; when the code's TTL runs out, drop back to the quota list so
        // the next click doesn't land on an expired pairing sheet.
        .onChange(of: pairing.isExpired) { expired in
            if expired {
                showPairing = false
                pairing.stop()
            }
        }
    }

    // MARK: - Header

    /// Tri-state daemon status — a Boolean "stale?" forced DB errors onto the
    /// green branch, showing a healthy dot while reads were failing.
    private enum DaemonStatus {
        case healthy, stale, unreadable

        var dotColor: Color {
            switch self {
            case .healthy: return .green
            case .stale: return .orange
            case .unreadable: return .red
            }
        }

        var label: String? {
            switch self {
            case .healthy: return nil
            case .stale: return "daemon 未在轮询"
            case .unreadable: return "读取失败"
            }
        }
    }

    private var daemonStatus: DaemonStatus {
        if store.errorMessage != nil { return .unreadable }
        guard !store.providerGroups.isEmpty else { return .healthy }
        // 6min > Claude's 5min poll floor — slower than that means the daemon stopped.
        guard let lastPoll = store.lastPollAt else { return .stale }
        return Date().timeIntervalSince(lastPoll) > 360 ? .stale : .healthy
    }

    private var header: some View {
        HStack(spacing: 8) {
            Circle()
                .fill(daemonStatus.dotColor)
                .frame(width: 7, height: 7)
            Text("quota·watch")
                .font(.system(size: 13, weight: .semibold))
            if let statusLabel = daemonStatus.label {
                Text(statusLabel)
                    .font(.caption)
                    .foregroundStyle(daemonStatus.dotColor)
            } else if let lastPoll = store.lastPollAt {
                Text("轮询 \(lastPoll, style: .relative)")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
            Spacer()
            if store.exhaustedCount > 0 {
                Label("\(store.exhaustedCount) 已打满", systemImage: "nosign")
                    .font(.caption2)
                    .foregroundStyle(.secondary)
            }
        }
        .padding(.horizontal, 16)
        .padding(.top, 12)
        .padding(.bottom, 10)
    }

    private func errorBanner(_ message: String) -> some View {
        HStack {
            Image(systemName: "exclamationmark.triangle.fill")
                .foregroundStyle(.yellow)
            Text(message)
                .font(.caption)
                .foregroundStyle(.secondary)
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 8)
    }

    // MARK: - Content

    @ViewBuilder
    private var content: some View {
        if store.providerGroups.isEmpty && store.errorMessage == nil {
            emptyState
        } else {
            // A ScrollView inside a MenuBarExtra(.window) popover collapses to
            // zero height: the window sizes itself to content, the ScrollView
            // gets no height proposal, and renders blank. Give it an explicit
            // height — exact fit for short lists, capped + scrollable for long.
            ScrollView {
                VStack(spacing: 10) {
                    ForEach(store.providerGroups) { group in
                        ProviderSection(group: group, history: store.history)
                    }
                }
                .padding(.horizontal, 14)
                .padding(.vertical, 12)
            }
            .frame(height: min(estimatedContentHeight, 480))
        }
    }

    /// Approximate rendered height so the ScrollView gets a concrete, non-zero
    /// frame. Per-section chrome ≈ title + padding; per-row ≈ ring row height.
    private var estimatedContentHeight: CGFloat {
        let sections = store.providerGroups
        let rowCount = sections.reduce(0) { $0 + max(1, $1.items.count) }
        return CGFloat(sections.count) * 46 + CGFloat(rowCount) * 64
            + CGFloat(max(0, sections.count - 1)) * 10 + 24
    }

    private var emptyState: some View {
        HStack {
            Spacer()
            VStack(spacing: 8) {
                Image(systemName: "tray")
                    .font(.title2)
                    .foregroundStyle(.secondary)
                Text("No providers configured")
                    .font(.caption)
                    .foregroundStyle(.secondary)
                Text("Add providers with the CLI first")
                    .font(.caption2)
                    .foregroundStyle(.tertiary)
            }
            .padding(.vertical, 24)
            Spacer()
        }
    }

    // MARK: - Footer

    private var footer: some View {
        VStack(spacing: 0) {
            if showSettings {
                HStack {
                    Text("告警阈值")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                    Spacer()
                    Stepper(
                        "剩余 < \(Int(store.alertThresholdPct))% 时提醒",
                        value: $store.alertThresholdPct,
                        in: 5...50,
                        step: 5
                    )
                    .font(.caption)
                }
                .padding(.horizontal, 16)
                .padding(.vertical, 8)
                Divider().opacity(0.5)
            }

            HStack(spacing: 16) {
                Button {
                    withAnimation(.easeInOut(duration: 0.15)) { showSettings.toggle() }
                } label: {
                    Image(systemName: "gearshape")
                }
                .buttonStyle(FooterButtonStyle())
                .help("设置")

                Button {
                    pairing.start()
                    showPairing = true
                } label: {
                    Image(systemName: "qrcode")
                }
                .buttonStyle(FooterButtonStyle())
                .help("配对设备")

                Button {
                    store.refresh()
                } label: {
                    Image(systemName: "arrow.clockwise")
                }
                .buttonStyle(FooterButtonStyle())
                .help("重新读取")

                Button {
                    NSWorkspace.shared.open(URL(string: "http://localhost:3000")!)
                } label: {
                    Image(systemName: "safari")
                }
                .buttonStyle(FooterButtonStyle())
                .help("打开 Web 仪表盘")

                Spacer()

                Button {
                    NSApplication.shared.terminate(nil)
                } label: {
                    Image(systemName: "power")
                }
                .buttonStyle(FooterButtonStyle())
                .help("退出")
            }
            .padding(.horizontal, 16)
            .padding(.vertical, 9)
        }
    }
}

/// Icon-only footer buttons: quiet until hovered.
private struct FooterButtonStyle: ButtonStyle {
    @State private var hovering = false

    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(.system(size: 12))
            .foregroundStyle(hovering || configuration.isPressed ? .primary : .secondary)
            .frame(width: 24, height: 20)
            .contentShape(Rectangle())
            .onHover { hovering = $0 }
    }
}

// MARK: - Provider section

private struct ProviderSection: View {
    let group: QuotaStore.ProviderGroup
    let history: [String: [(t: Date, usedPct: Double)]]

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(spacing: 6) {
                Text(group.info.displayName)
                    .font(.system(size: 12, weight: .semibold))
                Text(group.info.providerType)
                    .font(.system(size: 9))
                    .foregroundStyle(.tertiary)
                Spacer()
            }

            if group.items.isEmpty {
                Text("等待采集")
                    .font(.caption)
                    .foregroundStyle(.tertiary)
                    .padding(.vertical, 2)
            } else {
                VStack(spacing: 10) {
                    ForEach(group.items) { item in
                        QuotaWindowRow(item: item, points: history[item.id] ?? [])
                    }
                }            }
        }
        .padding(12)
        .background(
            RoundedRectangle(cornerRadius: 12)
                .fill(Color.primary.opacity(0.05))
        )
    }
}

// MARK: - Window row: ring gauge + labels + sparkline

private struct QuotaWindowRow: View {
    let item: QuotaStore.QuotaItem
    let points: [(t: Date, usedPct: Double)]

    private var severity: QuotaStore.QuotaSeverity {
        .of(remainingPct: item.remainingPct)
    }

    /// Window names often re-embed the same tag the chip already shows
    /// ("session (5h)", "Claude+GPT (5h)"). Drop the trailing "(…)".
    private var cleanName: String {
        if let r = item.windowName.range(
            of: #"\s*\([^)]*\)\s*$"#, options: .regularExpression) {
            return String(item.windowName[..<r.lowerBound])
        }
        return item.windowName
    }

    /// The "used / total unit" line only matters for real quantities
    /// (tokens, credits). For percent windows it restates the big number.
    private var showsRawCounts: Bool {
        item.unit.lowercased() != "percent" && item.total > 0
    }

    private var resetLabel: String? { QuotaStore.formatResetCountdown(item.resetAt) }

    var body: some View {
        HStack(spacing: 10) {
            RingGauge(
                fraction: item.usedPct / 100,
                color: item.exhausted ? .gray : severity.barColor,
                dimmed: item.exhausted
            )

            VStack(alignment: .leading, spacing: 3) {
                HStack(spacing: 6) {
                    KindChip(kind: item.windowKind)
                    Text(cleanName)
                        .font(.system(size: 12))
                        .lineLimit(1)
                    Spacer(minLength: 4)
                    if item.exhausted {
                        Text("已打满")
                            .font(.system(size: 10, weight: .medium))
                            .foregroundStyle(.secondary)
                    } else {
                        Text(QuotaStore.formatUsedPct(remainingPct: item.remainingPct))
                            .font(.system(size: 12, weight: .semibold).monospacedDigit())
                            .foregroundStyle(severity.textColor)
                    }
                }

                HStack(spacing: 6) {
                    Sparkline(
                        points: points,
                        fallbackLevel: item.usedPct,
                        color: item.exhausted ? .gray : severity.barColor
                    )
                    .frame(width: 64, height: 14)
                    Spacer(minLength: 4)
                    if showsRawCounts {
                        Text("\(QuotaStore.formatValue(item.used)) / \(QuotaStore.formatValue(item.total)) \(item.unit)")
                            .font(.caption2)
                            .foregroundStyle(.tertiary)
                    }
                    if let resetLabel {
                        Label(resetLabel, systemImage: "clock")
                            .font(.caption2)
                            .foregroundStyle(.tertiary)
                    }
                }
            }
        }
        .opacity(item.exhausted ? 0.62 : 1)
    }
}

// MARK: - Ring gauge

private struct RingGauge: View {
    let fraction: Double
    let color: Color
    var dimmed: Bool = false

    var body: some View {
        ZStack {
            Circle()
                .stroke(Color.gray.opacity(0.18), lineWidth: 3.5)
            Circle()
                .trim(from: 0, to: max(0, min(1, fraction)))
                .stroke(color, style: StrokeStyle(lineWidth: 3.5, lineCap: .round))
                .rotationEffect(.degrees(-90))
        }
        .frame(width: 30, height: 30)
    }
}

// MARK: - Sparkline (24h used-%, x = real time)

/// x is mapped by WALL TIME across the trailing 24h, not by sample index —
/// snapshots are change-only, so index-spacing would draw a 10-minute burst as
/// a slow day-long climb. A window with <2 changes in 24h renders a flat line
/// at its current level: flat IS the truthful shape.
private struct Sparkline: View {
    let points: [(t: Date, usedPct: Double)]
    let fallbackLevel: Double
    let color: Color

    private static let windowSeconds: TimeInterval = 24 * 3600

    var body: some View {
        Canvas { context, size in
            guard size.width > 0, size.height > 0 else { return }
            let now = Date()
            let yFor = { (usedPct: Double) in
                size.height * (1 - CGFloat(max(0, min(100, usedPct)) / 100))
            }
            let xFor = { (t: Date) in
                size.width * CGFloat(max(0, min(1,
                    (t.timeIntervalSince(now) + Self.windowSeconds) / Self.windowSeconds)))
            }

            var path = Path()
            if points.count >= 2 {
                // Extend to "now" so a stale flat tail reads as flat, not cut off.
                for (i, p) in points.enumerated() {
                    let pt = CGPoint(x: xFor(p.t), y: yFor(p.usedPct))
                    if i == 0 { path.move(to: pt) } else { path.addLine(to: pt) }
                }
                if let last = points.last, last.t < now {
                    path.addLine(to: CGPoint(x: size.width, y: yFor(last.usedPct)))
                }
            } else {
                // 0 or 1 sample: flat line at the current level.
                let y = yFor(fallbackLevel)
                path.move(to: CGPoint(x: 0, y: y))
                path.addLine(to: CGPoint(x: size.width, y: y))
            }
            context.stroke(path, with: .color(color.opacity(0.55)), lineWidth: 1.2)
        }
    }
}

// MARK: - Kind chip

private struct KindChip: View {
    let kind: String

    var body: some View {
        Text(WindowKind.label(kind))
            .font(.system(size: 8.5, weight: .bold))
            .foregroundStyle(.secondary)
            .padding(.horizontal, 5)
            .padding(.vertical, 1.5)
            .background(Capsule().fill(Color.gray.opacity(0.16)))
    }
}
