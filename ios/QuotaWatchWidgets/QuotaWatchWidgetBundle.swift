import SwiftUI
import WidgetKit

@main
struct QuotaWatchWidgetBundle: WidgetBundle {
    var body: some Widget {
        FeaturedQuotaWidget()
        OverviewQuotaWidget()
    }
}

/// Small + lock-screen widget: one window. Auto-tracks the tightest window by
/// default; long-press to pin a specific provider (SelectProviderIntent).
struct FeaturedQuotaWidget: Widget {
    let kind = "QuotaFeatured"

    var body: some WidgetConfiguration {
        AppIntentConfiguration(kind: kind, intent: SelectProviderIntent.self, provider: FeaturedProvider()) { entry in
            FeaturedWidgetView(entry: entry)
        }
        .configurationDisplayName("配额 · 速览")
        .description("最紧张的几个渠道一览；长按可只盯一个渠道。")
        .supportedFamilies([.systemSmall, .accessoryCircular, .accessoryRectangular, .accessoryInline])
    }
}

/// Medium + large home-screen overview: every provider's tightest window, worst
/// first, paginated — tap the ▶ to page through more than fit on one screen.
struct OverviewQuotaWidget: Widget {
    let kind = "QuotaOverview"

    var body: some WidgetConfiguration {
        StaticConfiguration(kind: kind, provider: OverviewProvider()) { entry in
            OverviewWidgetView(entry: entry)
        }
        .configurationDisplayName("配额 · 概览")
        .description("多渠道一览，按紧张度排序；点 ▶ 翻页看更多。")
        .supportedFamilies([.systemMedium, .systemLarge])
    }
}
