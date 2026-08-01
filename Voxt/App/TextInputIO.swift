// TextInputIO.swift
// Provides Text Input IO for app lifecycle and routing.

import Foundation
import AppKit
import ApplicationServices
import Carbon

private enum FocusedInputLearningAXSupport {
    /// Lightweight C API ordinary reads (Electron often returns cannotComplete at 0.05s).
    private static let messagingTimeout: Float = 0.2
    /// One-shot AXManualAccessibility poke needs a longer messaging window.
    private static let manualAccessibilityMessagingTimeout: Float = 0.5
    private static let snapshotLock = NSLock()
    private static let enableAXEnhancedTimeout: TimeInterval = 1.2
    private static let osascriptReadTimeout: TimeInterval = 1.5
    private static let manualAccessibilitySettleDelay: TimeInterval = 0.15
    private static let maxExcerptCharacters = 200
    private static let enhancedUIEnabledPIDs = NSLockingSet()
    private static let manualAccessibilityPokedPIDs = NSLockingSet()
    private static let firstResultLoggedPIDs = NSLockingSet()
    /// System Events permanently denied for this PID (-10004 / -1743); skip osascript on later polls.
    private static let osascriptUnavailablePIDs = NSLockingSet()
    private static let nestedFocusContainerRoles: Set<String> = [
        "AXWebArea",
        "AXGroup",
        "AXScrollArea"
    ]
    private static let maxCAPIDiagnosticCharacters = 200
    /// Safe AppleScript marker prefix — never log field content; only parse these markers.
    private static let osascriptErrorMarkerPrefix = "AX_READ_ERR:"
    private static let osascriptEmptyMarker = "AX_READ_EMPTY"
    private static let osascriptEnableOKMarker = "AX_ENABLE_OK"
    private static let osascriptEnableErrorMarkerPrefix = "AX_ENABLE_ERR:"

    static func snapshot(
        bundleIdentifier: String?,
        processIdentifier: pid_t
    ) async -> AppDelegate.FocusedInputTextSnapshot? {
        await Task.detached(priority: .utility) { () -> AppDelegate.FocusedInputTextSnapshot? in
            guard snapshotLock.try() else {
                VoxtLog.input(
                    "Automatic dictionary AX snapshot skipped: a previous background read is still running.",
                    verbose: true
                )
                return nil
            }
            defer { snapshotLock.unlock() }

            guard AccessibilityPermissionManager.isTrusted() else {
                VoxtLog.input(
                    "Automatic dictionary AX snapshot skipped: accessibility not trusted (permission missing, not unreadable field).",
                    verbose: true
                )
                return nil
            }

            let enhancedStatus = ensureAXEnhancedUserInterfaceIfNeeded(for: processIdentifier)

            // First pass: osascript then lightweight C API (no tree scan).
            var attempt = attemptFocusedSnapshot(
                bundleIdentifier: bundleIdentifier,
                processIdentifier: processIdentifier
            )
            var manualPokeRawValue: Int32?
            var didPokeThisCycle = false

            // Per-PID once: only after both osascript + C API fail, poke AXManualAccessibility
            // via C API (Electron wake), sleep 150ms, then retry same helpers.
            if attempt.snapshot == nil,
               !manualAccessibilityPokedPIDs.contains(processIdentifier) {
                manualPokeRawValue = pokeAXManualAccessibility(for: processIdentifier)
                didPokeThisCycle = true
                Thread.sleep(forTimeInterval: manualAccessibilitySettleDelay)
                attempt = attemptFocusedSnapshot(
                    bundleIdentifier: bundleIdentifier,
                    processIdentifier: processIdentifier
                )
            }

            let successSource = attempt.snapshot?.textSource
            logFirstResultDiagnosticsIfNeeded(
                processIdentifier: processIdentifier,
                enhancedStatus: enhancedStatus,
                osascriptMarker: attempt.osascriptMarker,
                cAPIMarker: attempt.cAPIMarker,
                manualPokeRawValue: didPokeThisCycle ? manualPokeRawValue : nil,
                successSource: successSource
            )

            if let snapshot = attempt.snapshot {
                VoxtLog.input(
                    "Automatic dictionary AX snapshot success source=\(snapshot.textSource ?? "unknown") pid=\(processIdentifier) chars=\(snapshot.text.count)",
                    verbose: true
                )
            }
            return attempt.snapshot
        }.value
    }

    private struct SnapshotAttempt {
        let snapshot: AppDelegate.FocusedInputTextSnapshot?
        let osascriptMarker: String
        let cAPIMarker: String
    }

    /// Shared first-pass / post-poke retry path: osascript then C API. No tree scan.
    private static func attemptFocusedSnapshot(
        bundleIdentifier: String?,
        processIdentifier: pid_t
    ) -> SnapshotAttempt {
        let osascriptRead = readFocusedTextViaOsascript(processIdentifier: processIdentifier)
        if case .success(let text) = osascriptRead {
            let excerpt = excerptForLearning(text)
            if !excerpt.isEmpty {
                return SnapshotAttempt(
                    snapshot: AppDelegate.FocusedInputTextSnapshot(
                        text: excerpt,
                        bundleIdentifier: bundleIdentifier,
                        processIdentifier: processIdentifier,
                        role: nil,
                        isEditable: true,
                        isFocusedTarget: true,
                        selectedRange: nil,
                        failureReason: nil,
                        textSource: "osascript-ax-focused"
                    ),
                    osascriptMarker: osascriptRead.diagnosticMarker,
                    cAPIMarker: "skipped"
                )
            }
        }

        let cAPIResult = readFocusedSnapshotViaCAPI(
            bundleIdentifier: bundleIdentifier,
            processIdentifier: processIdentifier
        )
        return SnapshotAttempt(
            snapshot: cAPIResult.snapshot,
            osascriptMarker: osascriptRead.diagnosticMarker,
            cAPIMarker: cAPIResult.marker
        )
    }

    private static func ensureAXEnhancedUserInterfaceIfNeeded(for processIdentifier: pid_t) -> String {
        guard !enhancedUIEnabledPIDs.contains(processIdentifier) else {
            return "already"
        }
        if osascriptUnavailablePIDs.contains(processIdentifier) {
            enhancedUIEnabledPIDs.insert(processIdentifier)
            return "unavailable"
        }

        // Launch System Events first (it may not be running), short settle, then set by PID.
        // Markers make enable success/failure explicit — silent try must not report success.
        let script = """
        try
          tell application "System Events" to launch
          delay 0.1
          tell application "System Events"
            tell (first application process whose unix id is \(processIdentifier))
              set value of attribute "AXEnhancedUserInterface" to true
            end tell
          end tell
          return "\(osascriptEnableOKMarker)"
        on error errMsg number errNum
          return "\(osascriptEnableErrorMarkerPrefix)" & errNum & ":" & errMsg
        end try
        """
        let result = runOsascript(script: script, timeout: enableAXEnhancedTimeout, purpose: "enable")
        // Always mark so we do not keep re-running a slow enable path each poll.
        enhancedUIEnabledPIDs.insert(processIdentifier)
        switch result {
        case .success(let output):
            let trimmed = output.trimmingCharacters(in: .whitespacesAndNewlines)
            if trimmed == osascriptEnableOKMarker || trimmed.hasPrefix(osascriptEnableOKMarker) {
                VoxtLog.input(
                    "Automatic dictionary AX enable success pid=\(processIdentifier)",
                    verbose: true
                )
                return "success"
            }
            if trimmed.hasPrefix(osascriptEnableErrorMarkerPrefix) {
                let payload = String(trimmed.dropFirst(osascriptEnableErrorMarkerPrefix.count))
                let parts = payload.split(separator: ":", maxSplits: 1, omittingEmptySubsequences: false)
                let number = parts.first.map(String.init) ?? "?"
                let shortMessage = sanitizeDiagnosticFragment(
                    parts.count > 1 ? String(parts[1]) : ""
                )
                // Same permanent denials as read path: cache so later polls skip System Events.
                if number == "-10004" || number == "-1743" {
                    osascriptUnavailablePIDs.insert(processIdentifier)
                }
                let status = shortMessage.isEmpty
                    ? "ax_err:\(number)"
                    : "ax_err:\(number):\(shortMessage)"
                VoxtLog.input(
                    "Automatic dictionary AX enable ax_err pid=\(processIdentifier) number=\(number) marker=\(shortMessage)",
                    verbose: true
                )
                return status
            }
            // Unexpected stdout: treat as failure, never silent success.
            let fragment = sanitizeDiagnosticFragment(trimmed)
            VoxtLog.input(
                "Automatic dictionary AX enable unexpected marker pid=\(processIdentifier) marker=\(fragment)",
                verbose: true
            )
            return fragment.isEmpty ? "unexpected" : "unexpected:\(fragment)"
        case .timeout:
            VoxtLog.input(
                "Automatic dictionary AX enable timeout pid=\(processIdentifier) timeoutMs=\(Int(enableAXEnhancedTimeout * 1000))",
                verbose: true
            )
            return "timeout"
        case .exitFailure(let code, let stderr):
            let fragment = sanitizeDiagnosticFragment(stderr)
            VoxtLog.input(
                "Automatic dictionary AX enable exit failure pid=\(processIdentifier) code=\(code) stderr=\(stderr.prefix(120))",
                verbose: true
            )
            return fragment.isEmpty ? "exit_failure:\(code)" : "exit_failure:\(code):\(fragment)"
        case .launchFailure(let message):
            let fragment = sanitizeDiagnosticFragment(message)
            VoxtLog.input(
                "Automatic dictionary AX enable launch failure pid=\(processIdentifier) error=\(fragment)",
                verbose: true
            )
            return fragment.isEmpty ? "launch_failure" : "launch_failure:\(fragment)"
        }
    }

    /// Per-PID once. Sets AXManualAccessibility=true via C API only (no tree scan).
    /// Unsupported on native apps → quick AXError (e.g. attribute unsupported).
    @discardableResult
    private static func pokeAXManualAccessibility(for processIdentifier: pid_t) -> Int32 {
        manualAccessibilityPokedPIDs.insert(processIdentifier)
        let application = AXUIElementCreateApplication(processIdentifier)
        AXUIElementSetMessagingTimeout(application, manualAccessibilityMessagingTimeout)
        guard let enabledValue = kCFBooleanTrue else {
            return AXError.failure.rawValue
        }
        let error = AXUIElementSetAttributeValue(
            application,
            "AXManualAccessibility" as CFString,
            enabledValue
        )
        VoxtLog.input(
            "Automatic dictionary AX manual poke pid=\(processIdentifier) axError=\(error.rawValue)",
            verbose: true
        )
        return error.rawValue
    }

    private enum OsascriptTextRead {
        case success(String)
        case empty
        case axError(number: String, shortMessage: String)
        case unavailable
        case timeout
        case exitFailure(code: Int32, stderr: String)
        case launchFailure(String)

        /// Safe diagnostic marker for current.log — never includes field content.
        var diagnosticMarker: String {
            switch self {
            case .success:
                return "ok"
            case .empty:
                return "empty"
            case .axError(let number, let shortMessage):
                return "ax_err:\(number):\(shortMessage)"
            case .unavailable:
                return "unavailable"
            case .timeout:
                return "timeout"
            case .exitFailure(let code, let stderr):
                let marker = sanitizeDiagnosticFragment(stderr)
                return marker.isEmpty ? "exit:\(code)" : "exit:\(code):\(marker)"
            case .launchFailure(let message):
                return "launch_failure:\(sanitizeDiagnosticFragment(message))"
            }
        }
    }

    private static func readFocusedTextViaOsascript(processIdentifier: pid_t) -> OsascriptTextRead {
        // Permanent Automation / sandbox denials: skip System Events entirely.
        if osascriptUnavailablePIDs.contains(processIdentifier) {
            return .unavailable
        }

        // Prefer AXValue, then AXSelectedText. Errors return safe markers (not field text).
        let script = """
        try
          tell application "System Events"
            tell (first application process whose unix id is \(processIdentifier))
              set focusedElement to value of attribute "AXFocusedUIElement"
              try
                set focusedValue to value of attribute "AXValue" of focusedElement
                if focusedValue is not missing value and focusedValue as text is not "" then
                  return focusedValue as text
                end if
              end try
              try
                set selectedText to value of attribute "AXSelectedText" of focusedElement
                if selectedText is not missing value and selectedText as text is not "" then
                  return selectedText as text
                end if
              end try
            end tell
          end tell
          return "\(osascriptEmptyMarker)"
        on error errMsg number errNum
          return "\(osascriptErrorMarkerPrefix)" & errNum & ":" & errMsg
        end try
        """
        let result = runOsascript(script: script, timeout: osascriptReadTimeout, purpose: "read")
        switch result {
        case .success(let output):
            let trimmed = output.trimmingCharacters(in: .whitespacesAndNewlines)
            if trimmed.hasPrefix(osascriptErrorMarkerPrefix) {
                let payload = String(trimmed.dropFirst(osascriptErrorMarkerPrefix.count))
                let parts = payload.split(separator: ":", maxSplits: 1, omittingEmptySubsequences: false)
                let number = parts.first.map(String.init) ?? "?"
                let shortMessage = sanitizeDiagnosticFragment(
                    parts.count > 1 ? String(parts[1]) : ""
                )
                // -10004: sandbox/privilege violation; -1743: Automation denied.
                // Cache per-PID so later polls skip osascript. -600 is launch timing — retry OK.
                if number == "-10004" || number == "-1743" {
                    osascriptUnavailablePIDs.insert(processIdentifier)
                    VoxtLog.input(
                        "Automatic dictionary AX read osascript unavailable cached pid=\(processIdentifier) number=\(number)",
                        verbose: true
                    )
                }
                VoxtLog.input(
                    "Automatic dictionary AX read ax_err via osascript pid=\(processIdentifier) number=\(number) marker=\(shortMessage)",
                    verbose: true
                )
                return .axError(number: number, shortMessage: shortMessage)
            }
            if trimmed.isEmpty || trimmed == osascriptEmptyMarker {
                VoxtLog.input(
                    "Automatic dictionary AX read empty via osascript pid=\(processIdentifier)",
                    verbose: true
                )
                return .empty
            }
            return .success(trimmed)
        case .timeout:
            VoxtLog.input(
                "Automatic dictionary AX read timeout pid=\(processIdentifier) timeoutMs=\(Int(osascriptReadTimeout * 1000))",
                verbose: true
            )
            return .timeout
        case .exitFailure(let code, let stderr):
            VoxtLog.input(
                "Automatic dictionary AX read exit failure pid=\(processIdentifier) code=\(code) stderr=\(stderr.prefix(120))",
                verbose: true
            )
            return .exitFailure(code: code, stderr: stderr)
        case .launchFailure(let message):
            VoxtLog.input(
                "Automatic dictionary AX read launch failure pid=\(processIdentifier) error=\(message)",
                verbose: true
            )
            return .launchFailure(message)
        }
    }

    private struct CAPIReadResult {
        let snapshot: AppDelegate.FocusedInputTextSnapshot?
        /// Content-free route diagnostic, e.g. `app:e=-25204|win:role=AXWebArea,v=-25212|sw:ok`.
        let marker: String
    }

    /// SayIt-aligned C API fallback: try lightweight focused-element routes (no tree scan).
    /// Order: app focused → window focused → systemWide focused → systemWide focusedApp focused.
    /// Nested AXWebArea/AXGroup/AXScrollArea: one-level focused child before value reads.
    private static func readFocusedSnapshotViaCAPI(
        bundleIdentifier: String?,
        processIdentifier: pid_t
    ) -> CAPIReadResult {
        var diagnosticParts: [String] = []
        // Best-effort dedupe when the same CF pointer is returned via multiple routes.
        var seenElementPointers = Set<UnsafeMutableRawPointer>()

        let application = AXUIElementCreateApplication(processIdentifier)
        AXUIElementSetMessagingTimeout(application, messagingTimeout)

        // a) app → AXFocusedUIElement
        if let snapshot = tryCAPIFocusedCandidate(
            root: application,
            routeLabel: "app",
            textSource: "c-api-app-focused",
            bundleIdentifier: bundleIdentifier,
            processIdentifier: processIdentifier,
            seenElementPointers: &seenElementPointers,
            diagnosticParts: &diagnosticParts
        ) {
            return CAPIReadResult(snapshot: snapshot, marker: joinCAPIDiagnostic(diagnosticParts))
        }

        // b) app → AXFocusedWindow → window AXFocusedUIElement (then window itself as value source)
        let (focusedWindow, windowFetchError) = copyElementAttribute(
            kAXFocusedWindowAttribute as CFString,
            for: application
        )
        if let focusedWindow {
            AXUIElementSetMessagingTimeout(focusedWindow, messagingTimeout)
            if let snapshot = tryCAPIFocusedCandidate(
                root: focusedWindow,
                routeLabel: "win",
                textSource: "c-api-window-focused",
                bundleIdentifier: bundleIdentifier,
                processIdentifier: processIdentifier,
                seenElementPointers: &seenElementPointers,
                diagnosticParts: &diagnosticParts
            ) {
                return CAPIReadResult(snapshot: snapshot, marker: joinCAPIDiagnostic(diagnosticParts))
            }
            // Window itself as candidate (some Electron surfaces expose value on the window).
            if let snapshot = tryCAPIValueCandidate(
                element: focusedWindow,
                routeLabel: "winSelf",
                textSource: "c-api-window-value",
                bundleIdentifier: bundleIdentifier,
                processIdentifier: processIdentifier,
                seenElementPointers: &seenElementPointers,
                diagnosticParts: &diagnosticParts
            ) {
                return CAPIReadResult(snapshot: snapshot, marker: joinCAPIDiagnostic(diagnosticParts))
            }
        } else {
            diagnosticParts.append("win:e=\(windowFetchError.rawValue)")
        }

        // c) systemWide → AXFocusedUIElement
        let systemWide = AXUIElementCreateSystemWide()
        AXUIElementSetMessagingTimeout(systemWide, messagingTimeout)
        if let snapshot = tryCAPIFocusedCandidate(
            root: systemWide,
            routeLabel: "sw",
            textSource: "c-api-systemwide-focused",
            bundleIdentifier: bundleIdentifier,
            processIdentifier: processIdentifier,
            seenElementPointers: &seenElementPointers,
            diagnosticParts: &diagnosticParts
        ) {
            return CAPIReadResult(snapshot: snapshot, marker: joinCAPIDiagnostic(diagnosticParts))
        }

        // d) systemWide → AXFocusedApplication → that app's AXFocusedUIElement
        let (focusedApp, focusedAppError) = copyElementAttribute(
            kAXFocusedApplicationAttribute as CFString,
            for: systemWide
        )
        if let focusedApp {
            AXUIElementSetMessagingTimeout(focusedApp, messagingTimeout)
            if let snapshot = tryCAPIFocusedCandidate(
                root: focusedApp,
                routeLabel: "swApp",
                textSource: "c-api-systemwide-app-focused",
                bundleIdentifier: bundleIdentifier,
                processIdentifier: processIdentifier,
                seenElementPointers: &seenElementPointers,
                diagnosticParts: &diagnosticParts
            ) {
                return CAPIReadResult(snapshot: snapshot, marker: joinCAPIDiagnostic(diagnosticParts))
            }
        } else {
            diagnosticParts.append("swApp:e=\(focusedAppError.rawValue)")
        }

        return CAPIReadResult(snapshot: nil, marker: joinCAPIDiagnostic(diagnosticParts))
    }

    /// Resolve `root.AXFocusedUIElement`, then SayIt-aligned value/selectedText (with optional nested focus).
    private static func tryCAPIFocusedCandidate(
        root: AXUIElement,
        routeLabel: String,
        textSource: String,
        bundleIdentifier: String?,
        processIdentifier: pid_t,
        seenElementPointers: inout Set<UnsafeMutableRawPointer>,
        diagnosticParts: inout [String]
    ) -> AppDelegate.FocusedInputTextSnapshot? {
        let (focused, focusError) = copyElementAttribute(
            kAXFocusedUIElementAttribute as CFString,
            for: root
        )
        guard let focused else {
            diagnosticParts.append("\(routeLabel):e=\(focusError.rawValue)")
            return nil
        }
        return tryCAPIValueCandidate(
            element: focused,
            routeLabel: routeLabel,
            textSource: textSource,
            bundleIdentifier: bundleIdentifier,
            processIdentifier: processIdentifier,
            seenElementPointers: &seenElementPointers,
            diagnosticParts: &diagnosticParts
        )
    }

    /// SayIt-aligned value extraction on a candidate element (deduped by CF pointer).
    private static func tryCAPIValueCandidate(
        element: AXUIElement,
        routeLabel: String,
        textSource: String,
        bundleIdentifier: String?,
        processIdentifier: pid_t,
        seenElementPointers: inout Set<UnsafeMutableRawPointer>,
        diagnosticParts: inout [String]
    ) -> AppDelegate.FocusedInputTextSnapshot? {
        let elementPointer = Unmanaged.passUnretained(element).toOpaque()
        guard seenElementPointers.insert(elementPointer).inserted else {
            diagnosticParts.append("\(routeLabel):dup")
            return nil
        }

        AXUIElementSetMessagingTimeout(element, messagingTimeout)
        let focusedRole = stringAttribute(kAXRoleAttribute as CFString, for: element)
        var child: AXUIElement?
        if let focusedRole, nestedFocusContainerRoles.contains(focusedRole) {
            child = elementAttribute(kAXFocusedUIElementAttribute as CFString, for: element)
        }

        let (childValue, childValueError) = child.map {
            copyNonEmptyStringAttribute(kAXValueAttribute as CFString, for: $0)
        } ?? (nil, AXError.attributeUnsupported)
        let (focusedValue, focusedValueError) = copyNonEmptyStringAttribute(
            kAXValueAttribute as CFString,
            for: element
        )

        let text: String?
        let textElement: AXUIElement
        var selectedTextError: AXError = .attributeUnsupported
        if let childValue {
            text = childValue
            textElement = child ?? element
        } else if let focusedValue {
            text = focusedValue
            textElement = element
        } else {
            let childSelectedResult = child.map {
                copyNonEmptyStringAttribute(kAXSelectedTextAttribute as CFString, for: $0)
            }
            let (focusedSelected, focusedSelectedError) = copyNonEmptyStringAttribute(
                kAXSelectedTextAttribute as CFString,
                for: element
            )
            selectedTextError = childSelectedResult?.1 ?? focusedSelectedError
            if let childSelected = childSelectedResult?.0 {
                text = childSelected
                textElement = child ?? element
            } else if let focusedSelected {
                text = focusedSelected
                textElement = element
            } else {
                let roleToken = focusedRole.map { "role=\($0)" } ?? "role=?"
                let valueErrorToken = child != nil
                    ? "v=\(childValueError.rawValue)/\(focusedValueError.rawValue)"
                    : "v=\(focusedValueError.rawValue)"
                diagnosticParts.append(
                    "\(routeLabel):\(roleToken),\(valueErrorToken),s=\(selectedTextError.rawValue)"
                )
                return nil
            }
        }

        guard let text else { return nil }
        let excerpt = excerptForLearning(text)
        guard !excerpt.isEmpty else {
            let roleToken = focusedRole.map { "role=\($0)" } ?? "role=?"
            diagnosticParts.append("\(routeLabel):\(roleToken),empty-excerpt")
            return nil
        }

        let role = stringAttribute(kAXRoleAttribute as CFString, for: textElement) ?? focusedRole
        let selectedRange: NSRange? = rangeAttribute(
            kAXSelectedTextRangeAttribute as CFString,
            for: textElement
        ).flatMap { range -> NSRange? in
            guard range.location >= 0, range.length >= 0 else { return nil }
            return NSRange(location: range.location, length: range.length)
        }
        let isEditable = boolAttribute("AXEditable" as CFString, for: textElement) == true
            || isAttributeSettable(kAXValueAttribute as CFString, on: textElement)
            || isAttributeSettable(kAXSelectedTextRangeAttribute as CFString, on: textElement)

        let roleToken = role.map { "role=\($0)" } ?? "role=?"
        diagnosticParts.append("\(routeLabel):\(roleToken),ok")

        return AppDelegate.FocusedInputTextSnapshot(
            text: excerpt,
            bundleIdentifier: bundleIdentifier,
            processIdentifier: processIdentifier,
            role: role,
            isEditable: isEditable,
            isFocusedTarget: boolAttribute(kAXFocusedAttribute as CFString, for: textElement) == true,
            selectedRange: selectedRange,
            failureReason: nil,
            textSource: textSource
        )
    }

    private static func joinCAPIDiagnostic(_ parts: [String]) -> String {
        guard !parts.isEmpty else { return "none" }
        let joined = parts.joined(separator: "|")
        if joined.count <= maxCAPIDiagnosticCharacters {
            return joined
        }
        return String(joined.prefix(maxCAPIDiagnosticCharacters))
    }

    private static func copyElementAttribute(
        _ attribute: CFString,
        for element: AXUIElement
    ) -> (AXUIElement?, AXError) {
        AXUIElementSetMessagingTimeout(element, messagingTimeout)
        var value: CFTypeRef?
        let error = AXUIElementCopyAttributeValue(element, attribute, &value)
        guard error == .success,
              let value,
              CFGetTypeID(value) == AXUIElementGetTypeID() else {
            return (nil, error)
        }
        return (unsafeBitCast(value, to: AXUIElement.self), error)
    }

    private static func copyNonEmptyStringAttribute(
        _ attribute: CFString,
        for element: AXUIElement
    ) -> (String?, AXError) {
        AXUIElementSetMessagingTimeout(element, messagingTimeout)
        var value: CFTypeRef?
        let error = AXUIElementCopyAttributeValue(element, attribute, &value)
        guard error == .success else {
            return (nil, error)
        }
        let raw: String?
        if let text = value as? String {
            raw = text
        } else {
            raw = (value as? NSAttributedString)?.string
        }
        let trimmed = raw?.trimmingCharacters(in: .whitespacesAndNewlines)
        guard let trimmed, !trimmed.isEmpty else {
            return (nil, error)
        }
        return (trimmed, error)
    }

    private static func logFirstResultDiagnosticsIfNeeded(
        processIdentifier: pid_t,
        enhancedStatus: String,
        osascriptMarker: String,
        cAPIMarker: String,
        manualPokeRawValue: Int32?,
        successSource: String?
    ) {
        let isFirst = !firstResultLoggedPIDs.contains(processIdentifier)
        if isFirst {
            firstResultLoggedPIDs.insert(processIdentifier)
        }
        let pokeToken: String
        if let manualPokeRawValue {
            pokeToken = String(manualPokeRawValue)
        } else if manualAccessibilityPokedPIDs.contains(processIdentifier) {
            pokeToken = "already"
        } else {
            pokeToken = "skipped"
        }
        let sourceToken = successSource ?? "nil"
        let cAPIToken = sanitizeDiagnosticFragment(cAPIMarker, maxLength: maxCAPIDiagnosticCharacters)
        // Info on first PID result so current.log shows Automation deny vs empty fields;
        // subsequent polls stay verbose-only.
        VoxtLog.input(
            "Automatic dictionary AX first-result pid=\(processIdentifier) enhanced=\(enhancedStatus) osascript=\(osascriptMarker) cAPI=\(cAPIToken) manualPoke=\(pokeToken) source=\(sourceToken)",
            verbose: !isFirst
        )
    }

    private static func sanitizeDiagnosticFragment(_ raw: String, maxLength: Int = 80) -> String {
        let collapsed = raw
            .replacingOccurrences(of: "\n", with: " ")
            .replacingOccurrences(of: "\r", with: " ")
            .trimmingCharacters(in: .whitespacesAndNewlines)
        guard !collapsed.isEmpty else { return "" }
        return String(collapsed.prefix(maxLength))
    }

    private enum OsascriptResult {
        case success(String)
        case timeout
        case exitFailure(code: Int32, stderr: String)
        case launchFailure(String)
    }

    private static func runOsascript(
        script: String,
        timeout: TimeInterval,
        purpose: String
    ) -> OsascriptResult {
        let process = Process()
        process.executableURL = URL(fileURLWithPath: "/usr/bin/osascript")
        process.arguments = ["-e", script]

        let stdoutPipe = Pipe()
        let stderrPipe = Pipe()
        process.standardOutput = stdoutPipe
        process.standardError = stderrPipe

        do {
            try process.run()
        } catch {
            return .launchFailure(error.localizedDescription)
        }

        let deadline = Date().addingTimeInterval(timeout)
        while process.isRunning, Date() < deadline {
            Thread.sleep(forTimeInterval: 0.02)
        }

        if process.isRunning {
            // Hard timeout: SIGTERM, short wait; if still alive SIGKILL, short wait;
            // only read pipes after confirmed exit. Never block forever on readDataToEndOfFile.
            process.terminate()
            waitForProcessExit(process, timeout: 0.2)
            if process.isRunning {
                kill(process.processIdentifier, SIGKILL)
                waitForProcessExit(process, timeout: 0.2)
            }
            if process.isRunning {
                // Still stuck: drop pipe readers and return immediately.
                try? stdoutPipe.fileHandleForReading.close()
                try? stderrPipe.fileHandleForReading.close()
                VoxtLog.input(
                    "Automatic dictionary AX \(purpose) process still running after SIGKILL; closed pipes and returning timeout",
                    verbose: true
                )
                return .timeout
            }
            _ = stdoutPipe.fileHandleForReading.readDataToEndOfFile()
            _ = stderrPipe.fileHandleForReading.readDataToEndOfFile()
            VoxtLog.input(
                "Automatic dictionary AX \(purpose) process terminated after timeout",
                verbose: true
            )
            return .timeout
        }

        let stdoutData = stdoutPipe.fileHandleForReading.readDataToEndOfFile()
        let stderrData = stderrPipe.fileHandleForReading.readDataToEndOfFile()
        let stdout = String(data: stdoutData, encoding: .utf8) ?? ""
        let stderr = String(data: stderrData, encoding: .utf8) ?? ""
        let status = process.terminationStatus
        if status == 0 {
            return .success(stdout)
        }
        return .exitFailure(code: status, stderr: stderr)
    }

    private static func waitForProcessExit(_ process: Process, timeout: TimeInterval) {
        let deadline = Date().addingTimeInterval(timeout)
        while process.isRunning, Date() < deadline {
            Thread.sleep(forTimeInterval: 0.01)
        }
    }

    /// Keep short text intact; for longer fields keep a trailing excerpt (~200 chars).
    private static func excerptForLearning(_ text: String) -> String {
        let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard trimmed.count > maxExcerptCharacters else { return trimmed }
        let suffix = String(trimmed.suffix(maxExcerptCharacters))
        return suffix.trimmingCharacters(in: .whitespacesAndNewlines)
    }

    private static func nonEmptyStringAttribute(_ attribute: CFString, for element: AXUIElement) -> String? {
        let text = stringAttribute(attribute, for: element)?
            .trimmingCharacters(in: .whitespacesAndNewlines)
        guard let text, !text.isEmpty else { return nil }
        return text
    }

    private static func elementAttribute(_ attribute: CFString, for element: AXUIElement) -> AXUIElement? {
        AXUIElementSetMessagingTimeout(element, messagingTimeout)
        var value: CFTypeRef?
        guard AXUIElementCopyAttributeValue(element, attribute, &value) == .success,
              let value,
              CFGetTypeID(value) == AXUIElementGetTypeID() else {
            return nil
        }
        return unsafeBitCast(value, to: AXUIElement.self)
    }

    private static func stringAttribute(_ attribute: CFString, for element: AXUIElement) -> String? {
        AXUIElementSetMessagingTimeout(element, messagingTimeout)
        var value: CFTypeRef?
        guard AXUIElementCopyAttributeValue(element, attribute, &value) == .success else {
            return nil
        }
        if let text = value as? String { return text }
        return (value as? NSAttributedString)?.string
    }

    private static func boolAttribute(_ attribute: CFString, for element: AXUIElement) -> Bool? {
        AXUIElementSetMessagingTimeout(element, messagingTimeout)
        var value: CFTypeRef?
        guard AXUIElementCopyAttributeValue(element, attribute, &value) == .success else {
            return nil
        }
        if let bool = value as? Bool { return bool }
        return (value as? NSNumber)?.boolValue
    }

    private static func rangeAttribute(_ attribute: CFString, for element: AXUIElement) -> CFRange? {
        AXUIElementSetMessagingTimeout(element, messagingTimeout)
        var value: CFTypeRef?
        guard AXUIElementCopyAttributeValue(element, attribute, &value) == .success,
              let value,
              CFGetTypeID(value) == AXValueGetTypeID() else {
            return nil
        }
        let axValue = unsafeBitCast(value, to: AXValue.self)
        guard AXValueGetType(axValue) == .cfRange else { return nil }
        var range = CFRange()
        return AXValueGetValue(axValue, .cfRange, &range) ? range : nil
    }

    private static func isAttributeSettable(_ attribute: CFString, on element: AXUIElement) -> Bool {
        AXUIElementSetMessagingTimeout(element, messagingTimeout)
        var settable = DarwinBoolean(false)
        return AXUIElementIsAttributeSettable(element, attribute, &settable) == .success
            && settable.boolValue
    }
}

/// Thread-safe set of PIDs that already received AXEnhancedUserInterface enable attempt.
private final class NSLockingSet: @unchecked Sendable {
    private let lock = NSLock()
    private var values: Set<pid_t> = []

    func contains(_ value: pid_t) -> Bool {
        lock.lock()
        defer { lock.unlock() }
        return values.contains(value)
    }

    func insert(_ value: pid_t) {
        lock.lock()
        defer { lock.unlock() }
        values.insert(value)
    }
}

extension AppDelegate {
    private static let axMessagingTimeout: Float = 0.05
    private static let automaticDictionaryLearningSnippetBeforeCursor = 4_000
    private static let automaticDictionaryLearningSnippetAfterCursor = 1_000
    private static let nativeWritableTextRoles: Set<String> = [
        kAXTextAreaRole as String,
        kAXTextFieldRole as String,
        "AXSearchField",
        kAXComboBoxRole as String
    ]
    private static let genericEditableTextRoles: Set<String> = [
        "AXWebArea",
        "AXGroup",
        "AXLayoutArea",
        "AXScrollArea",
        "AXDocument",
        "AXUnknown"
    ]
    private static let nonEditableFalsePositiveRoles: Set<String> = [
        kAXWindowRole as String,
        kAXButtonRole as String,
        kAXStaticTextRole as String,
        "AXToolbar",
        "AXMenuBar",
        "AXMenuItem",
        "AXMenu",
        "AXSplitter",
        "AXList",
        "AXTable",
        "AXOutline",
        "AXRow"
    ]

    struct FocusedInputTextSnapshot: Sendable {
        let text: String
        let bundleIdentifier: String?
        let processIdentifier: pid_t?
        let role: String?
        let isEditable: Bool
        let isFocusedTarget: Bool
        let selectedRange: NSRange?
        let failureReason: String?
        let textSource: String?
    }

    func hasWritableFocusedTextInput() -> Bool {
        guard let processID = NSWorkspace.shared.frontmostApplication?.processIdentifier,
              let focusedElement = focusedAXElement(preferredProcessID: processID) else {
            VoxtLog.input("Focused input check: no focused AX element.")
            return false
        }

        if let writableElement = writableTextInputElement(from: focusedElement) {
            let role = axStringAttribute(kAXRoleAttribute as CFString, for: writableElement) ?? "unknown"
            let editable = isWritableTextInputElement(writableElement)
            let valueSettable = isAttributeSettable(kAXValueAttribute as CFString, on: writableElement)
            VoxtLog.input(
                "Focused input check: writable descendant detected. role=\(role), editable=\(editable), valueSettable=\(valueSettable)"
            )
            return true
        }

        let editable = axBoolAttribute("AXEditable" as CFString, for: focusedElement)
        if editable == true {
            let role = axStringAttribute(kAXRoleAttribute as CFString, for: focusedElement) ?? "unknown"
            VoxtLog.input("Focused input check: editable AX element detected. role=\(role)")
            return true
        }

        if isAttributeSettable(kAXValueAttribute as CFString, on: focusedElement) {
            let role = axStringAttribute(kAXRoleAttribute as CFString, for: focusedElement) ?? "unknown"
            VoxtLog.input("Focused input check: settable AX value detected. role=\(role)")
            return true
        }

        guard let role = axStringAttribute(kAXRoleAttribute as CFString, for: focusedElement) else {
            VoxtLog.input(
                "Focused input check: role unavailable. editable=\(editable == true), valueSettable=false"
            )
            return false
        }

        let isWritable = Self.nativeWritableTextRoles.contains(role)
        VoxtLog.input(
            "Focused input check: role=\(role), editable=\(editable == true), valueSettable=false, result=\(isWritable)"
        )
        return isWritable
    }

    func currentFocusedInputTextSnapshot(
        expectedBundleID: String? = nil,
        logDiagnostics: Bool = true
    ) -> FocusedInputTextSnapshot? {
        guard let frontmostApplication = NSWorkspace.shared.frontmostApplication else {
            if logDiagnostics {
                VoxtLog.input("Focused input snapshot unavailable: no frontmost application.")
            }
            return nil
        }
        if let expectedBundleID,
           let bundleIdentifier = frontmostApplication.bundleIdentifier,
           bundleIdentifier != expectedBundleID {
            if logDiagnostics {
                VoxtLog.input(
                    "Focused input snapshot skipped: frontmost app changed. expectedBundleID=\(expectedBundleID), actualBundleID=\(bundleIdentifier)"
                )
            }
            return nil
        }

        let bundleIdentifier = frontmostApplication.bundleIdentifier
        let processIdentifier = frontmostApplication.processIdentifier

        guard let focusedElement = focusedAXElement(
            preferredProcessID: processIdentifier,
            logDiagnostics: logDiagnostics
        ) else {
            if logDiagnostics {
                VoxtLog.input(
                    "Focused input snapshot unavailable: no focused AX element. bundleID=\(bundleIdentifier ?? "unknown")"
                )
            }
            return nil
        }

        let writableElement = writableTextInputElement(from: focusedElement) ?? (
            isWritableTextInputElement(focusedElement) ? focusedElement : nil
        )
        guard let writableElement else {
            let role = axStringAttribute(kAXRoleAttribute as CFString, for: focusedElement) ?? "unknown"
            if logDiagnostics {
                VoxtLog.input(
                    "Focused input snapshot unavailable: no writable text element found. bundleID=\(bundleIdentifier ?? "unknown"), role=\(role)"
                )
            }
            return nil
        }

        let role = axStringAttribute(kAXRoleAttribute as CFString, for: writableElement)
        let isFocusedTarget = axBoolAttribute(kAXFocusedAttribute as CFString, for: writableElement) == true
        let value = axTextValue(for: writableElement)?.trimmingCharacters(in: .whitespacesAndNewlines)

        guard let text = value, !text.isEmpty else {
            let textFailureReason = unreadableTextFailureReason(for: writableElement)
            let role = axStringAttribute(kAXRoleAttribute as CFString, for: writableElement) ?? "unknown"
            if logDiagnostics {
                VoxtLog.input(
                    "Focused input snapshot unavailable: writable element has empty/unreadable value. bundleID=\(bundleIdentifier ?? "unknown"), role=\(role), failureReason=\(textFailureReason)"
                )
            }
            return nil
        }

        let snapshot = FocusedInputTextSnapshot(
            text: text,
            bundleIdentifier: bundleIdentifier,
            processIdentifier: processIdentifier,
            role: role,
            isEditable: isWritableTextInputElement(writableElement),
            isFocusedTarget: isFocusedTarget,
            selectedRange: selectedNSRange(from: axRangeAttribute(kAXSelectedTextRangeAttribute as CFString, for: writableElement)),
            failureReason: nil,
            textSource: "ax-value"
        )
        if logDiagnostics {
            VoxtLog.input("Focused input snapshot ready: \(focusedInputSnapshotSummary(snapshot))")
        }
        return snapshot
    }

    func currentFocusedInputTextSnapshotForAutomaticDictionaryLearning(
        expectedBundleID: String? = nil,
        expectedProcessIdentifier: pid_t? = nil
    ) async -> FocusedInputTextSnapshot? {
        let startedAt = Date()
        defer {
            let elapsed = Date().timeIntervalSince(startedAt)
            if elapsed >= 0.5 {
                let bundleID = NSWorkspace.shared.frontmostApplication?.bundleIdentifier ?? "unknown"
                VoxtLog.input(
                    "Automatic dictionary focused input snapshot was slow. elapsedMs=\(Int(elapsed * 1000)), bundleID=\(bundleID), expectedBundleID=\(expectedBundleID ?? "nil")"
                )
            }
        }

        guard let frontmostApplication = NSWorkspace.shared.frontmostApplication else {
            return nil
        }
        if let expectedBundleID,
           let bundleIdentifier = frontmostApplication.bundleIdentifier,
           bundleIdentifier != expectedBundleID {
            return nil
        }
        if let expectedProcessIdentifier,
           frontmostApplication.processIdentifier != expectedProcessIdentifier {
            return nil
        }

        let bundleIdentifier = frontmostApplication.bundleIdentifier
        let processIdentifier = expectedProcessIdentifier ?? frontmostApplication.processIdentifier
        return await FocusedInputLearningAXSupport.snapshot(
            bundleIdentifier: bundleIdentifier,
            processIdentifier: processIdentifier
        )
    }

    private func focusedInputSnippetSnapshot(
        for writableElement: AXUIElement,
        bundleIdentifier: String?,
        processIdentifier: pid_t
    ) -> FocusedInputTextSnapshot? {
        guard axParameterizedAttributeNames(for: writableElement)
            .contains(kAXStringForRangeParameterizedAttribute as String) else {
            return nil
        }

        let role = axStringAttribute(kAXRoleAttribute as CFString, for: writableElement)
        let isFocusedTarget = axBoolAttribute(kAXFocusedAttribute as CFString, for: writableElement) == true
        let selectedRange = axRangeAttribute(kAXSelectedTextRangeAttribute as CFString, for: writableElement)
        let sourceRange: CFRange?
        if let selectedRange,
           selectedRange.location >= 0,
           let numberOfCharacters = axIntAttribute("AXNumberOfCharacters" as CFString, for: writableElement),
           numberOfCharacters > 0 {
            sourceRange = automaticDictionaryLearningSnippetRange(
                selectedRange: selectedRange,
                numberOfCharacters: numberOfCharacters
            )
        } else if let visibleRange = axRangeAttribute(kAXVisibleCharacterRangeAttribute as CFString, for: writableElement),
                  visibleRange.location >= 0,
                  visibleRange.length > 0 {
            sourceRange = visibleRange
        } else {
            sourceRange = nil
        }

        guard let sourceRange,
              sourceRange.length > 0,
              let text = axParameterizedString(
                kAXStringForRangeParameterizedAttribute as CFString,
                range: sourceRange,
                for: writableElement
              ),
              !text.isEmpty else {
            return nil
        }

        return FocusedInputTextSnapshot(
            text: text,
            bundleIdentifier: bundleIdentifier,
            processIdentifier: processIdentifier,
            role: role,
            isEditable: isWritableTextInputElement(writableElement),
            isFocusedTarget: isFocusedTarget,
            selectedRange: selectedNSRange(from: selectedRange),
            failureReason: nil,
            textSource: "ax-focused-range"
        )
    }

    private func automaticDictionaryLearningSnippetRange(
        selectedRange: CFRange,
        numberOfCharacters: Int
    ) -> CFRange {
        let selectedLocation = min(max(selectedRange.location, 0), numberOfCharacters)
        let selectedLength = max(selectedRange.length, 0)
        let before = min(Self.automaticDictionaryLearningSnippetBeforeCursor, selectedLocation)
        let start = max(selectedLocation - before, 0)
        let requestedLength = before + selectedLength + Self.automaticDictionaryLearningSnippetAfterCursor
        let availableLength = max(numberOfCharacters - start, 0)
        return CFRange(location: start, length: min(requestedLength, availableLength))
    }

    private func focusedAXElement(
        preferredProcessID: pid_t,
        logDiagnostics: Bool = true
    ) -> AXUIElement? {
        guard AccessibilityPermissionManager.isTrusted() else {
            if logDiagnostics {
                VoxtLog.input("Focused input check: accessibility not trusted.")
            }
            return nil
        }

        if let appFocusedElement = focusedAXElement(for: preferredProcessID, logDiagnostics: logDiagnostics) {
            return appFocusedElement
        }

        let bundleID = NSWorkspace.shared.frontmostApplication?.bundleIdentifier ?? "unknown"
        if let systemFocusedElement = systemFocusedAXElement(logDiagnostics: logDiagnostics) {
            if logDiagnostics {
                VoxtLog.input("Focused input check: falling back to system-wide focused element. bundleID=\(bundleID)")
            }
            return systemFocusedElement
        }

        if logDiagnostics {
            VoxtLog.input("Focused input check: app/system focus resolution failed. bundleID=\(bundleID)")
        }
        return nil
    }

    private func systemFocusedAXElement(logDiagnostics: Bool = true) -> AXUIElement? {
        let systemWide = AXUIElementCreateSystemWide()
        AXUIElementSetMessagingTimeout(systemWide, Self.axMessagingTimeout)
        var focusedElementRef: CFTypeRef?
        let focusedStatus = AXUIElementCopyAttributeValue(
            systemWide,
            kAXFocusedUIElementAttribute as CFString,
            &focusedElementRef
        )
        guard focusedStatus == .success,
              let focusedElementRef,
              CFGetTypeID(focusedElementRef) == AXUIElementGetTypeID() else {
            let bundleID = NSWorkspace.shared.frontmostApplication?.bundleIdentifier ?? "unknown"
            if logDiagnostics {
                VoxtLog.input(
                    "Focused input check: system-wide focused element unavailable. status=\(focusedStatus.rawValue), bundleID=\(bundleID)"
                )
            }
            return nil
        }
        let focusedElement = unsafeBitCast(focusedElementRef, to: AXUIElement.self)
        return resolveFocusedElement(focusedElement)
    }

    private func focusedAXElement(
        for processID: pid_t,
        logDiagnostics: Bool = true
    ) -> AXUIElement? {
        let bundleID = NSWorkspace.shared.frontmostApplication?.bundleIdentifier ?? "unknown"
        let appElement = AXUIElementCreateApplication(processID)
        AXUIElementSetMessagingTimeout(appElement, Self.axMessagingTimeout)
        if let focusedAppElement = axElementAttribute(kAXFocusedUIElementAttribute as CFString, for: appElement),
           let resolved = resolveFocusedElement(focusedAppElement) {
            if logDiagnostics {
                VoxtLog.input(
                    "Focused input check: using frontmost app focused element. bundleID=\(bundleID), role=\(axStringAttribute(kAXRoleAttribute as CFString, for: resolved) ?? "unknown")"
                )
            }
            return resolved
        }

        guard let focusedWindow = axElementAttribute(kAXFocusedWindowAttribute as CFString, for: appElement) else {
            if logDiagnostics {
                VoxtLog.input("Focused input check: no focused window on frontmost app. bundleID=\(bundleID)")
            }
            return nil
        }

        if let focusedWindowElement = axElementAttribute(kAXFocusedUIElementAttribute as CFString, for: focusedWindow),
           let resolved = resolveFocusedElement(focusedWindowElement) {
            if logDiagnostics {
                VoxtLog.input(
                    "Focused input check: using focused window focused element. bundleID=\(bundleID), role=\(axStringAttribute(kAXRoleAttribute as CFString, for: resolved) ?? "unknown")"
                )
            }
            return resolved
        }

        if let focusedDescendant = findFocusedDescendant(in: focusedWindow, depthRemaining: 8),
           let resolved = resolveFocusedElement(focusedDescendant) {
            if logDiagnostics {
                VoxtLog.input(
                    "Focused input check: resolved focused descendant from window subtree. bundleID=\(bundleID), role=\(axStringAttribute(kAXRoleAttribute as CFString, for: resolved) ?? "unknown")"
                )
            }
            return resolved
        }

        if let bestEditableDescendant = findBestWritableTextDescendant(in: focusedWindow, depthRemaining: 8) {
            if logDiagnostics {
                VoxtLog.input(
                    "Focused input check: using best editable descendant from focused window. bundleID=\(bundleID), role=\(axStringAttribute(kAXRoleAttribute as CFString, for: bestEditableDescendant) ?? "unknown")"
                )
            }
            return bestEditableDescendant
        }

        if logDiagnostics {
            VoxtLog.input("Focused input check: falling back to focused window element. bundleID=\(bundleID)")
        }
        return resolveFocusedElement(focusedWindow)
    }

    private func axBoolAttribute(_ attribute: CFString, for element: AXUIElement) -> Bool? {
        AXUIElementSetMessagingTimeout(element, Self.axMessagingTimeout)
        var valueRef: CFTypeRef?
        let status = AXUIElementCopyAttributeValue(element, attribute, &valueRef)
        guard status == .success, let valueRef else { return nil }
        if let boolValue = valueRef as? Bool {
            return boolValue
        }
        if let numberValue = valueRef as? NSNumber {
            return numberValue.boolValue
        }
        return nil
    }

    func axStringAttribute(_ attribute: CFString, for element: AXUIElement) -> String? {
        axStringAttribute(attribute, for: element, timeout: Self.axMessagingTimeout)
    }

    func axStringAttribute(
        _ attribute: CFString,
        for element: AXUIElement,
        timeout: Float
    ) -> String? {
        AXUIElementSetMessagingTimeout(element, timeout)
        var valueRef: CFTypeRef?
        let status = AXUIElementCopyAttributeValue(element, attribute, &valueRef)
        guard status == .success else { return nil }
        return valueRef as? String
    }

    private func isAttributeSettable(_ attribute: CFString, on element: AXUIElement) -> Bool {
        var settable = DarwinBoolean(false)
        let status = AXUIElementIsAttributeSettable(element, attribute, &settable)
        return status == .success && settable.boolValue
    }

    private func axIntAttribute(_ attribute: CFString, for element: AXUIElement) -> Int? {
        AXUIElementSetMessagingTimeout(element, Self.axMessagingTimeout)
        var valueRef: CFTypeRef?
        let status = AXUIElementCopyAttributeValue(element, attribute, &valueRef)
        guard status == .success, let valueRef else { return nil }
        if let number = valueRef as? NSNumber {
            return number.intValue
        }
        return nil
    }

    func axRangeAttribute(_ attribute: CFString, for element: AXUIElement) -> CFRange? {
        axRangeAttribute(attribute, for: element, timeout: Self.axMessagingTimeout)
    }

    func axRangeAttribute(
        _ attribute: CFString,
        for element: AXUIElement,
        timeout: Float
    ) -> CFRange? {
        AXUIElementSetMessagingTimeout(element, timeout)
        var valueRef: CFTypeRef?
        let status = AXUIElementCopyAttributeValue(element, attribute, &valueRef)
        guard status == .success,
              let valueRef,
              CFGetTypeID(valueRef) == AXValueGetTypeID() else {
            return nil
        }
        let axValue = unsafeBitCast(valueRef, to: AXValue.self)
        guard AXValueGetType(axValue) == .cfRange else { return nil }
        var range = CFRange()
        guard AXValueGetValue(axValue, .cfRange, &range) else { return nil }
        return range
    }

    private func setAXRangeAttribute(
        _ attribute: CFString,
        range: CFRange,
        for element: AXUIElement
    ) -> Bool {
        var mutableRange = range
        guard let rangeValue = AXValueCreate(.cfRange, &mutableRange) else {
            return false
        }
        AXUIElementSetMessagingTimeout(element, Self.axMessagingTimeout)
        let status = AXUIElementSetAttributeValue(element, attribute, rangeValue)
        return status == .success
    }

    private func hasSelectedTextRange(_ element: AXUIElement) -> Bool {
        axRangeAttribute(kAXSelectedTextRangeAttribute as CFString, for: element) != nil
    }

    func axParameterizedString(
        _ attribute: CFString,
        range: CFRange,
        for element: AXUIElement
    ) -> String? {
        axParameterizedString(attribute, range: range, for: element, timeout: Self.axMessagingTimeout)
    }

    func axParameterizedString(
        _ attribute: CFString,
        range: CFRange,
        for element: AXUIElement,
        timeout: Float
    ) -> String? {
        var mutableRange = range
        guard let rangeValue = AXValueCreate(.cfRange, &mutableRange) else {
            return nil
        }
        AXUIElementSetMessagingTimeout(element, timeout)
        var valueRef: CFTypeRef?
        let status = AXUIElementCopyParameterizedAttributeValue(
            element,
            attribute,
            rangeValue,
            &valueRef
        )
        guard status == .success, let valueRef else { return nil }
        if let text = valueRef as? String {
            return normalizedAXTextValue(text, for: element)
        }
        if let text = valueRef as? NSAttributedString {
            return normalizedAXTextValue(text.string, for: element)
        }
        return nil
    }

    private func axParameterizedAttributeNames(for element: AXUIElement) -> [String] {
        AXUIElementSetMessagingTimeout(element, Self.axMessagingTimeout)
        var valueRef: CFArray?
        let status = AXUIElementCopyParameterizedAttributeNames(element, &valueRef)
        guard status == .success, let names = valueRef as? [String] else { return [] }
        return names
    }

    private func axTextValue(for element: AXUIElement) -> String? {
        AXUIElementSetMessagingTimeout(element, Self.axMessagingTimeout)
        var valueRef: CFTypeRef?
        _ = AXUIElementCopyAttributeValue(
            element,
            kAXValueAttribute as CFString,
            &valueRef
        )

        if let stringValue = valueRef as? String,
           let normalizedStringValue = normalizedAXTextValue(stringValue, for: element) {
            return normalizedStringValue
        }
        if let attributedValue = valueRef as? NSAttributedString,
           let normalizedAttributedValue = normalizedAXTextValue(attributedValue.string, for: element) {
            return normalizedAttributedValue
        }

        if let selectedText = axStringAttribute(kAXSelectedTextAttribute as CFString, for: element),
           let normalizedSelectedText = normalizedAXTextValue(selectedText, for: element) {
            VoxtLog.input(
                "Focused input snapshot: resolved text via selected text attribute. role=\(axStringAttribute(kAXRoleAttribute as CFString, for: element) ?? "unknown"), length=\(normalizedSelectedText.count)"
            )
            return normalizedSelectedText
        }

        if let visibleRange = axRangeAttribute(kAXVisibleCharacterRangeAttribute as CFString, for: element),
           visibleRange.length > 0,
           let visibleText = axParameterizedString(
               kAXStringForRangeParameterizedAttribute as CFString,
               range: visibleRange,
               for: element
           ) {
            VoxtLog.input(
                "Focused input snapshot: resolved text via visible character range. role=\(axStringAttribute(kAXRoleAttribute as CFString, for: element) ?? "unknown"), length=\(visibleText.count)"
            )
            return visibleText
        }

        if let numberOfCharacters = axIntAttribute("AXNumberOfCharacters" as CFString, for: element),
           numberOfCharacters > 0 {
            let fullRange = CFRange(location: 0, length: numberOfCharacters)
            if let fullText = axParameterizedString(
                kAXStringForRangeParameterizedAttribute as CFString,
                range: fullRange,
                for: element
            ) {
                VoxtLog.input(
                    "Focused input snapshot: resolved text via full character range. role=\(axStringAttribute(kAXRoleAttribute as CFString, for: element) ?? "unknown"), length=\(fullText.count)"
                )
                return fullText
            }
        }
        return nil
    }

    func axElementAttribute(_ attribute: CFString, for element: AXUIElement) -> AXUIElement? {
        axElementAttribute(attribute, for: element, timeout: Self.axMessagingTimeout)
    }

    func axElementAttribute(
        _ attribute: CFString,
        for element: AXUIElement,
        timeout: Float
    ) -> AXUIElement? {
        AXUIElementSetMessagingTimeout(element, timeout)
        var valueRef: CFTypeRef?
        let status = AXUIElementCopyAttributeValue(element, attribute, &valueRef)
        guard status == .success,
              let valueRef,
              CFGetTypeID(valueRef) == AXUIElementGetTypeID()
        else {
            return nil
        }
        return unsafeBitCast(valueRef, to: AXUIElement.self)
    }

    func axElementArrayAttribute(_ attribute: CFString, for element: AXUIElement) -> [AXUIElement] {
        axElementArrayAttribute(attribute, for: element, timeout: Self.axMessagingTimeout)
    }

    func axElementArrayAttribute(
        _ attribute: CFString,
        for element: AXUIElement,
        timeout: Float
    ) -> [AXUIElement] {
        AXUIElementSetMessagingTimeout(element, timeout)
        var valueRef: CFTypeRef?
        let status = AXUIElementCopyAttributeValue(element, attribute, &valueRef)
        guard status == .success,
              let valueRef,
              let array = valueRef as? [Any]
        else {
            return []
        }

        return array.compactMap { item in
            let cfItem = item as AnyObject
            guard CFGetTypeID(cfItem) == AXUIElementGetTypeID() else { return nil }
            return unsafeBitCast(cfItem, to: AXUIElement.self)
        }
    }

    private func writableTextInputElement(from element: AXUIElement, depth: Int = 0) -> AXUIElement? {
        guard depth <= 8 else { return nil }

        if isWritableTextInputElement(element) {
            return element
        }

        if let focusedChild = axElementAttribute(kAXFocusedUIElementAttribute as CFString, for: element),
           let writableFocusedChild = writableTextInputElement(from: focusedChild, depth: depth + 1) {
            return writableFocusedChild
        }

        for child in axElementArrayAttribute(kAXChildrenAttribute as CFString, for: element) {
            if let writableChild = writableTextInputElement(from: child, depth: depth + 1) {
                return writableChild
            }
        }

        return nil
    }

    private func isWritableTextInputElement(_ element: AXUIElement) -> Bool {
        let role = axStringAttribute(kAXRoleAttribute as CFString, for: element)

        if let role, Self.nonEditableFalsePositiveRoles.contains(role) {
            return false
        }
        if axBoolAttribute("AXEditable" as CFString, for: element) == true {
            return true
        }
        if Self.nativeWritableTextRoles.contains(role ?? "") {
            return true
        }
        let hasSettableTextAttributes =
            isAttributeSettable(kAXSelectedTextRangeAttribute as CFString, on: element)
            || isAttributeSettable(kAXSelectedTextAttribute as CFString, on: element)
            || isAttributeSettable(kAXValueAttribute as CFString, on: element)
        let hasSelectedRange = hasSelectedTextRange(element)

        if Self.genericEditableTextRoles.contains(role ?? "") {
            return hasSelectedRange || hasSettableTextAttributes
        }

        return hasSelectedRange && hasSettableTextAttributes
    }

    private func resolveFocusedElement(_ element: AXUIElement, depthRemaining: Int = 8) -> AXUIElement? {
        guard depthRemaining >= 0 else { return nil }

        if isWritableTextInputElement(element) {
            return element
        }

        if let nestedFocused = axElementAttribute(kAXFocusedUIElementAttribute as CFString, for: element),
           let resolvedNestedFocused = resolveFocusedElement(nestedFocused, depthRemaining: depthRemaining - 1) {
            return resolvedNestedFocused
        }

        if let focusedDescendant = findFocusedDescendant(in: element, depthRemaining: depthRemaining - 1),
           let resolvedDescendant = resolveFocusedElement(focusedDescendant, depthRemaining: depthRemaining - 1) {
            return resolvedDescendant
        }

        if let bestEditableDescendant = findBestWritableTextDescendant(in: element, depthRemaining: depthRemaining - 1) {
            return bestEditableDescendant
        }

        return element
    }

    func findFocusedDescendant(in element: AXUIElement, depthRemaining: Int) -> AXUIElement? {
        guard depthRemaining >= 0 else { return nil }

        if axBoolAttribute(kAXFocusedAttribute as CFString, for: element) == true {
            return element
        }

        for child in axElementArrayAttribute(kAXChildrenAttribute as CFString, for: element) {
            if let nested = findFocusedDescendant(in: child, depthRemaining: depthRemaining - 1) {
                return nested
            }
        }

        return nil
    }

    private func findBestWritableTextDescendant(in element: AXUIElement, depthRemaining: Int) -> AXUIElement? {
        guard depthRemaining >= 0 else { return nil }

        let children = axElementArrayAttribute(kAXChildrenAttribute as CFString, for: element)
        var bestElement: AXUIElement?
        var bestScore = 0

        for child in children {
            let score = writableCandidateScore(for: child)
            if score > bestScore {
                bestScore = score
                bestElement = child
            }

            if let nested = findBestWritableTextDescendant(in: child, depthRemaining: depthRemaining - 1) {
                let nestedScore = writableCandidateScore(for: nested)
                if nestedScore > bestScore {
                    bestScore = nestedScore
                    bestElement = nested
                }
            }
        }

        return bestElement
    }

    private func writableCandidateScore(for element: AXUIElement) -> Int {
        var score = 0
        let role = axStringAttribute(kAXRoleAttribute as CFString, for: element)
        if axBoolAttribute("AXEditable" as CFString, for: element) == true {
            score += 6
        }
        if axBoolAttribute(kAXFocusedAttribute as CFString, for: element) == true {
            score += 4
        }
        if hasSelectedTextRange(element) {
            score += 3
        }
        if isAttributeSettable(kAXSelectedTextRangeAttribute as CFString, on: element) {
            score += 3
        }
        if isAttributeSettable(kAXSelectedTextAttribute as CFString, on: element) {
            score += 3
        }
        if isAttributeSettable(kAXValueAttribute as CFString, on: element) {
            score += 2
        }
        if Self.nativeWritableTextRoles.contains(role ?? "") {
            score += 5
        } else if Self.genericEditableTextRoles.contains(role ?? "") {
            score += 2
        }
        if Self.nonEditableFalsePositiveRoles.contains(role ?? "") {
            score = 0
        }
        return score
    }

    private func normalizedAXTextValue(_ rawValue: String, for element: AXUIElement) -> String? {
        let trimmed = rawValue.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return nil }
        if let placeholder = axStringAttribute(kAXPlaceholderValueAttribute as CFString, for: element),
           placeholder.trimmingCharacters(in: .whitespacesAndNewlines) == trimmed {
            return nil
        }
        if let title = axStringAttribute(kAXTitleAttribute as CFString, for: element),
           title.trimmingCharacters(in: .whitespacesAndNewlines) == trimmed {
            return nil
        }
        return trimmed
    }

    private func unreadableTextFailureReason(for element: AXUIElement) -> String {
        let selectedRange = axRangeAttribute(kAXSelectedTextRangeAttribute as CFString, for: element)
        let visibleRange = axRangeAttribute(kAXVisibleCharacterRangeAttribute as CFString, for: element)
        let numberOfCharacters = axIntAttribute("AXNumberOfCharacters" as CFString, for: element) ?? -1
        let hasStringForRange = axParameterizedAttributeNames(for: element)
            .contains(kAXStringForRangeParameterizedAttribute as String)
        let diagnostics =
            "numChars=\(numberOfCharacters), selectedRange=\(selectedRange.map { "{\($0.location),\($0.length)}" } ?? "nil"), visibleRange=\(visibleRange.map { "{\($0.location),\($0.length)}" } ?? "nil"), hasStringForRange=\(hasStringForRange)"
        if let placeholder = axStringAttribute(kAXPlaceholderValueAttribute as CFString, for: element),
           let value = axStringAttribute(kAXValueAttribute as CFString, for: element),
           placeholder.trimmingCharacters(in: .whitespacesAndNewlines)
                == value.trimmingCharacters(in: .whitespacesAndNewlines) {
            return "value-matched-placeholder, \(diagnostics)"
        }
        if let title = axStringAttribute(kAXTitleAttribute as CFString, for: element),
           let value = axStringAttribute(kAXValueAttribute as CFString, for: element),
           title.trimmingCharacters(in: .whitespacesAndNewlines)
                == value.trimmingCharacters(in: .whitespacesAndNewlines) {
            return "value-matched-title, \(diagnostics)"
        }
        if !isAttributeSettable(kAXValueAttribute as CFString, on: element) {
            return "ax-value-not-settable, \(diagnostics)"
        }
        return "missing-ax-value, \(diagnostics)"
    }

    private func selectedNSRange(from range: CFRange?) -> NSRange? {
        guard let range, range.location >= 0, range.length >= 0 else { return nil }
        return NSRange(location: range.location, length: range.length)
    }

    private func focusedInputSnapshotSummary(_ snapshot: FocusedInputTextSnapshot) -> String {
        let preview = String(snapshot.text.prefix(80))
        let selectedRangeDescription = snapshot.selectedRange.map {
            "{\($0.location),\($0.length)}"
        } ?? "nil"
        return
            "bundleID=\(snapshot.bundleIdentifier ?? "nil") pid=\(snapshot.processIdentifier.map(String.init) ?? "nil") "
                + "role=\(snapshot.role ?? "nil") editable=\(snapshot.isEditable) "
                + "focused=\(snapshot.isFocusedTarget) selectedRange=\(selectedRangeDescription) textLength=\(snapshot.text.count) "
                + "textSource=\(snapshot.textSource ?? "nil") preview=\(preview)"
    }

    @discardableResult
    private func restoreSessionTargetApplicationIfNeeded() -> Bool {
        guard let ownBundleID = Bundle.main.bundleIdentifier else { return false }
        let frontmostApplication = NSWorkspace.shared.frontmostApplication
        let frontmostBundleID = frontmostApplication?.bundleIdentifier
        let frontmostPID = frontmostApplication?.processIdentifier
        let ownPID = ProcessInfo.processInfo.processIdentifier

        guard frontmostPID == ownPID || frontmostBundleID == ownBundleID else {
            return false
        }

        if let targetPID = sessionTargetApplicationPID,
           let targetApplication = NSRunningApplication(processIdentifier: targetPID),
           !targetApplication.isTerminated {
            VoxtLog.input(
                "Restoring focus to session target app before text injection. bundleID=\(targetApplication.bundleIdentifier ?? "unknown"), pid=\(targetPID)"
            )
            return targetApplication.activate(options: [])
        }

        if let targetBundleID = sessionTargetApplicationBundleID,
           let targetApplication = NSRunningApplication.runningApplications(withBundleIdentifier: targetBundleID)
            .first(where: { !$0.isTerminated }) {
            VoxtLog.input(
                "Restoring focus to session target app by bundle ID before text injection. bundleID=\(targetBundleID), pid=\(targetApplication.processIdentifier)"
            )
            return targetApplication.activate(options: [])
        }

        VoxtLog.input(
            "Session target app restoration skipped: target app unavailable. targetBundleID=\(sessionTargetApplicationBundleID ?? "nil"), targetPID=\(sessionTargetApplicationPID.map(String.init) ?? "nil")"
        )
        return false
    }

    func typeText(
        _ text: String,
        restoreSessionTarget: Bool = true,
        completion: ((Bool) -> Void)? = nil
    ) {
        guard !text.isEmpty else {
            completion?(false)
            return
        }

        let injectionStartedAt = Date()
        let pasteboard = NSPasteboard.general
        let previous = readStringFromPasteboard(pasteboard) ?? ""
        let accessibilityTrusted = AccessibilityPermissionManager.isTrusted()
        let keepResultInClipboard = autoCopyWhenNoFocusedInput

        guard accessibilityTrusted else {
            writeTextToPasteboard(text)
            promptForAccessibilityPermission()
            VoxtLog.inputWarning("Accessibility permission missing. Transcription copied; paste manually after granting permission.")
            completion?(false)
            return
        }

        let activationRestored = restoreSessionTarget ? restoreSessionTargetApplicationIfNeeded() : false
        let activationDelay: TimeInterval = activationRestored ? 0.04 : 0
        VoxtLog.input(
            "Text injection prepared. characters=\(text.count), activationRestored=\(activationRestored), restoreSessionTarget=\(restoreSessionTarget), activationDelayMs=\(Int(activationDelay * 1000))",
            verbose: true
        )
        DispatchQueue.main.asyncAfter(deadline: .now() + activationDelay) { [weak self] in
            guard let self else {
                completion?(false)
                return
            }

            self.pasteTextByShortcut(
                text,
                previousClipboardValue: previous,
                keepResultInClipboard: keepResultInClipboard,
                completion: { didInject in
                    let elapsedMs = Int(Date().timeIntervalSince(injectionStartedAt) * 1000)
                    VoxtLog.input(
                        "Text injection completed via paste fallback. characters=\(text.count), elapsedMs=\(elapsedMs), didInject=\(didInject)"
                    )
                    completion?(didInject)
                }
            )
        }
    }

    func pressAutoKeyAfterTextInjection(
        _ hotkey: HotkeyPreference.Hotkey,
        delay: TimeInterval = 0.12
    ) {
        DispatchQueue.main.asyncAfter(deadline: .now() + delay) {
            guard AccessibilityPermissionManager.isTrusted() else {
                VoxtLog.inputWarning("Auto Key skipped: accessibility permission missing.")
                return
            }
            guard let source = CGEventSource(stateID: .hidSystemState) else {
                VoxtLog.error("Auto Key failed: unable to create CGEventSource")
                return
            }
            guard case .keyboard(let keyCode) = hotkey.input,
                  keyCode != HotkeyPreference.modifierOnlyKeyCode
            else {
                VoxtLog.inputWarning("Auto Key skipped: unsupported shortcut input.")
                return
            }

            let cgKeyCode = CGKeyCode(keyCode)
            let flags = Self.cgEventFlags(for: hotkey.modifiers)
            let keyDown = CGEvent(keyboardEventSource: source, virtualKey: cgKeyCode, keyDown: true)
            let keyUp = CGEvent(keyboardEventSource: source, virtualKey: cgKeyCode, keyDown: false)

            guard let keyDown, let keyUp else {
                VoxtLog.error("Auto Key failed: unable to create key events")
                return
            }

            keyDown.flags = flags
            keyUp.flags = flags
            HotkeyEventSupport.markAsVoxtInjected(keyDown)
            HotkeyEventSupport.markAsVoxtInjected(keyUp)
            keyDown.post(tap: .cgAnnotatedSessionEventTap)
            keyUp.post(tap: .cgAnnotatedSessionEventTap)
            VoxtLog.input(
                "Auto Key event posted after text injection. hotkey=\(HotkeyPreference.displayString(for: hotkey, distinguishModifierSides: false))",
                verbose: true
            )
        }
    }

    private static func cgEventFlags(for modifiers: NSEvent.ModifierFlags) -> CGEventFlags {
        var flags: CGEventFlags = []
        if modifiers.contains(.control) {
            flags.insert(.maskControl)
        }
        if modifiers.contains(.option) {
            flags.insert(.maskAlternate)
        }
        if modifiers.contains(.shift) {
            flags.insert(.maskShift)
        }
        if modifiers.contains(.command) {
            flags.insert(.maskCommand)
        }
        if modifiers.contains(.function) {
            flags.insert(.maskSecondaryFn)
        }
        return flags
    }

    func beginOverlayOutputDelivery() {
        overlayState.isRequesting = true
        overlayState.isCompleting = false
        if overlayState.displayMode != .answer {
            overlayState.displayMode = .processing
        }
    }

    func endOverlayOutputDelivery() {
        overlayState.isRequesting = false
    }

    func writeTextToPasteboard(_ text: String) {
        let pasteboard = NSPasteboard.general
        pasteboard.clearContents()
        pasteboard.setString(text, forType: .string)
    }

    func cacheLatestInjectableOutputText(_ text: String) {
        let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return }
        latestInjectableOutputText = trimmed
    }

    private func resolvedLatestInjectableOutputText() -> String? {
        let cached = latestInjectableOutputText?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        if !cached.isEmpty {
            return cached
        }

        let historyText = historyStore.latestEntryText()?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        return historyText.isEmpty ? nil : historyText
    }

    func injectLatestResultByCustomPasteHotkey() {
        guard let latestText = resolvedLatestInjectableOutputText() else {
            showOverlayStatus(AppLocalization.localizedString("No recent result available to paste yet."), clearAfter: 2.0)
            return
        }

        typeText(latestText)
    }

    private func pasteTextByShortcut(
        _ text: String,
        previousClipboardValue: String,
        keepResultInClipboard: Bool,
        completion: ((Bool) -> Void)?
    ) {
        writeTextToPasteboard(text)

        guard let source = CGEventSource(stateID: .hidSystemState) else {
            VoxtLog.error("typeText fallback failed: unable to create CGEventSource")
            completion?(false)
            return
        }

        let vKeyCode: CGKeyCode = 0x09
        let cmdDown = CGEvent(keyboardEventSource: source, virtualKey: vKeyCode, keyDown: true)
        cmdDown?.flags = .maskCommand
        let cmdUp = CGEvent(keyboardEventSource: source, virtualKey: vKeyCode, keyDown: false)
        cmdUp?.flags = .maskCommand

        guard cmdDown != nil, cmdUp != nil else {
            VoxtLog.error("typeText fallback failed: unable to create key events")
            completion?(false)
            return
        }

        HotkeyEventSupport.markAsVoxtInjected(cmdDown)
        HotkeyEventSupport.markAsVoxtInjected(cmdUp)
        cmdDown?.post(tap: .cgAnnotatedSessionEventTap)
        cmdUp?.post(tap: .cgAnnotatedSessionEventTap)
        completion?(true)

        guard !keepResultInClipboard else { return }
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.8) {
            let pasteboard = NSPasteboard.general
            pasteboard.clearContents()
            if !previousClipboardValue.isEmpty {
                pasteboard.setString(previousClipboardValue, forType: .string)
            }
        }
    }

    private func promptForAccessibilityPermission() {
        _ = AccessibilityPermissionManager.request(prompt: true)
    }

    func makePendingOutputReplacementTransaction(
        previewText: String,
        sessionID: UUID,
        expectedBundleID: String?
    ) -> PendingOutputReplacementTransaction? {
        let normalizedPreview = previewText.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !normalizedPreview.isEmpty else { return nil }
        guard let snapshot = currentFocusedInputTextSnapshot(
            expectedBundleID: expectedBundleID,
            logDiagnostics: false
        ) else {
            return nil
        }
        guard let selectedRange = snapshot.selectedRange else {
            VoxtLog.input("Preview replacement transaction skipped: selected range unavailable.")
            return nil
        }

        let baselineNSString = snapshot.text as NSString
        guard selectedRange.location >= 0,
              NSMaxRange(selectedRange) <= baselineNSString.length else {
            VoxtLog.input("Preview replacement transaction skipped: selected range exceeded baseline text.")
            return nil
        }

        let prefix = baselineNSString.substring(to: selectedRange.location)
        let suffix = baselineNSString.substring(from: NSMaxRange(selectedRange))
        let expectedTextAfterPreview = prefix + normalizedPreview + suffix
        let previewLength = (normalizedPreview as NSString).length

        return PendingOutputReplacementTransaction(
            sessionID: sessionID,
            bundleIdentifier: snapshot.bundleIdentifier ?? expectedBundleID,
            baselineText: snapshot.text,
            expectedTextAfterPreview: expectedTextAfterPreview,
            previewText: normalizedPreview,
            replacementRange: NSRange(location: selectedRange.location, length: previewLength)
        )
    }

    func performPendingOutputReplacement(
        _ transaction: PendingOutputReplacementTransaction,
        replacementText: String
    ) async -> Bool {
        let trimmedReplacement = replacementText.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmedReplacement.isEmpty else {
            VoxtLog.input("Pending output replacement skipped: replacement text was empty.")
            return false
        }

        guard let snapshot = currentFocusedInputTextSnapshot(
            expectedBundleID: transaction.bundleIdentifier,
            logDiagnostics: false
        ) else {
            VoxtLog.input("Pending output replacement skipped: focused input snapshot unavailable.")
            return false
        }

        guard snapshot.text == transaction.expectedTextAfterPreview else {
            VoxtLog.input(
                "Pending output replacement skipped: focused input changed after preview injection. baselineChars=\(transaction.baselineText.count), expectedChars=\(transaction.expectedTextAfterPreview.count), currentChars=\(snapshot.text.count)"
            )
            return false
        }

        guard let processIdentifier = snapshot.processIdentifier,
              let focusedElement = focusedAXElement(preferredProcessID: processIdentifier, logDiagnostics: false)
        else {
            VoxtLog.input("Pending output replacement skipped: focused AX element unavailable.")
            return false
        }

        let writableElement = writableTextInputElement(from: focusedElement) ?? (
            isWritableTextInputElement(focusedElement) ? focusedElement : nil
        )
        guard let writableElement else {
            VoxtLog.input("Pending output replacement skipped: writable AX element unavailable.")
            return false
        }

        let replacementCFRange = CFRange(
            location: transaction.replacementRange.location,
            length: transaction.replacementRange.length
        )
        guard setAXRangeAttribute(
            kAXSelectedTextRangeAttribute as CFString,
            range: replacementCFRange,
            for: writableElement
        ) else {
            VoxtLog.input("Pending output replacement skipped: unable to set selected text range.")
            return false
        }

        let didInject = await typeTextAsync(trimmedReplacement)
        if didInject {
            sessionOutputDestinationContext = captureCurrentOutputDestinationContext()
            VoxtLog.input(
                "Pending output replacement succeeded. previewChars=\(transaction.previewText.count), replacementChars=\(trimmedReplacement.count)"
            )
        }
        return didInject
    }

    private func typeTextAsync(_ text: String) async -> Bool {
        await withCheckedContinuation { continuation in
            typeText(text) { didInject in
                continuation.resume(returning: didInject)
            }
        }
    }
}
