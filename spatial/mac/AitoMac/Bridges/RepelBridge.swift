import Foundation

enum RepelBridge {
    static func repelPath(root: URL) -> String? {
        let candidates = [
            root.appendingPathComponent("bin/repel").path,
            NSHomeDirectory() + "/dev/ffmpeg/repel/target/release/repel",
            "/opt/homebrew/bin/repel",
            "/usr/local/bin/repel",
        ]
        return candidates.first { FileManager.default.isExecutableFile(atPath: $0) }
    }

    /// AVFoundation device index for Continuity / iPhone / Desk View / desktop.
    /// Prefer Continuity Camera when `preferIPhone` is true.
    static func resolveAvFoundationIndex(preferIPhone: Bool = false, deskView: Bool = false) -> Int {
        let listed = listAvFoundationVideoDevices()
        if deskView {
            if let i = listed.firstIndex(where: { $0.localizedCaseInsensitiveContains("desk view") }) {
                return i
            }
        }
        if preferIPhone {
            if let i = listed.firstIndex(where: {
                let s = $0.lowercased()
                return s.contains("iphone")
                    || (s.contains("camera") && !s.contains("facetime") && !s.contains("built-in")
                        && !s.contains("capture screen") && !s.contains("desk view"))
            }) {
                return i
            }
        }
        if let i = listed.firstIndex(where: {
            $0.localizedCaseInsensitiveContains("facetime") || $0.localizedCaseInsensitiveContains("built-in")
        }) {
            return i
        }
        return 0
    }

    static func listAvFoundationVideoDevices() -> [String] {
        let proc = Process()
        proc.executableURL = URL(fileURLWithPath: "/usr/bin/env")
        proc.arguments = ["ffmpeg", "-f", "avfoundation", "-list_devices", "true", "-i", ""]
        let err = Pipe()
        proc.standardOutput = Pipe()
        proc.standardError = err
        do {
            try proc.run()
            proc.waitUntilExit()
        } catch {
            return []
        }
        let text = String(data: err.fileHandleForReading.readDataToEndOfFile(), encoding: .utf8) ?? ""
        var devices: [String] = []
        var inVideo = false
        for line in text.components(separatedBy: .newlines) {
            if line.contains("AVFoundation video devices") {
                inVideo = true
                continue
            }
            if line.contains("AVFoundation audio devices") {
                break
            }
            guard inVideo else { continue }
            // [0] FaceTime HD Camera (Built-in)
            if let range = line.range(of: #"\[\d+\]\s+"#, options: .regularExpression) {
                let name = String(line[range.upperBound...]).trimmingCharacters(in: .whitespaces)
                if !name.isEmpty { devices.append(name) }
            }
        }
        return devices
    }

    static func playCamera(root: URL, preferIPhone: Bool = false, deskView: Bool = false) {
        let idx = resolveAvFoundationIndex(preferIPhone: preferIPhone, deskView: deskView)
        let title = deskView
            ? "aito-mac · desk view"
            : preferIPhone
                ? "aito-mac · Continuity iPhone"
                : "aito-mac · desktop camera"
        guard let repel = repelPath(root: root) else {
            spawnFFplay(index: idx, title: title)
            return
        }
        let proc = Process()
        proc.executableURL = URL(fileURLWithPath: repel)
        proc.arguments = ["play", "avfoundation://\(idx)", "-window_title", title]
        try? proc.run()
    }

    /// Open desktop + Continuity iPhone side-by-side via two ffplay/repel windows.
    static func playDualCameras(root: URL) {
        playCamera(root: root, preferIPhone: false)
        DispatchQueue.global().asyncAfter(deadline: .now() + 0.4) {
            playCamera(root: root, preferIPhone: true)
        }
    }

    static func walkScript(_ path: String, root: URL) -> String {
        if let walker = walkerPath(root: root) {
            return runTool(walker, args: ["bash", path])
        }
        if let repel = repelPath(root: root) {
            return runTool(repel, args: ["walk", path])
        }
        return "(no repel or aito-walk found)"
    }

    static func wasmStatus() -> String {
        if let p = ProcessInfo.processInfo.environment["REPEL_WASM_ANALYZER"],
           FileManager.default.fileExists(atPath: p) {
            return "REPEL_WASM_ANALYZER=\(p)"
        }
        let local = NSHomeDirectory() + "/dev/aito-mac/wasm/booth_modulator.wasm"
        if FileManager.default.fileExists(atPath: local) {
            return "booth_modulator.wasm bundled"
        }
        return "no wasm analyzer"
    }

    private static func walkerPath(root: URL) -> String? {
        let p = root.appendingPathComponent("bin/aito-walk").path
        return FileManager.default.isExecutableFile(atPath: p) ? p : nil
    }

    private static func spawnFFplay(index: Int = 0, title: String = "aito-mac camera") {
        let proc = Process()
        proc.executableURL = URL(fileURLWithPath: "/usr/bin/env")
        proc.arguments = [
            "ffplay", "-f", "avfoundation", "-i", "\(index):none",
            "-window_title", title,
            "-fflags", "nobuffer", "-flags", "low_delay",
        ]
        try? proc.run()
    }

    /// Play a local path or URL via repel (preferred) or ffplay — MKV / HTTP / file.
    @discardableResult
    static func playSource(_ source: String, root: URL, title: String = "aito-mac · media") -> Bool {
        let trimmed = source.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return false }

        if let repel = repelPath(root: root) {
            let proc = Process()
            proc.executableURL = URL(fileURLWithPath: repel)
            proc.arguments = ["play", trimmed, "-window_title", title, "-autoexit"]
            do {
                try proc.run()
                return true
            } catch {
                // fall through to ffplay
            }
        }

        let proc = Process()
        proc.executableURL = URL(fileURLWithPath: "/usr/bin/env")
        proc.arguments = [
            "ffplay", "-autoexit", "-window_title", title, "-noborder", trimmed,
        ]
        do {
            try proc.run()
            return true
        } catch {
            return false
        }
    }

    private static func runTool(_ tool: String, args: [String]) -> String {
        let proc = Process()
        proc.executableURL = URL(fileURLWithPath: tool)
        proc.arguments = args
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