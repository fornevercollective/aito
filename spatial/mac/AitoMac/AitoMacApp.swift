import AppKit
import Darwin
import Foundation

/// Explicit entry point — keeps AppDelegate strongly retained (NSApp.delegate is weak).
@main
enum AitoMacMain {
    static func main() {
        let app = NSApplication.shared
        let delegate = AppDelegate()
        // CRITICAL: strong retain — NSApplication.delegate is weak
        AppDelegate.shared = delegate
        app.delegate = delegate
        app.setActivationPolicy(.regular)
        app.run()
    }
}

final class AppDelegate: NSObject, NSApplicationDelegate {
    /// Strong retain for NSApp.delegate (weak)
    static var shared: AppDelegate?

    private static let lockPath = "/tmp/aito-mac.lock"
    private static var lockFD: Int32 = -1

    private var mainWindow: NSWindow?
    private var boothVC: BoothViewController?
    private var bootServer: BoothServer?

    func applicationWillFinishLaunching(_ notification: Notification) {
        NSApp.setActivationPolicy(.regular)
    }

    func applicationDidFinishLaunching(_ notification: Notification) {
        log("didFinishLaunching")

        guard acquireSingleInstanceLock() else {
            log("second instance — activating existing")
            activateExistingInstance()
            NSApp.terminate(nil)
            return
        }

        setupMainMenu()

        // 1) Create and SHOW window immediately (before servers / WebKit)
        let window = makeMainWindow()
        mainWindow = window
        forceShow(window)
        log("window ordered front frame=\(NSStringFromRect(window.frame)) visible=\(window.isVisible) windows=\(NSApp.windows.count)")

        // 2) Boot booth content on next runloop turn so window chrome is already visible
        DispatchQueue.main.async { [weak self] in
            self?.installBoothAndLoad()
        }

        // 3) Safety net — if still not visible after a beat, re-center and float briefly
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.4) { [weak self] in
            guard let self, let w = self.mainWindow else { return }
            if !w.isVisible || w.occlusionState.contains(.visible) == false {
                self.log("window not visible — re-forcing show")
                w.setFrame(self.centeredFrame(size: NSSize(width: 1280, height: 800)), display: true)
                self.forceShow(w)
            }
        }
    }

    private func forceShow(_ window: NSWindow) {
        window.alphaValue = 1
        window.isOpaque = true
        window.hasShadow = true
        // Temporarily float so it can't hide behind full-screen spaces
        window.level = .floating
        window.collectionBehavior = [.moveToActiveSpace, .fullScreenPrimary, .managed]
        window.setIsVisible(true)
        window.makeKeyAndOrderFront(nil)
        window.orderFrontRegardless()
        NSApp.activate(ignoringOtherApps: true)
        // Drop back to normal after it's on-screen
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.25) {
            window.level = .normal
            window.makeKeyAndOrderFront(nil)
        }
    }

    private func makeMainWindow() -> NSWindow {
        // Visible placeholder so user always sees a window even if WebKit is slow
        let placeholder = NSView(frame: NSRect(x: 0, y: 0, width: 1280, height: 800))
        placeholder.wantsLayer = true
        placeholder.layer?.backgroundColor = NSColor(red: 0.04, green: 0.04, blue: 0.05, alpha: 1).cgColor

        let label = NSTextField(labelWithString: "aito-mac · starting booth…")
        label.textColor = NSColor(white: 0.65, alpha: 1)
        label.font = NSFont.systemFont(ofSize: 15, weight: .medium)
        label.alignment = .center
        label.translatesAutoresizingMaskIntoConstraints = false
        placeholder.addSubview(label)
        NSLayoutConstraint.activate([
            label.centerXAnchor.constraint(equalTo: placeholder.centerXAnchor),
            label.centerYAnchor.constraint(equalTo: placeholder.centerYAnchor),
        ])

        let window = NSWindow(
            contentRect: NSRect(x: 0, y: 0, width: 1280, height: 800),
            styleMask: [.titled, .closable, .miniaturizable, .resizable],
            backing: .buffered,
            defer: false
        )
        window.title = "aito-mac · gsplat booth"
        window.minSize = NSSize(width: 960, height: 600)
        window.isReleasedWhenClosed = false
        window.tabbingMode = .disallowed
        window.backgroundColor = NSColor(red: 0.04, green: 0.04, blue: 0.05, alpha: 1)
        window.contentView = placeholder
        // Avoid bad autosave frames (common “menu only / no window” cause)
        window.setFrame(centeredFrame(size: NSSize(width: 1280, height: 800)), display: true)
        window.level = .normal
        window.collectionBehavior = [.moveToActiveSpace, .fullScreenPrimary]
        return window
    }

    private func centeredFrame(size: NSSize) -> NSRect {
        let screen = NSScreen.main ?? NSScreen.screens.first
        let visible = screen?.visibleFrame ?? NSRect(x: 0, y: 0, width: 1440, height: 900)
        let x = visible.midX - size.width / 2
        let y = visible.midY - size.height / 2
        return NSRect(x: x, y: y, width: size.width, height: size.height)
    }

    private func installBoothAndLoad() {
        guard let window = mainWindow else { return }
        let root = ProjectRoot.url()
        log("project root: \(root.path)")

        let bootServer = BoothServer(root: root)
        self.bootServer = bootServer
        bootServer.startIfNeeded(preferredPort: BoothServer.defaultPort)

        let boothVC = BoothViewController(root: root)
        self.boothVC = boothVC

        // Swap placeholder for real booth VC
        window.contentViewController = boothVC
        window.makeKeyAndOrderFront(nil)
        NSApp.activate(ignoringOtherApps: true)

        boothVC.reloadBooth()

        // Second load after server bind
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.75) { [weak self] in
            self?.boothVC?.reloadBooth()
            self?.mainWindow?.makeKeyAndOrderFront(nil)
            NSApp.activate(ignoringOtherApps: true)
        }
    }

    func applicationWillTerminate(_ notification: Notification) {
        bootServer?.stop()
        releaseSingleInstanceLock()
        log("willTerminate")
    }

    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool {
        true
    }

    func applicationShouldHandleReopen(_ sender: NSApplication, hasVisibleWindows flag: Bool) -> Bool {
        if let w = mainWindow {
            if !flag || !w.isVisible {
                w.setFrame(centeredFrame(size: w.frame.size), display: true)
            }
            w.makeKeyAndOrderFront(nil)
            w.orderFrontRegardless()
        }
        NSApp.activate(ignoringOtherApps: true)
        return true
    }

    @objc private func reloadBooth() {
        boothVC?.reloadBooth()
    }

    @objc private func showMainWindow() {
        if mainWindow == nil {
            mainWindow = makeMainWindow()
            installBoothAndLoad()
        }
        guard let w = mainWindow else { return }
        w.setFrame(centeredFrame(size: w.frame.size), display: true)
        forceShow(w)
        log("showMainWindow frame=\(NSStringFromRect(w.frame))")
    }

    @objc private func quitApp() {
        NSApp.terminate(nil)
    }

    private func activateExistingInstance() {
        DistributedNotificationCenter.default().postNotificationName(
            Notification.Name("com.fornevercollective.aito-mac.showWindow"),
            object: nil,
            userInfo: nil,
            deliverImmediately: true
        )
        let selfPid = ProcessInfo.processInfo.processIdentifier
        for app in NSWorkspace.shared.runningApplications {
            guard app.bundleIdentifier == "com.fornevercollective.aito-mac",
                  app.processIdentifier != selfPid else { continue }
            app.activate(options: [.activateIgnoringOtherApps, .activateAllWindows])
            break
        }
    }

    private func setupMainMenu() {
        let main = NSMenu()

        let appItem = NSMenuItem()
        main.addItem(appItem)
        let appMenu = NSMenu()
        appItem.submenu = appMenu
        appMenu.addItem(
            withTitle: "About aito-mac",
            action: #selector(NSApplication.orderFrontStandardAboutPanel(_:)),
            keyEquivalent: ""
        )
        appMenu.addItem(NSMenuItem.separator())
        appMenu.addItem(withTitle: "Show Booth Window", action: #selector(showMainWindow), keyEquivalent: "0")
        appMenu.addItem(withTitle: "Reload Booth", action: #selector(reloadBooth), keyEquivalent: "r")
        appMenu.addItem(NSMenuItem.separator())
        appMenu.addItem(withTitle: "Quit aito-mac", action: #selector(quitApp), keyEquivalent: "q")

        let fileItem = NSMenuItem(title: "File", action: nil, keyEquivalent: "")
        main.addItem(fileItem)
        let fileMenu = NSMenu(title: "File")
        fileItem.submenu = fileMenu
        fileMenu.addItem(
            withTitle: "Close Window",
            action: #selector(NSWindow.performClose(_:)),
            keyEquivalent: "w"
        )

        let viewItem = NSMenuItem(title: "View", action: nil, keyEquivalent: "")
        main.addItem(viewItem)
        let viewMenu = NSMenu(title: "View")
        viewItem.submenu = viewMenu
        viewMenu.addItem(withTitle: "Reload Booth", action: #selector(reloadBooth), keyEquivalent: "R")
        viewMenu.addItem(withTitle: "Show Booth Window", action: #selector(showMainWindow), keyEquivalent: "")

        let windowItem = NSMenuItem(title: "Window", action: nil, keyEquivalent: "")
        main.addItem(windowItem)
        let windowMenu = NSMenu(title: "Window")
        windowItem.submenu = windowMenu
        windowMenu.addItem(withTitle: "Show Booth Window", action: #selector(showMainWindow), keyEquivalent: "")
        windowMenu.addItem(
            withTitle: "Minimize",
            action: #selector(NSWindow.performMiniaturize(_:)),
            keyEquivalent: "m"
        )
        windowMenu.addItem(withTitle: "Zoom", action: #selector(NSWindow.performZoom(_:)), keyEquivalent: "")
        windowMenu.addItem(NSMenuItem.separator())
        windowMenu.addItem(
            withTitle: "Bring All to Front",
            action: #selector(NSApplication.arrangeInFront(_:)),
            keyEquivalent: ""
        )

        NSApp.mainMenu = main
        NSApp.windowsMenu = windowMenu

        // Second-instance / external show request
        DistributedNotificationCenter.default().addObserver(
            self,
            selector: #selector(showMainWindow),
            name: Notification.Name("com.fornevercollective.aito-mac.showWindow"),
            object: nil
        )
    }

    private func acquireSingleInstanceLock() -> Bool {
        let fd = open(Self.lockPath, O_CREAT | O_RDWR, S_IRUSR | S_IWUSR)
        guard fd >= 0 else { return true }
        if flock(fd, LOCK_EX | LOCK_NB) != 0 {
            close(fd)
            return false
        }
        Self.lockFD = fd
        // Write pid for debugging
        let pid = "\(ProcessInfo.processInfo.processIdentifier)\n"
        _ = pid.withCString { p in write(fd, p, strlen(p)) }
        return true
    }

    private func releaseSingleInstanceLock() {
        if Self.lockFD >= 0 {
            flock(Self.lockFD, LOCK_UN)
            close(Self.lockFD)
            Self.lockFD = -1
        }
        unlink(Self.lockPath)
    }

    private func log(_ msg: String) {
        let line = "\(ISO8601DateFormatter().string(from: Date())) \(msg)\n"
        let path = "/tmp/aito-mac-app.log"
        if let data = line.data(using: .utf8) {
            if FileManager.default.fileExists(atPath: path),
               let handle = FileHandle(forWritingAtPath: path) {
                handle.seekToEndOfFile()
                handle.write(data)
                handle.closeFile()
            } else {
                try? data.write(to: URL(fileURLWithPath: path), options: .atomic)
            }
        }
        fputs("[aito-mac] \(msg)\n", stderr)
    }
}

enum ProjectRoot {
    static func url() -> URL {
        if let env = ProcessInfo.processInfo.environment["AITO_MAC_ROOT"],
           !env.isEmpty {
            return URL(fileURLWithPath: env, isDirectory: true)
        }
        if let bundled = Bundle.main.resourceURL?.appendingPathComponent("aito-mac", isDirectory: true),
           FileManager.default.fileExists(atPath: bundled.appendingPathComponent("booth/index.html").path) {
            return bundled
        }
        let dev = URL(fileURLWithPath: NSHomeDirectory() + "/dev/aito-mac", isDirectory: true)
        if FileManager.default.fileExists(atPath: dev.appendingPathComponent("booth/index.html").path) {
            return dev
        }
        return Bundle.main.bundleURL
    }
}
