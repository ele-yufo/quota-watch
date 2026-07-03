import Foundation
import SwiftUI
import CoreImage.CIFilterBuiltins
import AppKit
import Darwin

/// Drives the menu-bar "pair a device" flow: asks the daemon for a short-lived
/// pairing code (POST /pair/start), renders it as a QR the phone scans, and
/// counts it down. The API token never leaves the Mac — the phone exchanges the
/// code for it via /pair/claim.
@MainActor
final class PairingModel: ObservableObject {
    @Published var code: String?
    @Published var qrImage: NSImage?
    @Published var host = ""
    @Published var port = 3737
    @Published var secondsLeft = 0
    @Published var error: String?
    @Published var isLoading = false

    private var timer: Timer?
    private var expiresAt: Date?

    private struct DaemonConfig { let port: Int; let token: String? }

    /// Begin a pairing session — reads config, resolves the LAN IP, asks the
    /// daemon for a code, and builds the QR.
    func start() {
        let config = loadConfig()
        port = config.port
        host = lanIPv4() ?? "127.0.0.1"
        error = nil
        isLoading = true
        Task { await requestCode(config) }
    }

    func stop() {
        timer?.invalidate()
        timer = nil
    }

    // MARK: - Daemon

    private func requestCode(_ config: DaemonConfig) async {
        defer { isLoading = false }
        guard let url = URL(string: "http://127.0.0.1:\(config.port)/pair/start") else { return }
        var req = URLRequest(url: url)
        req.httpMethod = "POST"
        req.timeoutInterval = 5
        if let token = config.token {
            req.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        }
        do {
            let (data, resp) = try await URLSession.shared.data(for: req)
            guard let http = resp as? HTTPURLResponse, http.statusCode == 200,
                  let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
                  let code = json["code"] as? String,
                  let expMs = json["expiresAt"] as? Double
            else {
                error = "无法获取配对码 — daemon 是否在运行？"
                return
            }
            self.code = code
            expiresAt = Date(timeIntervalSince1970: expMs / 1000)
            qrImage = makeQR("qw://pair?host=\(host)&port=\(port)&code=\(code)")
            startCountdown()
        } catch {
            self.error = "连接 daemon 失败：\(error.localizedDescription)"
        }
    }

    // MARK: - Config + network

    private func loadConfig() -> DaemonConfig {
        let path = FileManager.default.homeDirectoryForCurrentUser
            .appendingPathComponent(".quota-watch/config.json")
        guard let data = try? Data(contentsOf: path),
              let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let api = json["api"] as? [String: Any]
        else { return DaemonConfig(port: 3737, token: nil) }
        let port = (api["port"] as? Int) ?? 3737
        let token = api["token"] as? String
        return DaemonConfig(port: port, token: (token?.isEmpty == false) ? token : nil)
    }

    /// First non-loopback IPv4 address, preferring en0 (Wi-Fi/Ethernet) — the
    /// address the phone on the same LAN dials.
    private func lanIPv4() -> String? {
        var address: String?
        var ifaddr: UnsafeMutablePointer<ifaddrs>?
        guard getifaddrs(&ifaddr) == 0, let first = ifaddr else { return nil }
        defer { freeifaddrs(ifaddr) }
        for ptr in sequence(first: first, next: { $0.pointee.ifa_next }) {
            let flags = Int32(ptr.pointee.ifa_flags)
            guard (flags & IFF_UP) == IFF_UP, (flags & IFF_LOOPBACK) == 0 else { continue }
            // ifa_addr is nullable — some interface entries have no address;
            // dereferencing it unconditionally crashes. Guard first.
            guard let addr = ptr.pointee.ifa_addr, addr.pointee.sa_family == UInt8(AF_INET) else { continue }
            var buf = [CChar](repeating: 0, count: Int(NI_MAXHOST))
            getnameinfo(addr, socklen_t(addr.pointee.sa_len),
                        &buf, socklen_t(buf.count), nil, 0, NI_NUMERICHOST)
            let ip = String(cString: buf)
            if ip.hasPrefix("169.254") { continue } // link-local
            address = ip
            if String(cString: ptr.pointee.ifa_name) == "en0" { break }
        }
        return address
    }

    // MARK: - Countdown + QR

    private func startCountdown() {
        timer?.invalidate()
        updateSecondsLeft()
        timer = Timer.scheduledTimer(withTimeInterval: 1, repeats: true) { [weak self] _ in
            Task { @MainActor in self?.updateSecondsLeft() }
        }
    }

    private func updateSecondsLeft() {
        guard let expiresAt else { return }
        secondsLeft = max(0, Int(expiresAt.timeIntervalSinceNow))
        if secondsLeft == 0 { timer?.invalidate() }
    }

    private func makeQR(_ payload: String) -> NSImage? {
        let filter = CIFilter.qrCodeGenerator()
        filter.message = Data(payload.utf8)
        filter.correctionLevel = "M"
        guard let ci = filter.outputImage else { return nil }
        let scaled = ci.transformed(by: CGAffineTransform(scaleX: 10, y: 10))
        let rep = NSCIImageRep(ciImage: scaled)
        let img = NSImage(size: rep.size)
        img.addRepresentation(rep)
        return img
    }
}
