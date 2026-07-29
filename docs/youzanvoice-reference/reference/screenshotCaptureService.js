const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const { spawn } = require("node:child_process");
const { getSafeTempDir } = require("../helpers/safeTempDir");

const SCREENSHOT_TIMEOUT_MS = 15000;
const CONTEXT_PROBE_TIMEOUT_MS = 1200;
const MACOS_EDITABLE_ROLES = new Set(["AXTextField", "AXTextArea", "AXSearchField", "AXComboBox"]);

const MACOS_ANALYSIS_CONTEXT_SCRIPT = `
on replaceText(sourceText, findText, replacementText)
  set AppleScript's text item delimiters to findText
  set textItems to text items of sourceText
  set AppleScript's text item delimiters to replacementText
  set joinedText to textItems as text
  set AppleScript's text item delimiters to ""
  return joinedText
end replaceText

on cleanField(sourceValue)
  set textValue to sourceValue as text
  set textValue to my replaceText(textValue, tab, " ")
  set textValue to my replaceText(textValue, return, " ")
  set textValue to my replaceText(textValue, linefeed, " ")
  return textValue
end cleanField

try
  tell application "System Events"
    set targetProc to first application process whose frontmost is true
    set pidValue to unix id of targetProc
    set appName to my cleanField(name of targetProc)
    set focusedElement to missing value
    try
      set focusedElement to value of attribute "AXFocusedUIElement" of targetProc
    end try

    set roleValue to ""
    set subroleValue to ""
    set isEditable to false
    if focusedElement is not missing value then
      try
        set roleValue to value of attribute "AXRole" of focusedElement as text
      end try
      try
        set subroleValue to value of attribute "AXSubrole" of focusedElement as text
      end try

      set editableRoles to {"AXTextField", "AXTextArea", "AXSearchField", "AXComboBox"}
      repeat with editableRole in editableRoles
        if roleValue is (editableRole as text) then set isEditable to true
      end repeat

      try
        set editableValue to value of attribute "AXEditable" of focusedElement
        if editableValue is true then set isEditable to true
      end try
    end if

    if isEditable is true and focusedElement is not missing value then
      set targetWindow to missing value
      try
        set targetWindow to value of attribute "AXWindow" of focusedElement
      end try
      if targetWindow is missing value then
        try
          set targetWindow to first window of targetProc whose value of attribute "AXMain" is true
        end try
      end if

      if targetWindow is not missing value then
        set windowPosition to position of targetWindow
        set windowSize to size of targetWindow
        return "window" & tab & pidValue & tab & appName & tab & roleValue & tab & subroleValue & tab & (item 1 of windowPosition as integer) & tab & (item 2 of windowPosition as integer) & tab & (item 1 of windowSize as integer) & tab & (item 2 of windowSize as integer)
      end if
    end if

    return "display" & tab & pidValue & tab & appName & tab & roleValue & tab & subroleValue
  end tell
on error
  return "display" & tab & "" & tab & "" & tab & "" & tab & ""
end try
`;

/**
 * 生成截图临时目录，确保当前会话可写。
 */
function ensureScreenshotDir() {
  const baseDir = path.join(getSafeTempDir() || os.tmpdir(), "voiceink-screenshots");
  fs.mkdirSync(baseDir, { recursive: true });
  return baseDir;
}

/**
 * 生成截图文件路径，统一使用 png。
 */
function createScreenshotFilePath() {
  const now = new Date();
  const stamp = [
    now.getFullYear(),
    String(now.getMonth() + 1).padStart(2, "0"),
    String(now.getDate()).padStart(2, "0"),
    "-",
    String(now.getHours()).padStart(2, "0"),
    String(now.getMinutes()).padStart(2, "0"),
    String(now.getSeconds()).padStart(2, "0"),
    "-",
    String(now.getMilliseconds()).padStart(3, "0"),
  ].join("");
  return path.join(ensureScreenshotDir(), `screenshot-${stamp}.png`);
}

/**
 * 获取 Electron 的屏幕模块，截图范围计算只在主进程可用时启用。
 */
function getElectronScreen() {
  try {
    return require("electron").screen;
  } catch {
    return null;
  }
}

/**
 * 将截图矩形规整为 screencapture 可用的整数范围。
 */
function normalizeRect(rect) {
  if (!rect) return null;
  const x = Math.round(Number(rect.x));
  const y = Math.round(Number(rect.y));
  const width = Math.round(Number(rect.width));
  const height = Math.round(Number(rect.height));
  if (![x, y, width, height].every(Number.isFinite)) return null;
  if (width <= 0 || height <= 0) return null;
  return { x, y, width, height };
}

/**
 * 将矩形格式化为 macOS screencapture 的 -R 参数。
 */
function formatMacOSRect(rect) {
  const normalized = normalizeRect(rect);
  if (!normalized) return "";
  return `${normalized.x},${normalized.y},${normalized.width},${normalized.height}`;
}

/**
 * 获取鼠标所在显示器范围，用于非输入框场景的上下文截图。
 */
function getCursorDisplayContext(extra = {}) {
  const electronScreen = getElectronScreen();
  if (!electronScreen) {
    return {
      mode: "fullScreen",
      reason: "electron_screen_unavailable",
      ...extra,
    };
  }

  const cursorPoint = electronScreen.getCursorScreenPoint();
  const display = electronScreen.getDisplayNearestPoint(cursorPoint);
  return {
    mode: "display",
    reason: "cursor_display",
    rect: display?.bounds || null,
    displayId: display?.id,
    cursorPoint,
    ...extra,
  };
}

/**
 * 解析 macOS 前台应用焦点，输入框内优先返回焦点窗口范围。
 */
async function resolveMacOSAnalysisContext() {
  try {
    const { stdout } = await runCommand(
      "osascript",
      ["-e", MACOS_ANALYSIS_CONTEXT_SCRIPT],
      CONTEXT_PROBE_TIMEOUT_MS
    );
    const parts = String(stdout || "").trim().split("\t");
    const mode = parts[0] || "display";
    const processId = Number.parseInt(parts[1] || "", 10);
    const appName = parts[2] || "";
    const role = parts[3] || "";
    const subrole = parts[4] || "";
    const base = {
      processId: Number.isInteger(processId) ? processId : null,
      appName: appName || null,
      role: role || null,
      subrole: subrole || null,
    };

    if (mode === "window" && MACOS_EDITABLE_ROLES.has(role)) {
      const rect = normalizeRect({
        x: parts[5],
        y: parts[6],
        width: parts[7],
        height: parts[8],
      });
      if (rect) {
        return {
          mode: "window",
          reason: "focused_editable_window",
          rect,
          ...base,
        };
      }
    }

    return getCursorDisplayContext({
      reason: "focused_target_not_editable",
      ...base,
    });
  } catch (error) {
    return getCursorDisplayContext({
      reason: "focus_probe_failed",
      error: error?.message || String(error),
    });
  }
}

/**
 * 解析语音助手本次应该截取的上下文范围。
 */
async function resolveAnalysisCaptureContext() {
  if (process.platform === "darwin") {
    return resolveMacOSAnalysisContext();
  }
  return getCursorDisplayContext({ reason: "platform_default_display" });
}

/**
 * 执行系统命令并等待结束。
 */
function runCommand(command, args, timeoutMs = SCREENSHOT_TIMEOUT_MS) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stderr = "";
    let stdout = "";
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error(`Screenshot command timed out after ${timeoutMs}ms`));
    }, timeoutMs);

    child.stdout?.on("data", (chunk) => {
      stdout += String(chunk || "");
    });
    child.stderr?.on("data", (chunk) => {
      stderr += String(chunk || "");
    });
    child.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code === 0) {
        resolve({ stdout, stderr });
        return;
      }
      reject(new Error(stderr.trim() || stdout.trim() || `Screenshot command exited with ${code}`));
    });
  });
}

/**
 * 执行全屏截图并返回临时文件信息。
 */
async function captureFullScreen() {
  const filePath = createScreenshotFilePath();

  if (process.platform === "darwin") {
    await runCommand("screencapture", ["-x", filePath]);
  } else if (process.platform === "win32") {
    const escapedPath = filePath.replace(/\\/g, "\\\\").replace(/'/g, "''");
    const script = [
      "Add-Type -AssemblyName System.Windows.Forms",
      "Add-Type -AssemblyName System.Drawing",
      "$bounds = [System.Windows.Forms.SystemInformation]::VirtualScreen",
      "$bitmap = New-Object System.Drawing.Bitmap $bounds.Width, $bounds.Height",
      "$graphics = [System.Drawing.Graphics]::FromImage($bitmap)",
      "$graphics.CopyFromScreen($bounds.Left, $bounds.Top, 0, 0, $bitmap.Size)",
      `$bitmap.Save('${escapedPath}', [System.Drawing.Imaging.ImageFormat]::Png)`,
      "$graphics.Dispose()",
      "$bitmap.Dispose()",
    ].join(";");
    await runCommand("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", script]);
  } else {
    try {
      await runCommand("gnome-screenshot", ["-f", filePath]);
    } catch (firstError) {
      try {
        await runCommand("grim", [filePath]);
      } catch (secondError) {
        throw new Error(
          `Linux screenshot unavailable: ${firstError.message}; ${secondError.message}`
        );
      }
    }
  }

  const stat = fs.statSync(filePath);
  return {
    filePath,
    fileName: path.basename(filePath),
    mimeType: "image/png",
    size: stat.size,
  };
}

/**
 * 按语音助手上下文范围截图，无法识别范围时回退为全屏截图。
 */
async function captureForAnalysis(context) {
  const filePath = createScreenshotFilePath();
  const resolvedContext = context || (await resolveAnalysisCaptureContext());

  if (process.platform === "darwin") {
    const rectArg = formatMacOSRect(resolvedContext?.rect);
    if (rectArg) {
      await runCommand("screencapture", ["-x", "-R", rectArg, filePath]);
    } else {
      await runCommand("screencapture", ["-x", filePath]);
    }
  } else if (process.platform === "win32") {
    const escapedPath = filePath.replace(/\\/g, "\\\\").replace(/'/g, "''");
    const script = [
      "Add-Type -AssemblyName System.Windows.Forms",
      "Add-Type -AssemblyName System.Drawing",
      "$bounds = [System.Windows.Forms.SystemInformation]::VirtualScreen",
      "$bitmap = New-Object System.Drawing.Bitmap $bounds.Width, $bounds.Height",
      "$graphics = [System.Drawing.Graphics]::FromImage($bitmap)",
      "$graphics.CopyFromScreen($bounds.Left, $bounds.Top, 0, 0, $bitmap.Size)",
      `$bitmap.Save('${escapedPath}', [System.Drawing.Imaging.ImageFormat]::Png)`,
      "$graphics.Dispose()",
      "$bitmap.Dispose()",
    ].join(";");
    await runCommand("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", script]);
  } else {
    try {
      await runCommand("gnome-screenshot", ["-f", filePath]);
    } catch (firstError) {
      try {
        await runCommand("grim", [filePath]);
      } catch (secondError) {
        throw new Error(
          `Linux screenshot unavailable: ${firstError.message}; ${secondError.message}`
        );
      }
    }
  }

  const stat = fs.statSync(filePath);
  return {
    filePath,
    fileName: path.basename(filePath),
    mimeType: "image/png",
    size: stat.size,
    captureMode: resolvedContext?.mode || "fullScreen",
    captureReason: resolvedContext?.reason || "",
    captureRect: resolvedContext?.rect || null,
    displayId: resolvedContext?.displayId,
    appName: resolvedContext?.appName,
    processId: resolvedContext?.processId,
  };
}

/**
 * 删除会话产生的临时截图文件。
 */
function removeScreenshot(filePath) {
  if (!filePath) return;
  try {
    fs.unlinkSync(filePath);
  } catch {
    // 忽略清理失败，避免影响主流程
  }
}

module.exports = {
  captureFullScreen,
  captureForAnalysis,
  resolveAnalysisCaptureContext,
  removeScreenshot,
};
