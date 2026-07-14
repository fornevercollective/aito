import Foundation

final class BoothServer {
    static let defaultPort = 8768
    static let host = "127.0.0.1"

    static func activePort() -> Int {
        let path = "/tmp/aito-mac.port"
        if let text = try? String(contentsOfFile: path, encoding: .utf8),
           let port = Int(text.trimmingCharacters(in: .whitespacesAndNewlines)),
           port > 0 {
            return port
        }
        if let env = ProcessInfo.processInfo.environment["AITO_BOOTH_PORT"],
           let port = Int(env), port > 0 {
            return port
        }
        return defaultPort
    }

    private var process: Process?
    private let root: URL
    private var activePort = defaultPort

    init(root: URL) {
        self.root = root
    }

    func boothURL(port: Int? = nil) -> URL {
        let p = port ?? activePort
        return URL(string: "http://\(Self.host):\(p)/booth/")!
    }

    func startIfNeeded(preferredPort: Int = defaultPort) {
        if isReachable(port: preferredPort) {
            activePort = preferredPort
            return
        }

        let serveMjs = root.appendingPathComponent("scripts/serve.mjs")
        let servePy = root.appendingPathComponent("scripts/serve.py")

        if process?.isRunning == true {
            activePort = preferredPort
            return
        }

        if let python = firstExecutable(["/opt/homebrew/bin/python3", "/usr/local/bin/python3", "/usr/bin/python3"]),
           FileManager.default.fileExists(atPath: servePy.path) {
            spawn(executable: python, args: [servePy.path, String(preferredPort)])
        } else if let node = firstExecutable(["/opt/homebrew/bin/node", "/usr/local/bin/node", "/usr/bin/node"]),
                  FileManager.default.fileExists(atPath: serveMjs.path) {
            spawn(executable: node, args: [serveMjs.path, String(preferredPort)])
        }
        activePort = preferredPort
    }

    func waitUntilReady(timeout: TimeInterval = 10, port: Int? = nil) -> Bool {
        let target = port ?? activePort
        let deadline = Date().addingTimeInterval(timeout)
        while Date() < deadline {
            if isReachable(port: target) { return true }
            Thread.sleep(forTimeInterval: 0.1)
        }
        return isReachable(port: target)
    }

    func stop() {
        process?.terminate()
        process = nil
    }

    private func spawn(executable: String, args: [String]) {
        let proc = Process()
        proc.executableURL = URL(fileURLWithPath: executable)
        proc.arguments = args
        proc.currentDirectoryURL = root
        var env = ProcessInfo.processInfo.environment
        env["AITO_MAC_ROOT"] = root.path
        env["AITO_QUIET"] = "1"
        env["PATH"] = "/usr/bin:/bin:/opt/homebrew/bin:/usr/local/bin:" + (env["PATH"] ?? "")
        proc.environment = env
        proc.standardOutput = Pipe()
        proc.standardError = Pipe()
        try? proc.run()
        process = proc
    }

    private func isReachable(port: Int) -> Bool {
        let sem = DispatchSemaphore(value: 0)
        var ok = false
        var req = URLRequest(url: boothURL(port: port), cachePolicy: .reloadIgnoringLocalCacheData, timeoutInterval: 0.8)
        req.httpMethod = "GET"
        URLSession.shared.dataTask(with: req) { _, resp, _ in
            if let http = resp as? HTTPURLResponse, http.statusCode == 200 {
                ok = true
            }
            sem.signal()
        }.resume()
        _ = sem.wait(timeout: .now() + 1.0)
        return ok
    }

    private func firstExecutable(_ paths: [String]) -> String? {
        paths.first { FileManager.default.isExecutableFile(atPath: $0) }
    }
}