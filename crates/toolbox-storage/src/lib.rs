use rusqlite::{params, types::Type, Connection, OptionalExtension, Result, Row};
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use std::path::Path;
use toolbox_core::{tool_exists, CustomTool};

const DATABASE_SCHEMA_VERSION: i64 = 16;
pub const TOOL_STORAGE_BYTES: usize = 1024 * 1024;

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct Website {
    pub id: i64,
    pub name: String,
    pub url: String,
    pub description: String,
    pub tags: String,
    pub favorite: bool,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ConfigurationSnapshot {
    pub schema_version: u32,
    pub favorites: Vec<String>,
    pub websites: Vec<Website>,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct ModuleRecord {
    pub module_id: String,
    pub manifest: serde_json::Value,
    pub scripts: BTreeMap<String, String>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct BuiltInToolDisplay {
    pub id: String,
    pub name: String,
    pub description: String,
    pub category: String,
}

struct StagingCleanup(std::path::PathBuf);
impl Drop for StagingCleanup {
    fn drop(&mut self) {
        let _ = std::fs::remove_file(&self.0);
    }
}

pub struct Store {
    connection: Connection,
}

impl Store {
    pub fn open(path: &Path) -> Result<Self> {
        let connection = Connection::open(path)?;
        let mut store = Self { connection };
        store.migrate()?;
        Ok(store)
    }

    fn migrate(&mut self) -> Result<()> {
        self.connection.execute_batch("PRAGMA foreign_keys = ON;")?;
        let transaction = self.connection.transaction()?;
        transaction.execute_batch(
            "CREATE TABLE IF NOT EXISTS schema_migrations (
                 version INTEGER PRIMARY KEY,
                 applied_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
             );",
        )?;
        let version: i64 = transaction.query_row(
            "SELECT COALESCE(MAX(version), 0) FROM schema_migrations",
            [],
            |row| row.get(0),
        )?;
        if version > DATABASE_SCHEMA_VERSION {
            return Err(rusqlite::Error::SqliteFailure(
                rusqlite::ffi::Error::new(rusqlite::ffi::SQLITE_SCHEMA),
                Some(format!(
                    "本地数据库版本 {version} 高于当前应用支持的版本 {DATABASE_SCHEMA_VERSION}，请使用更新版本的应用。"
                )),
            ));
        }
        if version == 0 {
            transaction.execute_batch(
                "CREATE TABLE favorites (
                     tool_id TEXT PRIMARY KEY NOT NULL,
                     created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
                 );
                 INSERT INTO schema_migrations(version) VALUES (1);",
            )?;
        }
        if version < 2 {
            transaction.execute_batch(
                "CREATE TABLE websites (
                     id INTEGER PRIMARY KEY AUTOINCREMENT,
                     name TEXT NOT NULL,
                     url TEXT NOT NULL,
                     description TEXT NOT NULL DEFAULT '',
                     tags TEXT NOT NULL DEFAULT '',
                     favorite INTEGER NOT NULL DEFAULT 0,
                     created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
                 );
                 INSERT INTO schema_migrations(version) VALUES (2);",
            )?;
        }
        if version < 3 {
            transaction.execute_batch(
                "CREATE TABLE custom_tools (
                     id INTEGER PRIMARY KEY AUTOINCREMENT,
                     name TEXT NOT NULL,
                     description TEXT NOT NULL,
                     tags_json TEXT NOT NULL,
                     steps_json TEXT NOT NULL,
                     created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                     updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
                 );
                 INSERT INTO schema_migrations(version) VALUES (3);",
            )?;
        }
        if version < 4 {
            transaction.execute_batch(
                "CREATE TABLE recent_tools (
                     tool_id TEXT PRIMARY KEY NOT NULL,
                     last_used_at_ms INTEGER NOT NULL,
                     usage_count INTEGER NOT NULL DEFAULT 1
                 );
                 INSERT INTO schema_migrations(version) VALUES (4);",
            )?;
        }
        if version < 5 {
            transaction.execute_batch(
                "CREATE TABLE modules (
                     module_id TEXT PRIMARY KEY NOT NULL,
                     manifest_json TEXT NOT NULL,
                     scripts_json TEXT NOT NULL,
                     installed_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
                 );
                 INSERT INTO schema_migrations(version) VALUES (5);",
            )?;
        }
        if version < 6 {
            transaction.execute_batch(
                "CREATE TABLE builtin_tool_display (
                     tool_id TEXT PRIMARY KEY NOT NULL,
                     name TEXT NOT NULL,
                     description TEXT NOT NULL,
                     category TEXT NOT NULL,
                     updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
                 );
                 INSERT INTO schema_migrations(version) VALUES (6);",
            )?;
        }
        if version < 7 {
            transaction.execute_batch(
                "CREATE TABLE hidden_tools (
                     tool_id TEXT PRIMARY KEY NOT NULL
                 );
                 INSERT INTO schema_migrations(version) VALUES (7);",
            )?;
        }
        if version < 8 {
            transaction.execute_batch(
                "CREATE TABLE builtin_tool_modules (
                     tool_id TEXT PRIMARY KEY NOT NULL,
                     source TEXT NOT NULL,
                     updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
                 );
                 INSERT INTO schema_migrations(version) VALUES (8);",
            )?;
        }
        if version < 9 {
            transaction.execute_batch(
                "CREATE TABLE builtin_module_overrides (
                     module_id TEXT PRIMARY KEY NOT NULL,
                     manifest_json TEXT NOT NULL,
                     scripts_json TEXT NOT NULL,
                     updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
                 );
                 INSERT INTO schema_migrations(version) VALUES (9);",
            )?;
        }
        if version < 10 {
            transaction.execute_batch(
                "CREATE TABLE deleted_builtin_tools (
                     tool_id TEXT PRIMARY KEY NOT NULL
                 );",
            )?;
            let legacy_ids: Vec<String> = {
                let mut statement = transaction.prepare("SELECT tool_id FROM hidden_tools")?;
                let ids = statement
                    .query_map([], |row| row.get(0))?
                    .collect::<Result<_>>()?;
                ids
            };
            for id in legacy_ids.into_iter().filter(|id| tool_exists(id)) {
                transaction.execute(
                    "INSERT INTO deleted_builtin_tools(tool_id) VALUES (?1)",
                    params![id],
                )?;
            }
            transaction.execute_batch(
                "DROP TABLE hidden_tools; INSERT INTO schema_migrations(version) VALUES (10);",
            )?;
        }
        if version < 11 {
            transaction.execute_batch(
                "CREATE TABLE sync_identities (
                     kind TEXT NOT NULL,
                     local_id TEXT NOT NULL,
                     sync_id TEXT NOT NULL,
                     PRIMARY KEY(kind, local_id),
                     UNIQUE(kind, sync_id)
                 );
                 INSERT INTO schema_migrations(version) VALUES (11);",
            )?;
        }
        // The unpublished schema 11 also accepts stores opened by an earlier
        // development build before identity aliases were added.
        transaction.execute_batch(
            "CREATE TABLE IF NOT EXISTS sync_identity_aliases (
            kind TEXT NOT NULL, sync_id TEXT NOT NULL, local_id TEXT NOT NULL,
            PRIMARY KEY(kind, sync_id)
        );",
        )?;
        if version < 12 {
            // Retired builtin entries must leave favorites, history and recovery.
            // Keep automation definitions intact so missing steps can be edited.
            transaction.execute_batch(
                "DELETE FROM favorites WHERE tool_id IN ('text.sort', 'text.stats');
                 DELETE FROM recent_tools WHERE tool_id IN ('text.sort', 'text.stats');
                 DELETE FROM deleted_builtin_tools WHERE tool_id IN ('text.sort', 'text.stats');
                 DELETE FROM builtin_tool_display WHERE tool_id IN ('text.sort', 'text.stats');
                 DELETE FROM builtin_tool_modules WHERE tool_id IN ('text.sort', 'text.stats');
                 DELETE FROM builtin_module_overrides WHERE module_id IN ('builtin.text.sort', 'builtin.text.stats');
                 INSERT INTO schema_migrations(version) VALUES (12);",
            )?;
        }
        if version < 13 {
            transaction.execute_batch(
                "CREATE TABLE resource_blobs (digest TEXT PRIMARY KEY NOT NULL, data BLOB NOT NULL);
                 CREATE TABLE module_resources (
                     module_id TEXT NOT NULL REFERENCES modules(module_id) ON DELETE CASCADE,
                     path TEXT NOT NULL,
                     digest TEXT NOT NULL REFERENCES resource_blobs(digest),
                     PRIMARY KEY(module_id, path)
                 );
                 CREATE TABLE resource_drafts (
                     scope_id TEXT NOT NULL,
                     path TEXT NOT NULL,
                     digest TEXT NOT NULL REFERENCES resource_blobs(digest),
                     PRIMARY KEY(scope_id, path)
                 );
                 INSERT INTO schema_migrations(version) VALUES (13);",
            )?;
        }
        if version < 14 {
            transaction.execute_batch(
                "CREATE TABLE builtin_resources (
                    module_id TEXT NOT NULL REFERENCES builtin_module_overrides(module_id) ON DELETE CASCADE,
                    path TEXT NOT NULL, digest TEXT NOT NULL REFERENCES resource_blobs(digest),
                    PRIMARY KEY(module_id,path)
                 );
                 CREATE VIEW all_module_resources AS SELECT * FROM module_resources UNION ALL SELECT * FROM builtin_resources;
                 INSERT INTO schema_migrations(version) VALUES (14);",
            )?;
        }
        if version < 15 {
            transaction.execute_batch(
                "ALTER TABLE custom_tools ADD COLUMN icon TEXT;
                ALTER TABLE custom_tools ADD COLUMN icon_data TEXT;
                INSERT INTO schema_migrations(version) VALUES (15);",
            )?;
        }
        if version < 16 {
            transaction.execute_batch(
                "CREATE TABLE IF NOT EXISTS tool_storage (
                    module_id TEXT PRIMARY KEY,
                    values_json TEXT NOT NULL CHECK(length(CAST(values_json AS BLOB)) <= 1048576)
                 );
                 INSERT INTO schema_migrations(version) VALUES (16);",
            )?;
        }
        transaction.commit()
    }

    fn checked_tool_storage(module_id: &str, values: &BTreeMap<String, String>) -> Result<String> {
        if module_id.is_empty()
            || module_id.len() > 256
            || !module_id
                .bytes()
                .all(|byte| byte.is_ascii_alphanumeric() || b"._-".contains(&byte))
            || values.keys().any(|key| key.encode_utf16().count() > 256)
        {
            return Err(rusqlite::Error::InvalidQuery);
        }
        let json = serde_json::to_string(values).map_err(|_| rusqlite::Error::InvalidQuery)?;
        if json.len() > TOOL_STORAGE_BYTES {
            return Err(rusqlite::Error::InvalidQuery);
        }
        Ok(json)
    }

    pub fn load_tool_storage(
        &self,
        module_id: &str,
        legacy: &BTreeMap<String, String>,
    ) -> Result<BTreeMap<String, String>> {
        let json = Self::checked_tool_storage(module_id, legacy)?;
        let stored = self.load_tool_storage_json(module_id, &json)?;
        serde_json::from_str(&stored).map_err(|_| rusqlite::Error::InvalidQuery)
    }

    pub fn check_tool_storage_json(&self, module_id: &str, json: &str) -> Result<()> {
        Self::checked_tool_storage(module_id, &BTreeMap::new())?;
        if json.len() > TOOL_STORAGE_BYTES {
            return Err(rusqlite::Error::InvalidQuery);
        }
        let valid: bool =
            self.connection
                .query_row("SELECT json_valid(?1)", params![json], |row| row.get(0))?;
        if !valid {
            return Err(rusqlite::Error::InvalidQuery);
        }
        let kind: String =
            self.connection
                .query_row("SELECT json_type(?1)", params![json], |row| row.get(0))?;
        if kind != "object" {
            return Err(rusqlite::Error::InvalidQuery);
        }
        let mut statement = self
            .connection
            .prepare("SELECT CAST(key AS BLOB),type FROM json_each(?1)")?;
        let entries = statement.query_map(params![json], |row| {
            Ok((row.get::<_, Vec<u8>>(0)?, row.get::<_, String>(1)?))
        })?;
        for entry in entries {
            let (key, kind) = entry?;
            // SQLite can represent escaped isolated surrogates as WTF-8.
            // Count UTF-16 units without converting those keys to Rust String.
            let units: usize = key
                .iter()
                .map(|byte| {
                    if byte & 0xc0 == 0x80 {
                        0
                    } else if byte & 0xf8 == 0xf0 {
                        2
                    } else {
                        1
                    }
                })
                .sum();
            if kind != "text" || units > 256 {
                return Err(rusqlite::Error::InvalidQuery);
            }
        }
        Ok(())
    }

    pub fn load_tool_storage_json(&self, module_id: &str, json: &str) -> Result<String> {
        self.check_tool_storage_json(module_id, json)?;
        let tx = self.connection.unchecked_transaction()?;
        tx.execute(
            "INSERT OR IGNORE INTO tool_storage(module_id,values_json) VALUES (?1,?2)",
            params![module_id, json],
        )?;
        let stored: String = tx.query_row(
            "SELECT values_json FROM tool_storage WHERE module_id=?1",
            params![module_id],
            |row| row.get(0),
        )?;
        tx.commit()?;
        Ok(stored)
    }

    pub fn save_tool_storage(
        &self,
        module_id: &str,
        values: &BTreeMap<String, String>,
    ) -> Result<()> {
        let json = Self::checked_tool_storage(module_id, values)?;
        self.save_tool_storage_json(module_id, &json)
    }

    pub fn save_tool_storage_json(&self, module_id: &str, json: &str) -> Result<()> {
        self.check_tool_storage_json(module_id, json)?;
        self.connection.execute("INSERT INTO tool_storage(module_id,values_json) VALUES (?1,?2) ON CONFLICT(module_id) DO UPDATE SET values_json=excluded.values_json", params![module_id,json])?;
        Ok(())
    }

    pub fn stored_tool_storage_json(&self, module_id: &str) -> Result<Option<String>> {
        Self::checked_tool_storage(module_id, &BTreeMap::new())?;
        self.connection
            .query_row(
                "SELECT values_json FROM tool_storage WHERE module_id=?1",
                params![module_id],
                |row| row.get(0),
            )
            .optional()
    }

    pub fn merge_tool_storage_json(
        &self,
        module_id: &str,
        incoming: &str,
        local: &str,
        replace: bool,
    ) -> Result<String> {
        self.check_tool_storage_json(module_id, incoming)?;
        self.check_tool_storage_json(module_id, local)?;
        let value = if replace {
            incoming.to_owned()
        } else {
            // JSON1 preserves escaped UTF-16 strings without a Rust String decode of individual values.
            self.connection.query_row(
                "SELECT json_patch(?1,?2)",
                params![incoming, local],
                |row| row.get(0),
            )?
        };
        self.check_tool_storage_json(module_id, &value)?;
        Ok(value)
    }

    pub fn clear_preview_tool_storage(&self) -> Result<usize> {
        self.connection.execute(
            "DELETE FROM tool_storage WHERE substr(module_id,1,8)='preview.'",
            [],
        )
    }

    pub fn sync_identity(&self, kind: &str, local_id: &str) -> Result<String> {
        if !matches!(kind, "automation" | "website") {
            return Err(rusqlite::Error::InvalidQuery);
        }
        if let Some(id) = self
            .connection
            .query_row(
                "SELECT sync_id FROM sync_identities WHERE kind = ?1 AND local_id = ?2",
                params![kind, local_id],
                |row| row.get(0),
            )
            .optional()?
        {
            return Ok(id);
        }
        let id = uuid::Uuid::new_v4().to_string();
        self.attach_sync_identity(kind, local_id, &id)?;
        Ok(id)
    }

    pub fn sync_local_id(&self, kind: &str, sync_id: &str) -> Result<Option<String>> {
        self.connection
            .query_row(
            "SELECT local_id FROM sync_identities WHERE kind = ?1 AND sync_id = ?2
             UNION ALL SELECT local_id FROM sync_identity_aliases WHERE kind = ?1 AND sync_id = ?2 LIMIT 1",
                params![kind, sync_id],
                |row| row.get(0),
            )
            .optional()
    }

    pub fn sync_identity_rows(&self) -> Result<Vec<(String, String, String)>> {
        let mut statement = self.connection.prepare("SELECT kind, local_id, sync_id FROM sync_identities
            UNION ALL SELECT kind, local_id, sync_id FROM sync_identity_aliases ORDER BY kind, local_id, sync_id")?;
        let rows = statement
            .query_map([], |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)))?
            .collect();
        rows
    }

    pub fn attach_sync_identity(&self, kind: &str, local_id: &str, sync_id: &str) -> Result<()> {
        if !matches!(kind, "automation" | "website") || uuid::Uuid::parse_str(sync_id).is_err() {
            return Err(rusqlite::Error::InvalidQuery);
        }
        self.connection.execute(
            "INSERT INTO sync_identities(kind, local_id, sync_id) VALUES (?1, ?2, ?3)
             ON CONFLICT(kind, sync_id) DO UPDATE SET local_id = excluded.local_id",
            params![kind, local_id, sync_id],
        )?;
        Ok(())
    }

    pub fn associate_sync_identity(&self, kind: &str, local_id: &str, sync_id: &str) -> Result<()> {
        if !matches!(kind, "automation" | "website") || uuid::Uuid::parse_str(sync_id).is_err() {
            return Err(rusqlite::Error::InvalidQuery);
        }
        let own: Option<String> = self
            .connection
            .query_row(
                "SELECT sync_id FROM sync_identities WHERE kind = ?1 AND local_id = ?2",
                params![kind, local_id],
                |row| row.get(0),
            )
            .optional()?;
        match own {
            None => self.attach_sync_identity(kind, local_id, sync_id),
            Some(own) if own == sync_id => Ok(()),
            Some(_) => {
                self.connection.execute(
                    "INSERT INTO sync_identity_aliases(kind, sync_id, local_id) VALUES (?1, ?2, ?3)
                ON CONFLICT(kind, sync_id) DO UPDATE SET local_id = excluded.local_id",
                    params![kind, sync_id, local_id],
                )?;
                Ok(())
            }
        }
    }

    /// Validate and write a batch in an isolated database, then commit it atomically.
    /// Existing methods may use their own transactions without nesting them.
    pub fn atomic_update<T>(
        &mut self,
        update: impl FnOnce(&Store) -> std::result::Result<T, String>,
    ) -> std::result::Result<T, String> {
        let staging_directory = self
            .connection
            .path()
            .and_then(|path| std::path::Path::new(path).parent())
            .filter(|path| !path.as_os_str().is_empty())
            .map(std::path::Path::to_path_buf)
            .unwrap_or_else(std::env::temp_dir);
        let staging_path =
            staging_directory.join(format!("firefly-staging-{}.sqlite", uuid::Uuid::new_v4()));
        let created = std::fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&staging_path)
            .map_err(|_| "无法准备同步暂存文件。")?;
        drop(created);
        let _cleanup = StagingCleanup(staging_path.clone());
        let mut isolated = Connection::open(&staging_path).map_err(|_| "无法准备同步事务。")?;
        rusqlite::backup::Backup::new(&self.connection, &mut isolated)
            .and_then(|backup| {
                backup.run_to_completion(128, std::time::Duration::from_millis(1), None)
            })
            .map_err(|_| "无法读取本机同步数据。")?;
        isolated
            .execute_batch("PRAGMA foreign_keys = ON;")
            .map_err(|_| "无法准备同步事务。")?;
        let staging = Store {
            connection: isolated,
        };
        let result = update(&staging)?;
        rusqlite::backup::Backup::new(&staging.connection, &mut self.connection)
            .and_then(|backup| {
                backup.run_to_completion(128, std::time::Duration::from_millis(1), None)
            })
            .map_err(|_| "同步写入失败，本机数据未更新。")?;
        Ok(result)
    }

    pub fn deleted_builtin_tool_ids(&self) -> Result<Vec<String>> {
        let mut statement = self
            .connection
            .prepare("SELECT tool_id FROM deleted_builtin_tools ORDER BY tool_id")?;
        let ids = statement.query_map([], |row| row.get(0))?.collect();
        ids
    }

    pub fn delete_builtin_tool(&self, tool_id: &str) -> Result<()> {
        if !tool_exists(tool_id) {
            return Err(rusqlite::Error::InvalidQuery);
        }
        let transaction = self.connection.unchecked_transaction()?;
        transaction.execute(
            "INSERT OR IGNORE INTO deleted_builtin_tools(tool_id) VALUES (?1)",
            params![tool_id],
        )?;
        transaction.execute("DELETE FROM favorites WHERE tool_id = ?1", params![tool_id])?;
        transaction.execute(
            "DELETE FROM recent_tools WHERE tool_id = ?1",
            params![tool_id],
        )?;
        transaction.commit()
    }

    pub fn restore_builtin_tools(&self, tool_ids: &[String]) -> Result<()> {
        if tool_ids.is_empty()
            || tool_ids.len() > toolbox_core::list_tools().len()
            || tool_ids.iter().any(|id| !tool_exists(id))
        {
            return Err(rusqlite::Error::InvalidQuery);
        }
        let transaction = self.connection.unchecked_transaction()?;
        for id in tool_ids {
            transaction.execute(
                "DELETE FROM deleted_builtin_tools WHERE tool_id = ?1",
                params![id],
            )?;
        }
        transaction.commit()
    }

    pub fn builtin_tool_displays(&self) -> Result<Vec<BuiltInToolDisplay>> {
        let mut statement = self.connection.prepare(
            "SELECT tool_id, name, description, category FROM builtin_tool_display ORDER BY tool_id",
        )?;
        let displays = statement
            .query_map([], |row| {
                Ok(BuiltInToolDisplay {
                    id: row.get(0)?,
                    name: row.get(1)?,
                    description: row.get(2)?,
                    category: row.get(3)?,
                })
            })?
            .collect();
        displays
    }

    pub fn save_builtin_tool_display(&self, display: &BuiltInToolDisplay) -> Result<()> {
        if !tool_exists(&display.id)
            || display.name.trim().is_empty()
            || display.name.chars().count() > 80
            || display.description.trim().is_empty()
            || display.description.chars().count() > 500
            || display.category.trim().is_empty()
            || display.category.chars().count() > 40
        {
            return Err(rusqlite::Error::InvalidQuery);
        }
        self.connection.execute(
            "INSERT INTO builtin_tool_display(tool_id, name, description, category)
             VALUES (?1, ?2, ?3, ?4)
             ON CONFLICT(tool_id) DO UPDATE SET name = excluded.name,
               description = excluded.description, category = excluded.category,
               updated_at = CURRENT_TIMESTAMP",
            params![
                display.id,
                display.name.trim(),
                display.description.trim(),
                display.category.trim()
            ],
        )?;
        Ok(())
    }

    pub fn reset_builtin_tool_display(&self, id: &str) -> Result<()> {
        if !tool_exists(id) {
            return Err(rusqlite::Error::InvalidQuery);
        }
        self.connection.execute(
            "DELETE FROM builtin_tool_display WHERE tool_id = ?1",
            params![id],
        )?;
        Ok(())
    }

    pub fn recent_tools(&self) -> Result<Vec<String>> {
        let mut statement = self.connection.prepare(
            "SELECT tool_id FROM recent_tools ORDER BY last_used_at_ms DESC, tool_id LIMIT 30",
        )?;
        let tools = statement.query_map([], |row| row.get(0))?.collect();
        tools
    }

    pub fn record_tool_use(&self, id: &str) -> Result<()> {
        let now = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map_err(|_| rusqlite::Error::InvalidQuery)?
            .as_millis() as i64;
        self.connection.execute(
            "INSERT INTO recent_tools(tool_id, last_used_at_ms) VALUES (?1, ?2)
             ON CONFLICT(tool_id) DO UPDATE SET last_used_at_ms = excluded.last_used_at_ms,
               usage_count = recent_tools.usage_count + 1",
            params![id, now],
        )?;
        self.connection.execute(
            "DELETE FROM recent_tools WHERE tool_id NOT IN
             (SELECT tool_id FROM recent_tools ORDER BY last_used_at_ms DESC, tool_id LIMIT 30)",
            [],
        )?;
        Ok(())
    }

    pub fn clear_recent_tools(&self) -> Result<()> {
        self.connection.execute("DELETE FROM recent_tools", [])?;
        Ok(())
    }

    pub fn export_configuration(&self) -> Result<ConfigurationSnapshot> {
        Ok(ConfigurationSnapshot {
            schema_version: 3,
            favorites: self
                .favorites()?
                .into_iter()
                .filter(|id| tool_exists(id))
                .collect(),
            websites: self.websites()?,
        })
    }

    pub fn replace_configuration(&self, backup: &ConfigurationSnapshot) -> Result<()> {
        if backup.schema_version != 3 || backup.favorites.iter().any(|id| !tool_exists(id)) {
            return Err(rusqlite::Error::InvalidQuery);
        }
        let local_custom_favorites: Vec<String> = self
            .favorites()?
            .into_iter()
            .filter(|id| !tool_exists(id))
            .collect();
        let transaction = self.connection.unchecked_transaction()?;
        transaction.execute("DELETE FROM favorites", [])?;
        transaction.execute("DELETE FROM websites", [])?;
        transaction.execute("DELETE FROM sync_identities WHERE kind = 'website'", [])?;
        transaction.execute(
            "DELETE FROM sync_identity_aliases WHERE kind = 'website'",
            [],
        )?;
        transaction.execute("DELETE FROM recent_tools", [])?;
        for site in &backup.websites {
            transaction.execute(
                "INSERT INTO websites(id, name, url, description, tags, favorite) VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
                params![site.id, site.name, site.url, site.description, site.tags, site.favorite],
            )?;
        }
        for id in backup.favorites.iter().chain(local_custom_favorites.iter()) {
            transaction.execute("INSERT INTO favorites(tool_id) VALUES (?1)", params![id])?;
        }
        transaction.commit()
    }

    fn read_custom_tool(row: &Row<'_>) -> Result<CustomTool> {
        let id: i64 = row.get(0)?;
        let tags_json: String = row.get(3)?;
        let steps_json: String = row.get(4)?;
        Ok(CustomTool {
            icon: row.get(5)?,
            icon_data: row.get(6)?,
            id: format!("custom.{id}"),
            name: row.get(1)?,
            description: row.get(2)?,
            tags: serde_json::from_str(&tags_json).map_err(|error| {
                rusqlite::Error::FromSqlConversionFailure(3, Type::Text, Box::new(error))
            })?,
            steps: serde_json::from_str(&steps_json).map_err(|error| {
                rusqlite::Error::FromSqlConversionFailure(4, Type::Text, Box::new(error))
            })?,
        })
    }

    fn custom_id(id: &str) -> Result<i64> {
        id.strip_prefix("custom.")
            .and_then(|value| value.parse::<i64>().ok())
            .filter(|value| *value > 0 && id == format!("custom.{value}"))
            .ok_or(rusqlite::Error::InvalidQuery)
    }

    pub fn custom_tools(&self) -> Result<Vec<CustomTool>> {
        let mut statement = self.connection.prepare(
            "SELECT id, name, description, tags_json, steps_json, icon, icon_data FROM custom_tools ORDER BY id DESC",
        )?;
        let tools = statement.query_map([], Self::read_custom_tool)?.collect();
        tools
    }

    pub fn custom_tool(&self, id: &str) -> Result<Option<CustomTool>> {
        self.connection
            .query_row(
                "SELECT id, name, description, tags_json, steps_json, icon, icon_data FROM custom_tools WHERE id = ?1",
                params![Self::custom_id(id)?],
                Self::read_custom_tool,
            )
            .optional()
    }

    pub fn save_custom_tool(&self, tool: &CustomTool) -> Result<CustomTool> {
        let tags = serde_json::to_string(&tool.tags).map_err(|_| rusqlite::Error::InvalidQuery)?;
        let steps =
            serde_json::to_string(&tool.steps).map_err(|_| rusqlite::Error::InvalidQuery)?;
        let id = if tool.id.is_empty() {
            self.connection.execute(
                "INSERT INTO custom_tools(name, description, tags_json, steps_json, icon, icon_data) VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
                params![tool.name, tool.description, tags, steps, tool.icon, tool.icon_data],
            )?;
            self.connection.last_insert_rowid()
        } else {
            let id = Self::custom_id(&tool.id)?;
            let updated = self.connection.execute(
                "UPDATE custom_tools SET name = ?1, description = ?2, tags_json = ?3, steps_json = ?4, updated_at = CURRENT_TIMESTAMP, icon = ?6, icon_data = ?7 WHERE id = ?5",
                params![tool.name, tool.description, tags, steps, id, tool.icon, tool.icon_data],
            )?;
            if updated == 0 {
                return Err(rusqlite::Error::QueryReturnedNoRows);
            }
            id
        };
        self.custom_tool(&format!("custom.{id}"))?
            .ok_or(rusqlite::Error::QueryReturnedNoRows)
    }

    pub fn delete_custom_tool(&self, id: &str) -> Result<()> {
        let transaction = self.connection.unchecked_transaction()?;
        transaction.execute("DELETE FROM favorites WHERE tool_id = ?1", params![id])?;
        transaction.execute("DELETE FROM recent_tools WHERE tool_id = ?1", params![id])?;
        let deleted = transaction.execute(
            "DELETE FROM custom_tools WHERE id = ?1",
            params![Self::custom_id(id)?],
        )?;
        transaction.execute(
            "DELETE FROM sync_identities WHERE kind = 'automation' AND local_id = ?1",
            params![id],
        )?;
        transaction.execute(
            "DELETE FROM sync_identity_aliases WHERE kind = 'automation' AND local_id = ?1",
            params![id],
        )?;
        if deleted == 0 {
            return Err(rusqlite::Error::QueryReturnedNoRows);
        }
        transaction.commit()
    }

    pub fn modules(&self) -> Result<Vec<ModuleRecord>> {
        let mut statement = self.connection.prepare(
            "SELECT module_id, manifest_json, scripts_json FROM modules ORDER BY module_id",
        )?;
        let modules = statement
            .query_map([], |row| {
                let manifest: String = row.get(1)?;
                let scripts: String = row.get(2)?;
                Ok(ModuleRecord {
                    module_id: row.get(0)?,
                    manifest: serde_json::from_str(&manifest).map_err(|error| {
                        rusqlite::Error::FromSqlConversionFailure(1, Type::Text, Box::new(error))
                    })?,
                    scripts: serde_json::from_str(&scripts).map_err(|error| {
                        rusqlite::Error::FromSqlConversionFailure(2, Type::Text, Box::new(error))
                    })?,
                })
            })?
            .collect();
        modules
    }

    pub fn module(&self, module_id: &str) -> Result<Option<ModuleRecord>> {
        self.connection
            .query_row(
                "SELECT manifest_json, scripts_json FROM modules WHERE module_id = ?1",
                params![module_id],
                |row| {
                    let manifest: String = row.get(0)?;
                    let scripts: String = row.get(1)?;
                    Ok(ModuleRecord {
                        module_id: module_id.to_owned(),
                        manifest: serde_json::from_str(&manifest).map_err(|error| {
                            rusqlite::Error::FromSqlConversionFailure(
                                0,
                                Type::Text,
                                Box::new(error),
                            )
                        })?,
                        scripts: serde_json::from_str(&scripts).map_err(|error| {
                            rusqlite::Error::FromSqlConversionFailure(
                                1,
                                Type::Text,
                                Box::new(error),
                            )
                        })?,
                    })
                },
            )
            .optional()
    }

    pub fn module_manifest(&self, module_id: &str) -> Result<Option<serde_json::Value>> {
        self.connection
            .query_row(
                "SELECT manifest_json FROM modules WHERE module_id = ?1 UNION ALL SELECT manifest_json FROM builtin_module_overrides WHERE module_id = ?1",
                params![module_id],
                |row| {
                    let manifest: String = row.get(0)?;
                    serde_json::from_str(&manifest).map_err(|error| {
                        rusqlite::Error::FromSqlConversionFailure(0, Type::Text, Box::new(error))
                    })
                },
            )
            .optional()
    }

    pub fn builtin_module_overrides(&self) -> Result<Vec<ModuleRecord>> {
        let mut statement = self.connection.prepare(
            "SELECT module_id, manifest_json, scripts_json FROM builtin_module_overrides ORDER BY module_id",
        )?;
        let records = statement
            .query_map([], |row| {
                let manifest: String = row.get(1)?;
                let scripts: String = row.get(2)?;
                Ok(ModuleRecord {
                    module_id: row.get(0)?,
                    manifest: serde_json::from_str(&manifest).map_err(|error| {
                        rusqlite::Error::FromSqlConversionFailure(1, Type::Text, Box::new(error))
                    })?,
                    scripts: serde_json::from_str(&scripts).map_err(|error| {
                        rusqlite::Error::FromSqlConversionFailure(2, Type::Text, Box::new(error))
                    })?,
                })
            })?
            .collect();
        records
    }

    pub fn builtin_tool_sources(&self) -> Result<BTreeMap<String, String>> {
        let mut statement = self
            .connection
            .prepare("SELECT tool_id, source FROM builtin_tool_modules")?;
        let sources = statement
            .query_map([], |row| Ok((row.get(0)?, row.get(1)?)))?
            .collect();
        sources
    }

    pub fn save_builtin_module(&self, module: &ModuleRecord, tool_id: &str) -> Result<()> {
        self.save_builtin_module_with_resources(module, tool_id, &BTreeMap::new())
    }

    pub fn save_builtin_module_with_resources(
        &self,
        module: &ModuleRecord,
        tool_id: &str,
        resources: &BTreeMap<String, Vec<u8>>,
    ) -> Result<()> {
        if !tool_exists(tool_id) || module.module_id != format!("builtin.{tool_id}") {
            return Err(rusqlite::Error::InvalidQuery);
        }
        let transaction = self.connection.unchecked_transaction()?;
        transaction.execute(
            "INSERT INTO builtin_module_overrides(module_id, manifest_json, scripts_json) VALUES (?1, ?2, ?3)
             ON CONFLICT(module_id) DO UPDATE SET manifest_json = excluded.manifest_json,
               scripts_json = excluded.scripts_json, updated_at = CURRENT_TIMESTAMP",
            params![module.module_id,
                serde_json::to_string(&module.manifest).map_err(|_| rusqlite::Error::InvalidQuery)?,
                serde_json::to_string(&module.scripts).map_err(|_| rusqlite::Error::InvalidQuery)?],
        )?;
        transaction.execute(
            "DELETE FROM builtin_tool_display WHERE tool_id = ?1",
            params![tool_id],
        )?;
        transaction.execute(
            "DELETE FROM builtin_tool_modules WHERE tool_id = ?1",
            params![tool_id],
        )?;
        transaction.execute(
            "DELETE FROM deleted_builtin_tools WHERE tool_id = ?1",
            params![tool_id],
        )?;
        transaction.execute(
            "DELETE FROM builtin_resources WHERE module_id=?1",
            params![module.module_id],
        )?;
        for (path, data) in resources {
            use sha2::{Digest, Sha256};
            let digest = format!("{:x}", Sha256::digest(data));
            transaction.execute(
                "INSERT OR IGNORE INTO resource_blobs(digest,data) VALUES (?1,?2)",
                params![digest, data],
            )?;
            transaction.execute(
                "INSERT INTO builtin_resources(module_id,path,digest) VALUES (?1,?2,?3)",
                params![module.module_id, path, digest],
            )?;
        }
        transaction.execute("DELETE FROM resource_blobs WHERE NOT EXISTS (SELECT 1 FROM all_module_resources WHERE all_module_resources.digest=resource_blobs.digest) AND NOT EXISTS (SELECT 1 FROM resource_drafts WHERE resource_drafts.digest=resource_blobs.digest)",[])?;
        transaction.commit()
    }

    pub fn reset_builtin_module(&self, module_id: &str, tool_id: &str) -> Result<()> {
        if !tool_exists(tool_id) || module_id != format!("builtin.{tool_id}") {
            return Err(rusqlite::Error::InvalidQuery);
        }
        let transaction = self.connection.unchecked_transaction()?;
        transaction.execute(
            "DELETE FROM builtin_module_overrides WHERE module_id = ?1",
            params![module_id],
        )?;
        transaction.execute(
            "DELETE FROM builtin_tool_display WHERE tool_id = ?1",
            params![tool_id],
        )?;
        transaction.execute(
            "DELETE FROM builtin_tool_modules WHERE tool_id = ?1",
            params![tool_id],
        )?;
        transaction.execute("DELETE FROM resource_blobs WHERE NOT EXISTS (SELECT 1 FROM all_module_resources WHERE all_module_resources.digest=resource_blobs.digest) AND NOT EXISTS (SELECT 1 FROM resource_drafts WHERE resource_drafts.digest=resource_blobs.digest)",[])?;
        transaction.commit()
    }

    pub fn install_module(&self, module: &ModuleRecord) -> Result<()> {
        self.connection.execute(
            "INSERT INTO modules(module_id, manifest_json, scripts_json) VALUES (?1, ?2, ?3)
             ON CONFLICT(module_id) DO UPDATE SET manifest_json = excluded.manifest_json,
               scripts_json = excluded.scripts_json, installed_at = CURRENT_TIMESTAMP",
            params![
                module.module_id,
                serde_json::to_string(&module.manifest)
                    .map_err(|_| rusqlite::Error::InvalidQuery)?,
                serde_json::to_string(&module.scripts)
                    .map_err(|_| rusqlite::Error::InvalidQuery)?
            ],
        )?;
        Ok(())
    }

    /// Source and binary resources become visible together, including on update.
    pub fn install_module_with_resources(
        &self,
        module: &ModuleRecord,
        resources: &BTreeMap<String, Vec<u8>>,
    ) -> Result<()> {
        let transaction = self.connection.unchecked_transaction()?;
        self.install_module(module)?;
        transaction.execute(
            "DELETE FROM module_resources WHERE module_id = ?1",
            params![module.module_id],
        )?;
        for (path, data) in resources {
            use sha2::{Digest, Sha256};
            let digest = format!("{:x}", Sha256::digest(data));
            transaction.execute(
                "INSERT OR IGNORE INTO resource_blobs(digest,data) VALUES (?1,?2)",
                params![digest, data],
            )?;
            transaction.execute(
                "INSERT INTO module_resources(module_id, path, digest) VALUES (?1, ?2, ?3)",
                params![module.module_id, path, digest],
            )?;
        }
        transaction.execute("DELETE FROM resource_blobs WHERE NOT EXISTS (SELECT 1 FROM all_module_resources WHERE all_module_resources.digest = resource_blobs.digest) AND NOT EXISTS (SELECT 1 FROM resource_drafts WHERE resource_drafts.digest = resource_blobs.digest)",[])?;
        transaction.commit()
    }

    pub fn module_resources(&self, module_id: &str) -> Result<BTreeMap<String, Vec<u8>>> {
        let mut statement = self.connection.prepare(
            "SELECT r.path, b.data FROM all_module_resources r JOIN resource_blobs b ON b.digest = r.digest WHERE r.module_id = ?1 ORDER BY r.path",
        )?;
        let rows = statement
            .query_map(params![module_id], |row| Ok((row.get(0)?, row.get(1)?)))?
            .collect();
        rows
    }

    /// SQLite reads only the requested chunk; tool listing never loads assets.
    pub fn resource_chunk(
        &self,
        module_id: &str,
        path: &str,
        offset: u64,
        length: usize,
    ) -> Result<Option<Vec<u8>>> {
        self.connection.query_row("SELECT substr(b.data, ?3, ?4) FROM all_module_resources r JOIN resource_blobs b ON b.digest = r.digest WHERE r.module_id = ?1 AND r.path = ?2",
            params![module_id, path, offset + 1, length], |row| row.get(0)).optional()
    }

    pub fn resource_bytes_except(&self, module_id: &str) -> Result<u64> {
        self.connection.query_row(
            "SELECT COALESCE(SUM(length(data)), 0) FROM resource_blobs WHERE digest IN (SELECT digest FROM all_module_resources WHERE module_id != ?1 UNION SELECT digest FROM resource_drafts)",
            params![module_id],
            |row| row.get(0),
        )
    }

    pub fn resource_used_elsewhere(&self, module_id: &str, digest: &str) -> Result<bool> {
        self.connection.query_row("SELECT EXISTS(SELECT 1 FROM all_module_resources WHERE module_id != ?1 AND digest = ?2) OR EXISTS(SELECT 1 FROM resource_drafts WHERE digest = ?2)",params![module_id,digest],|row|row.get(0))
    }

    pub fn save_resource_draft(&self, scope: &str, path: &str, data: &[u8]) -> Result<()> {
        use sha2::{Digest, Sha256};
        let digest = format!("{:x}", Sha256::digest(data));
        let tx = self.connection.unchecked_transaction()?;
        tx.execute(
            "INSERT OR IGNORE INTO resource_blobs(digest,data) VALUES (?1,?2)",
            params![digest, data],
        )?;
        tx.execute("INSERT INTO resource_drafts(scope_id,path,digest) VALUES (?1,?2,?3) ON CONFLICT(scope_id,path) DO UPDATE SET digest=excluded.digest",params![scope,path,digest])?;
        tx.execute("DELETE FROM resource_blobs WHERE NOT EXISTS (SELECT 1 FROM all_module_resources WHERE all_module_resources.digest=resource_blobs.digest) AND NOT EXISTS (SELECT 1 FROM resource_drafts WHERE resource_drafts.digest=resource_blobs.digest)",[])?;
        let (count,size):(u64,u64)=tx.query_row("SELECT COUNT(*),COALESCE(SUM(length(b.data)),0) FROM resource_drafts d JOIN resource_blobs b ON b.digest=d.digest WHERE d.scope_id=?1",params![scope],|row|Ok((row.get(0)?,row.get(1)?)))?;
        let total: u64 = tx.query_row(
            "SELECT COALESCE(SUM(length(data)),0) FROM resource_blobs",
            [],
            |row| row.get(0),
        )?;
        if count > 128 || size > 128 * 1024 * 1024 || total > 512 * 1024 * 1024 {
            return Err(rusqlite::Error::InvalidQuery);
        }
        tx.commit()
    }

    pub fn resource_drafts(&self, scope: &str) -> Result<BTreeMap<String, Vec<u8>>> {
        let mut statement=self.connection.prepare("SELECT d.path,b.data FROM resource_drafts d JOIN resource_blobs b ON b.digest=d.digest WHERE d.scope_id=?1 ORDER BY d.path")?;
        let rows = statement
            .query_map(params![scope], |row| Ok((row.get(0)?, row.get(1)?)))?
            .collect();
        rows
    }

    pub fn draft_resource_chunk(
        &self,
        scope: &str,
        path: &str,
        digest: &str,
        offset: u64,
        length: usize,
    ) -> Result<Option<Vec<u8>>> {
        self.connection.query_row("SELECT substr(b.data,?4,?5) FROM resource_drafts d JOIN resource_blobs b ON b.digest=d.digest WHERE d.scope_id=?1 AND d.path=?2 AND d.digest=?3",params![scope,path,digest,offset+1,length],|row|row.get(0)).optional()
    }

    pub fn delete_resource_drafts(&self, scope: &str, path: Option<&str>) -> Result<()> {
        let tx = self.connection.unchecked_transaction()?;
        if let Some(path) = path {
            tx.execute(
                "DELETE FROM resource_drafts WHERE scope_id=?1 AND path=?2",
                params![scope, path],
            )?;
        } else {
            tx.execute(
                "DELETE FROM resource_drafts WHERE scope_id=?1",
                params![scope],
            )?;
        }
        tx.execute("DELETE FROM resource_blobs WHERE NOT EXISTS (SELECT 1 FROM all_module_resources WHERE all_module_resources.digest=resource_blobs.digest) AND NOT EXISTS (SELECT 1 FROM resource_drafts WHERE resource_drafts.digest=resource_blobs.digest)",[])?;
        tx.commit()
    }

    pub fn delete_module(&self, module_id: &str, tool_ids: &[String]) -> Result<()> {
        let transaction = self.connection.unchecked_transaction()?;
        for tool_id in tool_ids {
            transaction.execute("DELETE FROM favorites WHERE tool_id = ?1", params![tool_id])?;
            transaction.execute(
                "DELETE FROM recent_tools WHERE tool_id = ?1",
                params![tool_id],
            )?;
        }
        let removed = transaction.execute(
            "DELETE FROM modules WHERE module_id = ?1",
            params![module_id],
        )?;
        if removed == 0 {
            return Err(rusqlite::Error::QueryReturnedNoRows);
        }
        transaction.execute("DELETE FROM resource_blobs WHERE NOT EXISTS (SELECT 1 FROM all_module_resources WHERE all_module_resources.digest = resource_blobs.digest) AND NOT EXISTS (SELECT 1 FROM resource_drafts WHERE resource_drafts.digest = resource_blobs.digest)",[])?;
        transaction.commit()
    }

    pub fn delete_module_tool(&self, module: &ModuleRecord, tool_id: &str) -> Result<()> {
        self.delete_module_tools(module, &[tool_id.to_owned()])
    }

    pub fn delete_module_tools(&self, module: &ModuleRecord, tool_ids: &[String]) -> Result<()> {
        if tool_ids.is_empty() {
            return Err(rusqlite::Error::InvalidQuery);
        }
        let transaction = self.connection.unchecked_transaction()?;
        for tool_id in tool_ids {
            transaction.execute("DELETE FROM favorites WHERE tool_id = ?1", params![tool_id])?;
            transaction.execute(
                "DELETE FROM recent_tools WHERE tool_id = ?1",
                params![tool_id],
            )?;
        }
        let changed = transaction.execute(
            "UPDATE modules SET manifest_json = ?1, scripts_json = ?2 WHERE module_id = ?3",
            params![
                serde_json::to_string(&module.manifest)
                    .map_err(|_| rusqlite::Error::InvalidQuery)?,
                serde_json::to_string(&module.scripts)
                    .map_err(|_| rusqlite::Error::InvalidQuery)?,
                module.module_id,
            ],
        )?;
        if changed == 0 {
            return Err(rusqlite::Error::QueryReturnedNoRows);
        }
        transaction.commit()
    }

    pub fn favorites(&self) -> Result<Vec<String>> {
        let mut statement = self
            .connection
            .prepare("SELECT tool_id FROM favorites ORDER BY created_at, tool_id")?;
        let favorites = statement.query_map([], |row| row.get(0))?.collect();
        favorites
    }

    pub fn set_favorite(&self, tool_id: &str, favorite: bool) -> Result<()> {
        if favorite {
            self.connection.execute(
                "INSERT OR IGNORE INTO favorites(tool_id) VALUES (?1)",
                params![tool_id],
            )?;
        } else {
            self.connection
                .execute("DELETE FROM favorites WHERE tool_id = ?1", params![tool_id])?;
        }
        Ok(())
    }

    pub fn replace_favorites(&self, tool_ids: &[String]) -> Result<()> {
        let transaction = self.connection.unchecked_transaction()?;
        transaction.execute("DELETE FROM favorites", [])?;
        for tool_id in tool_ids {
            transaction.execute(
                "INSERT OR IGNORE INTO favorites(tool_id) VALUES (?1)",
                params![tool_id],
            )?;
        }
        transaction.commit()
    }

    pub fn websites(&self) -> Result<Vec<Website>> {
        let mut statement = self.connection.prepare(
            "SELECT id, name, url, description, tags, favorite FROM websites ORDER BY id DESC",
        )?;
        let websites = statement
            .query_map([], |row| {
                Ok(Website {
                    id: row.get(0)?,
                    name: row.get(1)?,
                    url: row.get(2)?,
                    description: row.get(3)?,
                    tags: row.get(4)?,
                    favorite: row.get(5)?,
                })
            })?
            .collect();
        websites
    }

    pub fn save_website(&self, website: &Website) -> Result<i64> {
        if website.id == 0 {
            self.connection.execute(
                "INSERT INTO websites(name, url, description, tags, favorite) VALUES (?1, ?2, ?3, ?4, ?5)",
                params![website.name, website.url, website.description, website.tags, website.favorite],
            )?;
            Ok(self.connection.last_insert_rowid())
        } else {
            let updated = self.connection.execute(
                "UPDATE websites SET name = ?1, url = ?2, description = ?3, tags = ?4, favorite = ?5 WHERE id = ?6",
                params![website.name, website.url, website.description, website.tags, website.favorite, website.id],
            )?;
            if updated == 0 {
                return Err(rusqlite::Error::QueryReturnedNoRows);
            }
            Ok(website.id)
        }
    }

    pub fn delete_website(&self, id: i64) -> Result<()> {
        let transaction = self.connection.unchecked_transaction()?;
        transaction.execute("DELETE FROM websites WHERE id = ?1", params![id])?;
        transaction.execute(
            "DELETE FROM sync_identities WHERE kind = 'website' AND local_id = ?1",
            params![id.to_string()],
        )?;
        transaction.execute(
            "DELETE FROM sync_identity_aliases WHERE kind = 'website' AND local_id = ?1",
            params![id.to_string()],
        )?;
        transaction.commit()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use toolbox_core::ToolStep;

    #[test]
    fn tool_storage_migration_commits_once_preserves_unicode_and_does_not_restore_cleared_data() {
        let path = temporary_database("tool-storage-migration");
        {
            let store = Store::open(&path).unwrap();
            store
                .connection
                .execute_batch(
                    "DROP TABLE tool_storage; DELETE FROM schema_migrations WHERE version >= 16;",
                )
                .unwrap();
            store.set_favorite("json.format", true).unwrap();
        }
        let legacy = BTreeMap::from([
            ("notes".into(), "中文与 emoji 🐱".into()),
            ("__proto__".into(), "ordinary value".into()),
        ]);
        {
            let store = Store::open(&path).unwrap();
            assert_eq!(
                store.load_tool_storage("dev.notes", &legacy).unwrap(),
                legacy
            );
            assert_eq!(store.favorites().unwrap(), vec!["json.format"]);
            let changed = BTreeMap::from([("notes".into(), "new".into())]);
            store.save_tool_storage("dev.notes", &changed).unwrap();
            assert_eq!(
                store.load_tool_storage("dev.notes", &legacy).unwrap(),
                changed
            );
            store
                .save_tool_storage("dev.notes", &BTreeMap::new())
                .unwrap();
        }
        {
            let store = Store::open(&path).unwrap();
            assert!(store
                .load_tool_storage("dev.notes", &legacy)
                .unwrap()
                .is_empty());
            assert_eq!(
                store.load_tool_storage("dev.other", &legacy).unwrap(),
                legacy
            );
        }
        std::fs::remove_file(path).unwrap();
    }

    #[test]
    fn tool_storage_enforces_one_mib_without_losing_the_last_committed_value() {
        let store = Store::open(Path::new(":memory:")).unwrap();
        let mut values = BTreeMap::from([("x".into(), "a".repeat(TOOL_STORAGE_BYTES - 8))]);
        store.save_tool_storage("dev.quota", &values).unwrap();
        values.get_mut("x").unwrap().push('a');
        assert!(store.save_tool_storage("dev.quota", &values).is_err());
        assert_eq!(
            store
                .load_tool_storage("dev.quota", &BTreeMap::new())
                .unwrap()["x"]
                .len(),
            TOOL_STORAGE_BYTES - 8
        );
        assert!(store.load_tool_storage("dev.new", &values).is_err());
        assert_eq!(
            store
                .load_tool_storage("dev.new", &BTreeMap::new())
                .unwrap(),
            BTreeMap::new()
        );
        assert!(store
            .save_tool_storage("bad/path", &BTreeMap::new())
            .is_err());
        // Installed-source previews include both the module ID and tool ID.
        let preview_id = format!("preview.installed.{}.{}", "a".repeat(98), "a".repeat(100));
        store
            .load_tool_storage(&preview_id, &BTreeMap::new())
            .unwrap();
        assert!(store
            .load_tool_storage(&"a".repeat(257), &BTreeMap::new())
            .is_err());
        let allowed = BTreeMap::from([("🐱".repeat(128), "ok".into())]);
        store.save_tool_storage("dev.keys", &allowed).unwrap();
        assert!(store
            .save_tool_storage(
                "dev.keys",
                &BTreeMap::from([("🐱".repeat(129), "bad".into())])
            )
            .is_err());
    }

    #[test]
    fn preview_storage_cleanup_preserves_installed_tool_data() {
        let store = Store::open(Path::new(":memory:")).unwrap();
        let values = BTreeMap::from([("notes".into(), "keep".into())]);
        store
            .save_tool_storage("preview.dev.notes", &values)
            .unwrap();
        store.save_tool_storage("dev.notes", &values).unwrap();
        assert_eq!(store.clear_preview_tool_storage().unwrap(), 1);
        assert_eq!(
            store
                .load_tool_storage("dev.notes", &BTreeMap::new())
                .unwrap(),
            values
        );
        assert!(store
            .load_tool_storage("preview.dev.notes", &BTreeMap::new())
            .unwrap()
            .is_empty());
    }

    #[test]
    fn javascript_storage_preserves_escaped_utf16_code_units_and_rejects_non_string_values() {
        let store = Store::open(Path::new(":memory:")).unwrap();
        let original = r#"{"notes":"\ud800","\udfff":"key","zero\u0000key":"value"}"#;
        assert_eq!(
            store.load_tool_storage_json("dev.utf16", original).unwrap(),
            original
        );
        assert_eq!(
            store.load_tool_storage_json("dev.utf16", "{}").unwrap(),
            original
        );
        for invalid in [r#"{"x":true}"#, r#"{"x":[]}"#, "[]", "null", "{bad}"] {
            assert!(store.save_tool_storage_json("dev.utf16", invalid).is_err());
            assert_eq!(
                store.load_tool_storage_json("dev.utf16", "{}").unwrap(),
                original
            );
        }
    }

    #[test]
    fn storage_merge_preserves_surrogates_nul_keys_and_local_conflicts_without_partial_writes() {
        let store = Store::open(Path::new(":memory:")).unwrap();
        let incoming = r#"{"\udfff":"incoming","edge":"\ud800","zero\u0000a":"remote","zero\u0000b":"separate","same":"remote","__proto__":"safe"}"#;
        let local = r#"{"same":"local","zero\u0000a":"local"}"#;
        let merged = store
            .merge_tool_storage_json("tool.dev.notes", incoming, local, false)
            .unwrap();
        for part in [
            r#""\udfff":"incoming""#,
            r#""edge":"\ud800""#,
            r#""zero\u0000a":"local""#,
            r#""zero\u0000b":"separate""#,
            r#""same":"local""#,
            r#""__proto__":"safe""#,
        ] {
            assert!(merged.contains(part), "{merged}");
        }
        assert_eq!(
            store
                .merge_tool_storage_json("tool.dev.notes", incoming, local, true)
                .unwrap(),
            incoming
        );
        store
            .save_tool_storage_json("tool.dev.notes", local)
            .unwrap();
        let big = serde_json::to_string(&BTreeMap::from([(
            "other",
            "x".repeat(TOOL_STORAGE_BYTES - 12),
        )]))
        .unwrap();
        assert!(store
            .merge_tool_storage_json("tool.dev.notes", &big, local, false)
            .is_err());
        assert_eq!(
            store
                .stored_tool_storage_json("tool.dev.notes")
                .unwrap()
                .unwrap(),
            local
        );
    }

    #[test]
    fn schema_eleven_retirement_cleans_only_removed_builtins_and_preserves_automations() {
        let mut store = Store::open(Path::new(":memory:")).unwrap();
        store.connection.execute_batch(
            "ALTER TABLE custom_tools DROP COLUMN icon; ALTER TABLE custom_tools DROP COLUMN icon_data;
DROP VIEW all_module_resources; DROP TABLE builtin_resources; DROP TABLE resource_drafts; DROP TABLE module_resources; DROP TABLE resource_blobs; DELETE FROM schema_migrations WHERE version>=12;
             INSERT INTO favorites(tool_id) VALUES ('text.sort'),('text.stats'),('json.format');
             INSERT INTO recent_tools(tool_id,last_used_at_ms) VALUES ('text.sort',1),('text.stats',2),('json.format',3);
             INSERT INTO deleted_builtin_tools(tool_id) VALUES ('text.sort'),('text.stats');
             INSERT INTO builtin_tool_display(tool_id,name,description,category) VALUES ('text.sort','old','','text'),('json.format','keep','','text');
             INSERT INTO builtin_tool_modules(tool_id,source) VALUES ('text.stats','old'),('json.format','keep');
             INSERT INTO builtin_module_overrides(module_id,manifest_json,scripts_json) VALUES ('builtin.text.sort','{}','{}'),('builtin.json.format','{}','{}');
             INSERT INTO custom_tools(name,description,tags_json,steps_json) VALUES ('old automation','','[]','[{\"tool_id\":\"text.sort\",\"action\":\"asc\"}]');"
        ).unwrap();
        store.migrate().unwrap();
        assert_eq!(store.favorites().unwrap(), ["json.format"]);
        for table in [
            "recent_tools",
            "deleted_builtin_tools",
            "builtin_tool_display",
            "builtin_tool_modules",
        ] {
            let count: i64 = store
                .connection
                .query_row(
                    &format!(
                        "SELECT count(*) FROM {table} WHERE tool_id IN ('text.sort','text.stats')"
                    ),
                    [],
                    |r| r.get(0),
                )
                .unwrap();
            assert_eq!(count, 0, "{table}");
        }
        assert_eq!(
            store.builtin_module_overrides().unwrap()[0].module_id,
            "builtin.json.format"
        );
        assert_eq!(store.builtin_tool_sources().unwrap()["json.format"], "keep");
        let definitions = store.custom_tools().unwrap();
        assert_eq!(definitions[0].steps[0].tool_id, "text.sort");
        store.migrate().unwrap();
        assert_eq!(store.custom_tools().unwrap(), definitions);
    }

    #[test]
    fn isolated_batch_commits_all_records_or_keeps_the_original_database() {
        let mut store = Store::open(Path::new(":memory:")).unwrap();
        store.set_favorite("json.format", true).unwrap();
        let before = store.sync_identity("automation", "custom.1").unwrap();
        let result: std::result::Result<(), String> = store.atomic_update(|staging| {
            staging.set_favorite("text.case", true).unwrap();
            staging.sync_identity("automation", "custom.2").unwrap();
            Err("invalid dependency".into())
        });
        assert!(result.is_err());
        assert_eq!(store.favorites().unwrap(), ["json.format"]);
        assert_eq!(
            store.sync_identity("automation", "custom.1").unwrap(),
            before
        );
        let rows: i64 = store
            .connection
            .query_row(
                "SELECT COUNT(*) FROM sync_identities WHERE local_id = 'custom.2'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(rows, 0);
        store
            .atomic_update(|staging| {
                staging
                    .set_favorite("text.case", true)
                    .map_err(|e| e.to_string())
            })
            .unwrap();
        assert_eq!(store.favorites().unwrap().len(), 2);
    }

    #[test]
    fn a_batch_write_error_rolls_back_builtin_markers_and_all_favorite_removals() {
        let mut store = Store::open(Path::new(":memory:")).unwrap();
        let record = ModuleRecord {
            module_id: "local.batch".into(),
            manifest: serde_json::json!({"module_id":"local.batch"}),
            scripts: BTreeMap::from([(
                "main.js".into(),
                "export function run(input){return input;}".into(),
            )]),
        };
        store.install_module(&record).unwrap();
        for id in ["json.format", "local.batch.one", "local.batch.two"] {
            store.set_favorite(id, true).unwrap();
            store.record_tool_use(id).unwrap();
        }
        store.connection.execute_batch("CREATE TRIGGER reject_module_update BEFORE UPDATE ON modules BEGIN SELECT RAISE(ABORT, 'test write failure'); END;").unwrap();
        let before_favorites = store.favorites().unwrap();
        let before_recent = store.recent_tools().unwrap();
        let result = store.atomic_update(|staging| {
            staging
                .delete_builtin_tool("json.format")
                .map_err(|e| e.to_string())?;
            staging
                .delete_module_tools(
                    &record,
                    &["local.batch.one".into(), "local.batch.two".into()],
                )
                .map_err(|e| e.to_string())
        });
        assert!(result.is_err());
        assert!(store.deleted_builtin_tool_ids().unwrap().is_empty());
        assert_eq!(store.favorites().unwrap(), before_favorites);
        assert_eq!(store.recent_tools().unwrap(), before_recent);
        assert_eq!(store.module("local.batch").unwrap(), Some(record));
    }

    #[test]
    fn website_delete_and_configuration_replace_release_sync_identities() {
        let store = Store::open(Path::new(":memory:")).unwrap();
        let site = Website {
            id: 0,
            name: "Docs".into(),
            url: "https://example.com".into(),
            description: String::new(),
            tags: String::new(),
            favorite: false,
        };
        let id = store.save_website(&site).unwrap();
        let identity = store.sync_identity("website", &id.to_string()).unwrap();
        store.delete_website(id).unwrap();
        assert!(store.sync_local_id("website", &identity).unwrap().is_none());
        let id = store.save_website(&site).unwrap();
        let identity = store.sync_identity("website", &id.to_string()).unwrap();
        store
            .replace_configuration(&store.export_configuration().unwrap())
            .unwrap();
        assert!(store.sync_local_id("website", &identity).unwrap().is_none());
    }

    #[test]
    fn builtin_deletion_keeps_source_and_restore_is_atomic_and_selective() {
        let path = temporary_database("builtin-delete-restore");
        let record = ModuleRecord {
            module_id: "builtin.json.format".into(),
            manifest: serde_json::json!({"module_id":"builtin.json.format","name":{"zh-CN":"修改后的名称"}}),
            scripts: BTreeMap::from([(
                "main.js".into(),
                "export function run(input) { return input; }".into(),
            )]),
        };
        {
            let store = Store::open(&path).unwrap();
            store.save_builtin_module(&record, "json.format").unwrap();
            store.set_favorite("json.format", true).unwrap();
            store.record_tool_use("json.format").unwrap();
            store.delete_builtin_tool("json.format").unwrap();
            store.delete_builtin_tool("text.case").unwrap();
            assert!(store.delete_builtin_tool("custom.1").is_err());
            assert!(store.favorites().unwrap().is_empty());
            assert!(store.recent_tools().unwrap().is_empty());
        }
        {
            let store = Store::open(&path).unwrap();
            assert_eq!(
                store.deleted_builtin_tool_ids().unwrap(),
                ["json.format", "text.case"]
            );
            assert!(store
                .restore_builtin_tools(&["json.format".into(), "local.imported.tool".into()])
                .is_err());
            assert_eq!(store.deleted_builtin_tool_ids().unwrap().len(), 2);
            store
                .restore_builtin_tools(&["json.format".into()])
                .unwrap();
            assert_eq!(store.deleted_builtin_tool_ids().unwrap(), ["text.case"]);
            let saved = store.builtin_module_overrides().unwrap();
            assert_eq!(saved[0].manifest, record.manifest);
            assert_eq!(saved[0].scripts, record.scripts);
            store
                .reset_builtin_module("builtin.text.case", "text.case")
                .unwrap();
            assert_eq!(store.deleted_builtin_tool_ids().unwrap(), ["text.case"]);
            store.save_builtin_module(&record, "json.format").unwrap();
        }
        std::fs::remove_file(path).unwrap();
    }

    #[test]
    fn schema_nine_migrates_old_hidden_builtins_and_releases_imported_tools() {
        let path = temporary_database("hidden-to-deleted");
        {
            let store = Store::open(&path).unwrap();
            store.set_favorite("json.format", true).unwrap();
            store.connection.execute_batch(
                "ALTER TABLE custom_tools DROP COLUMN icon; ALTER TABLE custom_tools DROP COLUMN icon_data;
DROP TABLE deleted_builtin_tools; DROP TABLE sync_identities;
                 DROP VIEW all_module_resources; DROP TABLE builtin_resources; DROP TABLE resource_drafts; DROP TABLE module_resources; DROP TABLE resource_blobs; DELETE FROM schema_migrations WHERE version >= 10;
                 CREATE TABLE hidden_tools (tool_id TEXT PRIMARY KEY NOT NULL);
                 INSERT INTO hidden_tools(tool_id) VALUES ('json.format'), ('dev.example.reverse.text');",
            ).unwrap();
        }
        {
            let store = Store::open(&path).unwrap();
            assert_eq!(store.deleted_builtin_tool_ids().unwrap(), ["json.format"]);
            assert_eq!(store.favorites().unwrap(), ["json.format"]);
            let hidden_table: i64 = store
                .connection
                .query_row(
                    "SELECT COUNT(*) FROM sqlite_master WHERE name = 'hidden_tools'",
                    [],
                    |row| row.get(0),
                )
                .unwrap();
            assert_eq!(hidden_table, 0);
            store
                .restore_builtin_tools(&["json.format".into()])
                .unwrap();
            assert!(store.deleted_builtin_tool_ids().unwrap().is_empty());
        }
        std::fs::remove_file(path).unwrap();
    }

    #[test]
    fn builtin_module_overrides_survive_reopen_and_reset_keeps_user_state() {
        let path = temporary_database("builtin-overrides");
        let record = ModuleRecord {
            module_id: "builtin.json.format".into(),
            manifest: serde_json::json!({"module_id":"builtin.json.format","version":"0.1.2"}),
            scripts: BTreeMap::from([(
                "main.js".into(),
                "export function run(input) { return input; }".into(),
            )]),
        };
        {
            let store = Store::open(&path).unwrap();
            store.set_favorite("json.format", true).unwrap();
            store.record_tool_use("json.format").unwrap();
            store
                .save_builtin_tool_display(&BuiltInToolDisplay {
                    id: "json.format".into(),
                    name: "旧名称".into(),
                    description: "旧说明".into(),
                    category: "文本处理".into(),
                })
                .unwrap();
            store.connection.execute("INSERT INTO builtin_tool_modules(tool_id, source) VALUES ('json.format', 'old source')", []).unwrap();
            store.save_builtin_module(&record, "json.format").unwrap();
            assert!(store.builtin_tool_displays().unwrap().is_empty());
            assert!(store.builtin_tool_sources().unwrap().is_empty());
            store
                .replace_configuration(&store.export_configuration().unwrap())
                .unwrap();
            store.record_tool_use("json.format").unwrap();
        }
        {
            let store = Store::open(&path).unwrap();
            let saved = store.builtin_module_overrides().unwrap();
            assert_eq!(saved.len(), 1);
            assert_eq!(saved[0].manifest, record.manifest);
            assert_eq!(saved[0].scripts, record.scripts);
            assert!(store
                .reset_builtin_module("builtin.json.format", "base64.convert")
                .is_err());
            store
                .reset_builtin_module("builtin.json.format", "json.format")
                .unwrap();
            assert!(store.builtin_module_overrides().unwrap().is_empty());
            assert_eq!(store.favorites().unwrap(), ["json.format"]);
            assert_eq!(store.recent_tools().unwrap(), ["json.format"]);
        }
        std::fs::remove_file(path).unwrap();
    }

    fn temporary_database(label: &str) -> std::path::PathBuf {
        std::env::temp_dir().join(format!(
            "firefly-{label}-{}-{}.sqlite",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ))
    }

    #[test]
    fn schema_eight_database_reopens_and_preserves_existing_data() {
        let path = temporary_database("schema-eight");
        {
            let store = Store::open(&path).unwrap();
            store.set_favorite("json.format", true).unwrap();
            store
                .save_website(&Website {
                    id: 0,
                    name: "已有网站".into(),
                    url: "https://example.com/".into(),
                    description: "保留原有数据".into(),
                    tags: String::new(),
                    favorite: false,
                })
                .unwrap();
        }
        {
            let connection = Connection::open(&path).unwrap();
            connection.execute_batch(
                "ALTER TABLE custom_tools DROP COLUMN icon; ALTER TABLE custom_tools DROP COLUMN icon_data;
DROP TABLE builtin_module_overrides;
                 DROP TABLE deleted_builtin_tools; DROP TABLE sync_identities;
                 CREATE TABLE hidden_tools (tool_id TEXT PRIMARY KEY NOT NULL);
                 DROP VIEW all_module_resources; DROP TABLE builtin_resources; DROP TABLE resource_drafts; DROP TABLE module_resources; DROP TABLE resource_blobs; DELETE FROM schema_migrations WHERE version >= 9;
                 CREATE TABLE IF NOT EXISTS builtin_tool_modules (
                     tool_id TEXT PRIMARY KEY NOT NULL,
                     source TEXT NOT NULL,
                     updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
                 );
                 INSERT OR IGNORE INTO schema_migrations(version) VALUES (8);
                 INSERT INTO builtin_tool_modules(tool_id, source) VALUES ('json.format', 'saved source');",
            ).unwrap();
        }
        {
            let store = Store::open(&path).unwrap();
            assert_eq!(store.favorites().unwrap(), ["json.format"]);
            assert_eq!(store.websites().unwrap()[0].name, "已有网站");
            let source: String = store
                .connection
                .query_row(
                    "SELECT source FROM builtin_tool_modules WHERE tool_id = 'json.format'",
                    [],
                    |row| row.get(0),
                )
                .unwrap();
            assert_eq!(source, "saved source");
            let version: i64 = store
                .connection
                .query_row("SELECT MAX(version) FROM schema_migrations", [], |row| {
                    row.get(0)
                })
                .unwrap();
            assert_eq!(version, DATABASE_SCHEMA_VERSION);
            assert!(store.builtin_module_overrides().unwrap().is_empty());
        }
        std::fs::remove_file(path).unwrap();
    }

    #[test]
    fn schema_seven_migrates_without_losing_favorites() {
        let path = temporary_database("schema-seven");
        {
            let store = Store::open(&path).unwrap();
            store.set_favorite("json.format", true).unwrap();
            store
                .connection
                .execute_batch(
                    "ALTER TABLE custom_tools DROP COLUMN icon; ALTER TABLE custom_tools DROP COLUMN icon_data;
DROP TABLE builtin_tool_modules;
                 DROP TABLE builtin_module_overrides;
                 DROP TABLE deleted_builtin_tools; DROP TABLE sync_identities;
                 CREATE TABLE hidden_tools (tool_id TEXT PRIMARY KEY NOT NULL);
                 DROP VIEW all_module_resources; DROP TABLE builtin_resources; DROP TABLE resource_drafts; DROP TABLE module_resources; DROP TABLE resource_blobs; DELETE FROM schema_migrations WHERE version >= 8;",
                )
                .unwrap();
        }
        {
            let store = Store::open(&path).unwrap();
            assert_eq!(store.favorites().unwrap(), ["json.format"]);
            let version: i64 = store
                .connection
                .query_row("SELECT MAX(version) FROM schema_migrations", [], |row| {
                    row.get(0)
                })
                .unwrap();
            assert_eq!(version, DATABASE_SCHEMA_VERSION);
            let count: i64 = store
                .connection
                .query_row("SELECT COUNT(*) FROM builtin_tool_modules", [], |row| {
                    row.get(0)
                })
                .unwrap();
            assert_eq!(count, 0);
        }
        std::fs::remove_file(path).unwrap();
    }

    #[test]
    fn newer_database_schema_is_rejected_without_changing_data() {
        let path = temporary_database("future-schema");
        let newer_version = DATABASE_SCHEMA_VERSION + 1;
        {
            let store = Store::open(&path).unwrap();
            store.set_favorite("json.format", true).unwrap();
            store
                .connection
                .execute(
                    "INSERT INTO schema_migrations(version) VALUES (?1)",
                    [newer_version],
                )
                .unwrap();
        }
        let error = match Store::open(&path) {
            Ok(_) => panic!("不应打开未来版本的数据库"),
            Err(error) => error,
        };
        assert!(error.to_string().contains("请使用更新版本的应用"));
        {
            let connection = Connection::open(&path).unwrap();
            let version: i64 = connection
                .query_row("SELECT MAX(version) FROM schema_migrations", [], |row| {
                    row.get(0)
                })
                .unwrap();
            assert_eq!(version, newer_version);
            let favorite: String = connection
                .query_row("SELECT tool_id FROM favorites", [], |row| row.get(0))
                .unwrap();
            assert_eq!(favorite, "json.format");
        }
        std::fs::remove_file(path).unwrap();
    }

    #[test]
    fn builtin_display_persists_and_keeps_stable_tool_identity() {
        let path = temporary_database("builtin-display");
        let display = BuiltInToolDisplay {
            id: "json.format".into(),
            name: "我的 JSON 工具".into(),
            description: "整理 JSON".into(),
            category: "常用工具".into(),
        };
        {
            let store = Store::open(&path).unwrap();
            assert!(store
                .save_builtin_tool_display(&BuiltInToolDisplay {
                    id: "unknown.tool".into(),
                    ..display.clone()
                })
                .is_err());
            store.save_builtin_tool_display(&display).unwrap();
            store
                .replace_configuration(&store.export_configuration().unwrap())
                .unwrap();
        }
        {
            let store = Store::open(&path).unwrap();
            assert_eq!(store.builtin_tool_displays().unwrap(), vec![display]);
            store.reset_builtin_tool_display("json.format").unwrap();
            assert!(store.builtin_tool_displays().unwrap().is_empty());
        }
        std::fs::remove_file(path).unwrap();
    }

    #[test]
    fn modules_and_their_favorites_survive_configuration_import() {
        let path = temporary_database("modules");
        let record = ModuleRecord {
            module_id: "dev.example.reverse".into(),
            manifest: serde_json::json!({"schema_version": 1, "module_id": "dev.example.reverse"}),
            scripts: BTreeMap::from([("main.js".into(), "export function run() {}".into())]),
        };
        let snapshot;
        {
            let store = Store::open(&path).unwrap();
            store.install_module(&record).unwrap();
            store
                .set_favorite("dev.example.reverse.text", true)
                .unwrap();
            snapshot = store.export_configuration().unwrap();
            assert_eq!(snapshot.schema_version, 3);
            assert!(snapshot.favorites.is_empty());
        }
        {
            let store = Store::open(&path).unwrap();
            assert_eq!(
                store.module(&record.module_id).unwrap().unwrap().scripts,
                record.scripts
            );
            store.replace_configuration(&snapshot).unwrap();
            assert_eq!(store.modules().unwrap().len(), 1);
            assert_eq!(store.favorites().unwrap(), ["dev.example.reverse.text"]);
            store
                .delete_module(&record.module_id, &["dev.example.reverse.text".into()])
                .unwrap();
            assert!(store.favorites().unwrap().is_empty());
        }
        std::fs::remove_file(path).unwrap();
    }

    #[test]
    fn deleting_one_module_tool_cleans_its_state_and_keeps_builtin_deletions() {
        let path = temporary_database("deleted-module-tools");
        let module_id = "dev.example.tools";
        let removed_id = "dev.example.tools.first";
        let kept_id = "dev.example.tools.second";
        let mut record = ModuleRecord {
            module_id: module_id.into(),
            manifest: serde_json::json!({"tools": [{"id": removed_id}, {"id": kept_id}]}),
            scripts: BTreeMap::from([("main.js".into(), "export function run() {}".into())]),
        };
        {
            let store = Store::open(&path).unwrap();
            store.install_module(&record).unwrap();
            store.delete_builtin_tool("json.format").unwrap();
            store.set_favorite(removed_id, true).unwrap();
            store.record_tool_use(removed_id).unwrap();
            record.manifest["tools"] = serde_json::json!([{"id": kept_id}]);
            store.delete_module_tool(&record, removed_id).unwrap();
            assert_eq!(
                store.module(module_id).unwrap().unwrap().manifest,
                record.manifest
            );
            assert!(store.favorites().unwrap().is_empty());
            assert!(store.recent_tools().unwrap().is_empty());
        }
        {
            let store = Store::open(&path).unwrap();
            assert_eq!(store.deleted_builtin_tool_ids().unwrap(), ["json.format"]);
            store
                .restore_builtin_tools(&["json.format".into()])
                .unwrap();
            assert!(store.deleted_builtin_tool_ids().unwrap().is_empty());
        }
        std::fs::remove_file(path).unwrap();
    }

    #[test]
    fn custom_tools_persist_update_and_delete_with_favorites() {
        let path = temporary_database("custom-tools");
        let created;
        {
            let store = Store::open(&path).unwrap();
            created = store
                .save_custom_tool(&CustomTool {
                    icon: Some("calculator".into()),
                    icon_data: None,
                    id: String::new(),
                    name: "编码工具".into(),
                    description: "依次编码".into(),
                    tags: vec!["文本".into()],
                    steps: vec![ToolStep {
                        tool_id: "url.convert".into(),
                        action: "encode".into(),
                    }],
                })
                .unwrap();
            assert!(created.id.starts_with("custom."));
            store.set_favorite(&created.id, true).unwrap();
            store.record_tool_use(&created.id).unwrap();
        }
        {
            let store = Store::open(&path).unwrap();
            assert_eq!(store.custom_tools().unwrap(), vec![created.clone()]);
            assert_eq!(store.favorites().unwrap(), vec![created.id.clone()]);
            let mut updated = created.clone();
            updated.name = "新的名称".into();
            updated.icon = None;
            updated.icon_data = Some("data:image/png;base64,storage-round-trip-test".into());
            updated.steps.push(ToolStep {
                tool_id: "base64.convert".into(),
                action: "encode".into(),
            });
            assert_eq!(store.save_custom_tool(&updated).unwrap(), updated);
            assert_eq!(store.custom_tool(&created.id).unwrap(), Some(updated));
            store.delete_custom_tool(&created.id).unwrap();
            assert!(store.custom_tools().unwrap().is_empty());
            assert!(store.favorites().unwrap().is_empty());
            assert!(store.recent_tools().unwrap().is_empty());
            assert!(store.delete_custom_tool(&created.id).is_err());
        }
        std::fs::remove_file(path).unwrap();
    }

    #[test]
    fn schema_fourteen_migrates_automation_icons_without_changing_steps_or_favorites() {
        let path = temporary_database("automation-icons-migration");
        let original;
        {
            let store = Store::open(&path).unwrap();
            original = store
                .save_custom_tool(
                    &serde_json::from_value(serde_json::json!({
                        "id":"", "name":"旧自动化", "description":"", "tags":[],
                        "steps":[{"tool_id":"json.format", "action":"format"}]
                    }))
                    .unwrap(),
                )
                .unwrap();
            store.set_favorite(&original.id, true).unwrap();
            store
                .connection
                .execute_batch(
                    "ALTER TABLE custom_tools DROP COLUMN icon;
                ALTER TABLE custom_tools DROP COLUMN icon_data;
                DELETE FROM schema_migrations WHERE version >= 15;",
                )
                .unwrap();
        }
        {
            let store = Store::open(&path).unwrap();
            assert_eq!(
                store.custom_tool(&original.id).unwrap(),
                Some(original.clone())
            );
            assert_eq!(store.favorites().unwrap(), vec![original.id.clone()]);
            let mut updated = original.clone();
            updated.icon = Some("heart".into());
            assert_eq!(store.save_custom_tool(&updated).unwrap(), updated);
        }
        std::fs::remove_file(path).unwrap();
    }

    #[test]
    fn recent_tools_keep_last_thirty_and_can_be_cleared() {
        let path = temporary_database("recent-tools");
        let store = Store::open(&path).unwrap();
        for index in 0..35 {
            store.record_tool_use(&format!("tool.{index}")).unwrap();
        }
        assert_eq!(store.recent_tools().unwrap().len(), 30);
        store.record_tool_use("tool.34").unwrap();
        let count: i64 = store
            .connection
            .query_row(
                "SELECT usage_count FROM recent_tools WHERE tool_id = 'tool.34'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(count, 2);
        store.clear_recent_tools().unwrap();
        assert!(store.recent_tools().unwrap().is_empty());
        drop(store);
        std::fs::remove_file(path).unwrap();
    }

    #[test]
    fn configuration_import_is_atomic_and_preserves_custom_tools() {
        let path = temporary_database("configuration");
        let store = Store::open(&path).unwrap();
        let tool = store
            .save_custom_tool(&CustomTool {
                icon: None,
                icon_data: None,
                id: String::new(),
                name: "我的工具".into(),
                description: String::new(),
                tags: vec!["常用".into()],
                steps: vec![ToolStep {
                    tool_id: "sha256.hash".into(),
                    action: "hash".into(),
                }],
            })
            .unwrap();
        store.set_favorite(&tool.id, true).unwrap();
        store.set_favorite("json.format", true).unwrap();
        store
            .save_website(&Website {
                id: 0,
                name: "文档".into(),
                url: "https://example.com".into(),
                description: String::new(),
                tags: String::new(),
                favorite: false,
            })
            .unwrap();
        let backup = store.export_configuration().unwrap();
        assert_eq!(backup.favorites, ["json.format"]);
        store.replace_configuration(&backup).unwrap();
        assert_eq!(store.custom_tools().unwrap(), vec![tool.clone()]);
        assert_eq!(
            store.favorites().unwrap(),
            [tool.id.as_str(), "json.format"]
        );
        assert_eq!(store.websites().unwrap(), backup.websites);
        let mut invalid = backup.clone();
        invalid.websites.push(invalid.websites[0].clone());
        assert!(store.replace_configuration(&invalid).is_err());
        let mut legacy = backup.clone();
        legacy.schema_version = 2;
        assert!(store.replace_configuration(&legacy).is_err());
        assert_eq!(store.custom_tools().unwrap(), vec![tool]);
        assert_eq!(store.websites().unwrap(), backup.websites);
        assert!(
            serde_json::from_value::<ConfigurationSnapshot>(serde_json::json!({
                "schema_version": 2, "favorites": [], "websites": [],
                "custom_tools": [], "modules": []
            }))
            .is_err()
        );
        drop(store);
        std::fs::remove_file(path).unwrap();
    }

    #[test]
    fn favorites_survive_reopen() {
        let path = std::env::temp_dir().join(format!(
            "firefly-storage-{}-{}.sqlite",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        {
            let store = Store::open(&path).unwrap();
            store.set_favorite("json.format", true).unwrap();
            store.set_favorite("json.format", true).unwrap();
            assert_eq!(store.favorites().unwrap(), ["json.format"]);
            store
                .replace_favorites(&["text.case".into(), "sha256.hash".into()])
                .unwrap();
            assert_eq!(store.favorites().unwrap(), ["sha256.hash", "text.case"]);
            store.replace_favorites(&["json.format".into()]).unwrap();
        }
        {
            let store = Store::open(&path).unwrap();
            assert_eq!(store.favorites().unwrap(), ["json.format"]);
            store.set_favorite("json.format", false).unwrap();
            assert!(store.favorites().unwrap().is_empty());
        }
        std::fs::remove_file(path).unwrap();
    }

    #[test]
    fn websites_migrate_and_survive_reopen() {
        let path = std::env::temp_dir().join(format!(
            "firefly-websites-{}-{}.sqlite",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        {
            let connection = Connection::open(&path).unwrap();
            connection.execute_batch(
                "CREATE TABLE schema_migrations (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
                 INSERT INTO schema_migrations(version) VALUES (1);
                 CREATE TABLE favorites (tool_id TEXT PRIMARY KEY NOT NULL, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
                 INSERT INTO favorites(tool_id) VALUES ('json.format');",
            ).unwrap();
        }
        {
            let store = Store::open(&path).unwrap();
            assert_eq!(store.favorites().unwrap(), ["json.format"]);
            let id = store
                .save_website(&Website {
                    id: 0,
                    name: "文档".into(),
                    url: "https://example.com".into(),
                    description: "示例".into(),
                    tags: "开发".into(),
                    favorite: false,
                })
                .unwrap();
            let mut website = store.websites().unwrap().pop().unwrap();
            assert_eq!(website.id, id);
            website.favorite = true;
            store.save_website(&website).unwrap();
        }
        {
            let store = Store::open(&path).unwrap();
            assert_eq!(store.favorites().unwrap(), ["json.format"]);
            let website = store.websites().unwrap().pop().unwrap();
            assert_eq!(website.name, "文档");
            assert!(website.favorite);
            store.delete_website(website.id).unwrap();
            assert!(store.websites().unwrap().is_empty());
        }
        std::fs::remove_file(path).unwrap();
    }
}
