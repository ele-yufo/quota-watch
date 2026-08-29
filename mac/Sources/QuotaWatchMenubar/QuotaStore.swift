import Foundation
import SQLite3
import SwiftUI

/// Reads quota data from the same SQLite database used by the CLI (~/.quota-watch/data.db).
///
/// Severity model (the whole point of the rewrite): a window at 0% remaining
/// is EXHAUSTED — it can't be fixed, only waited out, so it must not drive the
/// menu-bar alarm color. The icon and headline number follow the worst
/// ACTIONABLE window (remaining > 0); exhausted windows render dimmed.
@MainActor
class QuotaStore: ObservableObject {
    @Published var providerGroups: [ProviderGroup] = []
    /// Worst window that can still be acted on (remaining > 0). Drives the
    /// menu-bar number + color. Nil when everything is exhausted or fresh.
    @Published var worstActionable: QuotaItem? = nil
    /// Windows at 0% remaining — surfaced dimmed, never as red alarm.
    @Published var exhaustedCount: Int = 0
    @Published var lastUpdated: Date? = nil
    /// Newest last_poll_at across providers — daemon liveness. Snapshot
    /// timestamps can't prove freshness (change-only writes keep them old by
    /// design); this can. Nil when the daemon has never polled.
    @Published var lastPollAt: Date? = nil
    @Published var errorMessage: String? = nil
    /// 24h used-% history per window (oldest → newest, timestamps kept so the
    /// sparkline can place points by TIME, not by index).
    @Published var history: [String: [(t: Date, usedPct: Double)]] = [:]

    /// Remaining-% below which a window warns — early enough to still act
    /// (switch provider, slow down). User-adjustable, persisted.
    @Published var alertThresholdPct: Double {
        didSet { UserDefaults.standard.set(alertThresholdPct, forKey: "alertThresholdPct") }
    }

    private var timer: Timer?
    private var dbPath: String

    /// Windows that have already fired their single alert for the current
    /// period. An id is cleared once its window recovers above the threshold
    /// (i.e. it reset), re-arming it for the next period — edge-triggered,
    /// never per-refresh spam.
    private var alertedWindowIds: Set<String> = []

    /// On the very first refresh we adopt whatever is already low as
    /// "already alerted", so launching (e.g. at login) never fires a burst of
    /// notifications for pre-existing low state — only in-session crossings.
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
        var exhausted: Bool { remainingPct <= 0 }
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

    /// Time-class severity of an ACTIONABLE window, driving color and icon.
    enum QuotaSeverity {
        case critical, warning, normal

        static func of(remainingPct: Double) -> QuotaSeverity {
            if remainingPct < 10 { return .critical }
            if remainingPct < 30 { return .warning }
            return .normal
        }

        var textColor: Color {
            switch self {
            case .critical: return .red
            case .warning: return .orange
            case .normal: return .primary
            }
        }

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
        let stored = UserDefaults.standard.double(forKey: "alertThresholdPct")
        self.alertThresholdPct = stored > 0 ? stored : 20
        refresh()
        startAutoRefresh()
    }

    // MARK: - Refresh

    func refresh() {
        // nil = read failed (DB missing/corrupt/busy); [] = read OK, no data yet
        guard let result = readLatestSnapshots() else {
            return // errorMessage already set by the failing read
        }
        errorMessage = nil
        let (items, pollAt) = result

        // Popover groups and the menu-bar label come from the SAME items, so
        // the two can never disagree (an earlier bug read providers via a
        // second connection that came back empty under WAL).
        providerGroups = Self.buildGroups(from: items)
        exhaustedCount = items.filter(\.exhausted).count
        worstActionable = items.filter { !$0.exhausted }.min(by: { $0.remainingPct < $1.remainingPct })
        lastUpdated = Date()
        lastPollAt = pollAt
        // A failed history read keeps the previous history — never publish
        // partial/cleared curves over a transient BUSY.
        if let h = readHistory() { history = h }

        // A partial read (e.g. hitting the daemon's hourly WAL checkpoint)
        // must not seed the alert baseline — a later complete read would look
        // like a burst of new threshold crossings.
        if !items.isEmpty || pollAt != nil {
            notifyLowQuota(items)
        }
    }

    /// Edge-triggered, once-per-period low-quota notifications. Exhausted
    /// windows (0% remaining) already fired when they crossed the threshold —
    /// they stay in alertedWindowIds until the window resets, so an exhausted
    /// weekly never re-notifies every refresh.
    private func notifyLowQuota(_ items: [QuotaItem]) {
        let lowNow = Set(items.filter { $0.remainingPct < alertThresholdPct }.map(\.id))

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
        // The daemon's hourly maintenance (DELETE + WAL checkpoint) can hold the
        // write lock — wait briefly instead of erroring or returning half a table.
        if let db { sqlite3_busy_timeout(db, 3000) }
        return db
    }

    /// ISO-8601 (with optional fractional seconds) → Date.
    private static func parseTimestamp(_ s: String) -> Date? {
        let withFraction = ISO8601DateFormatter()
        withFraction.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        if let d = withFraction.date(from: s) { return d }
        return ISO8601DateFormatter().date(from: s)
    }

    /// Read latest snapshot per provider+window from SQLite, plus the daemon's
    /// newest poll timestamp. Returns nil on read failure (errorMessage set).
    private func readLatestSnapshots() -> (items: [QuotaItem], lastPollAt: Date?)? {
        guard let db = openDatabase() else { return nil }
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
            return nil
        }
        defer { sqlite3_finalize(stmt) }

        var items: [QuotaItem] = []
        while true {
            let rc = sqlite3_step(stmt)
            if rc == SQLITE_DONE { break }
            // BUSY/IOERR here means the rows so far are a PREFIX, not the full
            // set — treating it as done would flash partial data and poison the
            // alert-seeding baseline. Fail the whole read instead.
            guard rc == SQLITE_ROW else {
                errorMessage = "SQL read failed: \(String(cString: sqlite3_errmsg(db)))"
                return nil
            }
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

        // Daemon liveness: newest poll across providers (change-only snapshots
        // can't prove freshness — their timestamps stay old by design).
        var lastPoll: Date? = nil
        var pollStmt: OpaquePointer?
        let pollPrepare = sqlite3_prepare_v2(db, "SELECT MAX(last_poll_at) FROM provider_poll_state", -1, &pollStmt, nil)
        if pollPrepare == SQLITE_OK {
            let rc = sqlite3_step(pollStmt)
            if rc == SQLITE_ROW, let text = sqlite3_column_text(pollStmt, 0) {
                lastPoll = Self.parseTimestamp(String(cString: text))
            } else if rc != SQLITE_ROW && rc != SQLITE_DONE {
                errorMessage = "Poll-state read failed: \(String(cString: sqlite3_errmsg(db)))"
                sqlite3_finalize(pollStmt)
                return nil
            }
            sqlite3_finalize(pollStmt)
        } else {
            // A brand-new DB may not have the table yet — tolerate ONLY that.
            let msg = String(cString: sqlite3_errmsg(db))
            if !msg.contains("no such table") {
                errorMessage = "Poll-state read failed: \(msg)"
                return nil
            }
        }

        return (items, lastPoll)
    }

    /// 24h of (time, used-%) per window, oldest → newest. Timestamps are kept:
    /// snapshots are change-only, so spacing points by INDEX would draw a
    /// bursty climb as a gradual 24h slope. Returns nil on any read failure —
    /// the caller keeps the previous history rather than flashing an empty one.
    private func readHistory() -> [String: [(t: Date, usedPct: Double)]]? {
        guard let db = openDatabase() else { return nil }
        defer { sqlite3_close(db) }

        // In-window changes PLUS the latest pre-cutoff snapshot per window —
        // without that carry-in point, a window that changed once from 40→60%
        // would render as a flat 60% line across the whole 24h.
        let sql = """
            SELECT provider_id, window_name, remaining_pct, timestamp
            FROM quota_snapshots
            WHERE timestamp >= strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-24 hours')
            UNION ALL
            SELECT provider_id, window_name, remaining_pct, timestamp
            FROM quota_snapshots
            WHERE id IN (
                SELECT MAX(id) FROM quota_snapshots
                WHERE timestamp < strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-24 hours')
                GROUP BY provider_id, window_name
            )
            ORDER BY timestamp
            """
        var stmt: OpaquePointer?
        guard sqlite3_prepare_v2(db, sql, -1, &stmt, nil) == SQLITE_OK else { return nil }
        defer { sqlite3_finalize(stmt) }

        var raw: [String: [(t: Date, usedPct: Double)]] = [:]
        while true {
            let rc = sqlite3_step(stmt)
            if rc == SQLITE_DONE { break }
            guard rc == SQLITE_ROW,
                  let tsText = sqlite3_column_text(stmt, 3),
                  let t = Self.parseTimestamp(String(cString: tsText))
            else { return nil } // BUSY/IOERR mid-read → partial data, reject
            let pid = String(cString: sqlite3_column_text(stmt, 0))
            let name = String(cString: sqlite3_column_text(stmt, 1))
            let used = max(0, min(100, 100 - sqlite3_column_double(stmt, 2)))
            raw["\(pid)|\(name)", default: []].append((t: t, usedPct: used))
        }
        // Downsample: keep ≤48 evenly spaced points per window.
        return raw.mapValues { points in
            guard points.count > 48 else { return points }
            let step = Double(points.count - 1) / 47
            return (0...47).map { points[Int((Double($0) * step).rounded())] }
        }
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
