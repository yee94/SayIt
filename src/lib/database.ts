import Database from "@tauri-apps/plugin-sql";

let db: Database | null = null;
let initPromise: Promise<Database> | null = null;
let databaseInitError: string | null = null;

export function getDatabaseInitError(): string | null {
  return databaseInitError;
}

export function setDatabaseInitError(error: string): void {
  databaseInitError = error;
}

async function tableExists(
  connection: Database,
  tableName: string,
): Promise<boolean> {
  const rows = await connection.select<{ name: string }[]>(
    "SELECT name FROM sqlite_master WHERE type='table' AND name=$1",
    [tableName],
  );
  return rows.length > 0;
}

async function hasColumn(
  connection: Database,
  tableName: string,
  columnName: string,
): Promise<boolean> {
  const columns = await connection.select<{ name: string }[]>(
    `PRAGMA table_info(${tableName})`,
  );
  return columns.some((col) => col.name === columnName);
}

/** 幂等 ADD COLUMN：栏位已存在时跳过，避免 crash 后重试时 duplicate column 错误 */
async function addColumnIfNotExists(
  connection: Database,
  tableName: string,
  columnDefinition: string,
): Promise<void> {
  const columnName = columnDefinition.split(/\s+/)[0];
  if (!columnName) {
    throw new Error(
      `[database] Invalid columnDefinition: "${columnDefinition}"`,
    );
  }
  if (!(await hasColumn(connection, tableName, columnName))) {
    await connection.execute(
      `ALTER TABLE ${tableName} ADD COLUMN ${columnDefinition};`,
    );
  }
}

/**
 * Dashboard 专用：建立连线池 + 执行 migration。
 * 只有 main-window.ts（Dashboard）应呼叫此函式。
 */
export async function initializeDatabase(): Promise<Database> {
  if (db) return db;
  if (initPromise) return initPromise;

  initPromise = doInitializeDatabase();
  try {
    return await initPromise;
  } catch (err) {
    initPromise = null;
    throw err;
  }
}

/**
 * HUD 专用：等待 Dashboard 建好连线池后复用，永不呼叫 Database.load()。
 * Database.load() 会在 Rust 端以 HashMap.insert() 覆盖既有 Pool，
 * 若 Dashboard 正在用旧 Pool 跑 migration，transaction context 会遗失，
 * 导致 DROP TABLE 等破坏性操作失去 rollback 保护。
 */
export async function connectToDatabase(
  maxRetries = 100,
  retryDelayMs = 100,
): Promise<Database> {
  if (db) return db;

  for (let i = 0; i < maxRetries; i++) {
    try {
      const existing = Database.get("sqlite:app.db");
      await existing.execute("PRAGMA busy_timeout = 5000;");
      await existing.select<{ n: number }[]>("SELECT 1 AS n");
      db = existing;
      console.log("[database] HUD connected to existing database pool");
      return db;
    } catch {
      if (i < maxRetries - 1) {
        await new Promise((resolve) => setTimeout(resolve, retryDelayMs));
      }
    }
  }

  // Fallback：Dashboard 尚未载入（极罕见），HUD 自行初始化
  console.warn("[database] HUD fallback: initializing database directly");
  return doInitializeDatabase();
}

async function doInitializeDatabase(): Promise<Database> {
  // 使用 local variable，确保只有 schema 全部建立成功才设定 singleton
  const connection = await Database.load("sqlite:app.db");

  await connection.execute("PRAGMA journal_mode = WAL;");
  await connection.execute("PRAGMA synchronous = NORMAL;");
  await connection.execute("PRAGMA busy_timeout = 5000;");

  await connection.execute(`
    CREATE TABLE IF NOT EXISTS transcriptions (
      id TEXT PRIMARY KEY,
      timestamp INTEGER NOT NULL,
      raw_text TEXT NOT NULL,
      processed_text TEXT,
      recording_duration_ms INTEGER NOT NULL,
      transcription_duration_ms INTEGER NOT NULL,
      enhancement_duration_ms INTEGER,
      char_count INTEGER NOT NULL,
      trigger_mode TEXT NOT NULL CHECK(trigger_mode IN ('hold', 'toggle')),
      was_enhanced INTEGER NOT NULL DEFAULT 0,
      was_modified INTEGER,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);

  await connection.execute(`
    CREATE INDEX IF NOT EXISTS idx_transcriptions_timestamp
    ON transcriptions(timestamp DESC);
  `);

  await connection.execute(`
    CREATE INDEX IF NOT EXISTS idx_transcriptions_created_at
    ON transcriptions(created_at);
  `);

  await connection.execute(`
    CREATE TABLE IF NOT EXISTS vocabulary (
      id TEXT PRIMARY KEY,
      term TEXT NOT NULL UNIQUE,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);

  await connection.execute(`
    CREATE TABLE IF NOT EXISTS schema_version (
      version INTEGER PRIMARY KEY
    );
  `);

  await connection.execute(
    "INSERT OR IGNORE INTO schema_version (version) VALUES (1);",
  );

  // --- Migration v1 → v2: api_usage table ---
  const versionRows = await connection.select<{ version: number }[]>(
    "SELECT version FROM schema_version ORDER BY version DESC LIMIT 1",
  );
  const currentVersion = versionRows[0]?.version ?? 1;

  if (currentVersion < 2) {
    await connection.execute(`
      CREATE TABLE IF NOT EXISTS api_usage (
        id TEXT PRIMARY KEY,
        transcription_id TEXT NOT NULL,
        api_type TEXT NOT NULL CHECK(api_type IN ('whisper', 'chat')),
        model TEXT NOT NULL,
        prompt_tokens INTEGER,
        completion_tokens INTEGER,
        total_tokens INTEGER,
        prompt_time_ms REAL,
        completion_time_ms REAL,
        total_time_ms REAL,
        audio_duration_ms INTEGER,
        estimated_cost_ceiling REAL,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        FOREIGN KEY (transcription_id) REFERENCES transcriptions(id)
      );
    `);

    await connection.execute(`
      CREATE INDEX IF NOT EXISTS idx_api_usage_transcription_id
      ON api_usage(transcription_id);
    `);

    await connection.execute(
      "INSERT OR REPLACE INTO schema_version (version) VALUES (2);",
    );

    console.log("[database] Migration v1 → v2: created api_usage table");
  }

  // --- Migration v2 → v3: vocabulary weight/source + api_usage CHECK expansion ---
  const v3VersionRows = await connection.select<{ version: number }[]>(
    "SELECT version FROM schema_version ORDER BY version DESC LIMIT 1",
  );
  const v3CurrentVersion = v3VersionRows[0]?.version ?? 1;

  if (v3CurrentVersion < 3) {
    // 先补上 weight/source 栏位，后续建立 idx_vocabulary_weight 才看得到 weight
    await addColumnIfNotExists(
      connection,
      "vocabulary",
      "weight INTEGER NOT NULL DEFAULT 1",
    );
    await addColumnIfNotExists(
      connection,
      "vocabulary",
      "source TEXT NOT NULL DEFAULT 'manual'",
    );

    // 不使用显式交易：tauri-plugin-sql 连线池无连线亲和性，
    // 跨 execute() 呼叫的 BEGIN/COMMIT 会落在不同连线而失败
    // （cannot commit - no transaction is active）。改为依赖幂等语句 +
    // 下方关键表恢复逻辑确保可重复执行。
    await connection.execute(
      "CREATE INDEX IF NOT EXISTS idx_vocabulary_weight ON vocabulary(weight DESC);",
    );

    // api_usage 表重建（扩展 CHECK constraint 加入 'vocabulary_analysis'）
    // SQLite 不支援 ALTER CONSTRAINT，必须重建
    // 若上次 rebuild 在 DROP api_usage 后、RENAME 前崩溃，api_usage_new 会是
    // 唯一资料副本，先还原成 api_usage，避免被下方 DROP 清掉造成资料遗失
    if (
      !(await tableExists(connection, "api_usage")) &&
      (await tableExists(connection, "api_usage_new"))
    ) {
      await connection.execute("ALTER TABLE api_usage_new RENAME TO api_usage;");
    }
    // 清除上次失败可能残留的暂存表（此时 api_usage 必为资料来源，drop 安全）
    await connection.execute("DROP TABLE IF EXISTS api_usage_new;");
    await connection.execute(`
      CREATE TABLE api_usage_new (
        id TEXT PRIMARY KEY,
        transcription_id TEXT NOT NULL,
        api_type TEXT NOT NULL CHECK(api_type IN ('whisper', 'chat', 'vocabulary_analysis')),
        model TEXT NOT NULL,
        prompt_tokens INTEGER,
        completion_tokens INTEGER,
        total_tokens INTEGER,
        prompt_time_ms REAL,
        completion_time_ms REAL,
        total_time_ms REAL,
        audio_duration_ms INTEGER,
        estimated_cost_ceiling REAL,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        FOREIGN KEY (transcription_id) REFERENCES transcriptions(id)
      );
    `);
    // api_usage 可能在先前失败的 migration 中被 DROP 而未 RENAME 回来
    const hasApiUsage = await tableExists(connection, "api_usage");
    if (hasApiUsage) {
      await connection.execute(
        "INSERT INTO api_usage_new SELECT * FROM api_usage;",
      );
      await connection.execute("DROP TABLE api_usage;");
    }
    await connection.execute("ALTER TABLE api_usage_new RENAME TO api_usage;");
    await connection.execute(`
      CREATE INDEX IF NOT EXISTS idx_api_usage_transcription_id
      ON api_usage(transcription_id);
    `);

    await connection.execute(
      "INSERT OR REPLACE INTO schema_version (version) VALUES (3);",
    );

    console.log(
      "[database] Migration v2 → v3: vocabulary weight/source + api_usage CHECK expansion",
    );
  }

  // --- Migration v3 → v4: recording storage + status ---
  const v4VersionRows = await connection.select<{ version: number }[]>(
    "SELECT version FROM schema_version ORDER BY version DESC LIMIT 1",
  );
  const v4CurrentVersion = v4VersionRows[0]?.version ?? 1;

  if (v4CurrentVersion < 4) {
    // 先补上 audio_file_path/status 栏位，后续建立 idx_transcriptions_status 才看得到 status
    await addColumnIfNotExists(
      connection,
      "transcriptions",
      "audio_file_path TEXT",
    );
    await addColumnIfNotExists(
      connection,
      "transcriptions",
      "status TEXT NOT NULL DEFAULT 'success'",
    );

    await connection.execute(
      "CREATE INDEX IF NOT EXISTS idx_transcriptions_status ON transcriptions(status);",
    );
    await connection.execute(
      "INSERT OR REPLACE INTO schema_version (version) VALUES (4);",
    );
    console.log(
      "[database] Migration v3 → v4: recording storage + status columns",
    );
  }

  // --- Migration v4 → v5: hallucination_terms table ---
  const v5VersionRows = await connection.select<{ version: number }[]>(
    "SELECT version FROM schema_version ORDER BY version DESC LIMIT 1",
  );
  const v5CurrentVersion = v5VersionRows[0]?.version ?? 1;

  if (v5CurrentVersion < 5) {
    await connection.execute(`
      CREATE TABLE IF NOT EXISTS hallucination_terms (
        id TEXT PRIMARY KEY,
        term TEXT NOT NULL UNIQUE,
        source TEXT NOT NULL CHECK(source IN ('builtin', 'auto', 'manual')),
        locale TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
    `);
    await connection.execute(`
      CREATE INDEX IF NOT EXISTS idx_hallucination_terms_locale
      ON hallucination_terms(locale);
    `);
    await connection.execute(
      "INSERT OR REPLACE INTO schema_version (version) VALUES (5);",
    );
    console.log("[database] Migration v4 → v5: hallucination_terms table");
  }

  // --- Migration v5 → v6: recalculate char_count from raw_text ---
  const v6VersionRows = await connection.select<{ version: number }[]>(
    "SELECT version FROM schema_version ORDER BY version DESC LIMIT 1",
  );
  const v6CurrentVersion = v6VersionRows[0]?.version ?? 1;

  if (v6CurrentVersion < 6) {
    await connection.execute(`
      UPDATE transcriptions
      SET char_count = LENGTH(raw_text)
      WHERE processed_text IS NOT NULL
        AND char_count != LENGTH(raw_text);
    `);
    await connection.execute(
      "INSERT OR REPLACE INTO schema_version (version) VALUES (6);",
    );
    console.log(
      "[database] Migration v5 → v6: recalculate char_count from raw_text",
    );
  }

  // --- Migration v6 → v7: remove hallucination_terms table ---
  const v7VersionRows = await connection.select<{ version: number }[]>(
    "SELECT version FROM schema_version ORDER BY version DESC LIMIT 1",
  );
  const v7CurrentVersion = v7VersionRows[0]?.version ?? 1;

  if (v7CurrentVersion < 7) {
    await connection.execute("DROP TABLE IF EXISTS hallucination_terms;");
    await connection.execute(
      "INSERT OR REPLACE INTO schema_version (version) VALUES (7);",
    );
    console.log(
      "[database] Migration v6 → v7: removed hallucination_terms table",
    );
  }

  // --- Migration v7 → v8: edit mode columns ---
  const v8VersionRows = await connection.select<{ version: number }[]>(
    "SELECT version FROM schema_version ORDER BY version DESC LIMIT 1",
  );
  const v8CurrentVersion = v8VersionRows[0]?.version ?? 1;

  if (v8CurrentVersion < 8) {
    await addColumnIfNotExists(
      connection,
      "transcriptions",
      "is_edit_mode INTEGER NOT NULL DEFAULT 0",
    );
    await addColumnIfNotExists(
      connection,
      "transcriptions",
      "edit_source_text TEXT",
    );

    await connection.execute(
      "INSERT OR REPLACE INTO schema_version (version) VALUES (8);",
    );
    console.log(
      "[database] Migration v7 → v8: edit mode columns",
    );
  }

  // --- Migration v8 → v9: vocabulary soft-delete + updated_at ---
  const v9VersionRows = await connection.select<{ version: number }[]>(
    "SELECT version FROM schema_version ORDER BY version DESC LIMIT 1",
  );
  const v9CurrentVersion = v9VersionRows[0]?.version ?? 1;

  if (v9CurrentVersion < 9) {
    await addColumnIfNotExists(
      connection,
      "vocabulary",
      "updated_at TEXT",
    );
    await addColumnIfNotExists(
      connection,
      "vocabulary",
      "deleted_at TEXT",
    );

    // 存量行用 created_at 回填 updated_at，供后续多设备同步元数据
    await connection.execute(`
      UPDATE vocabulary
      SET updated_at = created_at
      WHERE updated_at IS NULL;
    `);

    await connection.execute(
      "INSERT OR REPLACE INTO schema_version (version) VALUES (9);",
    );
    console.log(
      "[database] Migration v8 → v9: vocabulary soft-delete + updated_at",
    );
  }

  // --- 关键表验证与恢复 ---
  // 先前版本的 migration 可能因连线池覆盖导致 DROP TABLE 后未 RENAME，
  // 若 api_usage 不存在则以最新 schema 重建（资料已遗失，但 app 可正常运作）

  // vocabulary column 恢复（issue #27）：
  // 某些 Windows 环境下 v3 migration 将 schema_version 推进到 ≥3，
  // 但 weight/source column 却没成功落地，导致 INSERT 时报
  // "table vocabulary has no column named source"。
  // 这里无条件重跑幂等的 addColumnIfNotExists，已存在则跳过、缺失则补上。
  if (await tableExists(connection, "vocabulary")) {
    await addColumnIfNotExists(
      connection,
      "vocabulary",
      "weight INTEGER NOT NULL DEFAULT 1",
    );
    await addColumnIfNotExists(
      connection,
      "vocabulary",
      "source TEXT NOT NULL DEFAULT 'manual'",
    );
    await addColumnIfNotExists(
      connection,
      "vocabulary",
      "updated_at TEXT",
    );
    await addColumnIfNotExists(
      connection,
      "vocabulary",
      "deleted_at TEXT",
    );
    // 崩溃恢复后可能补上 updated_at 但未回填
    await connection.execute(`
      UPDATE vocabulary
      SET updated_at = COALESCE(updated_at, created_at, datetime('now'))
      WHERE updated_at IS NULL;
    `);
  }

  if (!(await tableExists(connection, "api_usage"))) {
    // 可能有残留的 api_usage_new（上次 migration 建了但没 RENAME 成功）
    if (await tableExists(connection, "api_usage_new")) {
      await connection.execute(
        "ALTER TABLE api_usage_new RENAME TO api_usage;",
      );
      console.log("[database] Recovery: renamed api_usage_new → api_usage");
    } else {
      await connection.execute(`
        CREATE TABLE api_usage (
          id TEXT PRIMARY KEY,
          transcription_id TEXT NOT NULL,
          api_type TEXT NOT NULL CHECK(api_type IN ('whisper', 'chat', 'vocabulary_analysis')),
          model TEXT NOT NULL,
          prompt_tokens INTEGER,
          completion_tokens INTEGER,
          total_tokens INTEGER,
          prompt_time_ms REAL,
          completion_time_ms REAL,
          total_time_ms REAL,
          audio_duration_ms INTEGER,
          estimated_cost_ceiling REAL,
          created_at TEXT NOT NULL DEFAULT (datetime('now')),
          FOREIGN KEY (transcription_id) REFERENCES transcriptions(id)
        );
      `);
      await connection.execute(`
        CREATE INDEX IF NOT EXISTS idx_api_usage_transcription_id
        ON api_usage(transcription_id);
      `);
      console.log("[database] Recovery: recreated missing api_usage table");
    }
  }

  // 只有全部 schema 建立成功才设定 singleton
  db = connection;
  console.log("[database] SQLite initialized with WAL mode");

  return db;
}

export function getDatabase(): Database {
  if (!db) {
    throw new Error(
      "[database] Database not initialized. Call initializeDatabase() first.",
    );
  }
  return db;
}
