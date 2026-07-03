import Foundation
import WidgetKit

/// A provider paired with one of its windows — the unit both the single-window
/// and the overview widgets render. Identifiable so `ForEach` is clean.
struct RankedWindow: Identifiable {
    let provider: QuotaProvider
    let window: QuotaWindow
    var id: String { provider.providerId + "|" + window.windowName }

    var level: UsageLevel { UsageLevel(remainingPct: window.remainingPct) }
}

/// One rendered moment for the widgets.
struct QuotaEntry: TimelineEntry {
    let date: Date
    let providers: [QuotaProvider]
    let selectedProviderId: String?
    let lastUpdated: Date?
    /// True when the data came from the cache (daemon unreachable) rather than a
    /// fresh fetch — the views show a subtle "缓存" hint.
    let isStale: Bool
    /// Paging index for the medium/large widgets (wraps in the view). Advanced by
    /// the interactive NextPageIntent button.
    var page: Int = 0
    /// Show used vs remaining — mirrors the app's global choice.
    var displayMode: QuotaDisplayMode = .used

    /// The window a single-window widget features: the selected provider's
    /// tightest window, or the tightest across everything when none is pinned.
    var featured: RankedWindow? {
        let pool: [QuotaProvider]
        if let sel = selectedProviderId, let p = providers.first(where: { $0.providerId == sel }) {
            pool = [p]
        } else {
            pool = providers
        }
        return pool
            .flatMap { p in p.windows.map { RankedWindow(provider: p, window: $0) } }
            .min { $0.window.remainingPct < $1.window.remainingPct }
    }

    /// Each provider's tightest window, worst first — for the small widget.
    var overviewRows: [RankedWindow] {
        providers
            .compactMap { p in p.primary.map { RankedWindow(provider: p, window: $0) } }
            .sorted { $0.window.remainingPct < $1.window.remainingPct }
    }

    /// Providers ordered by their tightest window (worst first) — the medium /
    /// large overview shows each with all of its windows.
    var sortedProviders: [QuotaProvider] {
        providers.sorted { ($0.primary?.remainingPct ?? 100) < ($1.primary?.remainingPct ?? 100) }
    }

    static let placeholder = QuotaEntry(
        date: Date(), providers: DemoData.providers(),
        selectedProviderId: nil, lastUpdated: Date(), isStale: false)
}

/// Fetches `/quota` (network first, cache fallback) and builds an entry.
enum QuotaFetcher {
    /// ~20 min between reloads keeps comfortably within WidgetKit's refresh
    /// budget while staying fresh enough for quota (which moves over minutes).
    static let refreshInterval: TimeInterval = 20 * 60

    static func entry(selecting providerId: String?) async -> QuotaEntry {
        let page = SharedStore.widgetPage
        let mode = SharedStore.displayMode
        let host = SharedStore.host
        if !host.isEmpty {
            let client = APIClient(
                host: host, port: SharedStore.port,
                token: SharedStore.token.isEmpty ? nil : SharedStore.token, timeout: 5)
            if let providers = try? await client.quota() {
                SharedStore.saveSnapshot(providers)
                return QuotaEntry(
                    date: Date(), providers: providers, selectedProviderId: providerId,
                    lastUpdated: Date(), isStale: false, page: page, displayMode: mode)
            }
        }
        // Daemon unreachable (wrong network, asleep Mac, not paired) → last cache.
        if let cached = SharedStore.loadSnapshot() {
            return QuotaEntry(
                date: Date(), providers: cached.providers, selectedProviderId: providerId,
                lastUpdated: cached.date, isStale: true, page: page, displayMode: mode)
        }
        return QuotaEntry(
            date: Date(), providers: [], selectedProviderId: providerId,
            lastUpdated: nil, isStale: true, page: page, displayMode: mode)
    }

    /// Fast, network-free entry from the cache — drives the LIVE render (snapshot
    /// + timeline) so a freshly-added widget paints instantly instead of a white
    /// box. When there is no cache it returns an EMPTY entry (→ the "未配对 · 打开
    /// App" state), never fabricated demo data: showing demo on the real widget
    /// would be indistinguishable from live quota. (Demo is only for the gallery
    /// placeholder, below.)
    static func cachedEntry(selecting providerId: String?) -> QuotaEntry {
        let page = SharedStore.widgetPage
        let mode = SharedStore.displayMode
        if let cached = SharedStore.loadSnapshot() {
            return QuotaEntry(
                date: Date(), providers: cached.providers, selectedProviderId: providerId,
                lastUpdated: cached.date, isStale: false, page: page, displayMode: mode)
        }
        return QuotaEntry(
            date: Date(), providers: [], selectedProviderId: providerId,
            lastUpdated: nil, isStale: true, page: page, displayMode: mode)
    }

    /// A timeline that renders INSTANTLY from cache (never awaits the network,
    /// so a freshly-added widget can never sit white) and kicks a background
    /// refresh so the next cycle has fresh data.
    static func instantTimeline(selecting providerId: String?) -> Timeline<QuotaEntry> {
        Timeline(entries: [cachedEntry(selecting: providerId)],
                 policy: .after(Date().addingTimeInterval(refreshInterval)))
    }

    /// Fetch live quota and update the shared cache — best effort, no UI wait.
    static func refreshCache() async {
        let host = SharedStore.host
        guard !host.isEmpty else { return }
        let client = APIClient(
            host: host, port: SharedStore.port,
            token: SharedStore.token.isEmpty ? nil : SharedStore.token, timeout: 8)
        if let providers = try? await client.quota() {
            SharedStore.saveSnapshot(providers)
        }
    }
}

/// Configurable single-window widget (small + accessory families).
struct FeaturedProvider: AppIntentTimelineProvider {
    // Gallery placeholder = representative demo (redacted by the system). The
    // live render (snapshot/timeline) uses the real cache-or-empty.
    func placeholder(in context: Context) -> QuotaEntry { .placeholder }

    func snapshot(for configuration: SelectProviderIntent, in context: Context) async -> QuotaEntry {
        QuotaFetcher.cachedEntry(selecting: configuration.provider?.id)
    }

    func timeline(for configuration: SelectProviderIntent, in context: Context) async -> Timeline<QuotaEntry> {
        Task { await QuotaFetcher.refreshCache() }
        return QuotaFetcher.instantTimeline(selecting: configuration.provider?.id)
    }
}

/// Non-configurable overview widget (medium + large families).
struct OverviewProvider: TimelineProvider {
    func placeholder(in context: Context) -> QuotaEntry { .placeholder }

    func getSnapshot(in context: Context, completion: @escaping (QuotaEntry) -> Void) {
        completion(QuotaFetcher.cachedEntry(selecting: nil))
    }

    func getTimeline(in context: Context, completion: @escaping (Timeline<QuotaEntry>) -> Void) {
        Task { await QuotaFetcher.refreshCache() }
        completion(QuotaFetcher.instantTimeline(selecting: nil))
    }
}
