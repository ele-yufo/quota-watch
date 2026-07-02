import Foundation
import UserNotifications

/// Handles macOS native notifications for quota alerts.
enum Notifier {

    /// Request permission to show notifications. Call once on app launch.
    static func requestPermission() {
        UNUserNotificationCenter.current().requestAuthorization(options: [.alert, .sound, .badge]) { granted, error in
            if let error {
                print("[Notifier] Permission error: \(error.localizedDescription)")
            }
        }
    }

    /// Send a local notification immediately.
    static func send(title: String, body: String) {
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
