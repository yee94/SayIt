import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const mockCheck = vi.fn();
const mockInvoke = vi.fn().mockResolvedValue(undefined);

vi.mock("@tauri-apps/plugin-updater", () => ({
  check: mockCheck,
}));

vi.mock("@tauri-apps/api/core", () => ({
  invoke: mockInvoke,
}));

describe("autoUpdater.ts", () => {
  beforeEach(() => {
    vi.resetModules();
    mockCheck.mockReset();
    mockInvoke.mockReset().mockResolvedValue(undefined);
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("[P0] 无更新时应回传 up-to-date", async () => {
    mockCheck.mockResolvedValue(null);

    const { checkForAppUpdate } = await import("../../src/lib/autoUpdater");
    const result = await checkForAppUpdate();

    expect(result).toEqual({ status: "up-to-date" });
    expect(mockCheck).toHaveBeenCalledOnce();
  });

  it("[P0] 有更新时应回传 update-available 且不触发下载", async () => {
    const mockDownload = vi.fn().mockResolvedValue(undefined);
    mockCheck.mockResolvedValue({
      version: "1.2.0",
      download: mockDownload,
      install: vi.fn(),
    });

    const { checkForAppUpdate } = await import("../../src/lib/autoUpdater");
    const result = await checkForAppUpdate();

    expect(result).toEqual({ status: "update-available", version: "1.2.0" });
    expect(mockDownload).not.toHaveBeenCalled();
  });

  it("[P0] check 失败应回传 error 结果且不抛错", async () => {
    mockCheck.mockRejectedValue(new Error("Network error"));

    const { checkForAppUpdate } = await import("../../src/lib/autoUpdater");
    const result = await checkForAppUpdate();

    expect(result).toEqual({ status: "error", error: "Network error" });
    expect(console.error).toHaveBeenCalledWith(
      "[autoUpdater] Update check failed:",
      "Network error",
    );
  });

  it("[P0] downloadUpdate 应只下载不安装", async () => {
    const mockDownload = vi.fn().mockResolvedValue(undefined);
    const mockInstall = vi.fn();
    mockCheck.mockResolvedValue({
      version: "1.2.0",
      download: mockDownload,
      install: mockInstall,
    });

    const { checkForAppUpdate, downloadUpdate } = await import(
      "../../src/lib/autoUpdater"
    );
    await checkForAppUpdate();
    await downloadUpdate();

    expect(mockDownload).toHaveBeenCalledOnce();
    expect(mockInstall).not.toHaveBeenCalled();
    expect(mockInvoke).not.toHaveBeenCalled();
  });

  it("[P0] installAndRelaunch 应安装并重启", async () => {
    const mockDownload = vi.fn().mockResolvedValue(undefined);
    const mockInstall = vi.fn().mockResolvedValue(undefined);
    mockCheck.mockResolvedValue({
      version: "1.2.0",
      download: mockDownload,
      install: mockInstall,
    });

    const { checkForAppUpdate, downloadUpdate, installAndRelaunch } =
      await import("../../src/lib/autoUpdater");
    await checkForAppUpdate();
    await downloadUpdate();
    await installAndRelaunch();

    expect(mockInstall).toHaveBeenCalledOnce();
    expect(mockInvoke).toHaveBeenCalledWith("request_app_restart");
  });

  it("[P0] downloadInstallAndRelaunch 应一键完成", async () => {
    const mockDownload = vi.fn().mockResolvedValue(undefined);
    const mockInstall = vi.fn().mockResolvedValue(undefined);
    mockCheck.mockResolvedValue({
      version: "1.2.0",
      download: mockDownload,
      install: mockInstall,
    });

    const { checkForAppUpdate, downloadInstallAndRelaunch } = await import(
      "../../src/lib/autoUpdater"
    );
    await checkForAppUpdate();
    await downloadInstallAndRelaunch();

    expect(mockDownload).toHaveBeenCalledOnce();
    expect(mockInstall).toHaveBeenCalledOnce();
    expect(mockInvoke).toHaveBeenCalledWith("request_app_restart");
  });

  it("[P0] 无暂存更新时 downloadUpdate 应抛错", async () => {
    mockCheck.mockResolvedValue(null);

    const { checkForAppUpdate, downloadUpdate } = await import(
      "../../src/lib/autoUpdater"
    );
    await checkForAppUpdate();

    await expect(downloadUpdate()).rejects.toThrow("No pending update");
  });

  it("[P0] 下载失败时 downloadUpdate 应抛错", async () => {
    const mockDownload = vi
      .fn()
      .mockRejectedValue(new Error("Download failed"));
    mockCheck.mockResolvedValue({
      version: "1.2.0",
      download: mockDownload,
      install: vi.fn(),
    });

    const { checkForAppUpdate, downloadUpdate } = await import(
      "../../src/lib/autoUpdater"
    );
    await checkForAppUpdate();

    await expect(downloadUpdate()).rejects.toThrow("Download failed");
    expect(mockInvoke).not.toHaveBeenCalled();
  });
});
