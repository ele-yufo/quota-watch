import Foundation
import SwiftUI
import Observation
import WidgetKit

/// Connection settings + live quota state. Host/port persist in UserDefaults;
/// the API token lives in the Keychain. Owns the auto-refresh loop.
@Observable
final class AppModel {
    // ── Connection settings (persisted) ────────────────────────────────
    var host: String {
        didSet { UserDefaults.standard.set(host, forKey: "qw.host"); syncConnectionToWidget() }
    }
    var port: Int {
        didSet { UserDefaults.standard.set(port, forKey: "qw.port"); syncConnectionToWidget() }
    }
    /// Backed by Keychain, not UserDefaults.
    var token: String {
        didSet { KeychainHelper.save(token: token.isEmpty ? nil : token); syncConnectionToWidget() }
    }

    /// SHA-256 hex fingerprint of the daemon CA — set during pairing; when
    /// present, all requests are HTTPS with TLS pinned to this CA.
    var caFingerprint: String? {
        didSet {
            UserDefaults.standard.set(caFingerprint, forKey: "qw.caFingerprint")
            syncConnectionToWidget()
        }
    }

    /// Demo mode — shows built-in sample data with no daemon. Lets users preview
    /// before pairing, and lets App Store review see the app without a Mac.
    var demoMode: Bool {
        didSet { UserDefaults.standard.set(demoMode, forKey: "qw.demo") }
    }

    /// Show each window's used amount or its remaining amount — a global choice,
    /// mirrored to the App Group so the widgets match.
    var displayMode: QuotaDisplayMode {
        didSet {
            UserDefaults.standard.set(displayMode.rawValue, forKey: "qw.displayMode")
            SharedStore.setDisplayMode(displayMode)
            WidgetCenter.shared.reloadAllTimelines()
        }
    }

    // ── Live state ──────────────────────────────────────────────────────
    var providers: [QuotaProvider] = []
    var lastUpdated: Date?
    /// Typed failure of the last fetch (drives the error-state variants).
    var lastAPIError: APIError?
    var loadError: String? { lastAPIError?.errorDescription }
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
        self.caFingerprint = defaults.string(forKey: "qw.caFingerprint")
        self.demoMode = defaults.bool(forKey: "qw.demo")
        self.displayMode = QuotaDisplayMode(rawValue: defaults.string(forKey: "qw.displayMode") ?? "") ?? .used
        // didSet doesn't fire during init — seed the shared container so a widget
        // added before the first settings change still has host/port/token.
        SharedStore.saveConnection(host: host, port: port, token: token, caFingerprint: caFingerprint)
        SharedStore.setDisplayMode(displayMode)
    }

    /// Flip between showing used and remaining, everywhere.
    func toggleDisplayMode() { displayMode = displayMode.next }

    /// True while a multi-field connection update is in flight — the individual
    /// didSet hooks then skip the per-field widget sync so the App Group never
    /// sees a partial (new host + old port) connection.
    private var suppressWidgetSync = false

    /// Mirror connection settings to the App Group + nudge widgets to reload.
    private func syncConnectionToWidget() {
        guard !suppressWidgetSync else { return }
        SharedStore.saveConnection(host: host, port: port, token: token, caFingerprint: caFingerprint)
        WidgetCenter.shared.reloadAllTimelines()
    }

    /// Set host/port/token/caFingerprint atomically: one shared-container write,
    /// one widget reload, no intermediate state. Pairing always goes through here.
    private func applyConnection(host: String, port: Int, token: String, caFingerprint: String?) {
        demoMode = false
        suppressWidgetSync = true
        self.host = host
        self.port = port
        self.token = token
        self.caFingerprint = caFingerprint
        suppressWidgetSync = false
        syncConnectionToWidget()
    }

    /// Push the latest snapshot to the shared container and refresh any widgets.
    private func persistForWidget() {
        SharedStore.saveSnapshot(providers)
        WidgetCenter.shared.reloadAllTimelines()
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
        lastAPIError = nil
        initialLoadFailed = false
        // Deliberately NOT persisted to the widget cache: demo is an in-app
        // preview only. Writing it would make the widget show fake data as if
        // real (and survive into a later failed real fetch).
    }

    /// Leave demo mode and clear the sample data.
    @MainActor
    func exitDemo() {
        demoMode = false
        providers = []
        lastUpdated = nil
    }

    var client: APIClient {
        APIClient(host: host, port: port, token: token.isEmpty ? nil : token,
                  caFingerprint: caFingerprint)
    }

    /// Whether the configured host looks routable/public (drives the cleartext warning).
    var hostReachability: HostReachability {
        HostReachability(host: host)
    }

    /// Windows currently in the critical band (<10% remaining).
    var criticalWindows: [(provider: QuotaProvider, window: QuotaWindow)] {
        providers.flatMap { p in p.windows.filter { $0.remainingPct < 10 }.map { (p, $0) } }
    }

    /// The single most-at-risk window across all providers — the hero dial.
    var mostUrgent: (provider: QuotaProvider, window: QuotaWindow)? {
        providers.compactMap { p in p.primary.map { (p, $0) } }
            .min { $0.window.remainingPct < $1.window.remainingPct }
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
    /// mode so real data takes over, and fetches immediately so the widget has
    /// a real snapshot (not the empty state) right after pairing.
    @MainActor
    func applyPairing(_ payload: PairingPayload) {
        applyConnection(host: payload.host, port: payload.port, token: payload.token ?? "",
                        caFingerprint: payload.caFingerprint)
        Task { await self.refresh() }
    }

    /// Exchange a short-lived pairing code for the token (POST /pair/claim), then
    /// store the connection. The token never has to be seen or typed. Returns nil
    /// on success, or a user-facing error message.
    @MainActor
    func applyPairingCode(host: String, port: Int, code: String, caFingerprint: String? = nil) async -> String? {
        // The QR's fingerprint pins this very first request; a manual 6-digit
        // code has none, so the daemon's answer becomes the pin (the claim
        // response is the only untrusted hop — bounded by a 5-min single-use
        // code on the LAN).
        let client = APIClient(host: host, port: port, token: nil, caFingerprint: caFingerprint)
        do {
            let claimed = try await client.claimPairingCode(code)
            applyConnection(host: host, port: port, token: claimed.token,
                            caFingerprint: claimed.caFingerprint ?? caFingerprint)
            // Fetch right away so the widget cache has real data before the next
            // auto-refresh tick (which could be up to 10s away).
            await refresh()
            return nil
        } catch let error as APIError {
            if case .unauthorized = error {
                return "配对码无效或已过期 — 在 Mac 菜单栏点「配对」重新生成"
            }
            if case .certChanged = error {
                return "证书校验失败 — daemon 证书已更换，请在 Mac 上重新配对"
            }
            // .unreachable 等普通网络失败走通用文案，不再误报证书更换。
            return error.errorDescription ?? "配对失败"
        } catch {
            return "配对失败：\(error.localizedDescription)"
        }
    }

    // ── Data loading ────────────────────────────────────────────────────

    /// Fetch quota once; keeps prior data on failure and records the error.
    /// In demo mode it just refreshes the built-in sample data.
    @MainActor
    func refresh() async {
        if demoMode {
            providers = DemoData.providers()
            lastUpdated = Date()
            lastAPIError = nil
            initialLoadFailed = false
            return  // demo is in-app only — never written to the widget cache
        }
        guard isConfigured, !isRefreshing else { return }
        isRefreshing = true
        defer { isRefreshing = false }
        do {
            providers = try await client.quota()
            lastUpdated = Date()
            lastAPIError = nil
            initialLoadFailed = false
            persistForWidget()
        } catch {
            lastAPIError = (error as? APIError) ?? .unreachable
            // Offline fallback: memory is empty but the App Group still holds
            // the last good snapshot (e.g. app was killed, daemon unreachable
            // on relaunch) — surface it instead of a blank list. The stale
            // banner marks the age; a later success replaces it.
            if providers.isEmpty, let cached = SharedStore.loadSnapshot() {
                providers = cached.providers
                lastUpdated = cached.date
            }
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
                // 10s base + 0–3s jitter — keeps multiple devices / clock
                // boundaries from hammering the daemon in lockstep.
                let jitter = UInt64.random(in: 0...3_000_000_000)
                try? await Task.sleep(nanoseconds: Self.refreshInterval + jitter)
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
