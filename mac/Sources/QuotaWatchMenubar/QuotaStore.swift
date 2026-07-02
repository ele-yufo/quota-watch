import Foundation
import SQLite3
import SwiftUI

/// Reads quota data from the same SQLite database used by the CLI (~/.quota-watch/data.db).
@MainActor
class QuotaStore: ObservableObject {
    @Published var providerGroups: [ProviderGroup] = []
    @Published var worstItem: QuotaItem? = nil
    @Published var lastUpdated: Date? = nil
    @Published var errorMessage: String? = nil

    private var timer: Timer?
    private var dbPath: String

    /// Remaining-% at which a window first warns — early enough that the user
    /// can still act (switch provider, slow down) instead of being told after
    /// it's already exhausted.
    private let alertThresholdPct: Double = 20

    /// Windows that have already fired their single alert for the current
    /// period. An id is cleared once its window recovers above the threshold
    /// (i.e. it reset), re-arming it for the next period. This is what makes
    /// alerts edge-triggered / once — never the old per-refresh spam.
    private var alertedWindowIds: Set<String> = []

    /// On the very first refresh we adopt whatever is already low as
    /// "already alerted", so launching (e.g. at login) never fires a burst of
    /// notifications for pre-existing low state — only in-session threshold
    /// crossings notify. The menu-bar color already surfaces the standing state.
    private var didSeedAlerts = false

    // MARK: - Models

    struct QuotaItem: Identifiable {
        let id: String          // provider_id + "|" + window_name
        let providerId: String
        let displayName: String
        let providerType: String
        let windowName: String
        let windowKind: String  // session | day | week | month | balance | unknown
        let used: Double
        let total: Double
        let unit: String
        let remainingPct: Double
        let resetAt: String?
        let timestamp: String

        var usedPct: Double { max(0, min(100, 100 - remainingPct)) }
    }

    struct ProviderInfo: Identifiable {
        let id: String
        let displayName: String
        let providerType: String
    }

    struct ProviderGroup: Identifiable {
        let info: ProviderInfo
        let items: [QuotaItem]  // sorted by window_kind rank, then window name
        var id: String { info.id }
    }

    /// Time-class severity of a window, driving color and icon everywhere.
    enum QuotaSeverity {
        case critical, warning, normal

        static func of(remainingPct: Double) -> QuotaSeverity {
            if remainingPct < 10 { return .critical }
            if remainingPct < 30 { return .warning }
            return .normal
        }

        /// Text color for numbers/labels — red/orange when tight, default label color otherwise.
        var textColor: Color {
            switch self {
            case .critical: return .red
            case .warning: return .orange
            case .normal: return .primary
            }
        }

        /// Progress-bar fill — same scale, but "normal" uses the accent color so the
        /// bar stays legible instead of rendering as a flat primary-color block.
        var barColor: Color {
            switch self {
            case .critical: return .red
            case .warning: return .orange
            case .normal: return .accentColor
            }
        }

        var sfSymbol: String {
            switch self {
            case .critical: return "exclamationmark.triangle.fill"
            case .warning: return "exclamationmark.triangle"
            case .normal: return "gauge.medium"
            }
        }
    }

    init() {
        let home = FileManager.default.homeDirectoryForCurrentUser.path
        self.dbPath = "\(home)/.quota-watch/data.db"
        refresh()
        startAutoRefresh()
    }

    // MARK: - Refresh

    func refresh() {
        let items = readLatestSnapshots()

        // Build the popover's provider groups from the SAME items that power the
        // menu-bar label — so the two can never disagree (an earlier bug read
        // providers via a second connection that came back empty under WAL,
        // leaving the popover blank while the label showed data).
        providerGroups = Self.buildGroups(from: items)
        worstItem = items.min(by: { $0.remainingPct < $1.remainingPct })
        lastUpdated = Date()
        if !items.isEmpty { errorMessage = nil }

        notifyLowQuota(items)
    }

    /// Edge-triggered, once-per-period low-quota notifications. Fires a single
    /// actionable alert when a window *first* drops below the threshold, and
    /// re-arms only after it recovers (resets). No repeated spam, and it warns
    /// while the user can still switch providers or pace usage — an alert at
    /// exhaustion is useless because it can't be reset, only waited out.
    private func notifyLowQuota(_ items: [QuotaItem]) {
        let lowNow = Set(items.filter { $0.remainingPct < alertThresholdPct }.map(\.id))

        // First refresh: adopt the current low set as already-alerted so launch
        // never fires a burst. Only crossings from here on notify.
        guard didSeedAlerts else {
            alertedWindowIds = lowNow
            didSeedAlerts = true
            return
        }

        for item in items {
            if item.remainingPct < alertThresholdPct {
                guard !alertedWindowIds.contains(item.id) else { continue }
                alertedWindowIds.insert(item.id)

                let remaining = String(format: "%.0f%%", max(0, item.remainingPct))
                var body = "\(Self.windowLabel(item)) 仅剩 \(remaining)，考虑切到其他渠道或放慢节奏"
                if let reset = Self.formatResetCountdown(item.resetAt) {
                    body += "；约 \(reset) 后重置"
                }
                Notifier.send(title: "\(item.displayName) 配额快用完了", body: body)
            } else {
                // Recovered above the threshold — re-arm for the next period.
                alertedWindowIds.remove(item.id)
            }
        }
    }

    /// Human window label for notifications — strip the redundant "(5h)" tail
    /// the window name often re-embeds (the alert doesn't have the chip).
    static func windowLabel(_ item: QuotaItem) -> String {
        if let r = item.windowName.range(
            of: #"\s*\([^)]*\)\s*$"#, options: .regularExpression) {
            return String(item.windowName[..<r.lowerBound])
        }
        return item.windowName
    }

    private func startAutoRefresh() {
        timer = Timer.scheduledTimer(withTimeInterval: 60, repeats: true) { [weak self] _ in
            Task { @MainActor in
                self?.refresh()
            }
        }
    }

    /// Group the latest windows by provider, preserving first-seen order (the
    /// query already sorts by display name), each provider's windows sorted by
    /// kind rank then window name.
    private static func buildGroups(from items: [QuotaItem]) -> [ProviderGroup] {
        var order: [String] = []
        var info: [String: ProviderInfo] = [:]
        var byProvider: [String: [QuotaItem]] = [:]
        for item in items {
            if info[item.providerId] == nil {
                order.append(item.providerId)
                info[item.providerId] = ProviderInfo(
                    id: item.providerId, displayName: item.displayName, providerType: item.providerType)
            }
            byProvider[item.providerId, default: []].append(item)
        }
        return order.map { pid in
            let sorted = (byProvider[pid] ?? []).sorted { lhs, rhs in
                let lhsRank = WindowKind.rank(lhs.windowKind)
                let rhsRank = WindowKind.rank(rhs.windowKind)
                if lhsRank != rhsRank { return lhsRank < rhsRank }
                return lhs.windowName < rhs.windowName
            }
            return ProviderGroup(info: info[pid]!, items: sorted)
        }
    }

    // MARK: - SQLite reads

    private func openDatabase() -> OpaquePointer? {
        guard FileManager.default.fileExists(atPath: dbPath) else {
            errorMessage = "Database not found at \(dbPath)"
            return nil
        }
        // Open read-write: a WAL database read from a separate read-only
        // connection can miss data written to the WAL. We only ever SELECT; WAL
        // permits concurrent connections, so this is safe alongside the daemon.
        var db: OpaquePointer?
        if sqlite3_open_v2(dbPath, &db, SQLITE_OPEN_READWRITE, nil) != SQLITE_OK {
            if let db { sqlite3_close(db) }
            db = nil
            guard sqlite3_open_v2(dbPath, &db, SQLITE_OPEN_READONLY, nil) == SQLITE_OK else {
                errorMessage = "Failed to open database"
                if let db { sqlite3_close(db) }
                return nil
            }
        }
        return db
    }

    /// Read latest snapshot per provider+window from SQLite.
    private func readLatestSnapshots() -> [QuotaItem] {
        guard let db = openDatabase() else { return [] }
        defer { sqlite3_close(db) }

        let sql = """
            SELECT s.provider_id, p.display_name, p.provider AS provider_type,
                   s.window_name, s.window_kind, s.used, s.total, s.unit,
                   s.remaining_pct, s.reset_at, s.timestamp
            FROM quota_snapshots s
            JOIN providers p ON s.provider_id = p.id
            WHERE s.id IN (
                SELECT MAX(id) FROM quota_snapshots
                GROUP BY provider_id, window_name
            )
            ORDER BY p.display_name, s.window_name
            """

        var stmt: OpaquePointer?
        guard sqlite3_prepare_v2(db, sql, -1, &stmt, nil) == SQLITE_OK else {
            errorMessage = "SQL prepare failed: \(String(cString: sqlite3_errmsg(db)))"
            return []
        }
        defer { sqlite3_finalize(stmt) }

        var items: [QuotaItem] = []
        while sqlite3_step(stmt) == SQLITE_ROW {
            let providerId = String(cString: sqlite3_column_text(stmt, 0))
            let displayName = String(cString: sqlite3_column_text(stmt, 1))
            let providerType = String(cString: sqlite3_column_text(stmt, 2))
            let windowName = String(cString: sqlite3_column_text(stmt, 3))
            let windowKind = sqlite3_column_text(stmt, 4).map { String(cString: $0) } ?? "unknown"
            let used = sqlite3_column_double(stmt, 5)
            let total = sqlite3_column_double(stmt, 6)
            let unit = String(cString: sqlite3_column_text(stmt, 7))
            let remainingPct = sqlite3_column_double(stmt, 8)
            let resetAt = sqlite3_column_text(stmt, 9).map { String(cString: $0) }
            let timestamp = String(cString: sqlite3_column_text(stmt, 10))

            items.append(QuotaItem(
                id: "\(providerId)|\(windowName)",
                providerId: providerId,
                displayName: displayName,
                providerType: providerType,
                windowName: windowName,
                windowKind: windowKind.isEmpty ? "unknown" : windowKind,
                used: used,
                total: total,
                unit: unit,
                remainingPct: remainingPct,
                resetAt: resetAt,
                timestamp: timestamp
            ))
        }

        return items
    }

    // MARK: - Formatting helpers

    /// "已用%" — the hero number: 100 - remaining, clamped, no decimals.
    static func formatUsedPct(remainingPct: Double) -> String {
        let usedPct = max(0, min(100, 100 - remainingPct))
        return String(format: "%.0f%%", usedPct)
    }

    static func formatValue(_ value: Double) -> String {
        if value >= 1_000_000 {
            return String(format: "%.1fM", value / 1_000_000)
        } else if value >= 1_000 {
            return String(format: "%.1fK", value / 1_000)
        } else if value == floor(value) {
            return String(format: "%.0f", value)
        } else {
            return String(format: "%.2f", value)
        }
    }

    /// "3d 04h" / "1h 30m" / "45m" / "now" / "<1m" / nil when no resetAt.
    /// Mirrors packages/web/src/lib/format.ts formatResetCountdown/formatDuration.
    static func formatResetCountdown(_ isoString: String?) -> String? {
        guard let isoString, let date = parseISODate(isoString) else { return nil }
        let ms = date.timeIntervalSinceNow * 1000
        if ms <= 0 { return "now" }
        return formatDuration(ms)
    }

    static func formatDuration(_ ms: Double) -> String {
        if ms < 60_000 { return "<1m" }
        let totalMinutes = Int(ms / 60_000)
        let days = totalMinutes / 1440
        let hours = (totalMinutes % 1440) / 60
        let minutes = totalMinutes % 60
        if days > 0 { return String(format: "%dd %02dh", days, hours) }
        if hours > 0 { return String(format: "%dh %02dm", hours, minutes) }
        return "\(minutes)m"
    }

    private static func parseISODate(_ isoString: String) -> Date? {
        let withFraction = ISO8601DateFormatter()
        withFraction.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        if let date = withFraction.date(from: isoString) { return date }

        let withoutFraction = ISO8601DateFormatter()
        withoutFraction.formatOptions = [.withInternetDateTime]
        return withoutFraction.date(from: isoString)
    }
}

/// Window-kind taxonomy shared with packages/core/src/windows.ts — keep in sync.
enum WindowKind {
    static let order: [String: Int] = [
        "session": 0, "day": 1, "week": 2, "month": 3, "balance": 4, "unknown": 5,
    ]

    static let chipLabel: [String: String] = [
        "session": "5h", "day": "24h", "week": "7d", "month": "1mo", "balance": "bal", "unknown": "—",
    ]

    static func rank(_ kind: String) -> Int { order[kind] ?? 5 }
    static func label(_ kind: String) -> String { chipLabel[kind] ?? "—" }
}
