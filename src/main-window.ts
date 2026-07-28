import { createApp, nextTick } from "vue";
import { createPinia } from "pinia";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import MainApp from "./MainApp.vue";
import router from "./router";
import { initializeDatabase, setDatabaseInitError } from "./lib/database";
import {
  emitEvent,
  listenToEvent,
  DATABASE_READY,
  DATABASE_READY_PING,
} from "./composables/useTauriEvents";
import { extractErrorMessage } from "./lib/errorUtils";
import { initSentryForDashboard, captureError } from "./lib/sentry";
import { useSettingsStore } from "./stores/useSettingsStore";
import i18n from "./i18n";
import "./style.css";

// 停用 WebView 预设右键选单（Back / Reload），让 app 行为更接近原生
document.addEventListener("contextmenu", (e) => e.preventDefault());

async function bootstrap() {
  const pinia = createPinia();
  const app = createApp(MainApp);

  initSentryForDashboard(app, router);

  window.addEventListener("unhandledrejection", (event) => {
    captureError(event.reason, { source: "dashboard-unhandled-rejection" });
  });

  app.config.errorHandler = (err, _instance, info) => {
    console.error("[Dashboard] Vue error:", err);
    captureError(err, { source: "dashboard-vue-error", info });
  };

  app.use(pinia).use(i18n).use(router);

  // DB 必须在 mount 之前初始化，否则 View 的 onMounted 会因 getDatabase() 抛错而全部失败
  try {
    await initializeDatabase();
    // migration 完成：先注册 ping 回应再广播，通知 HUD 可安全存取连线池
    await listenToEvent(DATABASE_READY_PING, () => {
      void emitEvent(DATABASE_READY);
    });
    await emitEvent(DATABASE_READY);
  } catch (err) {
    const message = extractErrorMessage(err);
    console.error("[main-window] Database init failed:", message);
    captureError(err, { source: "database-init" });
    setDatabaseInitError(message);
    await invoke("debug_log", {
      level: "error",
      message: `Database init failed: ${message}`,
    });
  }

  app.mount("#app");
  await router.isReady();

  const settingsStore = useSettingsStore();
  await settingsStore.loadSettings();
  await settingsStore.consumeUpgradeNotice();
  await settingsStore.initializeAutoStart();

  if (!settingsStore.hasApiKey) {
    await router.push("/settings");
    await nextTick();
    const currentWindow = getCurrentWindow();
    await currentWindow.show();
    await currentWindow.setFocus();
    console.log("[main-window] API Key missing, redirected to settings");
  }

  // 录音档自动清理（背景执行，不阻断启动）
  if (settingsStore.isRecordingAutoCleanupEnabled) {
    queueMicrotask(() => {
      void (async () => {
        try {
          const days = settingsStore.recordingAutoCleanupDays;
          const deletedIdList = await invoke<string[]>(
            "cleanup_old_recordings",
            { days },
          );
          if (deletedIdList.length > 0) {
            const { useHistoryStore } = await import(
              "./stores/useHistoryStore"
            );
            const historyStore = useHistoryStore();
            await historyStore.clearAudioFilePathByIdList(deletedIdList);
            console.log(
              `[main-window] Auto cleanup: removed ${deletedIdList.length} old recordings (>${days} days)`,
            );
          }
        } catch (err) {
          console.error(
            "[main-window] Auto cleanup failed:",
            extractErrorMessage(err),
          );
          captureError(err, { source: "auto-cleanup" });
        }
      })();
    });
  }

  // 更新检查由 MainApp.vue onMounted 的 autoCheckAndDownload() 处理
  console.log("[main-window] Dashboard initialized");
}

bootstrap().catch((err) => {
  console.error("[main-window] Failed to initialize:", err);
  captureError(err, { source: "bootstrap" });
});
