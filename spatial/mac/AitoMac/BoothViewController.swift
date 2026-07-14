import AppKit
import WebKit

final class BoothViewController: NSViewController, WKScriptMessageHandler, WKNavigationDelegate, WKUIDelegate {
    private let root: URL
    private let jaxBridge: JaxBridge
    private let staticServer: BoothStaticServer
    private let legacyServer: BoothServer
    private var webView: WKWebView!
    private var statusLabel: NSTextField?
    private var hasLoadedBooth = false

    init(root: URL) {
        self.root = root
        self.jaxBridge = JaxBridge(root: root)
        self.staticServer = BoothStaticServer(root: root)
        self.legacyServer = BoothServer(root: root)
        super.init(nibName: nil, bundle: nil)
    }

    required init?(coder: NSCoder) {
        fatalError("init(coder:) has not been implemented")
    }

    override func loadView() {
        view = NSView(frame: NSRect(x: 0, y: 0, width: 1280, height: 800))
        view.wantsLayer = true
        view.layer?.backgroundColor = NSColor(red: 0.04, green: 0.04, blue: 0.05, alpha: 1).cgColor
    }

    override func viewDidLoad() {
        super.viewDidLoad()

        // Status strip (always visible if web fails)
        let status = NSTextField(wrappingLabelWithString: "")
        status.isHidden = true
        status.textColor = NSColor(white: 0.85, alpha: 1)
        status.font = NSFont.monospacedSystemFont(ofSize: 12, weight: .regular)
        status.backgroundColor = NSColor(red: 0.08, green: 0.08, blue: 0.1, alpha: 0.95)
        status.drawsBackground = true
        status.isBezeled = false
        status.translatesAutoresizingMaskIntoConstraints = false
        statusLabel = status
        view.addSubview(status)

        let config = WKWebViewConfiguration()
        config.userContentController.add(self, name: "aitoMac")
        config.preferences.setValue(true, forKey: "developerExtrasEnabled")
        if #available(macOS 12.0, *) {
            config.defaultWebpagePreferences.allowsContentJavaScript = true
        }
        config.mediaTypesRequiringUserActionForPlayback = []
        // Allow camera/mic from localhost booth
        config.preferences.javaScriptCanOpenWindowsAutomatically = true

        webView = WKWebView(frame: .zero, configuration: config)
        webView.navigationDelegate = self
        webView.uiDelegate = self
        webView.translatesAutoresizingMaskIntoConstraints = false
        webView.setValue(false, forKey: "drawsBackground")
        if #available(macOS 13.3, *) {
            webView.isInspectable = true
        }
        view.addSubview(webView)

        NSLayoutConstraint.activate([
            webView.topAnchor.constraint(equalTo: view.topAnchor),
            webView.bottomAnchor.constraint(equalTo: view.bottomAnchor),
            webView.leadingAnchor.constraint(equalTo: view.leadingAnchor),
            webView.trailingAnchor.constraint(equalTo: view.trailingAnchor),
            status.leadingAnchor.constraint(equalTo: view.leadingAnchor, constant: 16),
            status.trailingAnchor.constraint(equalTo: view.trailingAnchor, constant: -16),
            status.centerYAnchor.constraint(equalTo: view.centerYAnchor),
        ])

        // Defer heavy work so the window paints first
        DispatchQueue.main.async { [weak self] in
            self?.jaxBridge.startIfNeeded()
            self?.startServers()
        }
    }

    override func viewDidAppear() {
        super.viewDidAppear()
        view.window?.makeKeyAndOrderFront(nil)
        if !hasLoadedBooth {
            hasLoadedBooth = true
            // Slight delay so embedded server can bind
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.15) { [weak self] in
                self?.reloadBooth()
            }
        }
    }

    override func viewWillDisappear() {
        super.viewWillDisappear()
        jaxBridge.stop()
        staticServer.stop()
        legacyServer.stop()
    }

    func reloadBooth() {
        clearStatus()
        if !staticServer.isListening {
            startServers()
        }

        let boothIndex = root.appendingPathComponent("booth/index.html")
        guard FileManager.default.fileExists(atPath: boothIndex.path) else {
            showStatus("Booth files missing.\nExpected: \(boothIndex.path)")
            return
        }

        let boothPort = BoothServer.activePort()
        if legacyServer.waitUntilReady(timeout: 5, port: boothPort) {
            let url = legacyServer.boothURL(port: boothPort)
            webView.load(URLRequest(url: url, cachePolicy: .reloadIgnoringLocalCacheData))
            return
        }

        if staticServer.waitUntilReady(timeout: 2) {
            let url = staticServer.boothURL
            webView.load(URLRequest(url: url, cachePolicy: .reloadIgnoringLocalCacheData))
            return
        }

        showStatus(
            """
            Could not start booth server.
            Root: \(root.path)
            Tried ports \(BoothStaticServer.defaultPort)–\(BoothStaticServer.defaultPort + 10)
            Quit other aito-mac / node serve.mjs instances and reload (⌘R).
            """
        )
    }

    private func startServers() {
        staticServer.start()
        legacyServer.startIfNeeded(preferredPort: Int(staticServer.port))
        if !staticServer.waitUntilReady(timeout: 0.8) {
            legacyServer.startIfNeeded(preferredPort: BoothServer.defaultPort)
        }
    }

    func userContentController(
        _ userContentController: WKUserContentController,
        didReceive message: WKScriptMessage
    ) {
        guard let body = message.body as? [String: Any],
              let type = body["type"] as? String else { return }

        switch type {
        case "ready", "loadPresets":
            pushPresets()
        case "applyPreset":
            if let name = body["name"] as? String {
                applyPreset(named: name)
            }
        case "close":
            NSApp.terminate(nil)
        case "repelCamera":
            let preferIPhone = body["iphone"] as? Bool ?? false
            let deskView = body["deskView"] as? Bool ?? false
            RepelBridge.playCamera(root: root, preferIPhone: preferIPhone, deskView: deskView)
        case "repelDualCamera":
            RepelBridge.playDualCameras(root: root)
        case "repelPlay":
            let source = (body["source"] as? String)
                ?? (body["path"] as? String)
                ?? (body["url"] as? String)
                ?? ""
            let title = (body["title"] as? String) ?? "aito-mac · media"
            let ok = RepelBridge.playSource(source, root: root, title: title)
            pushJS("window.dispatchEvent(new CustomEvent('aitoMacFfplay',{detail:{ok:\(ok ? "true" : "false"),source:\(jsonLiteral(source))}}));")
        case "listCameras":
            let names = RepelBridge.listAvFoundationVideoDevices()
            if let data = try? JSONSerialization.data(withJSONObject: names),
               let text = String(data: data, encoding: .utf8) {
                pushJS("window.dispatchEvent(new CustomEvent('aitoMacCameras',{detail:\(text)}));")
            }
        case "walkerScan":
            let report = WalkerBridge.scanScripts(root: root)
            pushJS("console.log('walker', \(jsonLiteral(report)));")
        default:
            break
        }
    }

    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        clearStatus()
        pushJS("window.aitoMac?.setJaxEnabled?.(true);")
        pushPresets()
    }

    func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) {
        showStatus("Load failed: \(error.localizedDescription)\n\(staticServer.boothURL.absoluteString)")
    }

    func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
        showStatus("Booth unreachable: \(error.localizedDescription)\n\(staticServer.boothURL.absoluteString)")
    }

    func webView(
        _ webView: WKWebView,
        requestMediaCapturePermissionFor origin: WKSecurityOrigin,
        initiatedByFrame frame: WKFrameInfo,
        type: WKMediaCaptureType,
        decisionHandler: @escaping (WKPermissionDecision) -> Void
    ) {
        decisionHandler(.grant)
    }

    private func pushPresets() {
        guard let json = LuaBridge.exportPresets(root: root),
              let data = try? JSONSerialization.data(withJSONObject: json),
              let text = String(data: data, encoding: .utf8) else { return }
        pushJS("""
        window.dispatchEvent(new CustomEvent('aitoMacPresets', { detail: \(text) }));
        """)
    }

    private func applyPreset(named name: String) {
        guard let preset = LuaBridge.preset(named: name, root: root),
              let data = try? JSONSerialization.data(withJSONObject: preset),
              let text = String(data: data, encoding: .utf8) else { return }
        pushJS("""
        window.dispatchEvent(new CustomEvent('aitoMacApplyPreset', { detail: \(text) }));
        """)
    }

    private func pushJS(_ script: String) {
        webView.evaluateJavaScript(script, completionHandler: nil)
    }

    private func jsonLiteral(_ string: String) -> String {
        guard let data = try? JSONEncoder().encode(string),
              let encoded = String(data: data, encoding: .utf8) else {
            return "\"\""
        }
        return encoded
    }

    private func showStatus(_ message: String) {
        clearStatus()
        let label = NSTextField(wrappingLabelWithString: message)
        label.alignment = .center
        label.textColor = .secondaryLabelColor
        label.font = .systemFont(ofSize: 13)
        label.translatesAutoresizingMaskIntoConstraints = false
        view.addSubview(label)
        NSLayoutConstraint.activate([
            label.centerXAnchor.constraint(equalTo: view.centerXAnchor),
            label.centerYAnchor.constraint(equalTo: view.centerYAnchor),
            label.leadingAnchor.constraint(greaterThanOrEqualTo: view.leadingAnchor, constant: 24),
            label.trailingAnchor.constraint(lessThanOrEqualTo: view.trailingAnchor, constant: -24),
        ])
        statusLabel = label
    }

    private func clearStatus() {
        statusLabel?.removeFromSuperview()
        statusLabel = nil
    }
}