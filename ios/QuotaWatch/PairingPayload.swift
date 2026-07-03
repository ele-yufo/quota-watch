import Foundation

/// A parsed `qw://pair?host=..&port=..&[code=..|token=..]` pairing URL.
/// The menu-bar QR carries a short-lived `code` (exchanged for the token via
/// /pair/claim so the token is never shown); the legacy CLI QR carries `token`.
struct PairingPayload: Equatable {
    let host: String
    let port: Int
    let token: String?
    /// Short-lived pairing code — present on the menu-bar QR, exchanged for the
    /// token. When set, the app should claim it rather than store it directly.
    let code: String?

    /// Parse a scanned string. Accepts the `qw://pair` scheme; returns nil for
    /// anything else so the scanner keeps looking.
    init?(scanned string: String) {
        guard let components = URLComponents(string: string.trimmingCharacters(in: .whitespaces)),
              components.scheme == "qw",
              components.host == "pair"
        else { return nil }

        let items = components.queryItems ?? []
        func value(_ name: String) -> String? {
            items.first { $0.name == name }?.value?.trimmingCharacters(in: .whitespaces)
        }

        guard let host = value("host"), !host.isEmpty,
              let portString = value("port"), let port = Int(portString), port > 0
        else { return nil }

        self.host = host
        self.port = port
        let token = value("token")
        self.token = (token?.isEmpty ?? true) ? nil : token
        let code = value("code")
        self.code = (code?.isEmpty ?? true) ? nil : code
    }
}

/// Classifies a host for the "public host over cleartext HTTP" warning.
enum HostReachability {
    /// RFC1918 / loopback / .local — cleartext HTTP is acceptable on a trusted LAN.
    case privateNetwork
    /// A routable IP or bare domain — plain HTTP would expose the token; warn.
    case publicNetwork

    init(host: String) {
        let h = host.trimmingCharacters(in: .whitespaces).lowercased()
        if h == "localhost" || h == "127.0.0.1" || h == "::1" || h.hasSuffix(".local") {
            self = .privateNetwork
            return
        }
        let octets = h.split(separator: ".").compactMap { Int($0) }
        if octets.count == 4, octets.allSatisfy({ (0...255).contains($0) }) {
            let (a, b) = (octets[0], octets[1])
            if a == 10 { self = .privateNetwork; return }
            if a == 192 && b == 168 { self = .privateNetwork; return }
            if a == 172 && (16...31).contains(b) { self = .privateNetwork; return }
            self = .publicNetwork
            return
        }
        // hostname / domain → treat as public (can't prove it's private)
        self = .publicNetwork
    }
}
