import Foundation
import UserNotifications

/// Handles macOS native notifications for quota alerts.
enum Notifier {

    /// UNUserNotificationCenter requires a bundle identifier; a bare SwiftPM
    /// executable has none. Only use notifications when running as a real .app.
    private static var available: Bool { Bundle.main.bundleIdentifier != nil }

    /// Request permission to show notifications. Call once on app launch.
    static func requestPermission() {
        guard available else { return }
        UNUserNotificationCenter.current().requestAuthorization(options: [.alert, .sound, .badge]) { granted, error in
            if let error {
                print("[Notifier] Permission error: \(error.localizedDescription)")
            }
        }
    }

    /// Send a local notification immediately.
    static func send(title: String, body: String) {
        guard available else { return }
        let content = UNMutableNotificationContent()
        content.title = title
        content.body = body
        content.sound = .default

        let request = UNNotificationRequest(
            identifier: "quota-watch-\(UUID().uuidString)",
            content: content,
            trigger: nil // deliver immediately
        )

        UNUserNotificationCenter.current().add(request) { error in
            if let error {
                print("[Notifier] Failed to send notification: \(error.localizedDescription)")
            }
        }
    }
}
