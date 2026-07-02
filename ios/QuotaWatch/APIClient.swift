import Foundation

/// Typed failures surfaced to the UI so it can show a specific message.
enum APIError: Error, LocalizedError {
    case notConfigured
    case unreachable
    case unauthorized
    case timeout
    case badStatus(Int)
    case decoding

    var errorDescription: String? {
        switch self {
        case .notConfigured: return "未配置主机地址 — 先到设置页填写"
        case .unreachable: return "无法连接 — 确认 Mac 上 daemon 已用 --lan 启动，且在同一网络"
        case .unauthorized: return "认证失败 — 检查 Token（Mac 上运行 quota-watch connect 获取）"
        case .timeout: return "请求超时"
        case .badStatus(let code): return "服务器返回 \(code)"
        case .decoding: return "响应解析失败 — 服务端版本可能不匹配"
        }
    }
}

/// Talks to the quota-watch daemon's embedded HTTP API over the LAN.
struct APIClient {
    let host: String
    let port: Int
    let token: String?

    private static let timeout: TimeInterval = 8

    private var baseURL: URL? {
        var components = URLComponents()
        components.scheme = "http"
        components.host = host.trimmingCharacters(in: .whitespaces)
        components.port = port
        return components.url
    }

    private func request(path: String, method: String = "GET") throws -> URLRequest {
        guard !host.trimmingCharacters(in: .whitespaces).isEmpty,
              let base = baseURL,
              let url = URL(string: path, relativeTo: base)
        else { throw APIError.notConfigured }

        var req = URLRequest(url: url)
        req.httpMethod = method
        req.timeoutInterval = Self.timeout
        if let token, !token.isEmpty {
            req.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        }
        return req
    }

    private func send<T: Decodable>(_ req: URLRequest, as type: T.Type) async throws -> T {
        let data: Data
        let response: URLResponse
        do {
            (data, response) = try await URLSession.shared.data(for: req)
        } catch let error as URLError where error.code == .timedOut {
            throw APIError.timeout
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
}
