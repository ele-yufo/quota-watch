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
    /// CA fingerprint from /pair/start — shown for manual entry (the QR carries
    /// it too, but a manually-pairing phone must type it to pin TLS).
    @Published var caFingerprint = ""
    /// True once the current code's TTL ran out — MenuBarView auto-closes the
    /// panel on this, so a popover dismissed by clicking outside doesn't stick
    /// the user on an expired pairing sheet at the next click.
    @Published private(set) var isExpired = false

    private var timer: Timer?
    private var expiresAt: Date?

    /// TLS: the daemon API is HTTPS with a local CA. This session trusts only
    /// that CA (anchor-only), never the system bundle.
    private var daemonSession: URLSession?
    private var trustDelegate: TrustLocalCaDelegate?

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

    /// The countdown timer outlives the popover when it's dismissed by clicking
    /// outside (stop() isn't called on that path) — invalidate it here so it
    /// doesn't keep firing on the run loop until the app quits.
    deinit {
        timer?.invalidate()
    }

    // MARK: - Daemon

    private func requestCode(_ config: DaemonConfig) async {
        defer { isLoading = false }
        guard let url = URL(string: "https://127.0.0.1:\(config.port)/pair/start") else { return }
        var req = URLRequest(url: url)
        req.httpMethod = "POST"
        req.timeoutInterval = 5
        if let token = config.token {
            req.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        }
        do {
            let caPem = FileManager.default.homeDirectoryForCurrentUser
                .appendingPathComponent(".quota-watch/certs/ca.crt")
            let delegate = TrustLocalCaDelegate(caPemPath: caPem.path)
            trustDelegate = delegate
            let session = URLSession(configuration: .default, delegate: delegate, delegateQueue: nil)
            daemonSession = session
            let (data, resp) = try await session.data(for: req)
            guard let http = resp as? HTTPURLResponse, http.statusCode == 200,
                  let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
                  let code = json["code"] as? String,
                  let expMs = json["expiresAt"] as? Double
            else {
                error = "无法获取配对码 — daemon 是否在运行？"
                return
            }
            self.code = code
            isExpired = false
            expiresAt = Date(timeIntervalSince1970: expMs / 1000)
            // The QR carries the CA fingerprint so the phone pins TLS before
            // claiming the code (never trusting-on-first-use).
            var payload = "qw://pair?host=\(host)&port=\(port)&code=\(code)"
            if let fp = json["caFingerprint"] as? String, !fp.isEmpty {
                caFingerprint = fp
                payload += "&fp=\(fp)"
            }
            qrImage = makeQR(payload)
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
        if secondsLeft == 0 {
            timer?.invalidate()
            isExpired = true
        }
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

/// URLSession delegate that pins the daemon's local CA: the server trust chain
/// is evaluated against ONLY that CA (anchor-only, system bundle excluded).
/// The phone/CLI pin the same CA's fingerprint; here we trust the file itself.
private final class TrustLocalCaDelegate: NSObject, URLSessionDelegate {
    private let caPemPath: String

    init(caPemPath: String) {
        self.caPemPath = caPemPath
    }

    func urlSession(
        _ session: URLSession,
        didReceive challenge: URLAuthenticationChallenge,
        completionHandler: @escaping (URLSession.AuthChallengeDisposition, URLCredential?) -> Void
    ) {
        guard challenge.protectionSpace.authenticationMethod == NSURLAuthenticationMethodServerTrust,
              let trust = challenge.protectionSpace.serverTrust
        else {
            completionHandler(.performDefaultHandling, nil)
            return
        }
        guard let pem = try? String(contentsOfFile: caPemPath, encoding: .utf8),
              let cert = caCertificate(fromPem: pem)
        else {
            completionHandler(.cancelAuthenticationChallenge, nil)
            return
        }
        SecTrustSetAnchorCertificates(trust, [cert] as CFArray)
        SecTrustSetAnchorCertificatesOnly(trust, true)
        var error: CFError?
        if SecTrustEvaluateWithError(trust, &error) {
            completionHandler(.useCredential, URLCredential(trust: trust))
        } else {
            completionHandler(.cancelAuthenticationChallenge, nil)
        }
    }

    /// PEM → DER → SecCertificate (SecCertificateCreateWithData needs DER).
    private func caCertificate(fromPem pem: String) -> SecCertificate? {
        let b64 = pem
            .components(separatedBy: "\n")
            .filter { !$0.hasPrefix("-----") && !$0.isEmpty }
            .joined()
        guard let der = Data(base64Encoded: b64) else { return nil }
        return SecCertificateCreateWithData(nil, der as CFData)
    }
}
