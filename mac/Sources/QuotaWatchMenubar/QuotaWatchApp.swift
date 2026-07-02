import SwiftUI

@main
struct QuotaWatchApp: App {
    @StateObject private var store = QuotaStore()

    init() {
        // No dock icon — menu-bar-only app. Use NSApplication.shared (not the
        // NSApp global, which is still nil this early in App init).
        NSApplication.shared.setActivationPolicy(.accessory)
        Notifier.requestPermission()
    }

    var body: some Scene {
        MenuBarExtra {
            MenuBarView(store: store)
        } label: {
            MenuBarLabel(store: store)
        }
        .menuBarExtraStyle(.window)
    }
}

/// Menu bar title: SF Symbol + the tightest window's "已用%", colored by severity.
/// e.g. a low-remaining Claude session shows "⚠ 92%" in red instead of a bare icon.
private struct MenuBarLabel: View {
    @ObservedObject var store: QuotaStore

    private var severity: QuotaStore.QuotaSeverity {
        guard let worst = store.worstItem else { return .normal }
        return .of(remainingPct: worst.remainingPct)
    }

    private var titleText: String? {
        guard let worst = store.worstItem else { return nil }
        return QuotaStore.formatUsedPct(remainingPct: worst.remainingPct)
    }

    var body: some View {
        HStack(spacing: 3) {
            Image(systemName: severity.sfSymbol)
            if let titleText {
                Text(titleText)
                    .font(.system(size: 12, weight: .medium))
            }
        }
        .foregroundStyle(severity.textColor)
    }
}
