import { syncVocabularyWithDirectory } from "./vocabularySync";
import { extractErrorMessage } from "./errorUtils";
import { captureError } from "./sentry";
import {
  emitToWindow,
  VOCABULARY_CHANGED,
} from "../composables/useTauriEvents";
import { useSettingsStore } from "../stores/useSettingsStore";
import { useVocabularyStore } from "../stores/useVocabularyStore";
import type { VocabularyChangedPayload } from "../types/events";

let syncInFlight: Promise<boolean> | null = null;

/**
 * 若已设置同步目录，则执行一次词典同步。
 * @returns 是否实际执行了同步
 */
export async function runVocabularySyncIfEnabled(): Promise<boolean> {
  const settingsStore = useSettingsStore();
  if (!settingsStore.isVocabularySyncEnabled) return false;

  if (syncInFlight) {
    return syncInFlight;
  }

  syncInFlight = (async () => {
    const vocabularyStore = useVocabularyStore();
    try {
      try {
        await vocabularyStore.fetchTermList();
      } catch {
        // 空库或载入失败时仍尝试以目前记忆体内容同步
      }

      const directoryPath = settingsStore.vocabularySyncDirectoryPath.trim();
      const deviceId = (
        await settingsStore.ensureVocabularySyncDeviceId()
      ).trim();

      const result = await syncVocabularyWithDirectory({
        directoryPath,
        deviceId,
        localEntries: vocabularyStore.termList,
      });

      if (result.changed) {
        // replaceAllTerms 刻意不广播，避免同步写回再触发 MainApp 排程；
        // 仅通知 HUD 视窗重载合并后的词典。
        await vocabularyStore.replaceAllTerms(result.mergedEntries);
        void emitToWindow("main", VOCABULARY_CHANGED, {
          action: "updated",
          term: result.mergedEntries[0]?.term ?? "",
        } satisfies VocabularyChangedPayload);
      }

      await settingsStore.saveVocabularySyncLastSyncedAt(
        new Date().toISOString(),
      );
      return true;
    } catch (error) {
      console.error(
        `[vocabulary-sync] sync failed: ${extractErrorMessage(error)}`,
      );
      captureError(error, { source: "vocabulary-sync", step: "run" });
      throw error;
    } finally {
      syncInFlight = null;
    }
  })();

  return syncInFlight;
}
