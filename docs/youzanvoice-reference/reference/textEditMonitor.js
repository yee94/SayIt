const { spawn, execFile } = require("child_process");
const path = require("path");
const EventEmitter = require("events");
const fs = require("fs");
const debugLogger = require("./debugLogger");

const POLL_INTERVAL_MS = 500;
const INITIAL_QUERY_DELAY_MS = 500; // Wait for paste to settle in target app
const INITIAL_QUERY_RETRIES = 4; // Retry if AXValue is empty (paste not yet processed)
const INITIAL_QUERY_RETRY_DELAY_MS = 300;

// AppleScript to enable AXEnhancedUserInterface on the target app.
// Chromium-based apps (Chrome, Electron, VS Code, Slack, etc.) don't build their
// accessibility tree until an assistive technology announces itself via this attribute.
// This is the same technique Grammarly uses on macOS.
const MACOS_AX_ENABLE_SCRIPT = (pid) =>
  `tell application "System Events"\n` +
  `\tset targetProc to first application process whose unix id is ${pid}\n` +
  `\ttry\n` +
  `\t\tset value of attribute "AXEnhancedUserInterface" of targetProc to true\n` +
  `\tend try\n` +
  `end tell`;

// AppleScript to read the focused text field value from a specific app by PID.
// Using PID avoids the problem where the Electron overlay is "frontmost".
// Tries AXValue first, then falls back to AXStringForRange for apps that
// implement parameterized text attributes but not AXValue directly.
const MACOS_AX_SCRIPT_BY_PID = (pid) =>
  `tell application "System Events"\n` +
  `\tset targetProc to first application process whose unix id is ${pid}\n` +
  `\tset focAttr to value of attribute "AXFocusedUIElement" of targetProc\n` +
  `\tif focAttr is missing value then return ""\n` +
  `\ttry\n` +
  `\t\tset val to value of attribute "AXValue" of focAttr\n` +
  `\t\tif val is not missing value and val is not "" then return val\n` +
  `\tend try\n` +
  `\ttry\n` +
  `\t\tset charCount to value of attribute "AXNumberOfCharacters" of focAttr\n` +
  `\t\tif charCount is greater than 0 then\n` +
  `\t\t\treturn value of attribute "AXSelectedText" of focAttr\n` +
  `\t\tend if\n` +
  `\tend try\n` +
  `\treturn ""\n` +
  `end tell`;

const MACOS_SNAPSHOT_NO_FOCUS = "__OPENWHISPR_NO_FOCUS__";
const MACOS_SNAPSHOT_EMPTY = "__OPENWHISPR_EMPTY__";
const MACOS_SNAPSHOT_UNREADABLE = "__OPENWHISPR_UNREADABLE__";
const MACOS_SNAPSHOT_NOT_EDITABLE = "__OPENWHISPR_NOT_EDITABLE__";

// Snapshot variant used for paste verification.
// It distinguishes:
// - empty but readable inputs
// - unreadable controls
// - missing focused element
const MACOS_AX_SNAPSHOT_SCRIPT_BY_PID = (pid) =>
  `tell application "System Events"\n` +
  `\ttry\n` +
  `\t\tset targetProc to first application process whose unix id is ${pid}\n` +
  `\t\tset focAttr to value of attribute "AXFocusedUIElement" of targetProc\n` +
  `\ton error\n` +
  `\t\treturn "${MACOS_SNAPSHOT_NO_FOCUS}"\n` +
  `\tend try\n` +
  `\tif focAttr is missing value then return "${MACOS_SNAPSHOT_NO_FOCUS}"\n` +
  `\tset roleValue to ""\n` +
  `\ttry\n` +
  `\t\tset roleValue to value of attribute "AXRole" of focAttr as text\n` +
  `\tend try\n` +
  `\tset editableRoles to {"AXTextField", "AXTextArea", "AXSearchField", "AXComboBox"}\n` +
  `\tset isEditableRole to false\n` +
  `\trepeat with editableRole in editableRoles\n` +
  `\t\tif roleValue is (editableRole as text) then set isEditableRole to true\n` +
  `\tend repeat\n` +
  `\tif isEditableRole is false then return "${MACOS_SNAPSHOT_NOT_EDITABLE}"\n` +
  `\ttry\n` +
  `\t\tset val to value of attribute "AXValue" of focAttr\n` +
  `\t\tif val is missing value then return "${MACOS_SNAPSHOT_UNREADABLE}"\n` +
  `\t\tset textValue to val as text\n` +
  `\t\tif textValue is "" then return "${MACOS_SNAPSHOT_EMPTY}"\n` +
  `\t\treturn textValue\n` +
  `\ton error\n` +
  `\t\treturn "${MACOS_SNAPSHOT_UNREADABLE}"\n` +
  `\tend try\n` +
  `end tell`;

// 采样焦点元素附近的辅助功能文本，用于判断目标窗口是否暴露输入框和对话上下文。
const MACOS_AX_CONTEXT_SCRIPT_BY_PID = (pid) =>
  `global collectedText, collectedKeys, maxItems, maxDepth\n` +
  `set collectedText to {}\n` +
  `set collectedKeys to {}\n` +
  `set maxItems to 48\n` +
  `set maxDepth to 3\n` +
  `on normalizeAXText(rawText)\n` +
  `\tset textValue to rawText as text\n` +
  `\tif textValue is "" then return ""\n` +
  `\tset oldDelims to AppleScript's text item delimiters\n` +
  `\tset AppleScript's text item delimiters to {return, linefeed, tab}\n` +
  `\tset textParts to text items of textValue\n` +
  `\tset AppleScript's text item delimiters to " "\n` +
  `\tset normalizedText to textParts as text\n` +
  `\tset AppleScript's text item delimiters to oldDelims\n` +
  `\treturn normalizedText\n` +
  `end normalizeAXText\n` +
  `on appendAXText(roleValue, attrName, rawText)\n` +
  `\tglobal collectedText, collectedKeys, maxItems\n` +
  `\tif (count of collectedText) >= maxItems then return\n` +
  `\ttry\n` +
  `\t\tset normalizedText to my normalizeAXText(rawText)\n` +
  `\t\tif normalizedText is "" then return\n` +
  `\t\tset keyValue to roleValue & \":\" & attrName & \":\" & normalizedText\n` +
  `\t\tif collectedKeys contains keyValue then return\n` +
  `\t\tset end of collectedKeys to keyValue\n` +
  `\t\tset end of collectedText to roleValue & \"|\" & attrName & \"|\" & normalizedText\n` +
  `\tend try\n` +
  `end appendAXText\n` +
  `on collectAXText(theElement, depthValue)\n` +
  `\tglobal collectedText, maxItems, maxDepth\n` +
  `\tif depthValue > maxDepth then return\n` +
  `\tif (count of collectedText) >= maxItems then return\n` +
  `\tset roleValue to \"\"\n` +
  `\ttry\n` +
  `\t\ttell application \"System Events\" to set roleValue to value of attribute \"AXRole\" of theElement as text\n` +
  `\tend try\n` +
  `\tset attrNames to {\"AXValue\", \"AXTitle\", \"AXDescription\", \"AXSelectedText\", \"AXPlaceholderValue\"}\n` +
  `\trepeat with attrName in attrNames\n` +
  `\t\ttry\n` +
  `\t\t\tset attrNameText to attrName as text\n` +
  `\t\t\ttell application \"System Events\" to set attrValue to value of attribute attrNameText of theElement\n` +
  `\t\t\tif attrValue is not missing value then my appendAXText(roleValue, attrNameText, attrValue)\n` +
  `\t\tend try\n` +
  `\tend repeat\n` +
  `\ttry\n` +
  `\t\ttell application \"System Events\" to set childElements to value of attribute \"AXChildren\" of theElement\n` +
  `\t\tif childElements is not missing value then\n` +
  `\t\t\trepeat with childElement in childElements\n` +
  `\t\t\t\tif (count of collectedText) >= maxItems then exit repeat\n` +
  `\t\t\t\tmy collectAXText(childElement, depthValue + 1)\n` +
  `\t\t\tend repeat\n` +
  `\t\tend if\n` +
  `\tend try\n` +
  `end collectAXText\n` +
  `tell application \"System Events\"\n` +
  `\ttry\n` +
  `\t\tset targetProc to first application process whose unix id is ${pid}\n` +
  `\t\tset focAttr to value of attribute \"AXFocusedUIElement\" of targetProc\n` +
  `\ton error\n` +
  `\t\treturn \"\"\n` +
  `\tend try\n` +
  `\tif focAttr is missing value then return \"\"\n` +
  `\tset rootElement to focAttr\n` +
  `\trepeat 4 times\n` +
  `\t\ttry\n` +
  `\t\t\tset parentElement to value of attribute \"AXParent\" of rootElement\n` +
  `\t\t\tif parentElement is missing value then exit repeat\n` +
  `\t\t\tset rootElement to parentElement\n` +
  `\t\ton error\n` +
  `\t\t\texit repeat\n` +
  `\t\tend try\n` +
  `\tend repeat\n` +
  `\tmy collectAXText(rootElement, 0)\n` +
  `\tset oldDelims to AppleScript's text item delimiters\n` +
  `\tset AppleScript's text item delimiters to linefeed\n` +
  `\tset outputText to collectedText as text\n` +
  `\tset AppleScript's text item delimiters to oldDelims\n` +
  `\treturn outputText\n` +
  `end tell`;

const WINDOWS_FOREGROUND_APP_SCRIPT = `
try {
  Add-Type @"
using System;
using System.Runtime.InteropServices;
public static class Win32ForegroundWindow {
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint lpdwProcessId);
}
"@ | Out-Null

  $hwnd = [Win32ForegroundWindow]::GetForegroundWindow()
  if ($hwnd -eq [IntPtr]::Zero) {
    [pscustomobject]@{
      pid = $null
      name = $null
      capturedAt = (Get-Date).ToUniversalTime().ToString("o")
    } | ConvertTo-Json -Compress
    exit 0
  }

  $targetPid = 0
  [void][Win32ForegroundWindow]::GetWindowThreadProcessId($hwnd, [ref]$targetPid)
  $proc = Get-Process -Id $targetPid -ErrorAction SilentlyContinue
  $name = if ($null -ne $proc) { $proc.ProcessName } else { $null }

  [pscustomobject]@{
    pid = [int]$targetPid
    name = $name
    capturedAt = (Get-Date).ToUniversalTime().ToString("o")
  } | ConvertTo-Json -Compress
} catch {
  [pscustomobject]@{
    pid = $null
    name = $null
    capturedAt = (Get-Date).ToUniversalTime().ToString("o")
    error = $_.Exception.Message
  } | ConvertTo-Json -Compress
}
`;

const WINDOWS_TEXT_MONITOR_FALLBACK_SCRIPT = `
try {
  Add-Type -AssemblyName UIAutomationClient | Out-Null

  # Read the pasted transcription line from stdin (same contract as native binaries).
  $original = [Console]::In.ReadLine()
  if ([string]::IsNullOrEmpty($original)) {
    [Console]::Out.WriteLine("NO_VALUE")
    exit 0
  }

  function Get-FocusedValue {
    try {
      $el = [System.Windows.Automation.AutomationElement]::FocusedElement
      if ($null -eq $el) { return $null }

      # 1) ValuePattern (typical input controls)
      $valuePatternRef = $null
      $hasValuePattern = $el.TryGetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern, [ref]$valuePatternRef)
      if ($hasValuePattern -and $null -ne $valuePatternRef) {
        $value = $valuePatternRef.Current.Value
        if (-not [string]::IsNullOrEmpty($value)) { return $value }
      }

      # 2) TextPattern (some rich editors expose text this way)
      $textPatternRef = $null
      $hasTextPattern = $el.TryGetCurrentPattern([System.Windows.Automation.TextPattern]::Pattern, [ref]$textPatternRef)
      if ($hasTextPattern -and $null -ne $textPatternRef -and $null -ne $textPatternRef.DocumentRange) {
        $text = $textPatternRef.DocumentRange.GetText(-1)
        if ($null -ne $text) {
          $text = $text.TrimEnd([char]0)
          if (-not [string]::IsNullOrEmpty($text)) { return $text }
        }
      }

      return $null
    } catch {
      return $null
    }
  }

  # Retry briefly: paste may not be visible yet when monitor starts.
  $lastValue = $null
  for ($i = 0; $i -lt 8; $i++) {
    $lastValue = Get-FocusedValue
    if (-not [string]::IsNullOrEmpty($lastValue)) { break }
    Start-Sleep -Milliseconds 250
  }
  if ([string]::IsNullOrEmpty($lastValue)) {
    [Console]::Out.WriteLine("NO_VALUE")
    exit 0
  }

  $deadline = (Get-Date).AddSeconds(30)
  while ((Get-Date) -lt $deadline) {
    Start-Sleep -Milliseconds 500
    $currentValue = Get-FocusedValue
    if ($null -eq $currentValue) { continue }

    if ($currentValue -ne $lastValue) {
      $lastValue = $currentValue
      $b64 = [Convert]::ToBase64String([System.Text.Encoding]::UTF8.GetBytes($currentValue))
      [Console]::Out.WriteLine("CHANGED_B64:$b64")
      [Console]::Out.Flush()
    }
  }
} catch {
  [Console]::Out.WriteLine("NO_VALUE")
}
`;

class TextEditMonitor extends EventEmitter {
  constructor() {
    super();
    this.process = null;
    this.currentOriginalText = null;
    this.timeout = null;
    this._pollInterval = null;
    this._lastValue = null;
    this._stdoutBuffer = "";
    this.lastTargetPid = null;
    this.lastTargetAppName = null;
    this.lastTargetCapturedAt = null;
    this._activeMonitorMeta = null;
  }

  /**
   * macOS: capture the active app's PID via NSWorkspace before the overlay steals focus.
   * Must be called at hotkey press time, BEFORE showDictationPanel()/mainWindow.show().
   * NSWorkspace.frontmostApplication correctly identifies the key window owner,
   * ignoring panel-type windows like the 有赞语音输入 overlay.
   */
  captureTargetPid() {
    const applyCaptureResult = (err, stdout) => {
      if (err) {
        this.lastTargetPid = null;
        this.lastTargetAppName = null;
        this.lastTargetCapturedAt = null;
      } else {
        try {
          const parsed = JSON.parse((stdout || "").trim());
          const pid = Number(parsed?.pid);
          this.lastTargetPid = Number.isInteger(pid) ? pid : null;
          this.lastTargetAppName =
            typeof parsed?.name === "string" && parsed.name.trim() ? parsed.name.trim() : null;
          this.lastTargetCapturedAt =
            typeof parsed?.capturedAt === "string" ? parsed.capturedAt : new Date().toISOString();
        } catch {
          const pid = parseInt((stdout || "").trim(), 10);
          this.lastTargetPid = Number.isInteger(pid) ? pid : null;
          this.lastTargetAppName = null;
          this.lastTargetCapturedAt = new Date().toISOString();
        }
      }

      debugLogger.debug("[TextEditMonitor] Captured target app", {
        pid: this.lastTargetPid,
        appName: this.lastTargetAppName,
        capturedAt: this.lastTargetCapturedAt,
      });
    };

    if (process.platform === "darwin") {
      const script =
        'ObjC.import("AppKit");' +
        "const app = $.NSWorkspace.sharedWorkspace.frontmostApplication;" +
        "const payload = {" +
        "pid: Number(app.processIdentifier)," +
        "name: ObjC.unwrap(app.localizedName) || null," +
        "capturedAt: (new Date()).toISOString()" +
        "};" +
        "JSON.stringify(payload);";
      execFile(
        "osascript",
        ["-l", "JavaScript", "-e", script],
        { timeout: 2000 },
        applyCaptureResult
      );
      return;
    }

    if (process.platform === "win32") {
      const encodedScript = Buffer.from(WINDOWS_FOREGROUND_APP_SCRIPT, "utf16le").toString(
        "base64"
      );

      execFile(
        "powershell.exe",
        [
          "-NoProfile",
          "-NonInteractive",
          "-ExecutionPolicy",
          "Bypass",
          "-EncodedCommand",
          encodedScript,
        ],
        { timeout: 2000, windowsHide: true, maxBuffer: 1024 * 1024 },
        applyCaptureResult
      );
      return;
    }
  }

  getLastTargetAppInfo() {
    return {
      appName: this.lastTargetAppName || null,
      processId: Number.isInteger(this.lastTargetPid) ? this.lastTargetPid : null,
      capturedAt: this.lastTargetCapturedAt || null,
    };
  }

  /**
   * 启动文本编辑监听，用于捕捉粘贴后的用户修改或粘贴落点变化。
   * @param {string} originalText - 已粘贴的转写文本
   * @param {number} timeoutMs - 监听超时时长
   * @param {object} options - 监听配置，包含目标进程和初始查询等待时间
   */
  startMonitoring(originalText, timeoutMs = 30000, options = {}) {
    this.stopMonitoring();
    this.currentOriginalText = originalText;
    const initialQueryDelayMs =
      Number.isFinite(options.initialQueryDelayMs) && options.initialQueryDelayMs >= 0
        ? options.initialQueryDelayMs
        : INITIAL_QUERY_DELAY_MS;
    this._activeMonitorMeta = {
      timeoutMs,
      targetPid: Number.isInteger(options.targetPid) ? options.targetPid : null,
      initialQueryDelayMs,
      forceFallback: Boolean(options.forceFallback),
      fallbackAttempted: Boolean(options.fallbackAttempted),
    };

    if (process.platform === "darwin") {
      const resolved = options.forceFallback ? null : this.resolveBinary();
      if (resolved) {
        this._startMacOSNative(
          originalText,
          timeoutMs,
          options.targetPid,
          resolved,
          this._activeMonitorMeta
        );
        return;
      }
      this._startMacOSPolling(originalText, timeoutMs, options.targetPid, this._activeMonitorMeta);
      return;
    }

    const resolved = this.resolveBinary({
      forceFallback: this._activeMonitorMeta.forceFallback,
    });
    if (!resolved) {
      debugLogger.debug("[TextEditMonitor] No binary found for platform", {
        platform: process.platform,
      });
      this.currentOriginalText = null;
      this._activeMonitorMeta = null;
      return;
    }

    const { command, args } = resolved;
    debugLogger.debug("[TextEditMonitor] Resolved binary", {
      command,
      args,
      forceFallback: this._activeMonitorMeta.forceFallback,
    });

    // For native binaries, verify executable permission.
    // Skip shell commands resolved via PATH (python/powershell).
    const lowerCommand = String(command || "").toLowerCase();
    const isPathResolvedShellCommand =
      lowerCommand === "python3" ||
      lowerCommand === "powershell.exe" ||
      lowerCommand === "pwsh.exe";
    if (!isPathResolvedShellCommand) {
      try {
        fs.accessSync(command, fs.constants.X_OK);
      } catch {
        debugLogger.debug("[TextEditMonitor] Binary not executable", { command });
        this.currentOriginalText = null;
        this._activeMonitorMeta = null;
        return;
      }
    }

    debugLogger.debug("[TextEditMonitor] Spawning monitor", {
      textPreview: originalText.substring(0, 80),
    });

    this.process = spawn(command, args, {
      stdio: ["pipe", "pipe", "pipe"],
    });

    // Send original text via stdin
    this.process.stdin.write(originalText + "\n");
    this.process.stdin.end();

    this._stdoutBuffer = "";
    this.process.stdout.setEncoding("utf8");
    this.process.stdout.on("data", (chunk) => {
      debugLogger.debug("[TextEditMonitor] stdout", { data: chunk.trim() });
      this._handleProcessStdoutChunk(chunk);
    });

    this.process.stderr.setEncoding("utf8");
    this.process.stderr.on("data", (data) => {
      debugLogger.debug("[TextEditMonitor] stderr", { data: data.trim() });
    });

    this.process.on("error", (err) => {
      debugLogger.debug("[TextEditMonitor] Process error", { error: err.message });
      this.process = null;
    });

    this.process.on("exit", (code, signal) => {
      debugLogger.debug("[TextEditMonitor] Process exited", { code, signal });
      this.process = null;
    });

    // Safety net timeout (binary also self-exits after its own timeout)
    this.timeout = setTimeout(() => this.stopMonitoring(), timeoutMs);
  }

  stopMonitoring() {
    if (this.timeout) {
      clearTimeout(this.timeout);
      this.timeout = null;
    }
    if (this._pollInterval) {
      clearInterval(this._pollInterval);
      this._pollInterval = null;
    }
    this._lastValue = null;
    this._stdoutBuffer = "";
    if (this.process) {
      try {
        this.process.kill();
      } catch {
        // ignore
      }
      this.process = null;
    }
    this.currentOriginalText = null;
    this._activeMonitorMeta = null;
  }

  // 原生辅助功能监听失败时，切换到 AppleScript 轮询，避免自动学习漏掉用户修正。
  _restartMacOSFallbackMonitor(reason) {
    if (process.platform !== "darwin") return false;
    if (!this.currentOriginalText || this._activeMonitorMeta?.fallbackAttempted) return false;

    const originalText = this.currentOriginalText;
    const timeoutMs = this._activeMonitorMeta?.timeoutMs || 30000;
    const targetPid = this._activeMonitorMeta?.targetPid;
    const initialQueryDelayMs = this._activeMonitorMeta?.initialQueryDelayMs;

    debugLogger.info("[TextEditMonitor] Falling back to macOS polling", {
      reason,
      targetPid,
    });

    this.stopMonitoring();
    this.startMonitoring(originalText, timeoutMs, {
      targetPid,
      initialQueryDelayMs,
      forceFallback: true,
      fallbackAttempted: true,
    });
    return true;
  }

  _handleProcessStdoutChunk(chunk) {
    this._stdoutBuffer += chunk;
    const lines = this._stdoutBuffer.split(/\r?\n/);
    this._stdoutBuffer = lines.pop() || "";

    for (const rawLine of lines) {
      if (!rawLine) continue;
      this._handleProcessLine(rawLine);
    }
  }

  _decodeBase64Payload(encoded) {
    try {
      return Buffer.from(encoded, "base64").toString("utf8");
    } catch (error) {
      debugLogger.debug("[TextEditMonitor] Failed to decode base64 payload", {
        error: error.message,
      });
      return null;
    }
  }

  _emitTextEdited(newFieldValue) {
    if (typeof newFieldValue !== "string" || this.currentOriginalText === null) {
      return;
    }

    debugLogger.debug("[TextEditMonitor] Text changed", {
      newFieldValue: newFieldValue.substring(0, 80),
    });
    this.emit("text-edited", {
      originalText: this.currentOriginalText,
      newFieldValue,
    });
  }

  // 标准化监控文本，降低换行、连续空白导致的误判。
  _normalizeMonitorText(value) {
    return String(value || "")
      .replace(/\s+/g, " ")
      .trim();
  }

  // 判断监控启动时读到的初始值是否已经是用户改过的结果。
  _shouldEmitInitialEditedValue(originalText, fieldValue) {
    const original = this._normalizeMonitorText(originalText);
    const field = this._normalizeMonitorText(fieldValue);
    if (!original || !field || original === field) return false;

    // 原文还完整出现在输入框里时，多半只是粘贴到了已有文档，不当作修正。
    if (field.includes(original)) return false;

    const fieldLengthLimit = Math.max(48, original.length * 4);
    if (field.length > fieldLengthLimit) return false;

    if (original.length <= 12) {
      const uniqueChars = Array.from(new Set(original.split("").filter(Boolean)));
      if (uniqueChars.length === 0) return false;
      const sharedCount = uniqueChars.filter((char) => field.includes(char)).length;
      return sharedCount / uniqueChars.length >= 0.55;
    }

    const anchorLength = Math.min(16, Math.max(6, Math.floor(original.length / 4)));
    const head = original.slice(0, anchorLength);
    const tail = original.slice(-anchorLength);
    return field.includes(head) || field.includes(tail);
  }

  // 初次读取到已修改内容时立即上报，补齐粘贴后快速编辑的监控空窗。
  _emitInitialEditedValueIfNeeded(originalText, fieldValue) {
    if (!this._shouldEmitInitialEditedValue(originalText, fieldValue)) {
      return false;
    }

    debugLogger.debug("[TextEditMonitor] Initial value already edited", {
      originalPreview: String(originalText || "").substring(0, 80),
      valuePreview: String(fieldValue || "").substring(0, 80),
    });
    this._emitTextEdited(fieldValue);
    return true;
  }

  _handleProcessLine(line) {
    if (line.startsWith("CHANGED_B64:")) {
      const decoded = this._decodeBase64Payload(line.slice("CHANGED_B64:".length));
      if (decoded !== null) {
        this._emitTextEdited(decoded);
      }
      return;
    }

    if (line.startsWith("CHANGED:")) {
      this._emitTextEdited(line.slice("CHANGED:".length));
      return;
    }

    if (line === "NO_ELEMENT" || line === "NO_VALUE") {
      debugLogger.debug("[TextEditMonitor] No target element", { status: line });

      const shouldRetryWithFallback =
        (process.platform === "darwin" || process.platform === "win32") &&
        (line === "NO_ELEMENT" || line === "NO_VALUE") &&
        this._activeMonitorMeta &&
        !this._activeMonitorMeta.forceFallback &&
        !this._activeMonitorMeta.fallbackAttempted;

      if (shouldRetryWithFallback) {
        if (process.platform === "darwin") {
          this._restartMacOSFallbackMonitor(line);
          return;
        }

        const originalText = this.currentOriginalText;
        const timeoutMs = this._activeMonitorMeta.timeoutMs || 30000;
        const targetPid = this._activeMonitorMeta.targetPid;
        const initialQueryDelayMs = this._activeMonitorMeta.initialQueryDelayMs;

        debugLogger.debug("[TextEditMonitor] Retrying with PowerShell fallback monitor", {
          timeoutMs,
          targetPid,
        });

        this.stopMonitoring();
        if (typeof originalText === "string" && originalText.length > 0) {
          this.startMonitoring(originalText, timeoutMs, {
            targetPid,
            initialQueryDelayMs,
            forceFallback: true,
            fallbackAttempted: true,
          });
          return;
        }
      }

      this.stopMonitoring();
    }
  }

  /**
   * macOS: tell the target app that an assistive technology is present.
   * This causes Chromium/Electron apps to build their accessibility tree.
   */
  _enableAccessibility(pid) {
    return new Promise((resolve) => {
      const script = MACOS_AX_ENABLE_SCRIPT(pid);
      execFile("osascript", ["-e", script], { timeout: 3000 }, (err) => {
        if (err) {
          debugLogger.debug("[TextEditMonitor] macOS: AXEnhancedUserInterface failed", {
            error: err.message,
          });
        } else {
          debugLogger.debug("[TextEditMonitor] macOS: AXEnhancedUserInterface enabled", { pid });
        }
        resolve();
      });
    });
  }

  /**
   * 使用 macOS 原生 AXObserver 监听目标输入框事件，失败时降级到轮询。
   * @param {string} originalText - 已粘贴的转写文本
   * @param {number} timeoutMs - 监听超时时长
   * @param {number|null} targetPid - 接收粘贴的目标应用进程
   * @param {object} resolved - 已解析的原生监听二进制信息
   * @param {object} options - 监听配置
   */
  async _startMacOSNative(originalText, timeoutMs, targetPid, resolved, options = {}) {
    if (!targetPid) {
      debugLogger.debug("[TextEditMonitor] macOS native: no target PID");
      this.stopMonitoring();
      return;
    }
    const initialQueryDelayMs =
      Number.isFinite(options.initialQueryDelayMs) && options.initialQueryDelayMs >= 0
        ? options.initialQueryDelayMs
        : INITIAL_QUERY_DELAY_MS;

    debugLogger.debug("[TextEditMonitor] macOS native: starting", {
      targetPid,
      textPreview: originalText.substring(0, 80),
      initialQueryDelayMs,
    });

    await this._enableAccessibility(targetPid);
    if (this.currentOriginalText === null) return;

    await new Promise((r) => setTimeout(r, initialQueryDelayMs));
    if (this.currentOriginalText === null) return;

    const initialValue = await this._queryMacOSValue(targetPid);
    if (this.currentOriginalText === null) return;
    if (typeof initialValue === "string" && initialValue) {
      this._emitInitialEditedValueIfNeeded(originalText, initialValue);
    }

    const { command, args } = resolved;

    try {
      fs.accessSync(command, fs.constants.X_OK);
    } catch {
      debugLogger.debug(
        "[TextEditMonitor] macOS native: binary not executable, falling back to polling",
        { command }
      );
      this._startMacOSPolling(originalText, timeoutMs, targetPid, options);
      return;
    }

    this.process = spawn(command, [...args, String(targetPid)], {
      stdio: ["pipe", "pipe", "pipe"],
    });

    this.process.stdin.write(originalText + "\n");
    this.process.stdin.end();

    this._stdoutBuffer = "";
    this.process.stdout.setEncoding("utf8");
    this.process.stdout.on("data", (chunk) => {
      debugLogger.debug("[TextEditMonitor] stdout", { data: chunk.trim() });
      this._handleProcessStdoutChunk(chunk);
    });

    this.process.stderr.setEncoding("utf8");
    this.process.stderr.on("data", (data) => {
      debugLogger.debug("[TextEditMonitor] stderr", { data: data.trim() });
    });

    this.process.on("error", (err) => {
      debugLogger.debug("[TextEditMonitor] macOS native: process error, falling back to polling", {
        error: err.message,
      });
      this.process = null;
      this._restartMacOSFallbackMonitor("native_error");
    });

    this.process.on("exit", (code, signal) => {
      debugLogger.debug("[TextEditMonitor] Process exited", { code, signal });
      this.process = null;
      if (code !== 0) {
        this._restartMacOSFallbackMonitor(`native_exit_${code}`);
      }
    });

    this.timeout = setTimeout(() => this.stopMonitoring(), timeoutMs);
  }

  /**
   * macOS: query the focused text field value via osascript for a specific app PID.
   * Returns the field value string, or null on error.
   */
  _queryMacOSValue(pid) {
    return new Promise((resolve) => {
      const script = MACOS_AX_SCRIPT_BY_PID(pid);
      execFile("osascript", ["-e", script], { timeout: 3000 }, (err, stdout) => {
        if (err) {
          resolve(null);
        } else {
          resolve(stdout.replace(/\n$/, ""));
        }
      });
    });
  }

  _queryMacOSSnapshot(pid) {
    return new Promise((resolve) => {
      const script = MACOS_AX_SNAPSHOT_SCRIPT_BY_PID(pid);
      execFile("osascript", ["-e", script], { timeout: 3000 }, (err, stdout) => {
        if (err) {
          resolve(null);
          return;
        }

        const rawValue = stdout.replace(/\n$/, "");
        if (rawValue === MACOS_SNAPSHOT_NO_FOCUS) {
          resolve({ status: "no_focus", value: null });
          return;
        }
        if (rawValue === MACOS_SNAPSHOT_NOT_EDITABLE) {
          resolve({ status: "not_editable", value: null });
          return;
        }
        if (rawValue === MACOS_SNAPSHOT_UNREADABLE || rawValue === "") {
          resolve({ status: "unreadable", value: null });
          return;
        }
        if (rawValue === MACOS_SNAPSHOT_EMPTY) {
          resolve({ status: "empty", value: "" });
          return;
        }
        resolve({ status: "value", value: rawValue });
      });
    });
  }

  /**
   * 解析辅助功能上下文输出，统一成可用于日志和粘贴校验的结构。
   * @param {string} rawOutput - AppleScript 输出的 role|attr|text 行
   * @param {string} source - 上下文采样来源
   * @returns {object} 规范化后的上下文摘要
   */
  _parseMacOSContextLines(rawOutput, source) {
    const lines = String(rawOutput || "")
      .replace(/\n$/, "")
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => {
        const parts = line.split("|");
        return {
          role: parts.shift() || "",
          attr: parts.shift() || "",
          text: parts.join("|").trim(),
        };
      })
      .filter((line) => line.text);

    return {
      status: lines.length ? "value" : "empty",
      source,
      lines,
      text: lines.map((line) => line.text).join("\n"),
      lineCount: lines.length,
    };
  }

  /**
   * 通过辅助功能抽样读取焦点窗口附近文本，用于判断上下文和可编辑节点是否可读。
   * @param {number} pid - 目标应用进程 ID
   * @returns {Promise<object|null>} 窗口文本摘要，失败时返回 null
   */
  _queryMacOSContextSnapshot(pid) {
    return new Promise((resolve) => {
      const script = MACOS_AX_CONTEXT_SCRIPT_BY_PID(pid);
      execFile(
        "osascript",
        ["-e", script],
        { timeout: 1600, maxBuffer: 1024 * 1024 },
        (err, stdout) => {
          if (err) {
            resolve({
              status: "error",
              source: "applescript",
              error: err.message || String(err),
            });
            return;
          }

          resolve(this._parseMacOSContextLines(stdout, "applescript"));
        }
      );
    });
  }

  /**
   * 使用 osascript 轮询 macOS 目标输入框，作为原生监听不可用时的兜底。
   * @param {string} originalText - 已粘贴的转写文本
   * @param {number} timeoutMs - 监听超时时长
   * @param {number|null} targetPid - 接收粘贴的目标应用进程
   * @param {object} options - 监听配置
   */
  _startMacOSPolling(originalText, timeoutMs, targetPid, options = {}) {
    if (!targetPid) {
      debugLogger.debug("[TextEditMonitor] macOS: no target PID");
      this.stopMonitoring();
      return;
    }
    const initialQueryDelayMs =
      Number.isFinite(options.initialQueryDelayMs) && options.initialQueryDelayMs >= 0
        ? options.initialQueryDelayMs
        : INITIAL_QUERY_DELAY_MS;

    debugLogger.debug("[TextEditMonitor] macOS: starting osascript polling", {
      targetPid,
      textPreview: originalText.substring(0, 80),
      initialQueryDelayMs,
    });

    // 先唤醒目标应用辅助功能树，再根据调用场景等待粘贴事件落地。
    this._enableAccessibility(targetPid).then(() => {
      if (this.currentOriginalText === null) return; // guard against stopMonitoring()
      setTimeout(
        () => this._queryInitialValue(targetPid, originalText, timeoutMs),
        initialQueryDelayMs
      );
    });
  }

  /**
   * Query the initial AXValue with retries. The target app may not have processed
   * the pasted text yet, so an empty value is retried a few times before giving up.
   */
  async _queryInitialValue(targetPid, originalText, timeoutMs, attempt = 1) {
    // Guard against stopMonitoring() being called while we waited
    if (this.currentOriginalText === null) return;

    const initialValue = await this._queryMacOSValue(targetPid);
    if (this.currentOriginalText === null) return;

    if (initialValue === null) {
      debugLogger.debug("[TextEditMonitor] macOS: no focused element");
      this.stopMonitoring();
      return;
    }

    if (!initialValue) {
      if (attempt < INITIAL_QUERY_RETRIES) {
        debugLogger.debug("[TextEditMonitor] macOS: AXValue empty, retrying", {
          attempt,
          maxRetries: INITIAL_QUERY_RETRIES,
        });
        setTimeout(
          () => this._queryInitialValue(targetPid, originalText, timeoutMs, attempt + 1),
          INITIAL_QUERY_RETRY_DELAY_MS
        );
        return;
      }
      debugLogger.debug("[TextEditMonitor] macOS: no text value after retries");
      this.stopMonitoring();
      return;
    }

    this._lastValue = initialValue;
    this._emitInitialEditedValueIfNeeded(originalText, initialValue);
    debugLogger.debug("[TextEditMonitor] macOS: initial value", {
      valuePreview: initialValue.substring(0, 80),
      attempt,
    });

    this._pollInterval = setInterval(async () => {
      const currentValue = await this._queryMacOSValue(targetPid);
      // Guard against stopMonitoring() being called during the query
      if (this.currentOriginalText === null) return;

      if (currentValue === null) {
        debugLogger.debug("[TextEditMonitor] macOS: lost focused element");
        this.stopMonitoring();
        return;
      }

      if (currentValue !== this._lastValue) {
        this._lastValue = currentValue;
        debugLogger.debug("[TextEditMonitor] macOS: text changed", {
          newValuePreview: currentValue.substring(0, 80),
        });
        this.emit("text-edited", {
          originalText: this.currentOriginalText,
          newFieldValue: currentValue,
        });
      }
    }, POLL_INTERVAL_MS);

    this.timeout = setTimeout(() => this.stopMonitoring(), timeoutMs);
  }

  /**
   * Resolve the platform-specific binary.
   * Returns { command, args } or null if unavailable.
   */
  resolveBinary(options = {}) {
    const platform = process.platform;
    const forceFallback = Boolean(options.forceFallback);

    if (platform === "linux") {
      const nativePath = this._findFile("linux-text-monitor");
      if (nativePath) return { command: nativePath, args: [] };
      const scriptPath = this._findFile("linux-text-monitor.py");
      return scriptPath ? { command: "python3", args: [scriptPath] } : null;
    }

    if (platform === "win32") {
      if (!forceFallback) {
        const binaryPath = this._findFile("windows-text-monitor.exe");
        if (binaryPath) return { command: binaryPath, args: [] };
      }

      // Fallback for dev machines without compiled monitor binary.
      const encodedScript = Buffer.from(WINDOWS_TEXT_MONITOR_FALLBACK_SCRIPT, "utf16le").toString(
        "base64"
      );
      return {
        command: "powershell.exe",
        args: [
          "-NoProfile",
          "-NonInteractive",
          "-ExecutionPolicy",
          "Bypass",
          "-EncodedCommand",
          encodedScript,
        ],
      };
    }

    if (platform === "darwin") {
      const nativePath = this._findFile("macos-text-monitor");
      if (nativePath) return { command: nativePath, args: [] }; // PID added at spawn time
      return null;
    }

    return null;
  }

  _findFile(fileName) {
    const candidates = new Set([
      path.join(__dirname, "..", "..", "resources", "bin", fileName),
      path.join(__dirname, "..", "..", "resources", fileName),
    ]);

    if (process.resourcesPath) {
      [
        path.join(process.resourcesPath, fileName),
        path.join(process.resourcesPath, "bin", fileName),
        path.join(process.resourcesPath, "resources", fileName),
        path.join(process.resourcesPath, "resources", "bin", fileName),
        path.join(process.resourcesPath, "app.asar.unpacked", "resources", fileName),
        path.join(process.resourcesPath, "app.asar.unpacked", "resources", "bin", fileName),
      ].forEach((c) => candidates.add(c));
    }

    for (const candidate of candidates) {
      try {
        if (fs.statSync(candidate).isFile()) return candidate;
      } catch {
        continue;
      }
    }

    return null;
  }
}

module.exports = TextEditMonitor;
