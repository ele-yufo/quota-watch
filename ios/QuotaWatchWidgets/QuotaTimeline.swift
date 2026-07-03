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

    /// Each provider's tightest window, worst first — for the overview widget.
    var overviewRows: [RankedWindow] {
        providers
            .compactMap { p in p.primary.map { RankedWindow(provider: p, window: $0) } }
            .sorted { $0.window.remainingPct < $1.window.remainingPct }
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
        let host = SharedStore.host
        if !host.isEmpty {
            let client = APIClient(
                host: host, port: SharedStore.port,
                token: SharedStore.token.isEmpty ? nil : SharedStore.token)
            if let providers = try? await client.quota() {
                SharedStore.saveSnapshot(providers)
                return QuotaEntry(
                    date: Date(), providers: providers,
                    selectedProviderId: providerId, lastUpdated: Date(), isStale: false)
            }
        }
        // Daemon unreachable (wrong network, asleep Mac, not paired) → last cache.
        if let cached = SharedStore.loadSnapshot() {
            return QuotaEntry(
                date: Date(), providers: cached.providers,
                selectedProviderId: providerId, lastUpdated: cached.date, isStale: true)
        }
        return QuotaEntry(
            date: Date(), providers: [],
            selectedProviderId: providerId, lastUpdated: nil, isStale: true)
    }

    static func timeline(selecting providerId: String?) async -> Timeline<QuotaEntry> {
        let entry = await entry(selecting: providerId)
        return Timeline(entries: [entry], policy: .after(Date().addingTimeInterval(refreshInterval)))
    }
}

/// Configurable single-window widget (small + accessory families).
struct FeaturedProvider: AppIntentTimelineProvider {
    func placeholder(in context: Context) -> QuotaEntry { .placeholder }

    func snapshot(for configuration: SelectProviderIntent, in context: Context) async -> QuotaEntry {
        await QuotaFetcher.entry(selecting: configuration.provider?.id)
    }

    func timeline(for configuration: SelectProviderIntent, in context: Context) async -> Timeline<QuotaEntry> {
        await QuotaFetcher.timeline(selecting: configuration.provider?.id)
    }
}

/// Non-configurable overview widget (medium family).
struct OverviewProvider: TimelineProvider {
    func placeholder(in context: Context) -> QuotaEntry { .placeholder }

    func getSnapshot(in context: Context, completion: @escaping (QuotaEntry) -> Void) {
        Task { completion(await QuotaFetcher.entry(selecting: nil)) }
    }

    func getTimeline(in context: Context, completion: @escaping (Timeline<QuotaEntry>) -> Void) {
        Task { completion(await QuotaFetcher.timeline(selecting: nil)) }
    }
}
