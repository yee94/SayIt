import { invoke } from "@tauri-apps/api/core";
import {
  parseVocabularyCsv,
  serializeVocabularyCsv,
  sortVocabularyEntries,
} from "./vocabularyCsv";
import type { VocabularyEntry, VocabularySource } from "../types/vocabulary";

export interface VocabularySyncSnapshot {
  deviceId: string;
  path: string;
  content: string;
}

export interface VocabularySyncResult {
  mergedEntries: VocabularyEntry[];
  snapshotCount: number;
  changed: boolean;
}

function normalizeTermKey(term: string): string {
  return term.trim().toLowerCase();
}

function sourceRank(source: VocabularySource): number {
  return source === "manual" ? 2 : 1;
}

/**
 * 合并多份词典快照：
 * - 以规范化 term 为键做并集
 * - weight 取 max
 * - source：manual 优先于 ai
 * - 其余字段 LWW：较新 createdAt 胜出；同刻以 deviceId 字典序大者胜出（稳定）
 */
export function mergeVocabularySnapshots(
  snapshotList: Array<{ deviceId: string; entries: VocabularyEntry[] }>,
): VocabularyEntry[] {
  type Candidate = {
    entry: VocabularyEntry;
    deviceId: string;
  };

  const byTerm = new Map<string, Candidate>();

  for (const snapshot of snapshotList) {
    for (const entry of snapshot.entries) {
      const key = normalizeTermKey(entry.term);
      if (!key) continue;

      const incoming: Candidate = {
        entry: {
          ...entry,
          term: entry.term.trim(),
          weight: Math.max(1, entry.weight),
        },
        deviceId: snapshot.deviceId,
      };

      const existing = byTerm.get(key);
      if (!existing) {
        byTerm.set(key, incoming);
        continue;
      }

      const weight = Math.max(existing.entry.weight, incoming.entry.weight);
      const source: VocabularySource =
        sourceRank(existing.entry.source) >= sourceRank(incoming.entry.source)
          ? existing.entry.source
          : incoming.entry.source;

      const createdCmp = incoming.entry.createdAt.localeCompare(
        existing.entry.createdAt,
      );
      const deviceCmp = incoming.deviceId.localeCompare(existing.deviceId);
      const preferIncoming =
        createdCmp > 0 || (createdCmp === 0 && deviceCmp > 0);

      const winner = preferIncoming ? incoming : existing;
      byTerm.set(key, {
        deviceId: winner.deviceId,
        entry: {
          ...winner.entry,
          weight,
          source,
        },
      });
    }
  }

  return sortVocabularyEntries(
    Array.from(byTerm.values()).map((candidate) => candidate.entry),
  );
}

function sameVocabularyList(
  left: VocabularyEntry[],
  right: VocabularyEntry[],
): boolean {
  if (left.length !== right.length) return false;
  for (let i = 0; i < left.length; i += 1) {
    const a = left[i];
    const b = right[i];
    if (!a || !b) return false;
    if (
      a.id !== b.id ||
      a.term !== b.term ||
      a.weight !== b.weight ||
      a.source !== b.source ||
      a.createdAt !== b.createdAt
    ) {
      return false;
    }
  }
  return true;
}

/**
 * 执行一次同步：写出本机快照 → 读取目录全部快照 → 合并 → 回传是否需要写回本地。
 */
export async function syncVocabularyWithDirectory(options: {
  directoryPath: string;
  deviceId: string;
  localEntries: VocabularyEntry[];
}): Promise<VocabularySyncResult> {
  const directoryPath = options.directoryPath.trim();
  const deviceId = options.deviceId.trim();
  if (!directoryPath) {
    throw new Error("vocabulary sync directory is empty");
  }
  if (!deviceId) {
    throw new Error("vocabulary sync deviceId is empty");
  }

  const localContent = serializeVocabularyCsv(options.localEntries);
  await invoke<string>("write_vocabulary_sync_snapshot", {
    directoryPath,
    deviceId,
    content: localContent,
  });

  const snapshots = await invoke<VocabularySyncSnapshot[]>(
    "list_vocabulary_sync_snapshots",
    { directoryPath },
  );

  const parsed = snapshots.map((snapshot) => ({
    deviceId: snapshot.deviceId,
    entries: parseVocabularyCsv(snapshot.content),
  }));

  // 确保本机最新内存态参与合并（避免刚写盘后读到旧档）
  const withoutSelf = parsed.filter((item) => item.deviceId !== deviceId);
  const mergedEntries = mergeVocabularySnapshots([
    ...withoutSelf,
    { deviceId, entries: options.localEntries },
  ]);

  const localSorted = sortVocabularyEntries(options.localEntries);
  return {
    mergedEntries,
    snapshotCount: Math.max(snapshots.length, 1),
    changed: !sameVocabularyList(localSorted, mergedEntries),
  };
}

export async function pickVocabularySyncDirectory(): Promise<string | null> {
  const selected = await invoke<string | null>(
    "pick_vocabulary_sync_directory",
  );
  const trimmed = selected?.trim() ?? "";
  return trimmed.length > 0 ? trimmed : null;
}
