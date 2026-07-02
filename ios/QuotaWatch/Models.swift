import Foundation

/// Time-class of a quota window — mirrors core `WindowKind`. Unknown values
/// from a newer server decode to `.unknown` rather than failing the whole row.
enum WindowKind: String, Codable, CaseIterable {
    case session, day, week, month, balance, unknown

    init(from decoder: Decoder) throws {
        let raw = try decoder.singleValueContainer().decode(String.self)
        self = WindowKind(rawValue: raw) ?? .unknown
    }

    /// Display rank — tighter window first (mirrors core WINDOW_KIND_ORDER).
    var order: Int {
        switch self {
        case .session: return 0
        case .day: return 1
        case .week: return 2
        case .month: return 3
        case .balance: return 4
        case .unknown: return 5
        }
    }

    /// Compact chip label (mirrors core windowKindLabel).
    var label: String {
        switch self {
        case .session: return "5h"
        case .day: return "24h"
        case .week: return "7d"
        case .month: return "1mo"
        case .balance: return "bal"
        case .unknown: return "—"
        }
    }
}

/// One quota window — matches a row of `GET /quota` → provider.windows[].
struct QuotaWindow: Codable, Identifiable, Hashable {
    let windowName: String
    let windowKind: WindowKind
    let used: Double
    let total: Double
    let unit: String
    let remainingPct: Double
    let resetAt: String?
    let timestamp: String

    var id: String { windowName }

    /// Consumed percentage — the headline number.
    var usedPct: Double { max(0, min(100, 100 - remainingPct)) }

    /// resetAt parsed to a Date (ISO-8601), nil if absent/unparseable.
    var resetDate: Date? {
        guard let resetAt else { return nil }
        return ISO8601DateParser.date(from: resetAt)
    }
}

/// One provider — matches a top-level element of `GET /quota`.
struct QuotaProvider: Codable, Identifiable, Hashable {
    let providerId: String
    let displayName: String
    let providerType: String
    let windows: [QuotaWindow]

    var id: String { providerId }

    /// Windows sorted by kind (server already sorts; re-sort defensively).
    var sortedWindows: [QuotaWindow] {
        windows.sorted { $0.windowKind.order < $1.windowKind.order }
    }

    /// The most-at-risk window (lowest remaining), nil when no snapshot yet.
    var primary: QuotaWindow? {
        windows.min { $0.remainingPct < $1.remainingPct }
    }
}

/// `GET /health` response — daemon liveness for the "test connection" flow.
struct HealthResponse: Codable {
    let status: String
    let pid: Int
    let version: String
    let uptimeSec: Int
    let providers: [HealthProvider]

    struct HealthProvider: Codable {
        let id: String
        let provider: String
        let displayName: String
        let pollIntervalMs: Int
    }
}

/// Lenient ISO-8601 parser accepting both fractional and whole-second forms.
enum ISO8601DateParser {
    private static let withFraction: ISO8601DateFormatter = {
        let f = ISO8601DateFormatter()
        f.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return f
    }()
    private static let plain: ISO8601DateFormatter = {
        let f = ISO8601DateFormatter()
        f.formatOptions = [.withInternetDateTime]
        return f
    }()

    static func date(from string: String) -> Date? {
        withFraction.date(from: string) ?? plain.date(from: string)
    }
}
