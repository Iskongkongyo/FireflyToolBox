//! Factory resources are compressed in the executable and expanded on demand.
//! A bounded cache keeps chunked reads fast without retaining every engine.
use std::{
    collections::VecDeque,
    io::Read,
    sync::{Arc, Mutex, OnceLock},
};

const CACHE_LIMIT: usize = 64 * 1024 * 1024;
const RESOURCE_LIMIT: u64 = 64 * 1024 * 1024;

#[derive(Default)]
struct Cache {
    entries: VecDeque<(&'static str, Arc<[u8]>)>,
    bytes: usize,
}

static CACHE: OnceLock<Mutex<Cache>> = OnceLock::new();

impl Cache {
    fn clear(&mut self) -> usize {
        self.entries.clear();
        std::mem::take(&mut self.bytes)
    }

    fn get(&mut self, name: &str) -> Option<Arc<[u8]>> {
        let index = self.entries.iter().position(|entry| entry.0 == name)?;
        let entry = self.entries.remove(index)?;
        let bytes = Arc::clone(&entry.1);
        self.entries.push_back(entry);
        Some(bytes)
    }

    fn insert(&mut self, name: &'static str, data: Arc<[u8]>) {
        if data.len() > CACHE_LIMIT {
            return;
        }
        while self.bytes + data.len() > CACHE_LIMIT {
            if let Some((_, old)) = self.entries.pop_front() {
                self.bytes -= old.len();
            } else {
                break;
            }
        }
        self.bytes += data.len();
        self.entries.push_back((name, data));
    }
}

fn unpack(compressed: &[u8]) -> Option<Arc<[u8]>> {
    let mut decoder = flate2::read::ZlibDecoder::new(compressed).take(RESOURCE_LIMIT + 1);
    let mut data = Vec::new();
    decoder.read_to_end(&mut data).ok()?;
    if data.len() as u64 > RESOURCE_LIMIT {
        return None;
    }
    Some(Arc::from(data))
}

pub fn load(name: &'static str, compressed: &'static [u8]) -> Option<Arc<[u8]>> {
    let cache = CACHE.get_or_init(|| Mutex::new(Cache::default()));
    if let Some(data) = cache.lock().ok()?.get(name) {
        return Some(data);
    }
    // Expand outside the mutex so independent engine requests do not block.
    let data = unpack(compressed)?;
    let mut cache = cache.lock().ok()?;
    if let Some(existing) = cache.get(name) {
        return Some(existing);
    }
    cache.insert(name, Arc::clone(&data));
    Some(data)
}

pub fn clear_cache() -> Result<u64, String> {
    let Some(cache) = CACHE.get() else {
        return Ok(0);
    };
    let mut cache = cache.lock().map_err(|_| "引擎内存缓存暂不可用。")?;
    Ok(cache.clear() as u64)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn eviction_preserves_live_readers_and_recent_assets() {
        let mut cache = Cache::default();
        let first: Arc<[u8]> = vec![7; CACHE_LIMIT / 2].into();
        cache.insert("first", Arc::clone(&first));
        cache.insert("second", vec![8; CACHE_LIMIT / 2].into());
        assert!(cache.get("first").is_some());
        cache.insert("third", vec![9; 1].into());
        assert!(cache.get("second").is_none());
        assert!(cache.get("first").is_some());
        assert_eq!(first[first.len() - 1], 7);
        assert!(cache.bytes <= CACHE_LIMIT);
    }

    #[test]
    fn invalid_compressed_data_is_rejected() {
        assert!(unpack(b"invalid zlib stream").is_none());
    }

    #[test]
    fn clearing_releases_cached_entries_without_invalidating_live_readers() {
        let mut cache = Cache::default();
        let reader: Arc<[u8]> = vec![7; 12].into();
        cache.insert("active", Arc::clone(&reader));
        assert_eq!(cache.clear(), 12);
        assert!(cache.get("active").is_none());
        assert_eq!(reader.as_ref(), &[7; 12]);
        assert_eq!(cache.clear(), 0);
    }
}
