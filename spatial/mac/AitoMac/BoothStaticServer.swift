import Foundation
import Darwin

/// Minimal loopback static file server — no Python/Node required inside .app bundle.
final class BoothStaticServer {
    static let defaultPort: UInt16 = 8768
    static let host = "127.0.0.1"
    static let identityHeader = "X-Aito-Mac-Server"
    static let identityValue = "native"

    private let root: URL
    private var listenFD: Int32 = -1
    private let queue = DispatchQueue(label: "aito-mac.http", qos: .userInitiated)
    private var acceptSource: DispatchSourceRead?
    private(set) var port: UInt16 = defaultPort

    init(root: URL) {
        self.root = root
    }

    var isListening: Bool { listenFD >= 0 }

    var boothURL: URL {
        URL(string: "http://\(Self.host):\(port)/booth/")!
    }

    func start() {
        guard listenFD < 0 else { return }

        for candidate in Self.defaultPort...Self.defaultPort + 10 {
            if bindListen(port: candidate) {
                port = candidate
                return
            }
        }
    }

    func stop() {
        acceptSource?.cancel()
        acceptSource = nil
    }

    func waitUntilReady(timeout: TimeInterval = 8) -> Bool {
        guard isListening else { return false }
        // First accept can lag one runloop turn after bind.
        Thread.sleep(forTimeInterval: 0.05)
        let deadline = Date().addingTimeInterval(timeout)
        while Date() < deadline {
            if ping() { return true }
            Thread.sleep(forTimeInterval: 0.08)
        }
        return ping()
    }

    private func bindListen(port: UInt16) -> Bool {
        let fd = socket(AF_INET, SOCK_STREAM, 0)
        guard fd >= 0 else { return false }

        var yes: Int32 = 1
        setsockopt(fd, SOL_SOCKET, SO_REUSEADDR, &yes, socklen_t(MemoryLayout.size(ofValue: yes)))

        var addr = sockaddr_in()
        addr.sin_len = UInt8(MemoryLayout<sockaddr_in>.size)
        addr.sin_family = sa_family_t(AF_INET)
        addr.sin_port = port.bigEndian
        addr.sin_addr.s_addr = inet_addr("127.0.0.1")

        let bindOK = withUnsafePointer(to: &addr) {
            $0.withMemoryRebound(to: sockaddr.self, capacity: 1) {
                bind(fd, $0, socklen_t(MemoryLayout<sockaddr_in>.size))
            }
        }
        guard bindOK == 0, listen(fd, 32) == 0 else {
            close(fd)
            return false
        }

        listenFD = fd
        let source = DispatchSource.makeReadSource(fileDescriptor: listenFD, queue: queue)
        source.setEventHandler { [weak self] in self?.acceptConnections() }
        source.setCancelHandler { [weak self] in
            if let fd = self?.listenFD, fd >= 0 { close(fd) }
            self?.listenFD = -1
        }
        source.resume()
        acceptSource = source
        return true
    }

    private func ping() -> Bool {
        let sem = DispatchSemaphore(value: 0)
        var ok = false
        var req = URLRequest(url: boothURL, cachePolicy: .reloadIgnoringLocalCacheData, timeoutInterval: 0.6)
        req.httpMethod = "GET"
        URLSession.shared.dataTask(with: req) { _, resp, _ in
            if let http = resp as? HTTPURLResponse,
               http.statusCode == 200,
               http.value(forHTTPHeaderField: Self.identityHeader) == Self.identityValue {
                ok = true
            }
            sem.signal()
        }.resume()
        _ = sem.wait(timeout: .now() + 0.8)
        return ok
    }

    private func acceptConnections() {
        repeat {
            var addr = sockaddr()
            var len: socklen_t = socklen_t(MemoryLayout<sockaddr>.size)
            let client = accept(listenFD, &addr, &len)
            if client < 0 { break }
            queue.async { [weak self] in self?.handle(client: client) }
        } while true
    }

    private func handle(client: Int32) {
        defer { close(client) }
        var buf = [UInt8](repeating: 0, count: 4096)
        let n = recv(client, &buf, buf.count, 0)
        guard n > 0, let head = String(bytes: buf.prefix(n), encoding: .utf8) else { return }
        guard let line = head.split(separator: "\r\n").first else { return }
        let parts = line.split(separator: " ")
        guard parts.count >= 2, parts[0] == "GET" else {
            write(client, "HTTP/1.1 405 OK\r\nConnection: close\r\n\r\n", 37)
            return
        }
        var path = String(parts[1])
        if path == "/" { path = "/booth/" }
        if path.hasSuffix("/") { path += "index.html" }
        if path.contains("..") { return respond(client: client, status: 403, body: "Forbidden") }

        let rel = path.hasPrefix("/") ? String(path.dropFirst()) : path
        let fileURL = root.appendingPathComponent(rel)
        guard fileURL.path.hasPrefix(root.path), FileManager.default.fileExists(atPath: fileURL.path) else {
            return respond(client: client, status: 404, body: "Not found: \(path)")
        }
        guard let data = try? Data(contentsOf: fileURL) else {
            return respond(client: client, status: 500, body: "Read error")
        }
        let mime = Self.mime(ext: fileURL.pathExtension.lowercased())
        var header = "HTTP/1.1 200 OK\r\n"
        header += "Content-Type: \(mime)\r\n"
        header += "Content-Length: \(data.count)\r\n"
        header += "\(Self.identityHeader): \(Self.identityValue)\r\n"
        header += "Cache-Control: no-store\r\n"
        header += "Connection: close\r\n\r\n"
        if let h = header.data(using: .utf8) {
            _ = h.withUnsafeBytes { write(client, $0.baseAddress, $0.count) }
        }
        _ = data.withUnsafeBytes { write(client, $0.baseAddress, $0.count) }
    }

    private func respond(client: Int32, status: Int, body: String) {
        var msg = "HTTP/1.1 \(status) ERR\r\n"
        msg += "Content-Length: \(body.utf8.count)\r\n"
        msg += "\(Self.identityHeader): \(Self.identityValue)\r\n"
        msg += "Connection: close\r\n\r\n"
        msg += body
        _ = msg.withCString { write(client, $0, strlen($0)) }
    }

    private static func mime(ext: String) -> String {
        switch ext {
        case "html": return "text/html; charset=utf-8"
        case "css": return "text/css; charset=utf-8"
        case "js", "mjs": return "text/javascript; charset=utf-8"
        case "json": return "application/json"
        case "wasm": return "application/wasm"
        case "m4a": return "audio/mp4"
        case "mp3": return "audio/mpeg"
        case "wav": return "audio/wav"
        case "png": return "image/png"
        case "jpg", "jpeg": return "image/jpeg"
        default: return "application/octet-stream"
        }
    }
}