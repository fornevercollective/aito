import Foundation

final class JaxBridge {
    private var process: Process?
    private let root: URL

    init(root: URL) {
        self.root = root
    }

    var isRunning: Bool { process?.isRunning == true }

    func startIfNeeded() {
        guard process == nil || process?.isRunning == false else { return }
        let script = root.appendingPathComponent("jax-sidecar/booth_jax.py")
        guard FileManager.default.fileExists(atPath: script.path) else { return }

        let pythonCandidates = [
            "/opt/homebrew/bin/python3",
            "/usr/local/bin/python3",
            "/usr/bin/python3",
        ]
        guard let python = pythonCandidates.first(where: { FileManager.default.isExecutableFile(atPath: $0) }) else {
            return
        }

        let proc = Process()
        proc.executableURL = URL(fileURLWithPath: python)
        proc.arguments = [script.path, "--port", "8767"]
        proc.currentDirectoryURL = root
        proc.standardOutput = Pipe()
        proc.standardError = Pipe()
        try? proc.run()
        process = proc
    }

    func stop() {
        process?.terminate()
        process = nil
    }
}