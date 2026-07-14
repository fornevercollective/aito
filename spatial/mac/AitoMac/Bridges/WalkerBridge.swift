import Foundation

enum WalkerBridge {
    static func scanScripts(root: URL) -> String {
        let walker = root.appendingPathComponent("bin/aito-walk").path
        guard FileManager.default.isExecutableFile(atPath: walker) else {
            return RepelBridge.walkScript(
                root.appendingPathComponent("scripts/launch-booth.sh").path,
                root: root
            )
        }
        let proc = Process()
        proc.executableURL = URL(fileURLWithPath: walker)
        proc.arguments = ["scan", root.appendingPathComponent("scripts").path]
        let out = Pipe()
        proc.standardOutput = out
        proc.standardError = out
        do {
            try proc.run()
            proc.waitUntilExit()
            return String(data: out.fileHandleForReading.readDataToEndOfFile(), encoding: .utf8) ?? ""
        } catch {
            return error.localizedDescription
        }
    }
}