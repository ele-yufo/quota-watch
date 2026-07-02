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
            ScrollView {
                VStack(spacing: 10) {
                    ForEach(store.providerGroups) { group in
                        ProviderSection(group: group)
                    }
                }
                .padding(.horizontal, 14)
                .padding(.vertical, 12)
            }
            .frame(maxHeight: 420)
        }
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
        VStack(alignment: .leading, spacing: 8) {
            HStack(alignment: .firstTextBaseline) {
                Text(group.info.displayName)
                    .font(.subheadline.weight(.semibold))
                Spacer()
                Text(group.info.providerType)
                    .font(.caption2)
                    .foregroundStyle(.secondary)
            }

            if group.items.isEmpty {
                Text("等待采集")
                    .font(.caption)
                    .foregroundStyle(.tertiary)
                    .padding(.vertical, 2)
            } else {
                VStack(spacing: 10) {
                    ForEach(group.items) { item in
                        QuotaWindowRow(item: item)
                    }
                }
            }
        }
        .padding(10)
        .background(Color.gray.opacity(0.07))
        .clipShape(RoundedRectangle(cornerRadius: 10))
    }
}

// MARK: - Window row

private struct QuotaWindowRow: View {
    let item: QuotaStore.QuotaItem

    private var severity: QuotaStore.QuotaSeverity {
        .of(remainingPct: item.remainingPct)
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            HStack(spacing: 6) {
                KindChip(kind: item.windowKind)
                Text(item.windowName)
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .lineLimit(1)
                Spacer()
                Text(QuotaStore.formatUsedPct(remainingPct: item.remainingPct))
                    .font(.callout.monospacedDigit().weight(.semibold))
                    .foregroundStyle(severity.textColor)
            }

            ProgressBar(fraction: CGFloat(item.usedPct / 100), color: severity.barColor)

            HStack {
                Text("\(QuotaStore.formatValue(item.used)) / \(QuotaStore.formatValue(item.total)) \(item.unit)")
                    .font(.caption2)
                    .foregroundStyle(.tertiary)

                Spacer()

                if let resetLabel = QuotaStore.formatResetCountdown(item.resetAt) {
                    Label(resetLabel, systemImage: "clock")
                        .font(.caption2)
                        .foregroundStyle(.tertiary)
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
