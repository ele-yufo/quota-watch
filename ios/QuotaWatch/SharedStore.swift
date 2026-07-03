import Foundation

/// Cross-process bridge between the app and the widget extension, backed by the
/// shared App Group container. The app writes the connection settings + the
/// latest quota snapshot here on every refresh; the widget reads them (and also
/// fetches fresh data itself when the network allows, falling back to this
/// snapshot when it can't reach the daemon).
enum SharedStore {
    /// Must match the App Group capability on BOTH targets (app + widget).
    static let appGroup = "group.io.quotawatch.app"

    private static var defaults: UserDefaults? { UserDefaults(suiteName: appGroup) }

    private enum K {
        static let host = "qw.host"
        static let port = "qw.port"
        static let token = "qw.token"
        static let snapshot = "qw.snapshot"       // JSON-encoded [QuotaProvider]
        static let snapshotAt = "qw.snapshotAt"   // epoch seconds of last good fetch
    }

    // ── Connection settings (app → widget) ──────────────────────────────

    /// Mirror the app's connection settings into the shared container so the
    /// widget can reach the same daemon. Call whenever host/port/token change.
    static func saveConnection(host: String, port: Int, token: String) {
        guard let d = defaults else { return }
        d.set(host, forKey: K.host)
        d.set(port, forKey: K.port)
        // The daemon token is a low-sensitivity bearer credential — it already
        // transits plain HTTP over the public tunnel, guarded only as an access
        // token. Keeping a copy in the App Group container (sandboxed to this
        // team) lets the widget authenticate without a separate keychain-sharing
        // entitlement. The app's own copy still lives in the Keychain.
        d.set(token, forKey: K.token)
    }

    static var host: String { defaults?.string(forKey: K.host) ?? "" }
    static var port: Int {
        let p = defaults?.integer(forKey: K.port) ?? 0
        return p == 0 ? 3737 : p
    }
    static var token: String { defaults?.string(forKey: K.token) ?? "" }

    // ── Snapshot cache (app → widget fallback) ──────────────────────────

    /// Persist the latest fetched quota so the widget has something to show the
    /// instant it renders, and a fallback when it can't reach the daemon.
    static func saveSnapshot(_ providers: [QuotaProvider], at date: Date = Date()) {
        guard let d = defaults, let data = try? JSONEncoder().encode(providers) else { return }
        d.set(data, forKey: K.snapshot)
        d.set(date.timeIntervalSince1970, forKey: K.snapshotAt)
    }

    /// Last cached snapshot + when it was captured, nil if nothing cached yet.
    static func loadSnapshot() -> (providers: [QuotaProvider], date: Date)? {
        guard let d = defaults, let data = d.data(forKey: K.snapshot),
              let providers = try? JSONDecoder().decode([QuotaProvider].self, from: data)
        else { return nil }
        let ts = d.double(forKey: K.snapshotAt)
        return (providers, ts > 0 ? Date(timeIntervalSince1970: ts) : Date())
    }
}
