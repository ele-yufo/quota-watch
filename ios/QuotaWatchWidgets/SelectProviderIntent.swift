import AppIntents
import WidgetKit

/// A provider the user can pin a widget to. The list is populated from the last
/// cached snapshot in the shared container (whatever the app last fetched).
struct ProviderEntity: AppEntity {
    let id: String
    let name: String

    static var typeDisplayRepresentation: TypeDisplayRepresentation { "渠道" }
    static let defaultQuery = ProviderQuery()

    var displayRepresentation: DisplayRepresentation { DisplayRepresentation(title: "\(name)") }
}

struct ProviderQuery: EntityQuery {
    func entities(for identifiers: [ProviderEntity.ID]) async throws -> [ProviderEntity] {
        all().filter { identifiers.contains($0.id) }
    }

    func suggestedEntities() async throws -> [ProviderEntity] { all() }

    private func all() -> [ProviderEntity] {
        (SharedStore.loadSnapshot()?.providers ?? [])
            .map { ProviderEntity(id: $0.providerId, name: $0.displayName) }
    }
}

/// Widget configuration: which provider to feature. Left unset, the widget shows
/// the tightest window across every provider ("am I about to hit a wall").
struct SelectProviderIntent: WidgetConfigurationIntent {
    static var title: LocalizedStringResource = "选择渠道"
    static var description = IntentDescription("留空则自动显示当前最紧张的窗口。")

    @Parameter(title: "渠道（留空 = 自动盯最紧张）")
    var provider: ProviderEntity?
}

/// Interactive-widget button: page the medium/large widget to the next slice of
/// providers. WidgetKit reloads the timeline after it runs, rendering the page.
struct NextPageIntent: AppIntent {
    static var title: LocalizedStringResource = "下一页"

    func perform() async throws -> some IntentResult {
        SharedStore.advanceWidgetPage()
        return .result()
    }
}
