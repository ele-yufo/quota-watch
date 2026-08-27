import Foundation
import CryptoKit

/// Typed failures surfaced to the UI so it can show a specific message.
enum APIError: Error, LocalizedError {
    case notConfigured
    case unreachable
    case unauthorized
    case timeout
    case badStatus(Int)
    case decoding
    /// TLS 证书/指纹校验失败（pin mismatch）— 与普通网络不可达分开，
    /// 配对时的提示文案完全不同。
    case certChanged

    var errorDescription: String? {
        switch self {
        case .notConfigured: return "未配置主机地址 — 先到设置页填写"
        case .unreachable: return "无法连接 — 确认 Mac 上 daemon 已用 --lan 启动，且在同一网络"
        case .unauthorized: return "认证失败 — 检查 Token（Mac 上运行 quota-watch connect 获取）"
        case .timeout: return "请求超时"
        case .badStatus(let code): return "服务器返回 \(code)"
        case .decoding: return "响应解析失败 — 服务端版本可能不匹配"
        case .certChanged: return "证书校验失败 — daemon 证书已更换，请重新配对"
        }
    }
}

/// Talks to the quota-watch daemon's embedded HTTPS API over the LAN.
///
/// TLS: when `caFingerprint` is set (always, after pairing), connections use
/// HTTPS and a custom URLSession delegate that pins the server trust chain to
/// the daemon's CA by SHA-256 fingerprint — no CA bundle, no CN/SAN trust. When
/// it's nil (manual loopback fallback), plain HTTP is used.
struct APIClient {
    let host: String
    let port: Int
    let token: String?
    /// SHA-256 hex fingerprint of the daemon CA (learned during pairing).
    /// nil → plain HTTP (loopback manual entry only).
    var caFingerprint: String?
    /// Per-request timeout. Widgets use a short one so a first render never sits
    /// blank waiting on a slow/unreachable daemon.
    var timeout: TimeInterval = 8

    private var baseURL: URL? {
        var components = URLComponents()
        components.scheme = caFingerprint == nil ? "http" : "https"
        components.host = host.trimmingCharacters(in: .whitespaces)
        components.port = port
        return components.url
    }

    /// Sessions pinned to a specific CA fingerprint, cached per pin. The
    /// delegate is weakly referenced by URLSession, so it's retained here.
    private static let pinLock = NSLock()
    private static var pinSessions: [String: URLSession] = [:]
    private static var pinDelegates: [String: PinningDelegate] = [:]

    private var session: URLSession {
        guard let pin = caFingerprint else { return .shared }
        Self.pinLock.lock()
        defer { Self.pinLock.unlock() }
        if let s = Self.pinSessions[pin] { return s }
        let delegate = PinningDelegate(caFingerprint: pin)
        let s = URLSession(configuration: .ephemeral, delegate: delegate, delegateQueue: nil)
        Self.pinDelegates[pin] = delegate
        Self.pinSessions[pin] = s
        return s
    }

    /// 证书类 URLError —— pin 拒绝（delegate cancel 挑战）落在这一族。
    private static func isCertificateFailure(_ code: URLError.Code) -> Bool {
        switch code {
        case .serverCertificateHasBadDate, .serverCertificateUntrusted,
             .serverCertificateHasUnknownRoot, .serverCertificateNotYetValid,
             .secureConnectionFailed:
            return true
        default:
            return false
        }
    }

    private func request(path: String, method: String = "GET") throws -> URLRequest {
        guard !host.trimmingCharacters(in: .whitespaces).isEmpty,
              let base = baseURL,
              let url = URL(string: path, relativeTo: base)
        else { throw APIError.notConfigured }

        var req = URLRequest(url: url)
        req.httpMethod = method
        req.timeoutInterval = timeout
        if let token, !token.isEmpty {
            req.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        }
        return req
    }

    private func send<T: Decodable>(_ req: URLRequest, as type: T.Type) async throws -> T {
        let data: Data
        let response: URLResponse
        do {
            (data, response) = try await session.data(for: req)
        } catch let error as URLError where error.code == .timedOut {
            throw APIError.timeout
        } catch let error as URLError where Self.isCertificateFailure(error.code) {
            throw APIError.certChanged
        } catch {
            throw APIError.unreachable
        }

        guard let http = response as? HTTPURLResponse else { throw APIError.unreachable }
        switch http.statusCode {
        case 200..<300: break
        case 401: throw APIError.unauthorized
        default: throw APIError.badStatus(http.statusCode)
        }

        do {
            return try JSONDecoder().decode(T.self, from: data)
        } catch {
            throw APIError.decoding
        }
    }

    /// GET /health — used by the "test connection" button.
    func health() async throws -> HealthResponse {
        try await send(try request(path: "/health"), as: HealthResponse.self)
    }

    /// GET /quota — latest snapshot per provider×window.
    func quota() async throws -> [QuotaProvider] {
        try await send(try request(path: "/quota"), as: [QuotaProvider].self)
    }

    /// POST /poll — force an immediate poll of all providers.
    @discardableResult
    func pollNow() async throws -> Bool {
        struct PollResult: Decodable { let ok: Bool }
        let result = try await send(try request(path: "/poll", method: "POST"), as: PollResult.self)
        return result.ok
    }

    /// POST /pair/claim — exchange a short-lived pairing code for the API token.
    /// No token is sent (the code is the credential); a wrong/expired code comes
    /// back 401 → `.unauthorized`. An HTTP 200 with `ok: false` (server-side
    /// rejection) is treated the same — never returns an empty token silently.
    /// Also returns the CA fingerprint (the daemon's answer is the source of
    /// truth for the pin; the QR-provided one already pinned this request).
    func claimPairingCode(_ code: String) async throws -> (token: String, caFingerprint: String?) {
        struct ClaimResult: Decodable {
            let ok: Bool
            let token: String?
            let caFingerprint: String?
        }
        var req = try request(path: "/pair/claim", method: "POST")
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        req.httpBody = try JSONSerialization.data(withJSONObject: ["code": code])
        let result = try await send(req, as: ClaimResult.self)
        guard result.ok, let token = result.token, !token.isEmpty else {
            throw APIError.unauthorized
        }
        return (token, result.caFingerprint)
    }
}

/// URLSession delegate that pins the server trust chain's root CA to a known
/// SHA-256 fingerprint. Any mismatch (cert rotated, MITM) cancels the challenge
/// — the caller then surfaces a "证书已更换，请重新配对" error.
private final class PinningDelegate: NSObject, URLSessionDelegate {
    let caFingerprint: String

    init(caFingerprint: String) {
        self.caFingerprint = caFingerprint
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
        // SecTrustCopyCertificateChain returns leaf → root; pin the ROOT.
        // (`?? chain.first` would be the leaf — never a valid CA pin — so a
        // degenerate chain simply cancels.)
        guard let chain = SecTrustCopyCertificateChain(trust) as? [SecCertificate],
              let root = chain.last,
              let der = SecCertificateCopyData(root) as Data?
        else {
            completionHandler(.cancelAuthenticationChallenge, nil)
            return
        }
        let digest = CryptoKit.SHA256.hash(data: der)
        let hex = digest.map { String(format: "%02x", $0) }.joined()
        if hex == caFingerprint {
            completionHandler(.useCredential, URLCredential(trust: trust))
        } else {
            completionHandler(.cancelAuthenticationChallenge, nil)
        }
    }
}
