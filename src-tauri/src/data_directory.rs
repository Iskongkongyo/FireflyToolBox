//! Windows storage namespace migration, before SQLite or WebView2 is opened.
//! Legacy files remain as a fallback and for existing shortcut icon references.
use std::{
    ffi::c_void,
    fs::{self, File, OpenOptions},
    io::{self, Seek, SeekFrom},
    os::windows::{fs::MetadataExt, fs::OpenOptionsExt},
    path::{Path, PathBuf},
};

pub const DIRECTORY_NAME: &str = "FireflyToolBox";
pub const LEGACY_DIRECTORY_NAME: &str = "com.fireflytoolbox.toolbox";

#[link(name = "kernel32")]
extern "system" {
    fn CreateMutexW(attributes: *const c_void, owner: i32, name: *const u16) -> *mut c_void;
    fn WaitForSingleObject(handle: *mut c_void, milliseconds: u32) -> u32;
    fn ReleaseMutex(handle: *mut c_void) -> i32;
    fn CloseHandle(handle: *mut c_void) -> i32;
}

struct MigrationLock(*mut c_void);

impl MigrationLock {
    fn acquire(root: &Path) -> io::Result<Self> {
        use sha2::{Digest, Sha256};
        let key = Sha256::digest(root.as_os_str().to_string_lossy().as_bytes());
        let name = format!("Local\\FireflyToolBox.StorageMigration.{key:x}");
        let wide: Vec<u16> = name.encode_utf16().chain(Some(0)).collect();
        let handle = unsafe { CreateMutexW(std::ptr::null(), 0, wide.as_ptr()) };
        if handle.is_null() {
            return Err(io::Error::last_os_error());
        }
        // An abandoned mutex is safe to acquire: staged copies are never used
        // until the complete directory has been renamed into place.
        match unsafe { WaitForSingleObject(handle, 30_000) } {
            0 | 0x80 => Ok(Self(handle)),
            status => {
                let error = if status == 0x102 {
                    io::Error::new(io::ErrorKind::TimedOut, "另一个实例正在迁移应用数据。")
                } else {
                    io::Error::last_os_error()
                };
                unsafe { CloseHandle(handle) };
                Err(error)
            }
        }
    }
}

impl Drop for MigrationLock {
    fn drop(&mut self) {
        unsafe {
            ReleaseMutex(self.0);
            CloseHandle(self.0);
        }
    }
}

fn reject_reparse(metadata: &fs::Metadata) -> io::Result<()> {
    if metadata.file_attributes() & 0x400 != 0 {
        return Err(io::Error::new(
            io::ErrorKind::InvalidData,
            "应用数据中存在目录链接，请先检查数据目录。",
        ));
    }
    Ok(())
}

fn entries(directory: &Path) -> io::Result<Vec<fs::DirEntry>> {
    let mut result = fs::read_dir(directory)?.collect::<io::Result<Vec<_>>>()?;
    result.sort_by_key(|entry| entry.file_name());
    Ok(result)
}

fn skip_temporary(root: &Path, entry: &fs::DirEntry) -> bool {
    entry.path().parent() == Some(root) && entry.file_name() == "runtime-temp"
}

fn lock_databases(
    root: &Path,
    directory: &Path,
    locks: &mut Vec<(PathBuf, File)>,
) -> io::Result<()> {
    for entry in entries(directory)? {
        if skip_temporary(root, &entry) {
            continue;
        }
        let metadata = fs::symlink_metadata(entry.path())?;
        reject_reparse(&metadata)?;
        if metadata.is_dir() {
            lock_databases(root, &entry.path(), locks)?;
        } else {
            let name = entry.file_name().to_string_lossy().into_owned();
            if ["firefly.sqlite", "LOCK", "lockfile", "SingletonLock"]
                .iter()
                .any(|expected| name.eq_ignore_ascii_case(expected))
            {
                // Exclusive sharing detects a running old app/profile and
                // prevents it from reopening the database during the copy.
                let file = OpenOptions::new()
                    .read(true)
                    .share_mode(0)
                    .open(entry.path())?;
                locks.push((entry.path(), file));
            }
        }
    }
    Ok(())
}

struct StagedDirectory {
    path: PathBuf,
    target: PathBuf,
    committed: bool,
}

impl StagedDirectory {
    fn new(target: PathBuf) -> io::Result<Self> {
        let parent = target
            .parent()
            .ok_or_else(|| io::Error::new(io::ErrorKind::InvalidInput, "无效的应用数据目录。"))?;
        let path = parent.join(format!(
            ".FireflyToolBox-migrate-{:032x}",
            rand::random::<u128>()
        ));
        fs::create_dir(&path)?;
        Ok(Self {
            path,
            target,
            committed: false,
        })
    }
}

impl Drop for StagedDirectory {
    fn drop(&mut self) {
        if !self.committed {
            // Delete only our newly created staging directory, after checking
            // its resolved parent is the intended AppData parent directory.
            if let (Ok(stage), Some(parent)) = (self.path.canonicalize(), self.target.parent()) {
                if let Ok(parent) = parent.canonicalize() {
                    if stage.parent() == Some(parent.as_path())
                        && stage.file_name().is_some_and(|name| {
                            name.to_string_lossy()
                                .starts_with(".FireflyToolBox-migrate-")
                        })
                    {
                        let _ = fs::remove_dir_all(stage);
                    }
                }
            }
        }
    }
}

fn copy_tree(
    root: &Path,
    source: &Path,
    destination: &Path,
    locks: &[(PathBuf, File)],
) -> io::Result<()> {
    for entry in entries(source)? {
        if skip_temporary(root, &entry) {
            continue;
        }
        let path = entry.path();
        let metadata = fs::symlink_metadata(&path)?;
        reject_reparse(&metadata)?;
        let output = destination.join(entry.file_name());
        if metadata.is_dir() {
            fs::create_dir(&output)?;
            copy_tree(root, &path, &output, locks)?;
        } else if metadata.is_file() {
            let mut input = if let Some((_, file)) = locks.iter().find(|(name, _)| *name == path) {
                file.try_clone()?
            } else {
                File::open(&path)?
            };
            input.seek(SeekFrom::Start(0))?;
            let mut output = OpenOptions::new()
                .write(true)
                .create_new(true)
                .open(output)?;
            io::copy(&mut input, &mut output)?;
            output.sync_all()?;
        } else {
            return Err(io::Error::new(
                io::ErrorKind::InvalidData,
                "不支持的应用数据文件。",
            ));
        }
    }
    Ok(())
}

fn migrate_roots(roots: &[PathBuf]) -> io::Result<()> {
    let mut pending = Vec::new();
    for root in roots {
        let source = root.join(LEGACY_DIRECTORY_NAME);
        let target = root.join(DIRECTORY_NAME);
        if !source.exists() || pending.iter().any(|(previous, _)| previous == &source) {
            continue;
        }
        let metadata = fs::symlink_metadata(&source)?;
        reject_reparse(&metadata)?;
        if !metadata.is_dir() {
            return Err(io::Error::new(
                io::ErrorKind::InvalidData,
                "旧应用数据目录无效。",
            ));
        }
        if target.exists() {
            let metadata = fs::symlink_metadata(&target)?;
            reject_reparse(&metadata)?;
            if !metadata.is_dir() {
                return Err(io::Error::new(
                    io::ErrorKind::AlreadyExists,
                    "新数据目录位置已有其他文件。",
                ));
            }
            if fs::read_dir(&target)?.next().transpose()?.is_some() {
                // Existing new-format data always wins. Never merge a stale
                // backup into a profile already used by a newer version.
                continue;
            }
            fs::remove_dir(&target)?;
        }
        pending.push((source, target));
    }
    let mut locks = Vec::new();
    for (source, _) in &pending {
        lock_databases(source, source, &mut locks)?;
    }
    let mut staged = Vec::new();
    for (source, target) in pending {
        let stage = StagedDirectory::new(target)?;
        copy_tree(&source, &source, &stage.path, &locks)?;
        staged.push(stage);
    }
    // Finish copying both roots before publishing either profile. An I/O error
    // leaves the originals intact and removes all unpublished staging files.
    for stage in &mut staged {
        fs::rename(&stage.path, &stage.target)?;
        stage.committed = true;
    }
    Ok(())
}

pub fn migrate() -> Result<(), String> {
    let roaming = dirs::data_dir().ok_or("无法定位应用数据目录。")?;
    let local = dirs::data_local_dir().ok_or("无法定位本地应用数据目录。")?;
    let _lock = MigrationLock::acquire(&roaming).map_err(|error| error.to_string())?;
    migrate_roots(&[roaming, local]).map_err(|error| error.to_string())
}

pub fn show_migration_error(error: &str) {
    #[link(name = "user32")]
    extern "system" {
        fn MessageBoxW(window: *mut c_void, text: *const u16, title: *const u16, flags: u32)
            -> i32;
    }
    let message = format!("应用数据迁移未完成，旧目录中的数据仍然保留。\n请完全退出旧版本（包括托盘后台）后重试。\n\n{error}");
    let text: Vec<u16> = message.encode_utf16().chain(Some(0)).collect();
    let title: Vec<u16> = "流萤百宝箱".encode_utf16().chain(Some(0)).collect();
    unsafe { MessageBoxW(std::ptr::null_mut(), text.as_ptr(), title.as_ptr(), 0x10) };
}

#[cfg(test)]
mod tests {
    use super::*;

    struct Fixture(PathBuf);
    impl Fixture {
        fn new() -> Self {
            let root = std::env::temp_dir().join(format!(
                "firefly-data-migration-{:032x}",
                rand::random::<u128>()
            ));
            fs::create_dir(&root).unwrap();
            Self(root)
        }
        fn root(&self, name: &str) -> PathBuf {
            let root = self.0.join(name);
            fs::create_dir_all(root.join(LEGACY_DIRECTORY_NAME)).unwrap();
            root
        }
    }
    impl Drop for Fixture {
        fn drop(&mut self) {
            let path = self.0.canonicalize().unwrap();
            assert!(path.starts_with(std::env::temp_dir().canonicalize().unwrap()));
            let _ = fs::remove_dir_all(path);
        }
    }

    #[test]
    fn sqlite_profiles_and_icons_migrate_without_deleting_legacy_backups() {
        let fixture = Fixture::new();
        let roaming = fixture.root("Roaming");
        let local = fixture.root("Local");
        let old_roaming = roaming.join(LEGACY_DIRECTORY_NAME);
        {
            let store = toolbox_storage::Store::open(&old_roaming.join("firefly.sqlite")).unwrap();
            store.set_favorite("json.format", true).unwrap();
        }
        fs::create_dir(old_roaming.join("shortcut-icons")).unwrap();
        fs::write(
            old_roaming.join("shortcut-icons/icon.ico"),
            b"shortcut icon",
        )
        .unwrap();
        let profile = local
            .join(LEGACY_DIRECTORY_NAME)
            .join("EBWebView/Default/IndexedDB");
        fs::create_dir_all(&profile).unwrap();
        fs::write(profile.join("image-and-settings"), b"profile bytes").unwrap();
        fs::write(profile.join("LOCK"), b"").unwrap();
        let temporary = local.join(LEGACY_DIRECTORY_NAME).join("runtime-temp");
        fs::create_dir(&temporary).unwrap();
        fs::write(temporary.join("discardable"), b"temporary").unwrap();
        migrate_roots(&[roaming.clone(), local.clone()]).unwrap();
        let store =
            toolbox_storage::Store::open(&roaming.join(DIRECTORY_NAME).join("firefly.sqlite"))
                .unwrap();
        assert_eq!(store.favorites().unwrap(), vec!["json.format"]);
        assert_eq!(
            fs::read(roaming.join(DIRECTORY_NAME).join("shortcut-icons/icon.ico")).unwrap(),
            b"shortcut icon"
        );
        assert_eq!(
            fs::read(
                local
                    .join(DIRECTORY_NAME)
                    .join("EBWebView/Default/IndexedDB/image-and-settings")
            )
            .unwrap(),
            b"profile bytes"
        );
        assert!(old_roaming.join("firefly.sqlite").exists());
        assert!(profile.join("image-and-settings").exists());
        assert!(!local.join(DIRECTORY_NAME).join("runtime-temp").exists());
    }

    #[test]
    fn subsequent_starts_never_overwrite_newer_data_with_a_legacy_backup() {
        let fixture = Fixture::new();
        let root = fixture.root("Roaming");
        fs::write(root.join(LEGACY_DIRECTORY_NAME).join("settings"), b"old").unwrap();
        migrate_roots(&[root.clone()]).unwrap();
        fs::write(root.join(DIRECTORY_NAME).join("settings"), b"new").unwrap();
        migrate_roots(&[root.clone()]).unwrap();
        assert_eq!(
            fs::read(root.join(DIRECTORY_NAME).join("settings")).unwrap(),
            b"new"
        );
        assert_eq!(
            fs::read(root.join(LEGACY_DIRECTORY_NAME).join("settings")).unwrap(),
            b"old"
        );
    }

    #[test]
    fn running_legacy_database_blocks_migration_without_partial_profiles() {
        let fixture = Fixture::new();
        let root = fixture.root("Roaming");
        let source = root.join(LEGACY_DIRECTORY_NAME).join("firefly.sqlite");
        fs::write(&source, b"database").unwrap();
        let _locked = OpenOptions::new()
            .read(true)
            .share_mode(0)
            .open(&source)
            .unwrap();
        assert!(migrate_roots(&[root.clone()]).is_err());
        assert!(!root.join(DIRECTORY_NAME).exists());
    }

    #[test]
    fn a_failed_second_copy_does_not_publish_the_first_or_modify_sources() {
        let fixture = Fixture::new();
        let roaming = fixture.root("Roaming");
        let local = fixture.root("Local");
        fs::write(
            roaming.join(LEGACY_DIRECTORY_NAME).join("settings"),
            b"keep",
        )
        .unwrap();
        let source = local.join(LEGACY_DIRECTORY_NAME).join("Preferences");
        fs::write(&source, b"profile").unwrap();
        let _locked = OpenOptions::new()
            .read(true)
            .share_mode(0)
            .open(&source)
            .unwrap();
        assert!(migrate_roots(&[roaming.clone(), local.clone()]).is_err());
        for root in [&roaming, &local] {
            assert!(!root.join(DIRECTORY_NAME).exists());
            assert_eq!(fs::read_dir(root).unwrap().count(), 1);
        }
        assert_eq!(
            fs::read(roaming.join(LEGACY_DIRECTORY_NAME).join("settings")).unwrap(),
            b"keep"
        );
    }

    #[test]
    fn existing_non_directory_targets_are_not_replaced() {
        let fixture = Fixture::new();
        let root = fixture.root("Roaming");
        fs::write(root.join(DIRECTORY_NAME), b"other file").unwrap();
        assert!(migrate_roots(&[root.clone()]).is_err());
        assert_eq!(fs::read(root.join(DIRECTORY_NAME)).unwrap(), b"other file");
    }

    #[test]
    fn windows_uses_the_friendly_namespace_and_android_keeps_its_package_id() {
        let windows: serde_json::Value =
            serde_json::from_str(include_str!("../tauri.windows.conf.json")).unwrap();
        let shared: serde_json::Value =
            serde_json::from_str(include_str!("../tauri.conf.json")).unwrap();
        assert_eq!(windows["identifier"], DIRECTORY_NAME);
        assert_eq!(shared["identifier"], "firefly.toolbox");
    }
}
