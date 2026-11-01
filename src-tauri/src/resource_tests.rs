//! Package compatibility, integrity, storage and sync boundaries for v7 resources.
use crate::modules::{self, Resource};
use std::collections::BTreeMap;
use toolbox_storage::ModuleRecord;

#[test]
fn image_tools_declare_actual_worker_dependencies_and_large_file_quotas() {
    for id in ["image.edit", "image.compress", "image.convert"] {
        let record = crate::builtin_modules::bundled(&format!("builtin.{id}")).unwrap();
        let manifest = crate::modules::parse_record(&record).unwrap();
        assert_eq!(manifest.schema_version, 7);
        assert_eq!(manifest.limits.input_bytes, 256 * 1024 * 1024);
        assert_eq!(manifest.limits.output_bytes, 512 * 1024 * 1024);
        for path in ["engine/magick.wasm", "engine/image-format-worker.js"] {
            let resource = manifest
                .resources
                .iter()
                .find(|resource| resource.path == path)
                .unwrap();
            let data = crate::builtin_modules::bundled_resource(&record.module_id, path).unwrap();
            assert_eq!(crate::modules::resource_digest(&data), resource.sha256);
        }
    }
    for (id, input, output) in [
        ("image.hidden", 64, 128),
        ("image.stitch", 64, 128),
        ("image.exif", 256, 16),
        ("image.base64", 96, 96),
        ("image.color", 64, 4),
    ] {
        let record = crate::builtin_modules::bundled(&format!("builtin.{id}")).unwrap();
        let manifest = crate::modules::parse_record(&record).unwrap();
        assert_eq!(manifest.schema_version, 7);
        assert_eq!(manifest.limits.input_bytes, input * 1024 * 1024);
        assert_eq!(manifest.limits.output_bytes, output * 1024 * 1024);
    }
}

#[test]
fn compressed_factory_resources_match_original_manifests() {
    let mut checked = std::collections::BTreeSet::new();
    for tool in toolbox_core::TOOLS {
        if !crate::builtin_modules::resource_tool(tool.id) {
            continue;
        }
        let module_id = format!("builtin.{}", tool.id);
        let record = crate::builtin_modules::bundled(&module_id).unwrap();
        let manifest = crate::modules::parse_record(&record).unwrap();
        for resource in manifest.resources {
            if !checked.insert((resource.path.clone(), resource.sha256.clone())) {
                continue;
            }
            let data =
                crate::builtin_modules::bundled_resource(&module_id, &resource.path).unwrap();
            assert_eq!(data.len(), resource.size, "{}", resource.path);
            assert_eq!(
                crate::modules::resource_digest(&data),
                resource.sha256,
                "{}",
                resource.path
            );
            let again =
                crate::builtin_modules::bundled_resource(&module_id, &resource.path).unwrap();
            assert!(
                std::sync::Arc::ptr_eq(&data, &again),
                "chunked reads should reuse the expanded asset"
            );
        }
    }
    assert_eq!(checked.len(), 25);
    assert!(crate::builtin_modules::bundled_resource(
        "builtin.image.ocr",
        "engine/ffmpeg-core.wasm"
    )
    .is_none());
    assert!(
        crate::builtin_modules::bundled_resource("dev.untrusted.tool", "engine/magick.wasm")
            .is_none()
    );
}

#[test]
fn ppocr_factory_replaces_all_tesseract_models_with_scoped_local_resources() {
    let record = crate::builtin_modules::bundled("builtin.image.ocr").unwrap();
    let manifest = crate::modules::parse_record(&record).unwrap();
    assert!(manifest.network.hosts.is_empty());
    for path in [
        "engine/ppocr-det.bin",
        "engine/ppocr-rec.bin",
        "engine/ppocr-keys.json",
        "engine/ocr-runtime.wasm",
    ] {
        let item = manifest
            .resources
            .iter()
            .find(|resource| resource.path == path)
            .unwrap();
        let bytes = crate::builtin_modules::bundled_resource(&record.module_id, path).unwrap();
        assert_eq!(bytes.len(), item.size);
        assert_eq!(crate::modules::resource_digest(&bytes), item.sha256);
    }
    for path in [
        "engine/ocr-core.js",
        "engine/eng.bin",
        "engine/chi_sim.bin",
        "engine/eng-best.bin",
        "engine/chi_sim-best.bin",
    ] {
        assert!(!manifest
            .resources
            .iter()
            .any(|resource| resource.path == path));
        assert!(crate::builtin_modules::bundled_resource(&record.module_id, path).is_none());
    }
}
#[test]
fn builtin_resources_share_storage_survive_source_edits_and_reset_collects_only_unused_assets() {
    let store = toolbox_storage::Store::open(std::path::Path::new(":memory:")).unwrap();
    let (source, assets) = fixture();
    for id in ["image.convert", "video.audio"] {
        let mut record = source.clone();
        record.module_id = format!("builtin.{id}");
        record.manifest["module_id"] = record.module_id.clone().into();
        record.manifest["min_app_version"] = "0.1.28".into();
        record.manifest["tools"][0]["id"] = id.into();
        let manifest = modules::parse_record(&record).unwrap();
        crate::install_tool_module_resources(&store, &record, &manifest, &assets).unwrap();
        assert_eq!(store.module_resources(&record.module_id).unwrap(), assets);
        assert_eq!(
            crate::builtin_modules::resources(&store, &record).unwrap(),
            assets
        );
    }
    assert_eq!(store.resource_bytes_except("unrelated").unwrap(), 8);
    store
        .reset_builtin_module("builtin.image.convert", "image.convert")
        .unwrap();
    assert_eq!(store.resource_bytes_except("unrelated").unwrap(), 8);
    store
        .reset_builtin_module("builtin.video.audio", "video.audio")
        .unwrap();
    assert_eq!(store.resource_bytes_except("unrelated").unwrap(), 0);
    assert!(store
        .module_resources("builtin.video.audio")
        .unwrap()
        .is_empty());
    let factory = crate::builtin_modules::bundled("builtin.image.convert").unwrap();
    assert!(crate::builtin_modules::resources(&store, &factory)
        .unwrap()
        .contains_key("engine/magick.wasm"));
}

pub fn fixture() -> (ModuleRecord, BTreeMap<String, Vec<u8>>) {
    let mut manifest: serde_json::Value = serde_json::from_str(include_str!(
        "../../examples/modules/image-card/manifest.json"
    ))
    .unwrap();
    manifest["schema_version"] = 7.into();
    manifest["min_app_version"] = "0.1.27".into();
    manifest["limits"]["input_bytes"] = serde_json::json!(modules::MAX_FILE_BYTES);
    manifest["limits"]["output_bytes"] = serde_json::json!(modules::MAX_FILE_BYTES);
    let bytes = b"\0asm\x01\0\0\0".to_vec();
    manifest["resources"] = serde_json::to_value(vec![Resource {
        path: "assets/add.wasm".into(),
        size: bytes.len(),
        sha256: modules::resource_digest(&bytes),
    }])
    .unwrap();
    let record = ModuleRecord {
        module_id: manifest["module_id"].as_str().unwrap().into(),
        manifest,
        scripts: BTreeMap::from([
            ("index.html".into(), "<h1>test</h1>".into()),
            ("style.css".into(), "body{}".into()),
            ("main.js".into(), "export function mount(){}".into()),
        ]),
    };
    (record, BTreeMap::from([("assets/add.wasm".into(), bytes)]))
}

fn capacity_record() -> ModuleRecord {
    let (mut record, _) = fixture();
    let original = record.manifest["tools"][0].clone();
    record.manifest["resources"] = serde_json::json!([]);
    record.scripts.clear();
    let mut tools = Vec::new();
    for index in 0..16 {
        let mut tool = original.clone();
        tool["id"] = format!("{}.tool_{index}", record.module_id).into();
        tool["entry"] = format!("page-{index}.html").into();
        tool["ui"]["style"] = format!("style-{index}.css").into();
        tool["ui"]["script"] = format!("main-{index}.js").into();
        record
            .scripts
            .insert(format!("page-{index}.html"), "<main>Capacity</main>".into());
        record
            .scripts
            .insert(format!("style-{index}.css"), "main{}".into());
        record.scripts.insert(
            format!("main-{index}.js"),
            "export function mount(){}".into(),
        );
        tools.push(tool);
    }
    record.manifest["tools"] = serde_json::Value::Array(tools);
    record
}

#[test]
fn web_source_capacity_accepts_48_referenced_files_and_exact_byte_boundaries() {
    let mut record = capacity_record();
    assert_eq!(record.scripts.len(), 48);
    assert!(modules::parse_record(&record).is_ok());
    let scripts = crate::module_validation_sources(&record.scripts, "main-0.js", true).unwrap();
    assert_eq!(scripts.len(), 1);
    assert!(serde_json::to_vec(&scripts).unwrap().len() < 24 * 1024 * 1024);
    assert_eq!(
        crate::module_validation_sources(&record.scripts, "main-0.js", false).unwrap(),
        record.scripts
    );
    let paths: Vec<_> = record
        .scripts
        .keys()
        .filter(|path| path.ends_with(".html"))
        .take(4)
        .cloned()
        .collect();
    for path in &paths {
        let source = record.scripts.get_mut(path).unwrap();
        source.push_str(&" ".repeat(modules::MAX_SOURCE_BYTES - source.len()));
    }
    let excess =
        record.scripts.values().map(String::len).sum::<usize>() - modules::MAX_SOURCE_TOTAL_BYTES;
    let last = record.scripts.get_mut(&paths[3]).unwrap();
    last.truncate(last.len() - excess);
    assert_eq!(
        record.scripts.values().map(String::len).sum::<usize>(),
        32 * 1024 * 1024
    );
    assert!(modules::parse_record(&record).is_ok());
    let scripts = crate::module_validation_sources(&record.scripts, "main-0.js", true).unwrap();
    assert_eq!(scripts.len(), 1);
    assert!(
        serde_json::to_vec(&scripts).unwrap().len() < 24 * 1024 * 1024,
        "HTML is not sent to the isolated syntax worker"
    );
    record.scripts.get_mut(&paths[3]).unwrap().push(' ');
    assert!(
        modules::parse_record(&record).is_err(),
        "32 MiB plus one byte"
    );
    record.scripts.get_mut(&paths[3]).unwrap().pop();
    record.scripts.get_mut(&paths[0]).unwrap().push(' ');
    assert!(
        modules::parse_record(&record).is_err(),
        "8 MiB plus one byte"
    );
    let mut too_many = capacity_record();
    for index in 48..129 {
        too_many
            .scripts
            .insert(format!("extra-{index}.js"), "export{}".into());
    }
    assert!(modules::parse_record(&too_many).is_err(), "129 sources");
}

#[test]
fn resource_capacity_round_trips_96_mib_and_draft_storage_rolls_back_above_128_mib() {
    let (mut record, _) = fixture();
    let data = vec![42u8; 96 * 1024 * 1024];
    let digest = modules::resource_digest(&data);
    record.manifest["resources"] =
        serde_json::json!([{"path":"assets/model.bin","size":data.len(),"sha256":digest}]);
    let resources = BTreeMap::from([("assets/model.bin".into(), data)]);
    let bytes = modules::pack_package_full(&record, &resources, true).unwrap();
    assert!(bytes.len() > 64 * 1024 * 1024 && bytes.len() < 128 * 1024 * 1024);
    let restored = modules::unpack_package_full(&bytes, true).unwrap();
    assert_eq!(restored.record, record);
    assert_eq!(restored.resources, resources);
    drop(restored);
    drop(bytes);
    let store = toolbox_storage::Store::open(std::path::Path::new(":memory:")).unwrap();
    store
        .install_module_with_resources(&record, &resources)
        .unwrap();
    store
        .save_resource_draft(
            "capacity",
            "assets/model.bin",
            &resources["assets/model.bin"],
        )
        .unwrap();
    let extra = vec![43u8; 32 * 1024 * 1024];
    store
        .save_resource_draft("capacity", "assets/extra.bin", &extra)
        .unwrap();
    assert!(store
        .save_resource_draft("capacity", "assets/overflow.bin", &[44])
        .is_err());
    assert_eq!(
        store
            .draft_resource_chunk(
                "capacity",
                "assets/extra.bin",
                &modules::resource_digest(&extra),
                (extra.len() - 1) as u64,
                1
            )
            .unwrap(),
        Some(vec![43])
    );
    assert_eq!(
        store
            .draft_resource_chunk(
                "capacity",
                "assets/overflow.bin",
                &modules::resource_digest(&[44]),
                0,
                1
            )
            .unwrap(),
        None
    );
    record.manifest["resources"][0]["size"] = serde_json::json!(96 * 1024 * 1024 + 1);
    assert!(modules::parse_record(&record).is_err());
}

#[test]
fn package_capacity_rejects_oversized_archives_and_unpacked_totals() {
    let bytes = vec![0u8; 128 * 1024 * 1024 + 1];
    assert!(modules::unpack_package_full(&bytes, true).is_err());
    drop(bytes);
    let (mut record, _) = fixture();
    record.manifest["resources"] = serde_json::json!([
        {"path":"assets/a.bin","size":96*1024*1024,"sha256":"0".repeat(64)},
        {"path":"assets/b.bin","size":32*1024*1024,"sha256":"0".repeat(64)}
    ]);
    assert!(
        modules::parse_record(&record).is_err(),
        "sources also count toward the 128 MiB total"
    );
}

#[test]
fn resource_packages_round_trip_past_the_legacy_limit_and_detect_tampering() {
    let (mut record, mut resources) = fixture();
    let data = vec![42u8; 3 * 1024 * 1024];
    record.manifest["resources"].as_array_mut().unwrap().push(
        serde_json::to_value(Resource {
            path: "assets/model.bin".into(),
            size: data.len(),
            sha256: modules::resource_digest(&data),
        })
        .unwrap(),
    );
    resources.insert("assets/model.bin".into(), data);
    let bytes = modules::pack_package_full(&record, &resources, true).unwrap();
    assert!(bytes.len() > 2 * 1024 * 1024);
    let restored = modules::unpack_package_full(&bytes, true).unwrap();
    assert_eq!(restored.record, record);
    assert_eq!(restored.resources, resources);
    resources.get_mut("assets/model.bin").unwrap()[0] ^= 1;
    assert!(modules::pack_package_full(&record, &resources, true)
        .unwrap_err()
        .contains("摘要"));
    resources.remove("assets/add.wasm");
    assert!(modules::pack_package_full(&record, &resources, true).is_err());
}

#[test]
fn resources_require_v7_and_reject_unsafe_paths_collisions_and_invalid_wasm() {
    let (record, resources) = fixture();
    for path in [
        "../core.wasm",
        "/core.wasm",
        "C:/core.wasm",
        "assets\\core.wasm",
        "assets/run.exe",
        "main.js",
    ] {
        let mut changed = record.clone();
        changed.manifest["resources"][0]["path"] = path.into();
        assert!(modules::parse_record(&changed).is_err(), "{path}");
    }
    let mut changed = record.clone();
    changed.manifest["schema_version"] = 4.into();
    assert!(modules::parse_record(&changed).is_err());
    let mut changed = record.clone();
    changed.manifest["min_app_version"] = "0.1.26".into();
    assert!(modules::parse_record(&changed).is_err());
    let mut huge = record.clone();
    huge.manifest["resources"][0]["size"] = serde_json::json!(usize::MAX);
    let mut next = huge.manifest["resources"][0].clone();
    next["path"] = "assets/other.wasm".into();
    huge.manifest["resources"]
        .as_array_mut()
        .unwrap()
        .push(next);
    assert!(modules::parse_record(&huge).is_err());
    let mut changed = record.clone();
    let duplicate = changed.manifest["resources"][0].clone();
    changed.manifest["resources"]
        .as_array_mut()
        .unwrap()
        .push(duplicate);
    assert!(modules::parse_record(&changed).is_err());
    let mut invalid = resources;
    invalid.insert("assets/add.wasm".into(), b"not-wasm".to_vec());
    let mut changed = record;
    changed.manifest["resources"][0]["sha256"] = modules::resource_digest(b"not-wasm").into();
    assert!(modules::pack_package_full(&changed, &invalid, true).is_err());
}

#[test]
fn resource_drafts_are_scoped_persistent_and_survive_unrelated_package_updates() {
    let store = toolbox_storage::Store::open(std::path::Path::new(":memory:")).unwrap();
    let (mut record, resources) = fixture();
    let data = &resources["assets/add.wasm"];
    let digest = modules::resource_digest(data);
    store
        .save_resource_draft("draft-a", "assets/add.wasm", data)
        .unwrap();
    assert_eq!(
        store
            .draft_resource_chunk("draft-a", "assets/add.wasm", &digest, 1, 3)
            .unwrap(),
        Some(b"asm".to_vec())
    );
    assert_eq!(
        store
            .draft_resource_chunk("draft-b", "assets/add.wasm", &digest, 0, 8)
            .unwrap(),
        None
    );
    assert_eq!(
        store
            .draft_resource_chunk("draft-a", "assets/add.wasm", "wrong", 0, 8)
            .unwrap(),
        None
    );
    record.manifest["resources"] = serde_json::json!([]);
    store
        .install_module_with_resources(&record, &BTreeMap::new())
        .unwrap();
    assert_eq!(store.resource_drafts("draft-a").unwrap(), resources);
    assert_eq!(store.resource_bytes_except("absent").unwrap(), 8);
    store.delete_resource_drafts("draft-a", None).unwrap();
    assert!(store.resource_drafts("draft-a").unwrap().is_empty());
    assert_eq!(store.resource_bytes_except("absent").unwrap(), 0);
}

#[test]
fn binary_storage_is_atomic_chunked_and_cascades_on_uninstall() {
    let mut store = toolbox_storage::Store::open(std::path::Path::new(":memory:")).unwrap();
    let (record, resources) = fixture();
    store
        .install_module_with_resources(&record, &resources)
        .unwrap();
    assert_eq!(
        store
            .resource_chunk(&record.module_id, "assets/add.wasm", 1, 3)
            .unwrap(),
        Some(b"asm".to_vec())
    );
    assert_eq!(
        store
            .resource_chunk("another.module", "assets/add.wasm", 0, 8)
            .unwrap(),
        None
    );
    assert_eq!(
        store.module(&record.module_id).unwrap(),
        Some(record.clone())
    );
    let mut changed = record.clone();
    changed.manifest["version"] = "2.0.0".into();
    let result = store.atomic_update(|staging| {
        staging
            .install_module_with_resources(&changed, &BTreeMap::new())
            .map_err(|error| error.to_string())?;
        Err::<(), String>("abort batch".into())
    });
    assert!(result.is_err());
    assert_eq!(
        store.module(&record.module_id).unwrap(),
        Some(record.clone())
    );
    assert_eq!(
        store.module_resources(&record.module_id).unwrap(),
        resources
    );
    let mut second = record.clone();
    second.module_id = "dev.example.shared".into();
    second.manifest["module_id"] = second.module_id.clone().into();
    second.manifest["tools"][0]["id"] = "dev.example.shared.main".into();
    store
        .install_module_with_resources(&second, &resources)
        .unwrap();
    assert_eq!(store.resource_bytes_except("absent").unwrap(), 8);
    store
        .delete_module(
            &record.module_id,
            &[record.manifest["tools"][0]["id"].as_str().unwrap().into()],
        )
        .unwrap();
    assert!(store
        .module_resources(&record.module_id)
        .unwrap()
        .is_empty());
    assert_eq!(
        store.module_resources(&second.module_id).unwrap(),
        resources
    );
    store
        .delete_module(&second.module_id, &["dev.example.shared.main".into()])
        .unwrap();
    assert_eq!(store.resource_bytes_except("absent").unwrap(), 0);
}
