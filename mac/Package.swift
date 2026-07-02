// swift-tools-version: 5.9
import PackageDescription

let package = Package(
    name: "QuotaWatchMenubar",
    platforms: [.macOS(.v14)],
    targets: [
        .executableTarget(
            name: "QuotaWatchMenubar",
            path: "Sources/QuotaWatchMenubar",
            linkerSettings: [
                .linkedFramework("UserNotifications"),
            ]
        )
    ]
)
