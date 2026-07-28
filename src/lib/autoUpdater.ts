import { check, type Update } from "@tauri-apps/plugin-updater";
import { invoke } from "@tauri-apps/api/core";

export interface UpdateCheckResult {
  status: "up-to-date" | "update-available" | "error";
  version?: string;
  error?: string;
}

let pendingUpdate: Update | null = null;

/**
 * 检查 App 更新（仅检查，不下载）。
 * 找到更新时暂存 Update 物件供后续操作。
 */
export async function checkForAppUpdate(): Promise<UpdateCheckResult> {
  try {
    const update = await check();
    if (!update) {
      console.log("[autoUpdater] No update available");
      pendingUpdate = null;
      return { status: "up-to-date" };
    }

    console.log(`[autoUpdater] Update available: v${update.version}`);
    pendingUpdate = update;
    return { status: "update-available", version: update.version };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[autoUpdater] Update check failed:", message);
    return { status: "error", error: message };
  }
}

/**
 * 静默下载暂存的更新（不安装、不重启）。
 * 用于自动更新流程：背景下载完成后再通知使用者。
 */
export async function downloadUpdate(): Promise<void> {
  if (!pendingUpdate) {
    throw new Error("No pending update. Call checkForAppUpdate() first.");
  }

  console.log("[autoUpdater] Downloading update...");
  await pendingUpdate.download();
  console.log("[autoUpdater] Download complete");
}

/**
 * 安装已下载的更新并重启 App。
 * 必须在 downloadUpdate() 完成后呼叫。
 */
export async function installAndRelaunch(): Promise<void> {
  if (!pendingUpdate) {
    throw new Error("No pending update.");
  }

  console.log("[autoUpdater] Installing update...");
  await pendingUpdate.install();
  await invoke("request_app_restart");
}

/**
 * 一键下载、安装并重启（手动更新流程用）。
 */
export async function downloadInstallAndRelaunch(): Promise<void> {
  if (!pendingUpdate) {
    throw new Error("No pending update. Call checkForAppUpdate() first.");
  }

  console.log("[autoUpdater] Downloading update...");
  await pendingUpdate.download();
  console.log("[autoUpdater] Download complete, installing...");
  await pendingUpdate.install();
  await invoke("request_app_restart");
}
