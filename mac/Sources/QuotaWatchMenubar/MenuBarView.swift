import AppKit
import SwiftUI

/// The popover content displayed when clicking the menu bar icon.
/// Grouped by provider, one progress row per quota window.
struct MenuBarView: View {
    @ObservedObject var store: QuotaStore

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            header
            Divider()

            if let error = store.errorMessage {
                errorBanner(error)
            }

            content
            Divider()
            footer
        }
        .frame(width: 340)
    }

    // MARK: - Header

    private var header: some View {
        HStack {
            Text("quota-watch")
                .font(.headline)
            Spacer()
            if let lastUpdated = store.lastUpdated {
                Text(lastUpdated, style: .relative)
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
        }
        .padding(.horizontal, 16)
        .padding(.top, 12)
        .padding(.bottom, 8)
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
            // gets no height proposal, and renders blank (an earlier bug that
            // looked like "no data" when the data was actually present). Give it
            // an explicit height — exact fit for short lists, capped + scrollable
            // for long ones.
            ScrollView {
                VStack(spacing: 10) {
                    ForEach(store.providerGroups) { group in
                        ProviderSection(group: group)
                    }
                }
                .padding(.horizontal, 14)
                .padding(.vertical, 12)
            }
            .frame(height: min(estimatedContentHeight, 460))
        }
    }

    /// Approximate rendered height of the provider list so the ScrollView gets a
    /// concrete, non-zero frame. Small lists fit exactly; anything past the 460
    /// cap scrolls. Per-section chrome ≈ title + card padding; per-row ≈ chip +
    /// bar + footer line.
    private var estimatedContentHeight: CGFloat {
        let sections = store.providerGroups
        let rowCount = sections.reduce(0) { $0 + max(1, $1.items.count) }
        let sectionChrome = CGFloat(sections.count) * 58
        let rowsHeight = CGFloat(rowCount) * 56
        let interSectionSpacing = CGFloat(max(0, sections.count - 1)) * 10
        let outerPadding: CGFloat = 24
        return sectionChrome + rowsHeight + interSectionSpacing + outerPadding
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
        HStack(spacing: 16) {
            Button {
                store.refresh()
            } label: {
                Label("Refresh", systemImage: "arrow.clockwise")
                    .font(.caption)
            }
            .buttonStyle(.plain)

            Button {
                NSWorkspace.shared.open(URL(string: "http://localhost:3000")!)
            } label: {
                Label("Open web", systemImage: "safari")
                    .font(.caption)
            }
            .buttonStyle(.plain)

            Spacer()

            Button {
                NSApplication.shared.terminate(nil)
            } label: {
                Label("Quit", systemImage: "power")
                    .font(.caption)
            }
            .buttonStyle(.plain)
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 8)
    }
}

// MARK: - Provider section

private struct ProviderSection: View {
    let group: QuotaStore.ProviderGroup

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text(group.info.displayName)
                .font(.subheadline.weight(.semibold))

            if group.items.isEmpty {
                Text("等待采集")
                    .font(.caption)
                    .foregroundStyle(.tertiary)
                    .padding(.vertical, 2)
            } else {
                VStack(spacing: 12) {
                    ForEach(group.items) { item in
                        QuotaWindowRow(item: item)
                    }
                }
            }
        }
        .padding(12)
        .background(
            RoundedRectangle(cornerRadius: 12)
                .fill(Color.primary.opacity(0.055))
        )
    }
}

// MARK: - Window row

private struct QuotaWindowRow: View {
    let item: QuotaStore.QuotaItem

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

    /// The "used / total unit" line is only meaningful for real quantities
    /// (tokens, credits). For percent windows it just restates the big number.
    private var showsRawCounts: Bool {
        item.unit.lowercased() != "percent" && item.total > 0
    }

    private var resetLabel: String? { QuotaStore.formatResetCountdown(item.resetAt) }

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack(spacing: 7) {
                KindChip(kind: item.windowKind)
                Text(cleanName)
                    .font(.callout)
                    .lineLimit(1)
                Spacer(minLength: 8)
                Text(QuotaStore.formatUsedPct(remainingPct: item.remainingPct))
                    .font(.callout.monospacedDigit().weight(.semibold))
                    .foregroundStyle(severity.textColor)
            }

            ProgressBar(fraction: CGFloat(item.usedPct / 100), color: severity.barColor)

            // Secondary line — only rendered when it carries real information:
            // raw token/credit counts, and/or the reset countdown.
            if showsRawCounts || resetLabel != nil {
                HStack {
                    if showsRawCounts {
                        Text("\(QuotaStore.formatValue(item.used)) / \(QuotaStore.formatValue(item.total)) \(item.unit)")
                            .font(.caption2)
                            .foregroundStyle(.tertiary)
                    }
                    Spacer()
                    if let resetLabel {
                        Label(resetLabel, systemImage: "clock")
                            .font(.caption2)
                            .foregroundStyle(.tertiary)
                    }
                }
            }
        }
    }
}

// MARK: - Kind chip

private struct KindChip: View {
    let kind: String

    var body: some View {
        Text(WindowKind.label(kind))
            .font(.system(size: 9, weight: .bold))
            .foregroundStyle(.secondary)
            .padding(.horizontal, 6)
            .padding(.vertical, 2)
            .background(Capsule().fill(Color.gray.opacity(0.18)))
    }
}

// MARK: - Progress bar

private struct ProgressBar: View {
    let fraction: CGFloat
    let color: Color

    var body: some View {
        GeometryReader { geo in
            ZStack(alignment: .leading) {
                RoundedRectangle(cornerRadius: 2.5)
                    .fill(Color.gray.opacity(0.18))

                RoundedRectangle(cornerRadius: 2.5)
                    .fill(color)
                    .frame(width: geo.size.width * max(0, min(1, fraction)))
            }
        }
        .frame(height: 5)
    }
}
