import Foundation

enum LuaBridge {
    static func exportPresets(root: URL) -> [String: Any]? {
        let script = root.appendingPathComponent("scripts/export_presets.lua")
        guard FileManager.default.fileExists(atPath: script.path) else { return nil }

        let luaPaths = [
            "/opt/homebrew/bin/lua",
            "/usr/local/bin/lua",
            "/usr/bin/lua",
        ]
        guard let lua = luaPaths.first(where: { FileManager.default.isExecutableFile(atPath: $0) }) else {
            return fallbackPresets()
        }

        let proc = Process()
        proc.executableURL = URL(fileURLWithPath: lua)
        proc.arguments = [script.path]
        proc.currentDirectoryURL = root.appendingPathComponent("scripts")

        let pipe = Pipe()
        proc.standardOutput = pipe
        proc.standardError = Pipe()

        do {
            try proc.run()
            proc.waitUntilExit()
        } catch {
            return fallbackPresets()
        }

        let data = pipe.fileHandleForReading.readDataToEndOfFile()
        guard let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else {
            return fallbackPresets()
        }
        return json
    }

    static func preset(named name: String, root: URL) -> [String: Any]? {
        guard let all = exportPresets(root: root),
              let presets = all["presets"] as? [String: Any],
              let p = presets[name] as? [String: Any] else { return nil }
        return p
    }

    private static func fallbackPresets() -> [String: Any] {
        [
            "presets": [
                "neon": [
                    "label": "Neon pulse",
                    "depth": 1.4, "size": 0.018, "dispersion": 0.14,
                    "spin": 0.45, "hue": 0.12, "glow": 1.35, "mask": 0.3, "stride": 2,
                ],
            ],
        ]
    }
}