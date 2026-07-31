import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  mergeVocabularySnapshots,
  syncVocabularyWithDirectory,
} from "../../src/lib/vocabularySync";
import { serializeVocabularyCsv } from "../../src/lib/vocabularyCsv";
import type { VocabularyEntry } from "../../src/types/vocabulary";

const mockInvoke = vi.fn();
vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => mockInvoke(...args),
}));

function entry(
  partial: Partial<VocabularyEntry> & Pick<VocabularyEntry, "id" | "term">,
): VocabularyEntry {
  return {
    weight: 1,
    source: "manual",
    createdAt: "2026-01-01 00:00:00",
    ...partial,
  };
}

describe("mergeVocabularySnapshots", () => {
  it("unions terms from multiple devices", () => {
    const merged = mergeVocabularySnapshots([
      {
        deviceId: "a",
        entries: [entry({ id: "1", term: "Alpha" })],
      },
      {
        deviceId: "b",
        entries: [entry({ id: "2", term: "Beta" })],
      },
    ]);
    expect(merged.map((e) => e.term).sort()).toEqual(["Alpha", "Beta"]);
  });

  it("merges same term case-insensitively with max weight and manual preference", () => {
    const merged = mergeVocabularySnapshots([
      {
        deviceId: "a",
        entries: [
          entry({
            id: "1",
            term: "SayIt",
            weight: 2,
            source: "ai",
            createdAt: "2026-01-01 00:00:00",
          }),
        ],
      },
      {
        deviceId: "b",
        entries: [
          entry({
            id: "2",
            term: "sayit",
            weight: 5,
            source: "manual",
            createdAt: "2026-01-02 00:00:00",
          }),
        ],
      },
    ]);
    expect(merged).toHaveLength(1);
    expect(merged[0]?.weight).toBe(5);
    expect(merged[0]?.source).toBe("manual");
    expect(merged[0]?.id).toBe("2");
  });

  it("uses newer createdAt then deviceId for stable LWW identity", () => {
    const merged = mergeVocabularySnapshots([
      {
        deviceId: "device-a",
        entries: [
          entry({
            id: "old",
            term: "术语",
            createdAt: "2026-01-01 00:00:00",
          }),
        ],
      },
      {
        deviceId: "device-b",
        entries: [
          entry({
            id: "new",
            term: "术语",
            createdAt: "2026-02-01 00:00:00",
          }),
        ],
      },
    ]);
    expect(merged[0]?.id).toBe("new");
  });

  it("breaks ties with lexicographically larger deviceId when createdAt matches", () => {
    const merged = mergeVocabularySnapshots([
      {
        deviceId: "device-a",
        entries: [
          entry({
            id: "from-a",
            term: "Tie",
            createdAt: "2026-01-01 00:00:00",
          }),
        ],
      },
      {
        deviceId: "device-b",
        entries: [
          entry({
            id: "from-b",
            term: "Tie",
            createdAt: "2026-01-01 00:00:00",
          }),
        ],
      },
    ]);
    expect(merged[0]?.id).toBe("from-b");
  });

  it("skips blank terms", () => {
    const merged = mergeVocabularySnapshots([
      {
        deviceId: "a",
        entries: [
          entry({ id: "1", term: "   " }),
          entry({ id: "2", term: "Keep" }),
        ],
      },
    ]);
    expect(merged.map((e) => e.term)).toEqual(["Keep"]);
  });

  it("keeps manual source even when ai snapshot is newer", () => {
    const merged = mergeVocabularySnapshots([
      {
        deviceId: "a",
        entries: [
          entry({
            id: "manual",
            term: "API",
            source: "manual",
            weight: 1,
            createdAt: "2026-01-01 00:00:00",
          }),
        ],
      },
      {
        deviceId: "b",
        entries: [
          entry({
            id: "ai",
            term: "API",
            source: "ai",
            weight: 3,
            createdAt: "2026-06-01 00:00:00",
          }),
        ],
      },
    ]);
    expect(merged[0]?.source).toBe("manual");
    expect(merged[0]?.weight).toBe(3);
    expect(merged[0]?.id).toBe("ai");
  });
});

describe("syncVocabularyWithDirectory", () => {
  beforeEach(() => {
    mockInvoke.mockReset();
  });

  it("writes local snapshot then merges remote snapshots", async () => {
    const local = [entry({ id: "local-1", term: "Local" })];
    const remote = [entry({ id: "remote-1", term: "Remote" })];

    mockInvoke.mockImplementation(async (cmd: string) => {
      if (cmd === "write_vocabulary_sync_snapshot") {
        return "/tmp/sayit-vocabulary-device-local.csv";
      }
      if (cmd === "list_vocabulary_sync_snapshots") {
        return [
          {
            deviceId: "device-local",
            path: "/tmp/sayit-vocabulary-device-local.csv",
            content: serializeVocabularyCsv(local),
          },
          {
            deviceId: "device-remote",
            path: "/tmp/sayit-vocabulary-device-remote.csv",
            content: serializeVocabularyCsv(remote),
          },
        ];
      }
      throw new Error(`unexpected invoke: ${cmd}`);
    });

    const result = await syncVocabularyWithDirectory({
      directoryPath: "/tmp/sync",
      deviceId: "device-local",
      localEntries: local,
    });

    expect(mockInvoke).toHaveBeenCalledWith("write_vocabulary_sync_snapshot", {
      directoryPath: "/tmp/sync",
      deviceId: "device-local",
      content: serializeVocabularyCsv(local),
    });
    expect(result.snapshotCount).toBe(2);
    expect(result.changed).toBe(true);
    expect(result.mergedEntries.map((e) => e.term).sort()).toEqual([
      "Local",
      "Remote",
    ]);
  });

  it("reports unchanged when merge equals local list", async () => {
    const local = [entry({ id: "1", term: "Only" })];
    mockInvoke.mockImplementation(async (cmd: string) => {
      if (cmd === "write_vocabulary_sync_snapshot") return "/tmp/x.csv";
      if (cmd === "list_vocabulary_sync_snapshots") {
        return [
          {
            deviceId: "device-local",
            path: "/tmp/x.csv",
            content: serializeVocabularyCsv(local),
          },
        ];
      }
      throw new Error(`unexpected invoke: ${cmd}`);
    });

    const result = await syncVocabularyWithDirectory({
      directoryPath: "/tmp/sync",
      deviceId: "device-local",
      localEntries: local,
    });

    expect(result.changed).toBe(false);
    expect(result.mergedEntries).toEqual(local);
  });

  it("rejects empty directoryPath or deviceId", async () => {
    await expect(
      syncVocabularyWithDirectory({
        directoryPath: "  ",
        deviceId: "d1",
        localEntries: [],
      }),
    ).rejects.toThrow(/directory is empty/);

    await expect(
      syncVocabularyWithDirectory({
        directoryPath: "/tmp",
        deviceId: " ",
        localEntries: [],
      }),
    ).rejects.toThrow(/deviceId is empty/);
  });
});
