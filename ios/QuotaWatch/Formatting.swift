import Foundation

/// Reset-countdown + relative-time formatting, matching the web dashboard's
/// `formatDuration` / `formatResetCountdown`.
enum Formatting {
    /// ms → "3d 04h" / "1h 30m" / "45m" / "<1m".
    static func duration(ms: Double) -> String {
        if ms < 60_000 { return "<1m" }
        let totalMin = Int(ms / 60_000)
        let d = totalMin / 1440
        let h = (totalMin % 1440) / 60
        let m = totalMin % 60
        if d > 0 { return "\(d)d \(String(format: "%02d", h))h" }
        if h > 0 { return "\(h)h \(String(format: "%02d", m))m" }
        return "\(m)m"
    }

    /// A reset Date → "3d 04h" / "now"; nil when there's no reset time.
    static func resetCountdown(_ date: Date?, now: Date = Date()) -> String? {
        guard let date else { return nil }
        let ms = date.timeIntervalSince(now) * 1000
        if ms <= 0 { return "now" }
        return duration(ms: ms)
    }

    /// A past Date → "5s" / "3m" for "updated X ago".
    static func ago(_ date: Date, now: Date = Date()) -> String {
        let sec = max(0, Int(now.timeIntervalSince(date)))
        if sec < 60 { return "\(sec)s" }
        return "\(sec / 60)m"
    }
}
