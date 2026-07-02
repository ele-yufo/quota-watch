import SwiftUI

@main
struct QuotaWatchApp: App {
    @State private var model = AppModel()

    var body: some Scene {
        WindowGroup {
            QuotaListView()
                .environment(model)
        }
    }
}
