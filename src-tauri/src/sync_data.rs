use crate::{builtin_modules, modules, sync_transport, AppState};
use base64::{engine::general_purpose::STANDARD, Engine as _};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{
    collections::{BTreeMap, BTreeSet, HashSet},
    io::{self, Write},
    sync::{
        atomic::{AtomicU64, Ordering},
        Arc, Mutex,
    },
};
use tauri::Manager;
use toolbox_core::CustomTool;
use toolbox_storage::{ModuleRecord, Store, Website};

#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Options {
    pub modules: bool,
    pub automations: bool,
    pub builtins: bool,
    pub favorites: bool,
    pub websites: bool,
    pub layout: bool,
    pub preferences: bool,
    pub web_data: bool,
}
#[derive(Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct Automation {
    sync_id: String,
    tool: CustomTool,
}
#[derive(Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct Site {
    sync_id: String,
    website: Website,
}
#[derive(Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct Snapshot {
    format: String,
    app_version: String,
    platform: String,
    options: Options,
    modules: Vec<ModuleRecord>,
    #[serde(default, skip_serializing_if = "BTreeMap::is_empty")]
    resources: BTreeMap<String, BTreeMap<String, String>>,
    automations: Vec<Automation>,
    websites: Vec<Site>,
    favorites: Vec<String>,
    automation_refs: BTreeMap<String, String>,
    website_refs: BTreeMap<String, String>,
    preferences: BTreeMap<String, String>,
    #[serde(default, skip_serializing_if = "BTreeMap::is_empty")]
    web_storage: BTreeMap<String, String>,
}
#[derive(Clone, Serialize)]
struct ModuleVersions {
    local: Option<String>,
    incoming: String,
}
#[derive(Clone, Serialize)]
pub struct Item {
    key: String,
    kind: String,
    name: String,
    status: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    status_label: Option<String>,
    reason: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    versions: Option<ModuleVersions>,
    network_hosts: Vec<String>,
}
#[derive(Clone, Serialize)]
pub struct Preview {
    app_version: String,
    platform: String,
    options: Options,
    items: Vec<Item>,
    bytes: usize,
    preferences: BTreeMap<String, String>,
    storage_ids: Vec<String>,
    web_data_count: usize,
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Selection {
    pub options: Options,
    pub keys: Vec<String>,
    pub replace: bool,
}
#[derive(Debug, Serialize)]
pub struct Applied {
    pub imported: usize,
    pub skipped: usize,
    pub id_map: BTreeMap<String, String>,
    pub website_map: BTreeMap<String, String>,
    pub preferences: BTreeMap<String, String>,
    pub warnings: Vec<String>,
    pub active_ids: Vec<String>,
    pub site_ids: Vec<String>,
    pub web_data_imported: usize,
}
struct Pending {
    snapshot: Snapshot,
    baseline: String,
}
#[derive(Default)]
pub struct SyncState {
    sharing: Mutex<Option<Arc<sync_transport::Sharing>>>,
    pending: Mutex<Option<Pending>>,
    cancel: Mutex<Option<Arc<tokio::sync::Notify>>>,
    revision: AtomicU64,
}

pub const LAYOUT_KEYS: &[&str] = &[
    "firefly.groups.home.v1",
    "firefly.groups.favorites.v1",
    "firefly.groups.websites.v1",
    "firefly.order.categories.v1",
    "firefly.order.homeTools.v1",
    "firefly.order.favorites.v1",
    "firefly.order.favoriteGroups.v1",
    "firefly.order.websites.v1",
    "firefly.order.websiteGroups.v1",
];
pub const PREFERENCE_KEYS: &[&str] = &[
    "firefly.theme.v1",
    "firefly.start-page.v1",
    "firefly.accent.v1",
    "firefly.auto-hide-bars.v1",
    "firefly.smart-clipboard.v1",
    "firefly.usage-stats.v1",
    "firefly.component-transparency.v1",
    "firefly.home-font-size.v1",
    "firefly.app-font-size.v1",
    "firefly.card-gap.v1",
    "firefly.web-tool-initialization-ms.v1",
    "firefly.web-tool-interaction-ms.v1",
    "firefly.web-tool-default-fullscreen.v1",
    "firefly.web-tool-fullscreen-initial-hint.v1",
];
fn permitted_preference(key: &str, options: &Options) -> bool {
    (options.layout && LAYOUT_KEYS.contains(&key))
        || (options.preferences && PREFERENCE_KEYS.contains(&key))
        || (options.web_data && key.starts_with("firefly.browser-module.tool.") && key.len() <= 400)
}
fn sql<T, E>(value: Result<T, E>) -> Result<T, String> {
    value.map_err(|_| "无法读取或保存同步数据。".into())
}

fn web_ids(store: &Store) -> Result<BTreeSet<String>, String> {
    Ok(crate::listed_tools(store)?
        .into_iter()
        .filter(|tool| tool.ui_kind.as_deref() == Some("web"))
        .map(|tool| tool.id)
        .collect())
}
fn storage_ids(store: &Store, data: &Snapshot) -> Result<BTreeSet<String>, String> {
    let mut ids = web_ids(store)?;
    for record in &data.modules {
        for tool in modules::parse_record(record)?.tools {
            if tool.ui.kind == "web" {
                ids.insert(tool.id);
            }
        }
    }
    Ok(ids)
}
fn check_storage(store: &Store, values: &BTreeMap<String, String>) -> Result<(), String> {
    if values.len() > 1728
        || values.values().map(String::len).sum::<usize>() > sync_transport::MAX_SNAPSHOT
    {
        return Err("网页保存数据超过同步额度。".into());
    }
    for (id, json) in values {
        if !id.starts_with("tool.") {
            return Err("同步包含非工具持久数据。".into());
        }
        store
            .check_tool_storage_json(id, json)
            .map_err(|_| "网页保存数据格式无效或超过每个工具 1 MiB 上限。")?;
    }
    Ok(())
}
fn legacy_storage(
    preferences: &BTreeMap<String, String>,
    ids: &BTreeSet<String>,
) -> Result<BTreeMap<String, String>, String> {
    let mut scopes: Vec<_> = ids.iter().collect();
    scopes.sort_by_key(|id| std::cmp::Reverse(id.len()));
    let mut values = BTreeMap::<String, BTreeMap<String, String>>::new();
    for (key, value) in preferences {
        if let Some(rest) = key.strip_prefix("firefly.browser-module.tool.") {
            if let Some((id, key)) = scopes
                .iter()
                .find_map(|id| rest.strip_prefix(&format!("{id}.")).map(|key| (*id, key)))
            {
                values
                    .entry(format!("tool.{id}"))
                    .or_default()
                    .insert(key.to_owned(), value.clone());
            }
        }
    }
    values
        .into_iter()
        .map(|(id, values)| {
            serde_json::to_string(&values)
                .map(|json| (id, json))
                .map_err(|_| "旧版网页保存数据无效。".into())
        })
        .collect()
}
fn stored_data(
    store: &Store,
    ids: &BTreeSet<String>,
    legacy: &BTreeMap<String, String>,
) -> Result<BTreeMap<String, String>, String> {
    let mut values = BTreeMap::new();
    let mut bytes = 0usize;
    for id in ids {
        let namespace = format!("tool.{id}");
        if let Some(json) = sql(store.stored_tool_storage_json(&namespace))?
            .or_else(|| legacy.get(&namespace).cloned())
        {
            bytes = bytes.saturating_add(json.len());
            if bytes > sync_transport::MAX_SNAPSHOT {
                return Err("网页保存数据超过 128 MiB 同步额度，请减少同步内容。".into());
            }
            values.insert(namespace, json);
        }
    }
    check_storage(store, &values)?;
    Ok(values)
}
fn incoming_data(store: &Store, data: &Snapshot) -> Result<BTreeMap<String, String>, String> {
    if !data.options.web_data {
        return Ok(BTreeMap::new());
    }
    let mut values = legacy_storage(&data.preferences, &storage_ids(store, data)?)?;
    values.extend(data.web_storage.clone());
    check_storage(store, &values)?;
    Ok(values)
}
struct SnapshotWriter {
    bytes: Vec<u8>,
    count: usize,
    retain: bool,
}
impl Write for SnapshotWriter {
    fn write(&mut self, bytes: &[u8]) -> io::Result<usize> {
        let count = self
            .count
            .checked_add(bytes.len())
            .filter(|count| *count <= sync_transport::MAX_SNAPSHOT)
            .ok_or_else(|| io::Error::other("snapshot limit"))?;
        if self.retain {
            self.bytes.extend_from_slice(bytes);
        }
        self.count = count;
        Ok(bytes.len())
    }
    fn flush(&mut self) -> io::Result<()> {
        Ok(())
    }
}
fn snapshot_bytes(data: &Snapshot, retain: bool) -> Result<SnapshotWriter, String> {
    let mut output = SnapshotWriter {
        bytes: Vec::new(),
        count: 0,
        retain,
    };
    serde_json::to_writer(&mut output, data)
        .map_err(|_| "同步内容超过 128 MiB 快照额度，请减少同步项目或改用工具包导入。")?;
    Ok(output)
}
struct HashWriter(Sha256);
impl Write for HashWriter {
    fn write(&mut self, bytes: &[u8]) -> io::Result<usize> {
        self.0.update(bytes);
        Ok(bytes.len())
    }
    fn flush(&mut self) -> io::Result<()> {
        Ok(())
    }
}
fn baseline(store: &Store, data: &Snapshot) -> Result<String, String> {
    let saved = if data.options.web_data {
        stored_data(store, &storage_ids(store, data)?, &BTreeMap::new())?
    } else {
        BTreeMap::new()
    };
    let mut hash = HashWriter(Sha256::new());
    serde_json::to_writer(
        &mut hash,
        &(
            sql(store.modules())?,
            builtin_modules::records(store)?,
            sql(store.custom_tools())?,
            sql(store.websites())?,
            sql(store.favorites())?,
            sql(store.deleted_builtin_tool_ids())?,
            sql(store.sync_identity_rows())?,
            saved,
        ),
    )
    .map_err(|_| "无法读取本机同步版本。")?;
    Ok(format!("{:x}", hash.0.finalize()))
}
#[cfg(test)]
fn snapshot(
    store: &Store,
    options: Options,
    preferences: BTreeMap<String, String>,
) -> Result<Snapshot, String> {
    snapshot_selected(store, options, preferences, None)
}

#[cfg(test)]
fn snapshot_selected(
    store: &Store,
    options: Options,
    preferences: BTreeMap<String, String>,
    module_ids: Option<&HashSet<String>>,
) -> Result<Snapshot, String> {
    snapshot_with_storage(store, options, preferences, module_ids, BTreeMap::new())
}
fn snapshot_with_storage(
    store: &Store,
    options: Options,
    preferences: BTreeMap<String, String>,
    module_ids: Option<&HashSet<String>>,
    legacy: BTreeMap<String, String>,
) -> Result<Snapshot, String> {
    if ![
        options.modules,
        options.automations,
        options.builtins,
        options.favorites,
        options.websites,
        options.layout,
        options.preferences,
        options.web_data,
    ]
    .contains(&true)
    {
        return Err("请至少选择一项同步内容。".into());
    }
    let all_automations = sql(store.custom_tools())?;
    let all_sites = sql(store.websites())?;
    let automation_refs = all_automations
        .iter()
        .map(|tool| {
            Ok((
                tool.id.clone(),
                sql(store.sync_identity("automation", &tool.id))?,
            ))
        })
        .collect::<Result<BTreeMap<_, _>, String>>()?;
    let website_refs = all_sites
        .iter()
        .map(|site| {
            Ok((
                site.id.to_string(),
                sql(store.sync_identity("website", &site.id.to_string()))?,
            ))
        })
        .collect::<Result<BTreeMap<_, _>, String>>()?;
    let mut records = if options.modules {
        sql(store.modules())?
    } else {
        vec![]
    };
    if let Some(ids) = module_ids {
        if ids.len() > 100
            || ids
                .iter()
                .any(|id| !records.iter().any(|record| &record.module_id == id))
        {
            return Err("选择的工具包已变化，请重新打开同步页面。".into());
        }
        records.retain(|record| ids.contains(&record.module_id));
    }
    if options.builtins {
        let deleted: HashSet<_> = sql(store.deleted_builtin_tool_ids())?.into_iter().collect();
        records.extend(
            builtin_modules::records(store)?
                .into_iter()
                .filter(|record| {
                    builtin_modules::modified(record)
                        && builtin_modules::tool_id(&record.module_id)
                            .is_some_and(|id| !deleted.contains(id))
                }),
        );
    }
    let mut resources = BTreeMap::new();
    for record in &records {
        let assets = builtin_modules::resources(store, record)?;
        if !assets.is_empty() {
            resources.insert(
                record.module_id.clone(),
                assets
                    .into_iter()
                    .map(|(path, bytes)| (path, STANDARD.encode(bytes)))
                    .collect(),
            );
        }
    }
    let saved = if options.web_data {
        check_storage(store, &legacy)?;
        let mut old = legacy_storage(&preferences, &web_ids(store)?)?;
        old.extend(legacy);
        stored_data(store, &web_ids(store)?, &old)?
    } else {
        BTreeMap::new()
    };
    let data = Snapshot {
        format: if saved.is_empty() {
            "firefly-lan-sync-v1"
        } else {
            "firefly-lan-sync-v2"
        }
        .into(),
        app_version: env!("CARGO_PKG_VERSION").into(),
        platform: std::env::consts::OS.into(),
        options: options.clone(),
        modules: records,
        resources,
        automations: if options.automations {
            all_automations
                .into_iter()
                .map(|tool| Automation {
                    sync_id: automation_refs[&tool.id].clone(),
                    tool,
                })
                .collect()
        } else {
            vec![]
        },
        websites: if options.websites {
            all_sites
                .into_iter()
                .map(|website| Site {
                    sync_id: website_refs[&website.id.to_string()].clone(),
                    website,
                })
                .collect()
        } else {
            vec![]
        },
        favorites: if options.favorites {
            sql(store.favorites())?
        } else {
            vec![]
        },
        automation_refs,
        website_refs,
        preferences: preferences
            .into_iter()
            .filter(|(key, _)| {
                permitted_preference(key, &options)
                    && !key.starts_with("firefly.browser-module.tool.")
            })
            .collect(),
        web_storage: saved,
    };
    validate_snapshot(store, &data)?;
    Ok(data)
}
fn valid_sync_id(id: &str) -> bool {
    id.len() == 36
        && id.bytes().enumerate().all(|(i, v)| {
            if [8, 13, 18, 23].contains(&i) {
                v == b'-'
            } else {
                v.is_ascii_hexdigit()
            }
        })
}

fn snapshot_resources(
    data: &Snapshot,
    module_id: &str,
) -> Result<BTreeMap<String, Vec<u8>>, String> {
    let mut resources = BTreeMap::new();
    if let Some(values) = data.resources.get(module_id) {
        if values.len() > 128 {
            return Err("同步资源数量超限。".into());
        }
        for (path, encoded) in values {
            if encoded.len() > modules::MAX_RESOURCE_BYTES * 4 / 3 + 4 {
                return Err("同步资源大小超限。".into());
            }
            resources.insert(
                path.clone(),
                STANDARD.decode(encoded).map_err(|_| "同步资源编码无效。")?,
            );
        }
    }
    Ok(resources)
}
fn validate_snapshot(store: &Store, data: &Snapshot) -> Result<(), String> {
    if !matches!(
        data.format.as_str(),
        "firefly-lan-sync-v1" | "firefly-lan-sync-v2"
    ) || (!data.web_storage.is_empty()
        && (data.format != "firefly-lan-sync-v2" || !data.options.web_data))
        || semver::Version::parse(&data.app_version).is_err()
        || !matches!(data.platform.as_str(), "windows" | "android")
        || data.modules.len() > 128
        || data.resources.len() > data.modules.len()
        || data.automations.len() > 200
        || data.websites.len() > 1000
        || data.favorites.len() > 1000
        || data.automation_refs.len() > 200
        || data.website_refs.len() > 1000
        || data.preferences.len() > 500
    {
        return Err("同步格式、版本或数量不受支持。".into());
    }
    let mut identities = HashSet::new();
    for record in &data.modules {
        let builtin = builtin_modules::tool_id(&record.module_id).is_some();
        if !(if builtin {
            data.options.builtins
        } else {
            data.options.modules
        }) || !identities.insert(format!("module:{}", record.module_id))
        {
            return Err("同步工具包重复或不属于所选内容。".into());
        }
        let manifest = modules::parse_record(record)?;
        modules::validate_resources(&manifest, &snapshot_resources(data, &record.module_id)?)?;
    }
    if data
        .resources
        .keys()
        .any(|id| !data.modules.iter().any(|record| &record.module_id == id))
    {
        return Err("同步包含不属于工具包的资源。".into());
    }
    for item in &data.automations {
        if !data.options.automations
            || !valid_sync_id(&item.sync_id)
            || !identities.insert(format!("automation:{}", item.sync_id))
            || data.automation_refs.get(&item.tool.id) != Some(&item.sync_id)
        {
            return Err("自动化工具的同步标识无效或重复。".into());
        }
        crate::validate_custom_tool(&item.tool)?;
    }
    for item in &data.websites {
        if !data.options.websites
            || !valid_sync_id(&item.sync_id)
            || !identities.insert(format!("website:{}", item.sync_id))
            || data.website_refs.get(&item.website.id.to_string()) != Some(&item.sync_id)
        {
            return Err("网站的同步标识无效或重复。".into());
        }
        crate::validate_website(&item.website)?;
    }
    if data
        .automation_refs
        .iter()
        .any(|(id, sync)| !id.starts_with("custom.") || id.len() > 40 || !valid_sync_id(sync))
        || data
            .website_refs
            .iter()
            .any(|(id, sync)| id.parse::<u64>().is_err() || !valid_sync_id(sync))
    {
        return Err("同步引用无效。".into());
    }
    if data
        .preferences
        .iter()
        .any(|(key, value)| !permitted_preference(key, &data.options) || value.len() > 100_000)
        || data.preferences.values().map(String::len).sum::<usize>() > 2 * 1024 * 1024
    {
        return Err("同步偏好或网页数据超过上限。".into());
    }
    if data.preferences.iter().any(|(key, value)| {
        matches!(
            key.as_str(),
            "firefly.web-tool-default-fullscreen.v1"
                | "firefly.web-tool-fullscreen-initial-hint.v1"
        ) && !matches!(value.as_str(), "true" | "false")
    }) {
        return Err("网页工具显示设置无效。".into());
    }
    check_storage(store, &data.web_storage)?;
    Ok(())
}
fn module_problem(catalog: &[ModuleRecord], record: &ModuleRecord) -> Result<(), String> {
    let manifest = modules::parse_record(record)?;
    if !modules::runnable_here(&manifest) {
        return Err("工具不支持当前平台。".into());
    }
    if let Some(old) = catalog.iter().find(|old| old.module_id == record.module_id) {
        let previous = modules::parse_record(old)?;
        let ids: HashSet<_> = previous.tools.iter().map(|t| &t.id).collect();
        if ids != manifest.tools.iter().map(|t| &t.id).collect() {
            return Err("已有工具包的工具 ID 不同，无法直接覆盖。".into());
        }
        if semver::Version::parse(&manifest.version).ok()
            < semver::Version::parse(&previous.version).ok()
            && !(builtin_modules::tool_id(&record.module_id).is_some()
                && !builtin_modules::modified(old))
        {
            return Err("发送端版本较旧，请保留本机工具。".into());
        }
    }
    for old in catalog
        .iter()
        .filter(|old| old.module_id != record.module_id)
    {
        if modules::parse_record(old)?
            .tools
            .iter()
            .any(|t| manifest.tools.iter().any(|incoming| incoming.id == t.id))
        {
            return Err("工具 ID 与其他已安装工具包冲突。".into());
        }
    }
    Ok(())
}
fn preview(store: &Store, data: &Snapshot) -> Result<Preview, String> {
    let catalog = crate::tool_module_records(store)?;
    let deleted = sql(store.deleted_builtin_tool_ids())?;
    let mut items = vec![];
    for record in &data.modules {
        let builtin = builtin_modules::tool_id(&record.module_id);
        let incoming = modules::parse_record(record).ok();
        let (name, hosts) = incoming
            .as_ref()
            .map(|m| (modules::label(&m.name), m.network.hosts.clone()))
            .unwrap_or_else(|| (record.module_id.clone(), vec![]));
        let old = catalog.iter().find(|old| old.module_id == record.module_id);
        let previous = old.and_then(|record| modules::parse_record(record).ok());
        let versions = incoming.as_ref().map(|manifest| ModuleVersions {
            local: previous.as_ref().map(|manifest| manifest.version.clone()),
            incoming: manifest.version.clone(),
        });
        let comparison = incoming
            .as_ref()
            .zip(previous.as_ref())
            .and_then(|(incoming, local)| {
                Some(
                    semver::Version::parse(&incoming.version)
                        .ok()?
                        .cmp(&semver::Version::parse(&local.version).ok()?),
                )
            });
        let (status, reason, status_label) = if let Err(reason) = module_problem(&catalog, record) {
            ("blocked", reason, None)
        } else if builtin.is_some_and(|id| deleted.iter().any(|v| v == id)) {
            (
                "conflict",
                "本机已删除此自带工具，覆盖会恢复它。".into(),
                None,
            )
        } else if old == Some(record) {
            ("same", "内容相同，无需重复同步。".into(), None)
        } else if builtin.is_some() || old.is_some() {
            let (label, reason) = match comparison {
                Some(std::cmp::Ordering::Greater) => {
                    (Some("可更新"), "发送端版本较新；勾选覆盖后可更新本机工具。")
                }
                Some(std::cmp::Ordering::Equal) => (
                    Some("内容不同"),
                    "版本相同，内容不同；勾选覆盖后使用发送端内容。",
                ),
                Some(std::cmp::Ordering::Less) => (
                    Some("版本较旧"),
                    "发送端版本较旧；覆盖会替换本机自带的默认内容。",
                ),
                None => (None, "本机存在同 ID 的内容。"),
            };
            ("conflict", reason.into(), label.map(str::to_owned))
        } else {
            ("new", String::new(), None)
        };
        items.push(Item {
            key: format!("module:{}", record.module_id),
            kind: if builtin.is_some() {
                "builtins"
            } else {
                "modules"
            }
            .into(),
            name,
            status: status.into(),
            status_label,
            reason,
            versions,
            network_hosts: hosts,
        });
    }
    let mut names: BTreeMap<_, _> = crate::listed_tools(store)?
        .into_iter()
        .map(|tool| (tool.id, tool.name))
        .collect();
    for record in &data.modules {
        for tool in modules::parse_record(record)?.tools {
            names
                .entry(tool.id)
                .or_insert_with(|| modules::label(&tool.name));
        }
    }
    for (id, json) in incoming_data(store, data)? {
        let tool_id = id.strip_prefix("tool.").ok_or("网页保存数据标识无效。")?;
        let local = sql(store.stored_tool_storage_json(&id))?;
        let same = local.as_ref() == Some(&json);
        items.push(Item {
            key: format!("web_data:{id}"),
            kind: "web_data".into(),
            name: format!(
                "{} · 保存数据",
                names.get(tool_id).map(String::as_str).unwrap_or(tool_id)
            ),
            status: if same {
                "same"
            } else if local.is_some() {
                "merge"
            } else {
                "new"
            }
            .into(),
            reason: if same {
                "保存数据相同，无需重复同步。"
            } else {
                "默认补充缺少的键并保留本机同名键；勾选覆盖时整份替换。"
            }
            .into(),
            network_hosts: vec![],
            status_label: None,
            versions: None,
        });
    }
    for item in &data.automations {
        let old = sql(store.sync_local_id("automation", &item.sync_id))?
            .and_then(|id| store.custom_tool(&id).ok().flatten());
        let same = old
            .as_ref()
            .is_some_and(|old| automation_equal(old, &item.tool));
        items.push(Item {
            key: format!("automation:{}", item.sync_id),
            kind: "automations".into(),
            name: item.tool.name.clone(),
            status: if same {
                "same"
            } else if old.is_some() {
                "conflict"
            } else {
                "new"
            }
            .into(),
            reason: if same {
                "内容相同，无需重复同步。"
            } else if old.is_some() {
                "本机存在此自动化工具的其他内容。"
            } else {
                ""
            }
            .into(),
            network_hosts: vec![],
            status_label: None,
            versions: None,
        });
    }
    let all_sites = sql(store.websites())?;
    for item in &data.websites {
        let old_id = sql(store.sync_local_id("website", &item.sync_id))?;
        let old = old_id
            .and_then(|id| all_sites.iter().find(|site| site.id.to_string() == id))
            .or_else(|| all_sites.iter().find(|site| site.url == item.website.url));
        let same = old
            .as_ref()
            .is_some_and(|old| site_equal(old, &item.website));
        items.push(Item {
            key: format!("website:{}", item.sync_id),
            kind: "websites".into(),
            name: item.website.name.clone(),
            status: if same {
                "same"
            } else if old.is_some() {
                "conflict"
            } else {
                "new"
            }
            .into(),
            reason: if same {
                "内容相同。"
            } else if old.is_some() {
                "本机已有相同网站的书签。"
            } else {
                ""
            }
            .into(),
            network_hosts: vec![],
            status_label: None,
            versions: None,
        });
    }
    Ok(Preview {
        app_version: data.app_version.clone(),
        platform: data.platform.clone(),
        options: data.options.clone(),
        items,
        bytes: snapshot_bytes(data, false)?.count,
        preferences: data
            .preferences
            .iter()
            .filter(|(key, _)| !key.starts_with("firefly.browser-module.tool."))
            .map(|(key, value)| (key.clone(), value.clone()))
            .collect(),
        storage_ids: storage_ids(store, data)?.into_iter().collect(),
        web_data_count: incoming_data(store, data)?.len(),
    })
}
fn all_sites_by_url(store: &Store, url: &str) -> Option<Website> {
    store
        .websites()
        .ok()?
        .into_iter()
        .find(|site| site.url == url)
}
fn automation_equal(a: &CustomTool, b: &CustomTool) -> bool {
    a.name == b.name
        && a.description == b.description
        && a.tags == b.tags
        && a.icon == b.icon
        && a.icon_data == b.icon_data
        && serde_json::to_value(&a.steps).ok() == serde_json::to_value(&b.steps).ok()
}
fn site_equal(a: &Website, b: &Website) -> bool {
    a.name == b.name
        && a.url == b.url
        && a.description == b.description
        && a.tags == b.tags
        && a.favorite == b.favorite
}
fn options_subset(request: &Options, offered: &Options) -> bool {
    let a = [
        request.modules,
        request.automations,
        request.builtins,
        request.favorites,
        request.websites,
        request.layout,
        request.preferences,
        request.web_data,
    ];
    let b = [
        offered.modules,
        offered.automations,
        offered.builtins,
        offered.favorites,
        offered.websites,
        offered.layout,
        offered.preferences,
        offered.web_data,
    ];
    a.into_iter().zip(b).all(|(a, b)| !a || b)
}
fn kind_enabled(options: &Options, kind: &str) -> bool {
    match kind {
        "modules" => options.modules,
        "builtins" => options.builtins,
        "automations" => options.automations,
        "websites" => options.websites,
        "web_data" => options.web_data,
        _ => false,
    }
}
#[cfg(test)]
fn apply(store: &mut Store, data: &Snapshot, selection: &Selection) -> Result<Applied, String> {
    apply_with_storage(store, data, selection, &BTreeMap::new())
}
fn apply_with_storage(
    store: &mut Store,
    data: &Snapshot,
    selection: &Selection,
    legacy: &BTreeMap<String, String>,
) -> Result<Applied, String> {
    validate_snapshot(store, data)?;
    if selection.options.web_data {
        check_storage(store, legacy)?;
    }
    if !options_subset(&selection.options, &data.options) || selection.keys.len() > 4096 {
        return Err("同步选择无效。".into());
    }
    let report = preview(store, data)?;
    let selected: HashSet<_> = selection.keys.iter().collect();
    if selected.len() != selection.keys.len()
        || selection
            .keys
            .iter()
            .any(|key| !report.items.iter().any(|item| &item.key == key))
    {
        return Err("选择的同步项目不存在或重复。".into());
    }
    let mut skipped = 0;
    let mut chosen = HashSet::new();
    for item in &report.items {
        if !selected.contains(&item.key) || !kind_enabled(&selection.options, &item.kind) {
            continue;
        }
        if item.status == "blocked" {
            return Err(format!("{}：{}", item.name, item.reason));
        }
        if item.status == "same" || (item.status == "conflict" && !selection.replace) {
            skipped += 1;
        } else {
            chosen.insert(item.key.clone());
        }
    }
    #[cfg(any(target_os = "windows", target_os = "android"))]
    for record in &data.modules {
        if chosen.contains(&format!("module:{}", record.module_id)) {
            crate::validate_module_entries(record, &modules::parse_record(record)?)?;
        }
    }
    store.atomic_update(|staging| {
        let mut imported = 0;
        let mut warnings = vec![];
        #[cfg(any(target_os = "windows", target_os = "android"))]
        for record in &data.modules {
            if chosen.contains(&format!("module:{}", record.module_id)) {
                crate::install_tool_module_resources(
                    staging,
                    record,
                    &modules::parse_record(record)?,
                    &snapshot_resources(data, &record.module_id)?,
                )?;
                imported += 1;
            }
        }
        let mut id_map = BTreeMap::new();
        for (source, identity) in &data.automation_refs {
            if let Some(id) = sql(staging.sync_local_id("automation", identity))? {
                if sql(staging.custom_tool(&id))?.is_some() {
                    id_map.insert(source.clone(), id);
                }
            }
        }
        for item in &data.automations {
            if !chosen.contains(&format!("automation:{}", item.sync_id)) {
                continue;
            }
            let mut tool = item.tool.clone();
            tool.id = id_map.get(&item.tool.id).cloned().unwrap_or_default();
            crate::validate_text_steps(&crate::listed_tools(staging)?, &tool.steps)
                .map_err(|reason| format!("{}：{}；请同时勾选它依赖的工具。", tool.name, reason))?;
            if tool.id.is_empty() && sql(staging.custom_tools())?.len() >= 200 {
                return Err("自动化工具数量超过 200 个。".into());
            }
            let saved = sql(staging.save_custom_tool(&tool))?;
            sql(staging.attach_sync_identity("automation", &saved.id, &item.sync_id))?;
            id_map.insert(item.tool.id.clone(), saved.id);
            imported += 1;
        }
        let mut website_map = BTreeMap::new();
        for (source, identity) in &data.website_refs {
            if let Some(id) = sql(staging.sync_local_id("website", identity))? {
                if sql(staging.websites())?
                    .iter()
                    .any(|site| site.id.to_string() == id)
                {
                    website_map.insert(source.clone(), id);
                }
            }
        }
        for item in &data.websites {
            let key = format!("website:{}", item.sync_id);
            let existing = website_map
                .get(&item.website.id.to_string())
                .cloned()
                .or_else(|| {
                    all_sites_by_url(staging, &item.website.url).map(|site| site.id.to_string())
                });
            if let Some(id) = &existing {
                website_map.insert(item.website.id.to_string(), id.clone());
            }
            if !chosen.contains(&key) {
                if selection.options.websites {
                    if let Some(id) = &existing {
                        sql(staging.associate_sync_identity("website", id, &item.sync_id))?;
                    }
                }
                continue;
            }
            let mut site = item.website.clone();
            site.id = existing.and_then(|id| id.parse().ok()).unwrap_or(0);
            if site.id == 0 && sql(staging.websites())?.len() >= 1000 {
                return Err("网站数量超过 1000 个。".into());
            }
            let id = sql(staging.save_website(&site))?.to_string();
            // URL deduplication retains the canonical ID and remembers other devices' IDs.
            sql(staging.associate_sync_identity("website", &id, &item.sync_id))?;
            website_map.insert(item.website.id.to_string(), id);
            imported += 1;
        }
        let active: HashSet<_> = crate::listed_tools(staging)?
            .into_iter()
            .map(|tool| tool.id)
            .collect();
        if selection.options.favorites {
            let mut missing = 0;
            for source in &data.favorites {
                let id = if source.starts_with("custom.") {
                    id_map.get(source)
                } else {
                    Some(source)
                };
                if let Some(id) = id.filter(|id| active.contains(*id)) {
                    sql(staging.set_favorite(id, true))?;
                } else {
                    missing += 1;
                }
            }
            if missing > 0 {
                warnings.push(format!("{missing} 个收藏对应的工具未同步，已跳过。"));
            }
        }
        let mut web_data_imported = 0;
        if selection.options.web_data {
            let available = web_ids(staging)?;
            let mut unavailable = 0;
            for (id, incoming) in incoming_data(staging, data)? {
                if !chosen.contains(&format!("web_data:{id}")) {
                    continue;
                }
                let Some(tool_id) = id
                    .strip_prefix("tool.")
                    .filter(|id| available.contains(*id))
                else {
                    unavailable += 1;
                    continue;
                };
                let stored = sql(staging.stored_tool_storage_json(&id))?;
                let local = stored
                    .as_deref()
                    .or_else(|| legacy.get(&id).map(String::as_str))
                    .unwrap_or("{}");
                let merged = staging
                    .merge_tool_storage_json(&id, &incoming, local, selection.replace)
                    .map_err(|_| {
                        format!("工具 {tool_id} 合并后的保存数据无效或超过 1 MiB，本次导入未提交。")
                    })?;
                if stored.as_ref() != Some(&merged) {
                    sql(staging.save_tool_storage_json(&id, &merged))?;
                    web_data_imported += 1;
                }
            }
            if unavailable > 0 {
                warnings.push(format!(
                    "{unavailable} 个工具的保存数据未导入，对应网页工具未安装或未启用。"
                ));
            }
        }
        let preferences = data
            .preferences
            .iter()
            .filter(|(key, _)| permitted_preference(key, &selection.options))
            .filter(|(key, _)| !key.starts_with("firefly.browser-module.tool."))
            .map(|(key, value)| (key.clone(), value.clone()))
            .collect();
        let site_ids = sql(staging.websites())?
            .iter()
            .map(|site| site.id.to_string())
            .collect();
        Ok(Applied {
            imported,
            skipped,
            id_map,
            website_map,
            preferences,
            warnings,
            active_ids: active.into_iter().collect(),
            site_ids,
            web_data_imported,
        })
    })
}

#[tauri::command]
pub async fn sync_share(
    app: tauri::AppHandle,
    sync: tauri::State<'_, SyncState>,
    options: Options,
    preferences: BTreeMap<String, String>,
    module_ids: Option<Vec<String>>,
    legacy_storage: Option<BTreeMap<String, String>>,
) -> Result<sync_transport::ShareInfo, String> {
    sync_close(sync.clone());
    let revision = sync.revision.load(Ordering::Relaxed);
    let bytes = tauri::async_runtime::spawn_blocking(move || {
        let state = app.state::<AppState>();
        let store = state.0.lock().map_err(|_| "数据库暂不可用。")?;
        let ids = module_ids.map(|ids| ids.into_iter().collect::<HashSet<_>>());
        let data = snapshot_with_storage(
            &store,
            options,
            preferences,
            ids.as_ref(),
            legacy_storage.unwrap_or_default(),
        )?;
        Ok::<_, String>(snapshot_bytes(&data, true)?.bytes)
    })
    .await
    .map_err(|_| "同步准备线程失败。")??;
    let mut slot = sync.sharing.lock().map_err(|_| "同步暂不可用。")?;
    if revision != sync.revision.load(Ordering::Relaxed) {
        return Err("同步已取消。".into());
    }
    let sharing = sync_transport::start(bytes)?;
    let info = sharing.info.clone();
    *slot = Some(sharing);
    Ok(info)
}
#[tauri::command]
pub fn sync_status(
    sync: tauri::State<'_, SyncState>,
) -> Result<Option<sync_transport::ShareStatus>, String> {
    Ok(sync
        .sharing
        .lock()
        .map_err(|_| "同步暂不可用。")?
        .as_ref()
        .map(|s| s.status()))
}
#[tauri::command]
pub fn sync_close(sync: tauri::State<'_, SyncState>) {
    sync.revision.fetch_add(1, Ordering::Relaxed);
    if let Ok(mut cancel) = sync.cancel.lock() {
        if let Some(cancel) = cancel.take() {
            cancel.notify_one();
        }
    }
    if let Ok(mut sharing) = sync.sharing.lock() {
        if let Some(sharing) = sharing.take() {
            sharing.close();
        }
    }
    if let Ok(mut pending) = sync.pending.lock() {
        *pending = None;
    }
}
#[tauri::command]
pub async fn sync_receive(
    app: tauri::AppHandle,
    endpoint: String,
    code: String,
) -> Result<Preview, String> {
    use tauri::Manager;
    let sync = app.state::<SyncState>();
    sync_close(sync.clone());
    let revision = sync.revision.load(Ordering::Relaxed);
    let cancel = Arc::new(tokio::sync::Notify::new());
    *sync.cancel.lock().map_err(|_| "同步暂不可用。")? = Some(cancel.clone());
    if revision != sync.revision.load(Ordering::Relaxed) {
        return Err("同步已取消。".into());
    }
    let result = tokio::select! {value=sync_transport::receive(endpoint,code)=>value,_=cancel.notified()=>Err("同步已取消。".into())};
    let bytes = result?;
    let data: Snapshot =
        serde_json::from_slice(&bytes).map_err(|_| "同步数据无效或对方应用版本不兼容。")?;
    let mut pending = sync.pending.lock().map_err(|_| "同步暂不可用。")?;
    let store = app.state::<AppState>();
    let store = store.0.lock().map_err(|_| "数据库暂不可用。")?;
    validate_snapshot(&store, &data)?;
    let report = preview(&store, &data)?;
    if revision != sync.revision.load(Ordering::Relaxed) {
        return Err("同步已取消。".into());
    }
    let version = baseline(&store, &data)?;
    *pending = Some(Pending {
        snapshot: data,
        baseline: version,
    });
    Ok(report)
}
#[tauri::command]
pub fn sync_preview(
    state: tauri::State<'_, AppState>,
    sync: tauri::State<'_, SyncState>,
) -> Result<Preview, String> {
    let mut pending = sync.pending.lock().map_err(|_| "同步暂不可用。")?;
    let pending = pending.as_mut().ok_or("请先连接发送端。")?;
    let store = state.0.lock().map_err(|_| "数据库暂不可用。")?;
    pending.baseline = baseline(&store, &pending.snapshot)?;
    preview(&store, &pending.snapshot)
}
#[tauri::command]
pub fn sync_apply(
    state: tauri::State<'_, AppState>,
    sync: tauri::State<'_, SyncState>,
    selection: Selection,
    legacy_storage: Option<BTreeMap<String, String>>,
) -> Result<Applied, String> {
    let mut pending = sync.pending.lock().map_err(|_| "同步暂不可用。")?;
    let data = pending.as_ref().ok_or("请先连接并预览同步内容。")?;
    let mut store = state.0.lock().map_err(|_| "数据库暂不可用。")?;
    if baseline(&store, &data.snapshot)? != data.baseline {
        return Err("本机内容已变化，请点击“重新预览”后再同步。".into());
    }
    let result = apply_with_storage(
        &mut store,
        &data.snapshot,
        &selection,
        &legacy_storage.unwrap_or_default(),
    )?;
    *pending = None;
    Ok(result)
}

#[cfg(all(test, any(target_os = "windows", target_os = "android")))]
mod tests {
    use super::*;
    use toolbox_core::ToolStep;
    fn store() -> Store {
        Store::open(std::path::Path::new(":memory:")).unwrap()
    }
    fn record() -> ModuleRecord {
        let mut record = builtin_modules::bundled("builtin.json.format").unwrap();
        record.module_id = "local.sync".into();
        record.manifest["module_id"] = "local.sync".into();
        record.manifest["schema_version"] = 5.into();
        record.manifest["tools"][0]["id"] = "local.sync.text".into();
        record.scripts.insert(
            "main.js".into(),
            "export function run(input) { return input; }".into(),
        );
        record
    }
    fn automation(tool_id: &str) -> CustomTool {
        CustomTool {
            icon: None,
            icon_data: None,
            id: String::new(),
            name: "Flow".into(),
            description: "Test".into(),
            tags: vec![],
            steps: vec![ToolStep {
                tool_id: tool_id.into(),
                action: "format".into(),
            }],
        }
    }
    fn options() -> Options {
        Options {
            modules: true,
            automations: true,
            favorites: true,
            websites: true,
            ..Options::default()
        }
    }

    fn web_options() -> Options {
        Options {
            web_data: true,
            ..Options::default()
        }
    }

    #[test]
    fn fullscreen_preferences_require_opt_in_and_boolean_values() {
        let source = store();
        let flags = BTreeMap::from([
            (
                "firefly.web-tool-default-fullscreen.v1".into(),
                "true".into(),
            ),
            (
                "firefly.web-tool-fullscreen-initial-hint.v1".into(),
                "false".into(),
            ),
        ]);
        let selected = Options {
            preferences: true,
            ..Options::default()
        };
        let data = snapshot(&source, selected, flags.clone()).unwrap();
        assert_eq!(data.preferences, flags);
        assert!(validate_snapshot(&source, &data).is_ok());
        let excluded = snapshot(
            &source,
            Options {
                layout: true,
                ..Options::default()
            },
            flags,
        )
        .unwrap();
        assert!(excluded.preferences.is_empty());
        for key in [
            "firefly.web-tool-default-fullscreen.v1",
            "firefly.web-tool-fullscreen-initial-hint.v1",
        ] {
            let mut invalid = data.clone();
            invalid.preferences.insert(key.into(), "1".into());
            assert!(validate_snapshot(&source, &invalid).is_err());
        }
    }

    #[test]
    fn sqlite_snapshots_are_opt_in_and_preserve_raw_utf16_and_empty_snapshots() {
        let source = store();
        let mut target = store();
        let raw = r#"{"notes":"中文","edge":"\ud800","\udfff":"key"}"#;
        source
            .save_tool_storage_json("tool.notes.memo", raw)
            .unwrap();
        source
            .save_tool_storage_json("preview.notes.memo", r#"{"secret":"preview"}"#)
            .unwrap();
        source
            .save_tool_storage_json("tool.uninstalled.tool", r#"{"secret":"removed"}"#)
            .unwrap();
        let private = snapshot(&source, options(), BTreeMap::new()).unwrap();
        assert!(private.web_storage.is_empty());
        assert_eq!(private.format, "firefly-lan-sync-v1");
        let data = snapshot_with_storage(
            &source,
            web_options(),
            BTreeMap::new(),
            None,
            BTreeMap::from([(
                "tool.notes.memo".into(),
                r#"{"notes":"old browser copy"}"#.into(),
            )]),
        )
        .unwrap();
        assert_eq!(data.web_storage.len(), 1);
        assert_eq!(data.web_storage["tool.notes.memo"], raw);
        assert_eq!(data.format, "firefly-lan-sync-v2");
        let copy: Snapshot =
            serde_json::from_slice(&snapshot_bytes(&data, true).unwrap().bytes).unwrap();
        assert_eq!(copy.web_storage["tool.notes.memo"], raw);
        let selection = all(&data, &target, false);
        let imported = apply(&mut target, &data, &selection).unwrap();
        assert_eq!(imported.web_data_imported, 1);
        assert_eq!(
            target
                .stored_tool_storage_json("tool.notes.memo")
                .unwrap()
                .unwrap(),
            raw
        );
        source
            .save_tool_storage_json("tool.notes.memo", "{}")
            .unwrap();
        let cleared = snapshot(&source, web_options(), BTreeMap::new()).unwrap();
        let selection = all(&cleared, &target, true);
        apply(&mut target, &cleared, &selection).unwrap();
        assert_eq!(
            target
                .stored_tool_storage_json("tool.notes.memo")
                .unwrap()
                .unwrap(),
            "{}"
        );
        let mut invalid = data.clone();
        invalid.format = "firefly-lan-sync-v1".into();
        assert!(validate_snapshot(&source, &invalid).is_err());
        invalid = data;
        invalid.options.web_data = false;
        assert!(validate_snapshot(&source, &invalid).is_err());
    }

    #[test]
    fn sqlite_data_merges_local_keys_and_explicit_replacement_replaces_the_whole_snapshot() {
        let source = store();
        let mut target = store();
        source
            .save_tool_storage_json("tool.notes.memo", r#"{"same":"remote","new":"incoming"}"#)
            .unwrap();
        target
            .save_tool_storage_json("tool.notes.memo", r#"{"same":"local","old":"keep"}"#)
            .unwrap();
        let data = snapshot(&source, web_options(), BTreeMap::new()).unwrap();
        let selection = all(&data, &target, false);
        apply(&mut target, &data, &selection).unwrap();
        let values = target
            .load_tool_storage("tool.notes.memo", &BTreeMap::new())
            .unwrap();
        assert_eq!(values["same"], "local");
        assert_eq!(values["old"], "keep");
        assert_eq!(values["new"], "incoming");
        let selection = all(&data, &target, true);
        apply(&mut target, &data, &selection).unwrap();
        assert_eq!(
            target
                .stored_tool_storage_json("tool.notes.memo")
                .unwrap()
                .unwrap(),
            data.web_storage["tool.notes.memo"]
        );
        let before = baseline(&target, &data).unwrap();
        target
            .save_tool_storage_json("tool.notes.memo", r#"{"same":"edited after preview"}"#)
            .unwrap();
        assert_ne!(baseline(&target, &data).unwrap(), before);
        let public = snapshot(&source, options(), BTreeMap::new()).unwrap();
        let before = baseline(&target, &public).unwrap();
        target
            .save_tool_storage_json("tool.notes.memo", "{}")
            .unwrap();
        assert_eq!(baseline(&target, &public).unwrap(), before);
    }

    #[test]
    fn old_wire_data_is_imported_to_sqlite_and_uses_receiver_legacy_data_only_without_a_database_row(
    ) {
        let source = store();
        let mut target = store();
        let mut data = snapshot(&source, web_options(), BTreeMap::new()).unwrap();
        data.preferences = BTreeMap::from([
            (
                "firefly.browser-module.tool.notes.memo.same".into(),
                "remote".into(),
            ),
            (
                "firefly.browser-module.tool.notes.memo.new".into(),
                "new".into(),
            ),
        ]);
        assert_eq!(data.format, "firefly-lan-sync-v1");
        let selection = all(&data, &target, false);
        let legacy = BTreeMap::from([(
            "tool.notes.memo".into(),
            r#"{"same":"old local","old":"keep"}"#.into(),
        )]);
        let result = apply_with_storage(&mut target, &data, &selection, &legacy).unwrap();
        assert!(result.preferences.is_empty());
        assert_eq!(result.web_data_imported, 1);
        let values = target
            .load_tool_storage("tool.notes.memo", &BTreeMap::new())
            .unwrap();
        assert_eq!(values["same"], "old local");
        assert_eq!(values["old"], "keep");
        assert_eq!(values["new"], "new");
        target
            .save_tool_storage_json("tool.notes.memo", "{}")
            .unwrap();
        apply_with_storage(&mut target, &data, &selection, &legacy).unwrap();
        let values = target
            .load_tool_storage("tool.notes.memo", &BTreeMap::new())
            .unwrap();
        assert_eq!(values["same"], "remote");
        assert!(!values.contains_key("old"));
    }

    #[test]
    fn storage_overflow_rolls_back_modules_favorites_and_every_other_storage_write() {
        let source = store();
        let mut target = store();
        source.install_module(&record()).unwrap();
        source.set_favorite("local.sync.text", true).unwrap();
        source
            .save_tool_storage_json(
                "tool.notes.memo",
                &serde_json::to_string(&BTreeMap::from([("new", "a".repeat(600000))])).unwrap(),
            )
            .unwrap();
        target
            .save_tool_storage_json(
                "tool.notes.memo",
                &serde_json::to_string(&BTreeMap::from([("old", "b".repeat(600000))])).unwrap(),
            )
            .unwrap();
        let data = snapshot(
            &source,
            Options {
                modules: true,
                favorites: true,
                web_data: true,
                ..Options::default()
            },
            BTreeMap::new(),
        )
        .unwrap();
        let before = baseline(&target, &data).unwrap();
        let selection = all(&data, &target, false);
        assert!(apply(&mut target, &data, &selection)
            .unwrap_err()
            .contains("1 MiB"));
        assert_eq!(baseline(&target, &data).unwrap(), before);
        assert!(target.modules().unwrap().is_empty());
        assert!(target.favorites().unwrap().is_empty());
    }

    #[test]
    fn storage_exact_one_mib_is_accepted_but_invalid_scopes_and_oversized_values_are_rejected() {
        let source = store();
        let mut target = store();
        let raw = format!(
            "{{\"x\":\"{}\"}}",
            "a".repeat(toolbox_storage::TOOL_STORAGE_BYTES - 8)
        );
        source
            .save_tool_storage_json("tool.notes.memo", &raw)
            .unwrap();
        let data = snapshot(&source, web_options(), BTreeMap::new()).unwrap();
        let selection = all(&data, &target, true);
        apply(&mut target, &data, &selection).unwrap();
        assert_eq!(
            target
                .stored_tool_storage_json("tool.notes.memo")
                .unwrap()
                .unwrap()
                .len(),
            toolbox_storage::TOOL_STORAGE_BYTES
        );
        for (id, value) in [
            ("preview.notes.memo", "{}".to_owned()),
            ("tool.notes.memo", "[]".to_owned()),
            (
                "tool.notes.memo",
                format!(
                    "{{\"x\":\"{}\"}}",
                    "a".repeat(toolbox_storage::TOOL_STORAGE_BYTES - 7)
                ),
            ),
        ] {
            let mut invalid = data.clone();
            invalid.web_storage = BTreeMap::from([(id.into(), value)]);
            assert!(validate_snapshot(&source, &invalid).is_err());
        }
    }

    #[test]
    fn unselected_saved_data_and_missing_or_text_tools_never_receive_storage() {
        let source = store();
        let mut target = store();
        source.install_module(&record()).unwrap();
        target.install_module(&record()).unwrap();
        source
            .save_tool_storage_json("tool.notes.memo", r#"{"x":"private"}"#)
            .unwrap();
        let mut data = snapshot(&source, web_options(), BTreeMap::new()).unwrap();
        let mut selection = all(&data, &target, false);
        selection.options.web_data = false;
        assert_eq!(
            apply(&mut target, &data, &selection)
                .unwrap()
                .web_data_imported,
            0
        );
        assert!(target
            .stored_tool_storage_json("tool.notes.memo")
            .unwrap()
            .is_none());
        data.web_storage = BTreeMap::from([
            ("tool.local.sync.text".into(), "{}".into()),
            ("tool.missing.web".into(), "{}".into()),
        ]);
        let selection = all(&data, &target, true);
        let result = apply(&mut target, &data, &selection).unwrap();
        assert_eq!(result.web_data_imported, 0);
        assert_eq!(result.warnings.len(), 1);
        assert!(target
            .stored_tool_storage_json("tool.local.sync.text")
            .unwrap()
            .is_none());
    }

    #[test]
    fn imported_web_modules_and_their_saved_data_commit_together() {
        let source = store();
        let mut target = store();
        let (record, resources) = crate::resource_tests::fixture();
        source
            .install_module_with_resources(&record, &resources)
            .unwrap();
        let id = format!(
            "tool.{}",
            record.manifest["tools"][0]["id"].as_str().unwrap()
        );
        source
            .save_tool_storage_json(&id, r#"{"notes":"package data"}"#)
            .unwrap();
        let data = snapshot(
            &source,
            Options {
                modules: true,
                web_data: true,
                ..Options::default()
            },
            BTreeMap::new(),
        )
        .unwrap();
        let mut selection = all(&data, &target, false);
        selection.keys.clear();
        let skipped = apply(&mut target, &data, &selection).unwrap();
        assert_eq!(skipped.web_data_imported, 0);
        assert!(target.stored_tool_storage_json(&id).unwrap().is_none());
        let selection = all(&data, &target, false);
        let applied = apply(&mut target, &data, &selection).unwrap();
        assert_eq!(applied.imported, 1);
        assert_eq!(applied.web_data_imported, 1);
        assert!(target.stored_tool_storage_json(&id).unwrap().is_some());
    }

    #[test]
    fn choosing_one_tools_saved_data_never_replaces_an_unselected_tools_data() {
        let source = store();
        let mut target = store();
        for id in ["tool.notes.memo", "tool.date.countdown"] {
            source
                .save_tool_storage_json(id, r#"{"value":"remote"}"#)
                .unwrap();
            target
                .save_tool_storage_json(id, r#"{"value":"local"}"#)
                .unwrap();
        }
        let data = snapshot(&source, web_options(), BTreeMap::new()).unwrap();
        let mut selection = all(&data, &target, true);
        selection.keys = vec!["web_data:tool.notes.memo".into()];
        let result = apply(&mut target, &data, &selection).unwrap();
        assert_eq!(result.web_data_imported, 1);
        assert_eq!(
            target
                .load_tool_storage("tool.notes.memo", &BTreeMap::new())
                .unwrap()["value"],
            "remote"
        );
        assert_eq!(
            target
                .load_tool_storage("tool.date.countdown", &BTreeMap::new())
                .unwrap()["value"],
            "local"
        );
        selection.keys.push(selection.keys[0].clone());
        assert!(apply(&mut target, &data, &selection).is_err());
    }

    #[test]
    fn binary_resource_sync_round_trips_and_rejects_tampered_bytes_before_writing() {
        let source = store();
        let mut target = store();
        let (record, resources) = crate::resource_tests::fixture();
        source
            .install_module_with_resources(&record, &resources)
            .unwrap();
        let data = snapshot(
            &source,
            Options {
                modules: true,
                ..Options::default()
            },
            BTreeMap::new(),
        )
        .unwrap();
        let selection = all(&data, &target, false);
        let result = apply(&mut target, &data, &selection).unwrap();
        assert_eq!(result.imported, 1);
        assert_eq!(
            target.module_resources(&record.module_id).unwrap(),
            resources
        );
        assert!(preview(&target, &data)
            .unwrap()
            .items
            .iter()
            .all(|item| item.status == "same"));
        let mut invalid = data;
        invalid
            .resources
            .get_mut(&record.module_id)
            .unwrap()
            .insert("assets/add.wasm".into(), STANDARD.encode(b"bad"));
        assert!(validate_snapshot(&source, &invalid).is_err());
        assert_eq!(
            target.module_resources(&record.module_id).unwrap(),
            resources
        );
    }

    #[test]
    fn selecting_packages_omits_unselected_binary_payloads() {
        let source = store();
        let (asset_record, resources) = crate::resource_tests::fixture();
        source
            .install_module_with_resources(&asset_record, &resources)
            .unwrap();
        source.install_module(&record()).unwrap();
        let ids = HashSet::from(["local.sync".to_owned()]);
        let data = snapshot_selected(
            &source,
            Options {
                modules: true,
                ..Options::default()
            },
            BTreeMap::new(),
            Some(&ids),
        )
        .unwrap();
        assert_eq!(data.modules.len(), 1);
        assert_eq!(data.modules[0].module_id, "local.sync");
        assert!(data.resources.is_empty());
        assert!(snapshot_selected(
            &source,
            Options {
                modules: true,
                ..Options::default()
            },
            BTreeMap::new(),
            Some(&HashSet::from(["absent".to_owned()]))
        )
        .is_err());
    }
    fn all(data: &Snapshot, target: &Store, replace: bool) -> Selection {
        Selection {
            options: data.options.clone(),
            keys: preview(target, data)
                .unwrap()
                .items
                .iter()
                .map(|item| item.key.clone())
                .collect(),
            replace,
        }
    }
    #[test]
    fn repeated_and_reverse_sync_preserve_identity_and_remap_colliding_local_ids() {
        let source = store();
        let mut target = store();
        source.install_module(&record()).unwrap();
        let incoming = source
            .save_custom_tool(&automation("local.sync.text"))
            .unwrap();
        source.set_favorite(&incoming.id, true).unwrap();
        let unrelated = target.save_custom_tool(&automation("json.format")).unwrap();
        target.set_favorite(&unrelated.id, true).unwrap();
        assert_eq!(incoming.id, unrelated.id);
        let site = Website {
            id: 0,
            name: "Remote".into(),
            url: "https://remote.example.com".into(),
            description: String::new(),
            tags: String::new(),
            favorite: true,
        };
        source.save_website(&site).unwrap();
        let mut local = site.clone();
        local.url = "https://local.example.com".into();
        target.save_website(&local).unwrap();
        let data = snapshot(&source, options(), BTreeMap::new()).unwrap();
        let selection = all(&data, &target, false);
        let result = apply(&mut target, &data, &selection).unwrap();
        assert_ne!(result.id_map[&incoming.id], unrelated.id);
        assert_ne!(result.website_map["1"], "1");
        assert_eq!(target.custom_tools().unwrap().len(), 2);
        assert_eq!(target.favorites().unwrap().len(), 2);
        assert_eq!(target.websites().unwrap().len(), 2);
        let selection = all(&data, &target, false);
        assert!(preview(&target, &data)
            .unwrap()
            .items
            .iter()
            .all(|item| item.status == "same"));
        assert_eq!(apply(&mut target, &data, &selection).unwrap().imported, 0);
        let target_copy = target
            .sync_local_id("automation", &data.automations[0].sync_id)
            .unwrap()
            .unwrap();
        let reversed = snapshot(&target, options(), BTreeMap::new()).unwrap();
        let mut source = source;
        let selection = all(&reversed, &source, false);
        let result = apply(&mut source, &reversed, &selection).unwrap();
        assert_eq!(result.id_map[&target_copy], incoming.id);
        assert_eq!(source.custom_tools().unwrap().len(), 2);
    }
    #[test]
    fn dependency_failure_and_invalid_source_leave_all_local_records_unchanged() {
        let source = store();
        let mut target = store();
        source.install_module(&record()).unwrap();
        source
            .save_custom_tool(&automation("missing.text.tool"))
            .unwrap();
        target.set_favorite("json.format", true).unwrap();
        let data = snapshot(&source, options(), BTreeMap::new()).unwrap();
        let before = baseline(&target, &data).unwrap();
        let selection = all(&data, &target, false);
        assert!(apply(&mut target, &data, &selection)
            .unwrap_err()
            .contains("依赖"));
        assert_eq!(baseline(&target, &data).unwrap(), before);
        let mut data = data;
        data.automations.clear();
        data.modules[0]
            .scripts
            .insert("main.js".into(), "export invalid syntax !!!".into());
        let selection = all(&data, &target, false);
        assert!(apply(&mut target, &data, &selection).is_err());
        assert_eq!(baseline(&target, &data).unwrap(), before);
    }
    #[test]
    fn conflicts_preserve_local_content_until_explicitly_selected_for_replacement() {
        let source = store();
        let mut target = store();
        let remote = record();
        let mut local = remote.clone();
        local.scripts.insert(
            "main.js".into(),
            "export function run(input) { return {text: 'local'}; }".into(),
        );
        source.install_module(&remote).unwrap();
        target.install_module(&local).unwrap();
        let data = snapshot(&source, options(), BTreeMap::new()).unwrap();
        let selection = all(&data, &target, false);
        let shown = preview(&target, &data).unwrap();
        assert_eq!(shown.items[0].status, "conflict");
        assert_eq!(shown.items[0].status_label.as_deref(), Some("内容不同"));
        assert!(shown.items[0].reason.contains("版本相同，内容不同"));
        assert_eq!(
            shown.items[0].versions.as_ref().unwrap().local.as_deref(),
            Some(remote.manifest["version"].as_str().unwrap())
        );
        assert_eq!(apply(&mut target, &data, &selection).unwrap().skipped, 1);
        assert_eq!(target.module("local.sync").unwrap(), Some(local));
        let selection = all(&data, &target, true);
        apply(&mut target, &data, &selection).unwrap();
        assert_eq!(target.module("local.sync").unwrap(), Some(remote));
    }
    #[test]
    fn newer_sync_packages_show_both_versions_but_still_require_explicit_replacement() {
        for (local_version, remote_version) in [("1.9.0", "1.10.0"), ("1.0.0-rc.9", "1.0.0-rc.10")]
        {
            let source = store();
            let mut target = store();
            let mut remote = record();
            remote.manifest["version"] = remote_version.into();
            let mut local = remote.clone();
            local.manifest["version"] = local_version.into();
            source.install_module(&remote).unwrap();
            target.install_module(&local).unwrap();
            let data = snapshot(&source, options(), BTreeMap::new()).unwrap();
            let shown = preview(&target, &data).unwrap();
            let item = &shown.items[0];
            assert_eq!(item.status, "conflict");
            assert_eq!(item.status_label.as_deref(), Some("可更新"));
            let versions = item.versions.as_ref().unwrap();
            assert_eq!(versions.local.as_deref(), Some(local_version));
            assert_eq!(versions.incoming, remote_version);
            let selection = all(&data, &target, false);
            assert_eq!(apply(&mut target, &data, &selection).unwrap().skipped, 1);
            assert_eq!(target.module("local.sync").unwrap(), Some(local));
            let selection = all(&data, &target, true);
            apply(&mut target, &data, &selection).unwrap();
            assert_eq!(target.module("local.sync").unwrap(), Some(remote));
        }
    }
    #[test]
    fn older_sync_packages_remain_blocked_even_when_replacement_is_enabled() {
        let source = store();
        let mut target = store();
        let mut remote = record();
        remote.manifest["version"] = "1.0.0".into();
        let mut local = remote.clone();
        local.manifest["version"] = "2.0.0".into();
        source.install_module(&remote).unwrap();
        target.install_module(&local).unwrap();
        let data = snapshot(&source, options(), BTreeMap::new()).unwrap();
        let shown = preview(&target, &data).unwrap();
        assert_eq!(shown.items[0].status, "blocked");
        assert!(shown.items[0].reason.contains("发送端版本较旧"));
        assert_eq!(
            shown.items[0].versions.as_ref().unwrap().local.as_deref(),
            Some("2.0.0")
        );
        let selection = Selection {
            options: data.options.clone(),
            keys: vec!["module:local.sync".into()],
            replace: true,
        };
        assert!(apply(&mut target, &data, &selection).is_err());
        assert_eq!(target.module("local.sync").unwrap(), Some(local));
    }
    #[test]
    fn new_and_identical_packages_show_versions_without_conflict_labels() {
        let source = store();
        let target = store();
        let remote = record();
        source.install_module(&remote).unwrap();
        let data = snapshot(&source, options(), BTreeMap::new()).unwrap();
        let shown = preview(&target, &data).unwrap();
        assert_eq!(shown.items[0].status, "new");
        assert!(shown.items[0].status_label.is_none());
        assert!(shown.items[0].versions.as_ref().unwrap().local.is_none());
        let same = preview(&source, &data).unwrap();
        assert_eq!(same.items[0].status, "same");
        assert!(same.items[0].status_label.is_none());
        assert_eq!(
            same.items[0].versions.as_ref().unwrap().local.as_ref(),
            Some(&same.items[0].versions.as_ref().unwrap().incoming)
        );
    }
    #[test]
    fn deleted_builtin_requires_explicit_replacement_and_deletion_never_propagates() {
        let source = store();
        let mut target = store();
        let mut record = builtin_modules::bundled("builtin.json.format").unwrap();
        record.scripts.insert(
            "main.js".into(),
            "export function run(input) { return input; }".into(),
        );
        source.save_builtin_module(&record, "json.format").unwrap();
        target.delete_builtin_tool("json.format").unwrap();
        let data = snapshot(
            &source,
            Options {
                builtins: true,
                ..Options::default()
            },
            BTreeMap::new(),
        )
        .unwrap();
        let selection = all(&data, &target, false);
        apply(&mut target, &data, &selection).unwrap();
        assert_eq!(target.deleted_builtin_tool_ids().unwrap(), ["json.format"]);
        let selection = all(&data, &target, true);
        apply(&mut target, &data, &selection).unwrap();
        assert!(target.deleted_builtin_tool_ids().unwrap().is_empty());
        source.delete_builtin_tool("json.format").unwrap();
        assert!(snapshot(&source, data.options, BTreeMap::new())
            .unwrap()
            .modules
            .is_empty());
    }
    #[test]
    fn older_builtin_edits_can_replace_factory_defaults_but_not_newer_user_edits() {
        let source = store();
        let mut target = store();
        let mut record = builtin_modules::bundled("builtin.json.format").unwrap();
        record.manifest["version"] = "0.1.2".into();
        record.scripts.insert(
            "main.js".into(),
            "export function run(input) { return input; }".into(),
        );
        source.save_builtin_module(&record, "json.format").unwrap();
        let data = snapshot(
            &source,
            Options {
                builtins: true,
                ..Options::default()
            },
            BTreeMap::new(),
        )
        .unwrap();
        assert_eq!(preview(&target, &data).unwrap().items[0].status, "conflict");
        let selection = all(&data, &target, true);
        apply(&mut target, &data, &selection).unwrap();
        record.manifest["version"] = "0.1.7".into();
        target.save_builtin_module(&record, "json.format").unwrap();
        assert_eq!(preview(&target, &data).unwrap().items[0].status, "blocked");
    }
    #[test]
    fn matching_independent_bookmarks_retain_identity_for_later_layout_only_sync() {
        let source = store();
        let mut target = store();
        let site = Website {
            id: 0,
            name: "Docs".into(),
            url: "https://example.com".into(),
            description: String::new(),
            tags: String::new(),
            favorite: false,
        };
        source.save_website(&site).unwrap();
        target.save_website(&site).unwrap();
        let original = target.sync_identity("website", "1").unwrap();
        let data = snapshot(
            &source,
            Options {
                websites: true,
                ..Options::default()
            },
            BTreeMap::new(),
        )
        .unwrap();
        let selection = all(&data, &target, false);
        assert_eq!(apply(&mut target, &data, &selection).unwrap().imported, 0);
        assert_eq!(target.sync_identity("website", "1").unwrap(), original);
        let layout = snapshot(
            &source,
            Options {
                layout: true,
                ..Options::default()
            },
            BTreeMap::new(),
        )
        .unwrap();
        let selection = all(&layout, &target, false);
        assert_eq!(
            apply(&mut target, &layout, &selection).unwrap().website_map["1"],
            "1"
        );
        assert_eq!(target.websites().unwrap().len(), 1);
    }
    #[test]
    fn unsupported_tool_is_visible_and_unselected_categories_cannot_be_imported() {
        let source = store();
        let target = store();
        let mut record = record();
        record.manifest["platforms"] = serde_json::json!(["ios"]);
        source.install_module(&record).unwrap();
        let data = snapshot(&source, options(), BTreeMap::new()).unwrap();
        assert_eq!(preview(&target, &data).unwrap().items[0].status, "blocked");
        assert!(!options_subset(
            &Options {
                web_data: true,
                ..Options::default()
            },
            &data.options
        ));
        let mut data = data;
        data.format = "future-format".into();
        assert!(validate_snapshot(&source, &data).is_err());
    }
}
