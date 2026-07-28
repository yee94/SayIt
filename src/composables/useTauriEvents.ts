import { emit, listen, type UnlistenFn } from "@tauri-apps/api/event";

export {
  emit as emitEvent,
  emitTo as emitToWindow,
} from "@tauri-apps/api/event";
export { listen as listenToEvent } from "@tauri-apps/api/event";

export const VOICE_FLOW_STATE_CHANGED = "voice-flow:state-changed" as const;
export const TRANSCRIPTION_COMPLETED = "transcription:completed" as const;
export const TRANSCRIPTION_PARTIAL = "transcription:partial" as const;
export const SETTINGS_UPDATED = "settings:updated" as const;
export const VOCABULARY_CHANGED = "vocabulary:changed" as const;

export const HOTKEY_PRESSED = "hotkey:pressed" as const;
export const HOTKEY_RELEASED = "hotkey:released" as const;
export const HOTKEY_TOGGLED = "hotkey:toggled" as const;
export const HOTKEY_ERROR = "hotkey:error" as const;

export const QUALITY_MONITOR_RESULT = "quality-monitor:result" as const;

export const AUDIO_WAVEFORM = "audio:waveform" as const;
export const AUDIO_PREVIEW_LEVEL = "audio:preview-level" as const;

export const CORRECTION_MONITOR_RESULT = "correction-monitor:result" as const;
export const VOCABULARY_LEARNED = "vocabulary:learned" as const;
export const ESCAPE_PRESSED = "escape:pressed" as const;
export const HOTKEY_MODE_TOGGLE = "hotkey:mode-toggle" as const;
export const HOTKEY_RECORDING_CAPTURED = "hotkey:recording-captured" as const;
export const HOTKEY_RECORDING_REJECTED = "hotkey:recording-rejected" as const;

// Dashboard 完成 DB migration 后广播；HUD 收到才开始存取连线池
export const DATABASE_READY = "database:ready" as const;
// HUD 请 Dashboard 重新广播 DATABASE_READY（解决事件早于监听的竞态）
export const DATABASE_READY_PING = "database:ready-ping" as const;

/**
 * HUD 等待 Dashboard 完成资料库 migration 后再存取连线池。
 *
 * 动机：tauri-plugin-sql 连线池无连线亲和性，若 HUD 在 Dashboard 跑
 * migration 时并发存取同一个 pool，会强迫 pool 多开一条连线，破坏
 * migration 的跨语句假设（曾导致 "cannot commit - no transaction is active"）。
 *
 * 以 ping/replay 解决「Dashboard 早于 HUD 监听就已广播」的竞态；逾时则
 * 回传 false，呼叫端可 fallback 至 connectToDatabase() 的 retry 回圈
 *（Dashboard 缺席或 init 失败时 HUD 仍可尝试自行连线）。
 */
export async function waitForDatabaseReady(timeoutMs = 8000): Promise<boolean> {
  return new Promise<boolean>((resolve) => {
    let settled = false;
    let unlisten: UnlistenFn | null = null;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const finish = (ready: boolean) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      if (unlisten) unlisten();
      resolve(ready);
    };

    void listen(DATABASE_READY, () => finish(true)).then((fn) => {
      unlisten = fn;
      // 监听建立前就逾时：立即解除刚建立的监听
      if (settled) {
        fn();
        return;
      }
      // 监听就绪后请 Dashboard 重新广播，补捉早于监听的 ready 事件
      void emit(DATABASE_READY_PING);
    });

    timer = setTimeout(() => finish(false), timeoutMs);
  });
}
