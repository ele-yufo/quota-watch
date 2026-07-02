import Foundation

/// Built-in sample data for Demo mode — lets the full UI run with no daemon.
/// Used for the "preview before pairing" flow and so App Store reviewers can
/// see the app working without setting up a Mac. Reset times are computed
/// relative to now so countdowns look live.
enum DemoData {
    static func providers() -> [QuotaProvider] {
        let now = Date()
        func iso(_ seconds: TimeInterval) -> String {
            let f = ISO8601DateFormatter()
            f.formatOptions = [.withInternetDateTime]
            return f.string(from: now.addingTimeInterval(seconds))
        }
        func win(_ name: String, _ kind: WindowKind, used: Double, resetIn: TimeInterval) -> QuotaWindow {
            QuotaWindow(
                windowName: name, windowKind: kind,
                used: used, total: 100, unit: "percent",
                remainingPct: 100 - used, resetAt: iso(resetIn),
                timestamp: iso(0)
            )
        }

        return [
            QuotaProvider(providerId: "demo-claude", displayName: "Claude Max", providerType: "claude", windows: [
                win("session (5h)", .session, used: 42, resetIn: 3.5 * 3600),
                win("weekly (7d)", .week, used: 63, resetIn: 3.2 * 86400),
            ]),
            QuotaProvider(providerId: "demo-codex", displayName: "Codex Business", providerType: "codex", windows: [
                win("session (5h)", .session, used: 18, resetIn: 1.7 * 3600),
                win("weekly (7d)", .week, used: 45, resetIn: 4.4 * 86400),
            ]),
            QuotaProvider(providerId: "demo-glm", displayName: "GLM CN", providerType: "glm-cn", windows: [
                win("session (5h)", .session, used: 8, resetIn: 2.1 * 3600),
                win("weekly (7d)", .week, used: 96, resetIn: 3.1 * 86400),
            ]),
            QuotaProvider(providerId: "demo-opencode", displayName: "OpenCode Go", providerType: "opencode-go", windows: [
                win("session (5h)", .session, used: 5, resetIn: 4.9 * 3600),
                win("weekly (7d)", .week, used: 37, resetIn: 3.0 * 86400),
                win("monthly (1mo)", .month, used: 18, resetIn: 26.5 * 86400),
            ]),
            QuotaProvider(providerId: "demo-kimi", displayName: "Kimi", providerType: "kimi", windows: [
                win("session (5h)", .session, used: 12, resetIn: 2.4 * 3600),
                win("weekly (7d)", .week, used: 24, resetIn: 6.2 * 86400),
            ]),
            QuotaProvider(providerId: "demo-antigravity", displayName: "Antigravity", providerType: "antigravity", windows: [
                win("Gemini (5h)", .session, used: 31, resetIn: 4.0 * 3600),
                win("Claude+GPT (5h)", .session, used: 74, resetIn: 4.0 * 3600),
            ]),
        ]
    }
}
