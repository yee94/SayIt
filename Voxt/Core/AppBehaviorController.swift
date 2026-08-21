// AppBehaviorController.swift
// Provides App Behavior Controller for core app behavior.

import AppKit
import ServiceManagement

enum AppBehaviorController {
    static func resolvedActivationPolicy(
        showInDock: Bool,
        mainWindowVisible: Bool
    ) -> NSApplication.ActivationPolicy {
        if showInDock {
            return .regular
        }
        return mainWindowVisible ? .regular : .accessory
    }

    @MainActor
    static func applyDockVisibility(
        showInDock: Bool,
        mainWindowVisible: Bool
    ) {
        let targetPolicy = resolvedActivationPolicy(
            showInDock: showInDock,
            mainWindowVisible: mainWindowVisible
        )
        guard NSApp.activationPolicy() != targetPolicy else { return }

        NSApp.setActivationPolicy(targetPolicy)
        VoxtLog.info(
            "Dock visibility changed: showInDock=\(showInDock), mainWindowVisible=\(mainWindowVisible), policy=\(targetPolicy.rawValue)"
        )
    }

    @MainActor
    static func setLaunchAtLogin(_ enabled: Bool) throws {
        guard #available(macOS 13.0, *) else {
            VoxtLog.warning("Launch at login is unavailable on macOS versions below 13.0.")
            return
        }
        if enabled {
            try SMAppService.mainApp.register()
        } else {
            try SMAppService.mainApp.unregister()
        }
        VoxtLog.info("Launch at login updated: enabled=\(enabled)")
    }

    static func launchAtLoginIsEnabled() -> Bool {
        guard #available(macOS 13.0, *) else { return false }
        return SMAppService.mainApp.status == .enabled
    }

    /// 异步读取开机自启状态。
    /// `SMAppService.status` 是一次到 smd 的同步 XPC 往返，必须离开主线程调用，
    /// 否则会在 onAppear 的 MainActor Task 里阻塞主线程数百毫秒。
    static func launchAtLoginIsEnabledAsync() async -> Bool {
        await Task.detached(priority: .userInitiated) {
            launchAtLoginIsEnabled()
        }.value
    }

    @MainActor
    static func activateCurrentApp(ignoringOtherApps: Bool = false) {
        if ignoringOtherApps {
            NSApp.activate()
            return
        }

        _ = NSRunningApplication.current.activate(options: [.activateAllWindows])
    }

    @MainActor
    static func bringStandardWindowToFront(_ window: NSWindow?) {
        guard let window else { return }
        prepareWindowForActivation(window)
        activateCurrentApp()
        window.makeKeyAndOrderFront(nil)
    }

    @MainActor
    static func bringUserInvokedWindowToFront(_ window: NSWindow?) {
        guard let window else { return }
        prepareWindowForActivation(window)
        activateCurrentApp(ignoringOtherApps: true)
        window.makeKeyAndOrderFront(nil)
        reassertUserInvokedWindowActivation(window)
    }

    @MainActor
    private static func prepareWindowForActivation(_ window: NSWindow) {
        if window.isMiniaturized {
            window.deminiaturize(nil)
        }
    }

    private static func reassertUserInvokedWindowActivation(_ window: NSWindow) {
        for delay in [0.15, 0.35] {
            Task { @MainActor [weak window] in
                try? await Task.sleep(nanoseconds: UInt64(delay * 1_000_000_000))
                guard let window, window.isVisible else { return }
                prepareWindowForActivation(window)
                activateCurrentApp(ignoringOtherApps: true)
                window.makeKeyAndOrderFront(nil)
            }
        }
    }
}
