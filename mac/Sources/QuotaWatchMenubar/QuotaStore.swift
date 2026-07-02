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
        let providers = readAllProviders()

        providerGroups = Self.buildGroups(providers: providers, items: items)
        worstItem = items.min(by: { $0.remainingPct < $1.remainingPct })
        lastUpdated = Date()
        errorMessage = providers.isEmpty && items.isEmpty ? errorMessage : nil

        // Send a local notification for anything critically low on quota.
        for item in items where item.remainingPct < 10 {
            Notifier.send(
                title: "⚠️ \(item.displayName) quota low",
                body: "\(item.windowName): \(Self.formatUsedPct(remainingPct: item.remainingPct)) used (\(Self.formatValue(item.used))/\(Self.formatValue(item.total)) \(item.unit))"
            )
        }
    }

    private func startAutoRefresh() {
        timer = Timer.scheduledTimer(withTimeInterval: 60, repeats: true) { [weak self] _ in
            Task { @MainActor in
                self?.refresh()
            }
        }
    }

    /// Combine every known provider with its latest windows, sorted by kind rank
    /// then window name. Providers keep appearing even with zero windows so the
    /// UI can render an "等待采集" placeholder for them.
    private static func buildGroups(providers: [ProviderInfo], items: [QuotaItem]) -> [ProviderGroup] {
        let itemsByProvider = Dictionary(grouping: items, by: { $0.providerId })
        return providers.map { info in
            let sorted = (itemsByProvider[info.id] ?? []).sorted { lhs, rhs in
                let lhsRank = WindowKind.rank(lhs.windowKind)
                let rhsRank = WindowKind.rank(rhs.windowKind)
                if lhsRank != rhsRank { return lhsRank < rhsRank }
                return lhs.windowName < rhs.windowName
            }
            return ProviderGroup(info: info, items: sorted)
        }
    }

    // MARK: - SQLite reads

    private func openDatabase() -> OpaquePointer? {
        guard FileManager.default.fileExists(atPath: dbPath) else {
            errorMessage = "Database not found at \(dbPath)"
            return nil
        }
        var db: OpaquePointer?
        guard sqlite3_open_v2(dbPath, &db, SQLITE_OPEN_READONLY, nil) == SQLITE_OK else {
            errorMessage = "Failed to open database"
            if let db { sqlite3_close(db) }
            return nil
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

    /// Read every known provider, including ones with no snapshots yet.
    private func readAllProviders() -> [ProviderInfo] {
        guard let db = openDatabase() else { return [] }
        defer { sqlite3_close(db) }

        let sql = "SELECT id, display_name, provider FROM providers ORDER BY display_name COLLATE NOCASE"

        var stmt: OpaquePointer?
        guard sqlite3_prepare_v2(db, sql, -1, &stmt, nil) == SQLITE_OK else {
            errorMessage = "SQL prepare failed: \(String(cString: sqlite3_errmsg(db)))"
            return []
        }
        defer { sqlite3_finalize(stmt) }

        var providers: [ProviderInfo] = []
        while sqlite3_step(stmt) == SQLITE_ROW {
            let id = String(cString: sqlite3_column_text(stmt, 0))
            let displayName = String(cString: sqlite3_column_text(stmt, 1))
            let providerType = String(cString: sqlite3_column_text(stmt, 2))
            providers.append(ProviderInfo(id: id, displayName: displayName, providerType: providerType))
        }

        return providers
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
