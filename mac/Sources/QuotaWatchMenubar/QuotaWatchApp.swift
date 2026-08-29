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

/// Menu bar title: SF Symbol + the worst ACTIONABLE window's 已用%, colored by
/// severity. An exhausted window (0% remaining) is deliberately NOT shown as a
/// red alarm — it can't be fixed, only waited out; a permanently red menubar
/// trains the user to ignore real signal. Exhausted-only state renders a
/// dimmed ⌦-style marker instead of a number.
private struct MenuBarLabel: View {
    @ObservedObject var store: QuotaStore

    private var severity: QuotaStore.QuotaSeverity {
        guard let worst = store.worstActionable else { return .normal }
        return .of(remainingPct: worst.remainingPct)
    }

    var body: some View {
        HStack(spacing: 3) {
            if let worst = store.worstActionable {
                Image(systemName: severity.sfSymbol)
                Text(QuotaStore.formatUsedPct(remainingPct: worst.remainingPct))
                    .font(.system(size: 12, weight: .medium))
            } else if store.exhaustedCount > 0 {
                // Everything with data is exhausted — dimmed, not alarming.
                Image(systemName: "nosign")
            } else {
                Image(systemName: "gauge.medium")
            }
        }
        .foregroundStyle(store.worstActionable != nil ? severity.textColor : .secondary)
    }
}
