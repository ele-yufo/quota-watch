import Foundation
import SwiftUI
import Observation

/// Connection settings + live quota state. Host/port persist in UserDefaults;
/// the API token lives in the Keychain. Owns the auto-refresh loop.
@Observable
final class AppModel {
    // ── Connection settings (persisted) ────────────────────────────────
    var host: String {
        didSet { UserDefaults.standard.set(host, forKey: "qw.host") }
    }
    var port: Int {
        didSet { UserDefaults.standard.set(port, forKey: "qw.port") }
    }
    /// Backed by Keychain, not UserDefaults.
    var token: String {
        didSet { KeychainHelper.save(token: token.isEmpty ? nil : token) }
    }

    /// Demo mode — shows built-in sample data with no daemon. Lets users preview
    /// before pairing, and lets App Store review see the app without a Mac.
    var demoMode: Bool {
        didSet { UserDefaults.standard.set(demoMode, forKey: "qw.demo") }
    }

    // ── Live state ──────────────────────────────────────────────────────
    var providers: [QuotaProvider] = []
    var lastUpdated: Date?
    var loadError: String?
    var isRefreshing = false
    var isPolling = false
    /// True only after the initial quick-retry grace period has failed — lets the
    /// UI keep showing the skeleton through a transient cold-start miss instead of
    /// flashing the full error screen.
    var initialLoadFailed = false

    private var refreshTask: Task<Void, Never>?
    private static let refreshInterval: UInt64 = 10_000_000_000 // 10s in ns

    init() {
        let defaults = UserDefaults.standard
        self.host = defaults.string(forKey: "qw.host") ?? ""
        let storedPort = defaults.integer(forKey: "qw.port")
        self.port = storedPort == 0 ? 3737 : storedPort
        self.token = KeychainHelper.loadToken() ?? ""
        self.demoMode = defaults.bool(forKey: "qw.demo")
    }

    var isConfigured: Bool {
        demoMode || !host.trimmingCharacters(in: .whitespaces).isEmpty
    }

    /// Turn demo mode on (and load sample data immediately).
    @MainActor
    func enterDemo() {
        demoMode = true
        providers = DemoData.providers()
        lastUpdated = Date()
        loadError = nil
        initialLoadFailed = false
    }

    /// Leave demo mode and clear the sample data.
    func exitDemo() {
        demoMode = false
        providers = []
        lastUpdated = nil
    }

    var client: APIClient {
        APIClient(host: host, port: port, token: token.isEmpty ? nil : token)
    }

    /// Whether the configured host looks routable/public (drives the cleartext warning).
    var hostReachability: HostReachability {
        HostReachability(host: host)
    }

    /// Windows currently in the critical band (<10% remaining).
    var criticalWindows: [(provider: QuotaProvider, window: QuotaWindow)] {
        providers.flatMap { p in p.windows.filter { $0.remainingPct < 10 }.map { (p, $0) } }
    }

    /// Number of critical windows — drives the warning haptic when it increases.
    var criticalCount: Int { criticalWindows.count }

    /// A stable signature of the current critical set. Dismissing the alert
    /// remembers this; a *new* window going critical changes the signature so the
    /// alert reappears rather than staying silenced forever.
    var alertSignature: String {
        criticalWindows.map { "\($0.provider.providerId):\($0.window.windowName)" }.sorted().joined(separator: "|")
    }

    /// Signature the user last dismissed; nil = nothing dismissed.
    var dismissedAlertSignature: String?

    /// Show the alert banner when something is critical and this exact set
    /// hasn't been dismissed.
    var showAlert: Bool {
        criticalCount > 0 && alertSignature != dismissedAlertSignature
    }

    func dismissAlert() {
        dismissedAlertSignature = alertSignature
    }

    /// Apply a scanned pairing payload to the connection settings. Leaves demo
    /// mode so real data takes over.
    func applyPairing(_ payload: PairingPayload) {
        demoMode = false
        host = payload.host
        port = payload.port
        token = payload.token ?? ""
    }

    // ── Data loading ────────────────────────────────────────────────────

    /// Fetch quota once; keeps prior data on failure and records the error.
    /// In demo mode it just refreshes the built-in sample data.
    @MainActor
    func refresh() async {
        if demoMode {
            providers = DemoData.providers()
            lastUpdated = Date()
            loadError = nil
            initialLoadFailed = false
            return
        }
        guard isConfigured, !isRefreshing else { return }
        isRefreshing = true
        defer { isRefreshing = false }
        do {
            providers = try await client.quota()
            lastUpdated = Date()
            loadError = nil
            initialLoadFailed = false
        } catch {
            loadError = (error as? APIError)?.errorDescription ?? error.localizedDescription
        }
    }

    /// Ask the daemon to poll providers now, then re-read.
    @MainActor
    func pollNow() async {
        guard isConfigured, !isPolling else { return }
        isPolling = true
        defer { isPolling = false }
        _ = try? await client.pollNow()
        await refresh()
    }

    /// Test the current settings against /health.
    func testConnection() async -> Result<HealthResponse, APIError> {
        do {
            return .success(try await client.health())
        } catch let error as APIError {
            return .failure(error)
        } catch {
            return .failure(.unreachable)
        }
    }

    // ── Auto-refresh lifecycle ──────────────────────────────────────────

    /// Start the refresh loop (idempotent). Call when the list appears or the app
    /// returns to the foreground. On a cold start it retries quickly a few times
    /// before surfacing the error screen, then settles into the 10s cadence.
    func startAutoRefresh() {
        refreshTask?.cancel()
        refreshTask = Task { [weak self] in
            guard let self else { return }
            await self.refresh()

            // Quick-retry grace: a single transient first-fetch miss shouldn't
            // flash the error screen. Retry every 2s up to 3× while never loaded.
            var quick = 0
            while !Task.isCancelled && self.lastUpdated == nil && quick < 3 {
                try? await Task.sleep(nanoseconds: 2_000_000_000)
                if Task.isCancelled { break }
                await self.refresh()
                quick += 1
            }
            if self.lastUpdated == nil { self.initialLoadFailed = true }

            while !Task.isCancelled {
                try? await Task.sleep(nanoseconds: Self.refreshInterval)
                if Task.isCancelled { break }
                await self.refresh()
            }
        }
    }

    func stopAutoRefresh() {
        refreshTask?.cancel()
        refreshTask = nil
    }
}
