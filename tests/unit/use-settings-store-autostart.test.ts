import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createPinia, setActivePinia } from "pinia";

const mockIsEnabled = vi.fn();
const mockEnable = vi.fn();
const mockDisable = vi.fn();

vi.mock("@tauri-apps/plugin-autostart", () => ({
  isEnabled: mockIsEnabled,
  enable: mockEnable,
  disable: mockDisable,
}));

const mockStoreGet = vi.fn();
const mockStoreSet = vi.fn();
const mockStoreSave = vi.fn();
const mockStoreDelete = vi.fn();

vi.mock("@tauri-apps/plugin-store", () => ({
  load: vi.fn().mockResolvedValue({
    get: mockStoreGet,
    set: mockStoreSet,
    save: mockStoreSave,
    delete: mockStoreDelete,
  }),
}));

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../../src/composables/useTauriEvents", () => ({
  emitEvent: vi.fn().mockResolvedValue(undefined),
  SETTINGS_UPDATED: "settings:updated",
}));

describe("useSettingsStore — 自启动功能", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    mockIsEnabled.mockReset();
    mockEnable.mockReset();
    mockDisable.mockReset();
    mockStoreGet.mockReset();
    mockStoreSet.mockReset();
    mockStoreSave.mockReset();
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("loadAutoStartStatus", () => {
    it("[P0] 应读取当前自启动状态 — 已启用", async () => {
      mockIsEnabled.mockResolvedValue(true);

      const { useSettingsStore } = await import(
        "../../src/stores/useSettingsStore"
      );
      const store = useSettingsStore();
      await store.loadAutoStartStatus();

      expect(store.isAutoStartEnabled).toBe(true);
    });

    it("[P0] 应读取当前自启动状态 — 未启用", async () => {
      mockIsEnabled.mockResolvedValue(false);

      const { useSettingsStore } = await import(
        "../../src/stores/useSettingsStore"
      );
      const store = useSettingsStore();
      await store.loadAutoStartStatus();

      expect(store.isAutoStartEnabled).toBe(false);
    });

    it("[P0] isEnabled 失败应静默处理", async () => {
      mockIsEnabled.mockRejectedValue(new Error("Permission denied"));

      const { useSettingsStore } = await import(
        "../../src/stores/useSettingsStore"
      );
      const store = useSettingsStore();
      await store.loadAutoStartStatus();

      expect(store.isAutoStartEnabled).toBe(false);
      expect(console.error).toHaveBeenCalled();
    });
  });

  describe("toggleAutoStart", () => {
    it("[P0] 启用 → 关闭：应呼叫 disable", async () => {
      mockIsEnabled.mockResolvedValue(true);
      mockDisable.mockResolvedValue(undefined);

      const { useSettingsStore } = await import(
        "../../src/stores/useSettingsStore"
      );
      const store = useSettingsStore();
      await store.loadAutoStartStatus();
      expect(store.isAutoStartEnabled).toBe(true);

      await store.toggleAutoStart();

      expect(mockDisable).toHaveBeenCalledOnce();
      expect(store.isAutoStartEnabled).toBe(false);
    });

    it("[P0] 关闭 → 启用：应呼叫 enable", async () => {
      mockIsEnabled.mockResolvedValue(false);
      mockEnable.mockResolvedValue(undefined);

      const { useSettingsStore } = await import(
        "../../src/stores/useSettingsStore"
      );
      const store = useSettingsStore();
      await store.loadAutoStartStatus();
      expect(store.isAutoStartEnabled).toBe(false);

      await store.toggleAutoStart();

      expect(mockEnable).toHaveBeenCalledOnce();
      expect(store.isAutoStartEnabled).toBe(true);
    });

    it("[P0] toggle 失败应抛出错误", async () => {
      mockIsEnabled.mockResolvedValue(false);
      mockEnable.mockRejectedValue(new Error("System error"));

      const { useSettingsStore } = await import(
        "../../src/stores/useSettingsStore"
      );
      const store = useSettingsStore();
      await store.loadAutoStartStatus();

      await expect(store.toggleAutoStart()).rejects.toThrow("System error");
      expect(store.isAutoStartEnabled).toBe(false);
    });
  });

  describe("initializeAutoStart", () => {
    it("[P0] 首次启动应自动启用自启动", async () => {
      mockStoreGet.mockImplementation(async (key: string) => {
        if (key === "hasInitAutoStart") return null;
        return null;
      });
      mockEnable.mockResolvedValue(undefined);

      const { useSettingsStore } = await import(
        "../../src/stores/useSettingsStore"
      );
      const store = useSettingsStore();
      await store.initializeAutoStart();

      expect(mockEnable).toHaveBeenCalledOnce();
      expect(mockStoreSet).toHaveBeenCalledWith("hasInitAutoStart", true);
      expect(mockStoreSave).toHaveBeenCalled();
      expect(store.isAutoStartEnabled).toBe(true);
    });

    it("[P0] 非首次启动应读取现有状态", async () => {
      mockStoreGet.mockImplementation(async (key: string) => {
        if (key === "hasInitAutoStart") return true;
        return null;
      });
      mockIsEnabled.mockResolvedValue(true);

      const { useSettingsStore } = await import(
        "../../src/stores/useSettingsStore"
      );
      const store = useSettingsStore();
      await store.initializeAutoStart();

      expect(mockEnable).not.toHaveBeenCalled();
      expect(mockIsEnabled).toHaveBeenCalledOnce();
      expect(store.isAutoStartEnabled).toBe(true);
    });

    it("[P0] 初始化失败应静默处理", async () => {
      mockStoreGet.mockRejectedValue(new Error("Store error"));

      const { useSettingsStore } = await import(
        "../../src/stores/useSettingsStore"
      );
      const store = useSettingsStore();
      await store.initializeAutoStart();

      expect(store.isAutoStartEnabled).toBe(false);
      expect(console.error).toHaveBeenCalled();
    });
  });
});
