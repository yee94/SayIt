<script setup lang="ts">
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import {
  BookOpen,
  Download,
  FileText,
  LayoutDashboard,
  Lightbulb,
  Settings,
} from "lucide-vue-next";
import { useI18n } from "vue-i18n";
import { computed, markRaw, onMounted, onUnmounted, ref, watch } from "vue";
import { RouterLink, RouterView, useRoute } from "vue-router";
import AccessibilityGuide from "./components/AccessibilityGuide.vue";
import SiteHeader from "./components/SiteHeader.vue";
import sayItLogoUrl from "./assets/logo-sayit.png";
import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useFeedbackMessage } from "./composables/useFeedbackMessage";
import { listenToEvent, VOCABULARY_CHANGED } from "./composables/useTauriEvents";
import { useSettingsStore } from "./stores/useSettingsStore";
import { useVocabularyStore } from "./stores/useVocabularyStore";
import { runVocabularySyncIfEnabled } from "./lib/runVocabularySync";
import { captureError } from "./lib/sentry";
import { getDatabaseInitError } from "./lib/database";
import type { UnlistenFn } from "@tauri-apps/api/event";
import type { UpdateCheckResult } from "./lib/autoUpdater";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarHeader,
  SidebarInset,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
} from "@/components/ui/sidebar";

declare const __APP_VERSION__: string;
const appVersion = __APP_VERSION__;
const { t } = useI18n();

const navItems = computed(() => [
  { path: "/dashboard", label: t("mainApp.nav.dashboard"), icon: markRaw(LayoutDashboard) },
  { path: "/history", label: t("mainApp.nav.history"), icon: markRaw(FileText) },
  { path: "/dictionary", label: t("mainApp.nav.dictionary"), icon: markRaw(BookOpen) },
  { path: "/settings", label: t("mainApp.nav.settings"), icon: markRaw(Settings) },
  { path: "/guide", label: t("mainApp.nav.guide"), icon: markRaw(Lightbulb) },
]);

const route = useRoute();
const currentPageTitle = computed(() => {
  const item = navItems.value.find((n) => route.path.startsWith(n.path));
  return item?.label ?? "SayIt";
});

// 必须在 app.mount() 后读取 — setDatabaseInitError 在 bootstrap catch 中已设定
const databaseError = ref(getDatabaseInitError());
const showAccessibilityGuide = ref(false);

// ── 更新相关状态 ──
type UpdateUiState = "idle" | "checking" | "downloading" | "ready-to-install" | "installing";
const updateState = ref<UpdateUiState>("idle");
const availableVersion = ref("");
const updateFeedback = useFeedbackMessage();
const AUTO_CHECK_INITIAL_DELAY_MS = 5_000;
const AUTO_CHECK_INTERVAL_MS = 15 * 60_000; // 15 分钟
let autoCheckTimeoutId: ReturnType<typeof setTimeout> | null = null;
let autoCheckIntervalId: ReturnType<typeof setInterval> | null = null;

// AlertDialog 控制
const showManualUpdateDialog = ref(false);
const showAutoInstallDialog = ref(false);

// 升级提示（watch 而非 onMounted，因为 loadSettings 在 mount 之后才执行）
const settingsStore = useSettingsStore();
const showUpgradeNoticeDialog = ref(false);
const upgradeNoticeItemCount = 1;
watch(
  () => settingsStore.vocabularySyncDirectoryPath,
  (path, prev) => {
    if (path.trim() && path.trim() !== (prev ?? "").trim()) {
      scheduleVocabularySync("path-changed");
    }
  },
);

watch(() => settingsStore.showPromptUpgradeNotice, (shouldShow) => {
  if (shouldShow) {
    showUpgradeNoticeDialog.value = true;
    settingsStore.showPromptUpgradeNotice = false;
  }
});

// ── 流程 1：自动侦测（静默检查 → 静默下载 → 通知安装） ──
async function autoCheckAndDownload() {
  if (updateState.value !== "idle") return;

  try {
    const { checkForAppUpdate, downloadUpdate } = await import("./lib/autoUpdater");
    const result = await checkForAppUpdate();

    if (result.status !== "update-available" || !result.version) return;

    availableVersion.value = result.version;
    updateState.value = "downloading";

    await downloadUpdate();

    updateState.value = "ready-to-install";

    // 确保 Dashboard 可见再弹 dialog
    const currentWindow = getCurrentWindow();
    await currentWindow.show();
    await currentWindow.setFocus();

    showAutoInstallDialog.value = true;
  } catch (err) {
    console.error("[main-window] Auto update check/download failed:", err);
    captureError(err, { source: "updater", step: "auto-check" });
    updateState.value = "idle";
  }
}

// 使用者在自动流程的 AlertDialog 中点「安装并重启」
async function handleAutoInstall() {
  showAutoInstallDialog.value = false;
  updateState.value = "installing";
  try {
    const { installAndRelaunch } = await import("./lib/autoUpdater");
    await installAndRelaunch();
  } catch (err) {
    console.error("[main-window] Auto install failed:", err);
    updateFeedback.show("error", t("mainApp.update.installFailed"));
    updateState.value = "idle";
    availableVersion.value = "";
  }
}

// 使用者在自动流程的 AlertDialog 中点「稍后」
function handleAutoInstallLater() {
  showAutoInstallDialog.value = false;
  // 保持 ready-to-install 状态，sidebar 仍显示「立即安装」按钮
}

// sidebar footer 的「立即安装」按钮（自动下载完成后显示）
async function handleSidebarInstall() {
  showAutoInstallDialog.value = true;
}

// ── 流程 2：手动检查更新 ──
async function handleManualCheck() {
  if (updateState.value !== "idle" && updateState.value !== "ready-to-install") return;

  // 如果已有待安装的更新，直接弹 dialog
  if (updateState.value === "ready-to-install") {
    showAutoInstallDialog.value = true;
    return;
  }

  updateState.value = "checking";
  try {
    const { checkForAppUpdate } = await import("./lib/autoUpdater");
    const result = await checkForAppUpdate();
    handleManualCheckResult(result);
  } catch (err) {
    console.error("[main-window] Manual update check failed:", err);
    captureError(err, { source: "updater", step: "manual-check" });
    updateFeedback.show("error", t("mainApp.update.checkError"));
    updateState.value = "idle";
  }
}

function handleManualCheckResult(result: UpdateCheckResult) {
  if (result.status === "up-to-date") {
    updateFeedback.show("success", t("mainApp.update.upToDate"));
    updateState.value = "idle";
  } else if (result.status === "update-available") {
    availableVersion.value = result.version ?? "";
    updateState.value = "idle";
    showManualUpdateDialog.value = true;
  } else {
    updateFeedback.show("error", t("mainApp.update.checkFailed"));
    updateState.value = "idle";
  }
}

// 使用者在手动流程的 AlertDialog 中点「开始更新」
async function handleManualUpdate() {
  showManualUpdateDialog.value = false;
  updateState.value = "downloading";
  try {
    const { downloadInstallAndRelaunch } = await import("./lib/autoUpdater");
    await downloadInstallAndRelaunch();
  } catch (err) {
    console.error("[main-window] Manual update failed:", err);
    updateFeedback.show("error", t("mainApp.update.updateFailed"));
    updateState.value = "idle";
    availableVersion.value = "";
  }
}

// ── Sidebar footer 显示逻辑 ──
const updateButtonLabel = computed(() => {
  switch (updateState.value) {
    case "checking": return t("mainApp.update.checking");
    case "downloading": return t("mainApp.update.downloading");
    case "installing": return t("mainApp.update.installing");
    default: return t("mainApp.update.checkUpdate");
  }
});

const isUpdateBusy = computed(() =>
  updateState.value === "checking" ||
  updateState.value === "downloading" ||
  updateState.value === "installing"
);


const vocabularyStore = useVocabularyStore();
let unlistenVocabularyChanged: UnlistenFn | null = null;
const VOCAB_SYNC_DEBOUNCE_MS = 30_000;
const VOCAB_SYNC_INTERVAL_MS = 5 * 60_000;
let vocabularySyncDebounceId: ReturnType<typeof setTimeout> | null = null;
let vocabularySyncIntervalId: ReturnType<typeof setInterval> | null = null;

function scheduleVocabularySync(reason: string) {
  if (!settingsStore.isVocabularySyncEnabled) return;
  console.log(`[main-window] schedule vocabulary sync (${reason})`);
  if (vocabularySyncDebounceId) clearTimeout(vocabularySyncDebounceId);
  const delay = reason === "change" ? VOCAB_SYNC_DEBOUNCE_MS : 0;
  vocabularySyncDebounceId = setTimeout(() => {
    vocabularySyncDebounceId = null;
    void runVocabularySyncIfEnabled().catch((err) => {
      console.error("[main-window] vocabulary sync failed:", err);
    });
  }, delay);
}

onMounted(async () => {
  // 监听词汇变更（HUD 视窗 AI 新增词汇时同步 Dashboard）
  unlistenVocabularyChanged = await listenToEvent(VOCABULARY_CHANGED, () => {
    console.log("[main-window] VOCABULARY_CHANGED received, refreshing termList");
    void vocabularyStore.fetchTermList();
    scheduleVocabularySync("change");
  });

  // iCloud 词典同步：启动立即同步，之后每 5 分钟
  void vocabularyStore.fetchTermList().finally(() => {
    scheduleVocabularySync("startup");
  });
  vocabularySyncIntervalId = setInterval(() => {
    scheduleVocabularySync("interval");
  }, VOCAB_SYNC_INTERVAL_MS);

  // macOS 无障碍权限检查
  const isMacOS = navigator.userAgent.includes("Macintosh");
  if (isMacOS) {
    try {
      const hasAccessibilityPermission = await invoke<boolean>(
        "check_accessibility_permission_command",
      );
      showAccessibilityGuide.value = !hasAccessibilityPermission;
    } catch (error) {
      console.error(
        "[main-window] Failed to check accessibility permission:",
        error,
      );
      captureError(error, { source: "accessibility", step: "check-permission" });
    }
  }

  // 自动检查更新：启动 5 秒后首次检查，之后每 15 分钟重查
  autoCheckTimeoutId = setTimeout(() => {
    autoCheckAndDownload();
    autoCheckIntervalId = setInterval(autoCheckAndDownload, AUTO_CHECK_INTERVAL_MS);
  }, AUTO_CHECK_INITIAL_DELAY_MS);
});

onUnmounted(() => {
  unlistenVocabularyChanged?.();
  if (vocabularySyncDebounceId) clearTimeout(vocabularySyncDebounceId);
  if (vocabularySyncIntervalId) clearInterval(vocabularySyncIntervalId);
  if (autoCheckTimeoutId) clearTimeout(autoCheckTimeoutId);
  if (autoCheckIntervalId) clearInterval(autoCheckIntervalId);
});
</script>

<template>
  <!-- macOS Overlay 自订标题列：fixed z-20 盖住 Sidebar(z-10)，整条可拖动 -->
  <div
    data-tauri-drag-region
    class="fixed top-0 left-0 right-0 z-20 flex h-9 items-center justify-center border-b border-border bg-background"
  >
    <span data-tauri-drag-region class="text-xs font-medium text-muted-foreground select-none">SayIt</span>
  </div>

  <SidebarProvider class="h-screen !min-h-0 pt-9">
    <Sidebar collapsible="offcanvas">
      <SidebarHeader class="h-14 flex-row items-center gap-2.5 border-b border-sidebar-border px-4">
        <img :src="sayItLogoUrl" alt="SayIt" class="h-9 w-9 shrink-0 rounded-[10px] object-cover" />
        <span class="text-base font-semibold tracking-wide text-sidebar-foreground" style="font-family: 'SF Pro Display', 'Inter', system-ui, sans-serif;">SayIt</span>
      </SidebarHeader>
      <SidebarContent>
        <SidebarGroup class="p-3">
          <SidebarGroupContent>
            <SidebarMenu>
              <SidebarMenuItem v-for="item in navItems" :key="item.path">
                <SidebarMenuButton
                  as-child
                  :is-active="route.path.startsWith(item.path)"
                  class="h-10 gap-3 px-3 text-[15px] data-[active=true]:bg-primary/15 data-[active=true]:text-primary [&>svg]:size-[18px]"
                >
                  <RouterLink :to="item.path">
                    <component :is="item.icon" />
                    <span>{{ item.label }}</span>
                  </RouterLink>
                </SidebarMenuButton>
              </SidebarMenuItem>
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
      <SidebarFooter class="border-t border-sidebar-border px-4 py-3">
        <div class="flex items-center justify-between">
          <span class="text-xs text-muted-foreground">v{{ appVersion }}</span>
          <!-- ready-to-install 时不显示检查按钮，改显示安装提示 -->
          <Button
            v-if="updateState !== 'ready-to-install'"
            variant="link"
            class="h-auto p-0 text-xs text-muted-foreground"
            :disabled="isUpdateBusy"
            @click="handleManualCheck"
          >
            {{ updateButtonLabel }}
          </Button>
        </div>
        <!-- 自动下载完成：显示持久的安装提示 -->
        <div v-if="updateState === 'ready-to-install'" class="mt-1.5 flex items-center justify-between rounded-md bg-primary/10 px-2 py-1.5">
          <span class="text-xs font-medium text-primary">v{{ availableVersion }} {{ $t("mainApp.update.ready") }}</span>
          <Button
            size="sm"
            class="h-6 gap-1 px-2 text-xs"
            @click="handleSidebarInstall"
          >
            <Download class="h-3 w-3" />
            {{ $t("mainApp.update.installNow") }}
          </Button>
        </div>
        <p
          v-if="updateFeedback.message.value"
          class="mt-1 text-xs"
          :class="updateFeedback.type.value === 'success' ? 'text-primary' : 'text-destructive'"
        >
          {{ updateFeedback.message.value }}
        </p>
      </SidebarFooter>
    </Sidebar>

    <SidebarInset class="overflow-hidden">
      <SiteHeader :title="currentPageTitle" />
      <div
        v-if="databaseError"
        class="border-b border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive"
      >
        <p class="font-medium">{{ $t("errors.databaseInitFailed") }}</p>
        <p class="mt-1 text-xs text-destructive/80">{{ databaseError }}</p>
      </div>
      <div class="flex-1 overflow-y-auto bg-background">
        <RouterView />
      </div>
    </SidebarInset>
  </SidebarProvider>

  <AccessibilityGuide
    :visible="showAccessibilityGuide"
    @close="showAccessibilityGuide = false"
  />

  <!-- 自动流程 AlertDialog：更新已下载，询问是否安装重启 -->
  <AlertDialog :open="showAutoInstallDialog">
    <AlertDialogContent>
      <AlertDialogHeader>
        <AlertDialogTitle>{{ $t("mainApp.update.autoInstallTitle") }}</AlertDialogTitle>
        <AlertDialogDescription>
          {{ $t("mainApp.update.autoInstallDescription", { version: availableVersion }) }}
        </AlertDialogDescription>
      </AlertDialogHeader>
      <AlertDialogFooter>
        <AlertDialogCancel @click="handleAutoInstallLater">{{ $t("mainApp.update.later") }}</AlertDialogCancel>
        <AlertDialogAction @click="handleAutoInstall">{{ $t("mainApp.update.installRestart") }}</AlertDialogAction>
      </AlertDialogFooter>
    </AlertDialogContent>
  </AlertDialog>

  <!-- 升级提示 AlertDialog -->
  <AlertDialog :open="showUpgradeNoticeDialog">
    <AlertDialogContent>
      <AlertDialogHeader>
        <AlertDialogTitle>{{ $t("mainApp.upgradeNotice.title") }}</AlertDialogTitle>
        <AlertDialogDescription as="div">
          <ol class="mt-2 space-y-3 text-sm text-muted-foreground list-decimal list-inside">
            <li v-for="i in upgradeNoticeItemCount" :key="i">
              {{ $t(`mainApp.upgradeNotice.item${i}`) }}
            </li>
          </ol>
        </AlertDialogDescription>
      </AlertDialogHeader>
      <AlertDialogFooter>
        <AlertDialogAction @click="showUpgradeNoticeDialog = false">{{ $t("mainApp.upgradeNotice.dismiss") }}</AlertDialogAction>
      </AlertDialogFooter>
    </AlertDialogContent>
  </AlertDialog>

  <!-- 手动流程 AlertDialog：发现新版本，询问是否开始更新 -->
  <AlertDialog :open="showManualUpdateDialog">
    <AlertDialogContent>
      <AlertDialogHeader>
        <AlertDialogTitle>{{ $t("mainApp.update.newVersionTitle") }}</AlertDialogTitle>
        <AlertDialogDescription>
          {{ $t("mainApp.update.newVersionDescription", { version: availableVersion }) }}
        </AlertDialogDescription>
      </AlertDialogHeader>
      <AlertDialogFooter>
        <AlertDialogCancel @click="showManualUpdateDialog = false">{{ $t("mainApp.update.cancel") }}</AlertDialogCancel>
        <AlertDialogAction @click="handleManualUpdate">{{ $t("mainApp.update.startUpdate") }}</AlertDialogAction>
      </AlertDialogFooter>
    </AlertDialogContent>
  </AlertDialog>
</template>
