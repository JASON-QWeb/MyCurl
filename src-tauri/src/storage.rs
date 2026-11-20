//! 本地工作区数据与响应历史持久化模块（原子写入 + 定期滚动备份）

use chrono::Local;
use serde::Serialize;
use serde_json::Value;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::{Duration, Instant};

const MAX_HISTORY: usize = 30;
const MAX_BACKUPS: usize = 30;
const BACKUP_INTERVAL: Duration = Duration::from_secs(10 * 60);

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LoadDataResult {
    pub data: Option<Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub warning: Option<String>,
}

pub struct Storage {
    data_dir: PathBuf,
    history_dir: PathBuf,
    backup_dir: PathBuf,
    data_file: PathBuf,
    last_backup: Mutex<Option<Instant>>,
}

impl Storage {
    pub fn default_data_dir() -> PathBuf {
        if let Ok(env_dir) = std::env::var("MYCURL_DATA_DIR") {
            if !env_dir.trim().is_empty() {
                return PathBuf::from(env_dir);
            }
        }
        dirs::home_dir()
            .unwrap_or_else(|| PathBuf::from("."))
            .join(".mycurl")
    }

    pub fn new(data_dir: PathBuf) -> Result<Self, String> {
        let active_dir = if fs::create_dir_all(&data_dir).is_ok() {
            data_dir
        } else {
            let fallback = std::env::temp_dir().join("mycurl-data");
            fs::create_dir_all(&fallback)
                .map_err(|e| format!("无法创建数据目录 {:?}: {e}", fallback))?;
            fallback
        };

        let history_dir = active_dir.join("history");
        let backup_dir = active_dir.join("backups");
        fs::create_dir_all(&history_dir).map_err(|e| format!("创建历史目录失败: {e}"))?;
        fs::create_dir_all(&backup_dir).map_err(|e| format!("创建备份目录失败: {e}"))?;

        let data_file = active_dir.join("data.json");
        Ok(Self {
            data_dir: active_dir,
            history_dir,
            backup_dir,
            data_file,
            last_backup: Mutex::new(None),
        })
    }

    pub fn data_dir(&self) -> &Path {
        &self.data_dir
    }

    pub fn load_data(&self) -> Result<LoadDataResult, String> {
        if !self.data_file.exists() {
            return Ok(LoadDataResult {
                data: None,
                warning: None,
            });
        }
        let text = fs::read_to_string(&self.data_file).map_err(|e| format!("读取数据失败: {e}"))?;
        match serde_json::from_str::<Value>(&text) {
            Ok(val) => Ok(LoadDataResult {
                data: Some(val),
                warning: None,
            }),
            Err(_) => {
                let ts = Local::now().format("%Y%m%d-%H%M%S");
                let _ = fs::copy(
                    &self.data_file,
                    self.backup_dir.join(format!("corrupt-{ts}.json")),
                );
                Ok(LoadDataResult {
                    data: None,
                    warning: Some("数据文件损坏，已自动备份并重新初始化".to_string()),
                })
            }
        }
    }

    pub fn save_data(&self, data: &Value) -> Result<(), String> {
        self.maybe_backup();
        let pretty =
            serde_json::to_string_pretty(data).map_err(|e| format!("序列化数据失败: {e}"))?;
        atomic_write(&self.data_file, pretty.as_bytes())
    }

    fn maybe_backup(&self) {
        if !self.data_file.exists() {
            return;
        }
        let should_backup = {
            let mut guard = self.last_backup.lock().unwrap_or_else(|e| e.into_inner());
            match *guard {
                Some(prev) if prev.elapsed() < BACKUP_INTERVAL => false,
                _ => {
                    *guard = Some(Instant::now());
                    true
                }
            }
        };
        if !should_backup {
            return;
        }

        let stamp = Local::now().format("%Y%m%d-%H%M%S");
        let dst = self.backup_dir.join(format!("data-{stamp}.json"));
        let _ = fs::copy(&self.data_file, dst);

        if let Ok(entries) = fs::read_dir(&self.backup_dir) {
            let mut files: Vec<PathBuf> = entries
                .filter_map(|e| e.ok().map(|e| e.path()))
                .filter(|p| p.extension().and_then(|s| s.to_str()) == Some("json"))
                .collect();
            files.sort();
            if files.len() > MAX_BACKUPS {
                for old in &files[..files.len() - MAX_BACKUPS] {
                    let _ = fs::remove_file(old);
                }
            }
        }
    }

    fn history_file(&self, request_id: &str) -> Result<PathBuf, String> {
        if request_id.is_empty()
            || !request_id
                .chars()
                .all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '-')
        {
            return Err("非法的请求 ID".to_string());
        }
        Ok(self.history_dir.join(format!("{request_id}.json")))
    }

    pub fn load_history(&self, request_id: &str) -> Result<Vec<Value>, String> {
        let file = self.history_file(request_id)?;
        if !file.exists() {
            return Ok(Vec::new());
        }
        let text = fs::read_to_string(&file).map_err(|e| format!("读取历史失败: {e}"))?;
        Ok(serde_json::from_str::<Vec<Value>>(&text).unwrap_or_default())
    }

    pub fn save_history(&self, request_id: &str, record: Value) -> Result<(), String> {
        let file = self.history_file(request_id)?;
        let mut items = self.load_history(request_id).unwrap_or_default();
        let rec_id = record
            .get("id")
            .and_then(|v| v.as_str())
            .map(|s| s.to_string());
        if let Some(id) = rec_id {
            items.retain(|x| x.get("id").and_then(|v| v.as_str()) != Some(id.as_str()));
        }
        items.insert(0, record);
        items.truncate(MAX_HISTORY);
        let content = serde_json::to_vec(&items).map_err(|e| format!("序列化历史失败: {e}"))?;
        atomic_write(&file, &content)
    }

    pub fn delete_history(&self, request_id: &str, item_id: Option<&str>) -> Result<(), String> {
        let file = self.history_file(request_id)?;
        if !file.exists() {
            return Ok(());
        }
        match item_id {
            Some(id) => {
                let mut items = self.load_history(request_id).unwrap_or_default();
                items.retain(|x| x.get("id").and_then(|v| v.as_str()) != Some(id));
                let content =
                    serde_json::to_vec(&items).map_err(|e| format!("序列化历史失败: {e}"))?;
                atomic_write(&file, &content)
            }
            None => {
                let _ = fs::remove_file(&file);
                Ok(())
            }
        }
    }
}

fn atomic_write(target: &Path, bytes: &[u8]) -> Result<(), String> {
    let pid = std::process::id();
    let nanos = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or(0);
    let tmp = target.with_extension(format!("json.{pid}.{nanos}.tmp"));
    fs::write(&tmp, bytes).map_err(|e| format!("写入临时文件失败: {e}"))?;
    fs::rename(&tmp, target).map_err(|e| {
        let _ = fs::remove_file(&tmp);
        format!("原子替换文件失败: {e}")
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn test_save_load_and_history() {
        let dir = tempfile::tempdir().unwrap();
        let store = Storage::new(dir.path().to_path_buf()).unwrap();

        assert!(store.load_data().unwrap().data.is_none());

        let doc = json!({ "version": 1, "workspaces": [{ "id": "ws_1", "name": "测试" }] });
        store.save_data(&doc).unwrap();
        let loaded = store.load_data().unwrap();
        assert_eq!(loaded.data.unwrap()["workspaces"][0]["name"], "测试");

        store
            .save_history("req_abc", json!({ "id": "res_1", "status": 200 }))
            .unwrap();
        store
            .save_history("req_abc", json!({ "id": "res_2", "status": 201 }))
            .unwrap();
        let hist = store.load_history("req_abc").unwrap();
        assert_eq!(hist.len(), 2);
        assert_eq!(hist[0]["id"], "res_2");

        store.delete_history("req_abc", Some("res_1")).unwrap();
        assert_eq!(store.load_history("req_abc").unwrap().len(), 1);

        store.delete_history("req_abc", None).unwrap();
        assert!(store.load_history("req_abc").unwrap().is_empty());
    }

    #[test]
    fn test_reject_path_traversal_request_id() {
        let dir = tempfile::tempdir().unwrap();
        let store = Storage::new(dir.path().to_path_buf()).unwrap();
        assert!(store.load_history("../etc/passwd").is_err());
    }
}
