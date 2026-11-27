use base64::Engine;
use serde::{Deserialize, Serialize};
use std::{
    fs,
    io::{ErrorKind, Write},
    path::{Path, PathBuf},
    process::Command,
    sync::Mutex,
};

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Payload {
    filename: String,
    content: Option<String>,
    content_base64: Option<String>,
    mime_type: String,
    source: String,
    request_name: Option<String>,
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Record {
    id: String,
    filename: String,
    path: PathBuf,
    dir: PathBuf,
    size: usize,
    mime_type: String,
    source: String,
    request_name: Option<String>,
    created_at: i64,
    exists: bool,
}

fn basename(name: &str) -> String {
    let name = name.rsplit(['/', '\\']).next().unwrap_or("").trim();
    let name = name
        .replace(|c: char| c.is_control() || "<>:\"|?*".contains(c), "")
        .trim_matches(['.', ' '])
        .to_owned();
    let stem = name.split('.').next().unwrap_or("").to_ascii_uppercase();
    if name.is_empty()
        || ["CON", "PRN", "AUX", "NUL"].contains(&stem.as_str())
        || stem
            .strip_prefix("COM")
            .or_else(|| stem.strip_prefix("LPT"))
            .is_some_and(|n| n.len() == 1 && n.as_bytes()[0].is_ascii_digit())
    {
        return "download.txt".into();
    }
    name
}

pub struct Downloads {
    data: PathBuf,
    pub dir: PathBuf,
    lock: Mutex<()>,
}

impl Downloads {
    pub fn new(data: &Path) -> Self {
        let dir = dirs::download_dir()
            .or_else(|| dirs::home_dir().map(|p| p.join("Downloads")))
            .unwrap_or_else(|| data.join("downloads"));
        Self {
            data: data.into(),
            dir,
            lock: Mutex::new(()),
        }
    }

    fn records(&self) -> Result<Vec<Record>, String> {
        match fs::read(self.data.join("downloads.json")) {
            Ok(bytes) => serde_json::from_slice(&bytes).map_err(|e| e.to_string()),
            Err(e) if e.kind() == ErrorKind::NotFound => Ok(vec![]),
            Err(e) => Err(e.to_string()),
        }
    }

    fn persist(&self, records: &[Record]) -> Result<(), String> {
        let bytes = serde_json::to_vec(records).map_err(|e| e.to_string())?;
        crate::storage::atomic_write(&self.data.join("downloads.json"), &bytes)
    }

    pub fn save(&self, payload: Payload) -> Result<Record, String> {
        let _guard = self.lock.lock().map_err(|e| e.to_string())?;
        let mut records = self.records()?;
        let bytes = match (payload.content, payload.content_base64) {
            (Some(text), None) => text.into_bytes(),
            (None, Some(b64)) => base64::engine::general_purpose::STANDARD
                .decode(b64)
                .map_err(|e| e.to_string())?,
            _ => return Err("Expected text or base64 content".into()),
        };
        fs::create_dir_all(&self.dir).map_err(|e| e.to_string())?;
        let dir = fs::canonicalize(&self.dir).map_err(|e| e.to_string())?;
        let name = basename(&payload.filename);
        let (stem, ext) = name
            .rfind('.')
            .map_or((name.as_str(), ""), |i| name.split_at(i));
        for i in 0.. {
            let filename = if i == 0 {
                name.clone()
            } else {
                format!("{stem} ({i}){ext}")
            };
            let path = dir.join(&filename);
            let mut options = fs::OpenOptions::new();
            options.write(true).create_new(true);
            #[cfg(unix)]
            {
                use std::os::unix::fs::OpenOptionsExt;
                options.mode(0o600);
            }
            let mut file = match options.open(&path) {
                Ok(f) => f,
                Err(e) if e.kind() == ErrorKind::AlreadyExists => continue,
                Err(e) => return Err(e.to_string()),
            };
            let now = chrono::Utc::now();
            let record = Record {
                id: format!(
                    "{}-{}-{i}",
                    now.timestamp_nanos_opt().unwrap_or_default(),
                    std::process::id()
                ),
                path: path.clone(),
                dir,
                filename,
                size: bytes.len(),
                mime_type: payload.mime_type,
                source: payload.source,
                request_name: payload.request_name,
                created_at: now.timestamp_millis(),
                exists: true,
            };
            records.insert(0, record.clone());
            records.truncate(100);
            let result = file.write_all(&bytes).map_err(|e| e.to_string());
            drop(file);
            if let Err(e) = result.and_then(|_| self.persist(&records)) {
                let _ = fs::remove_file(path);
                return Err(e);
            }
            return Ok(record);
        }
        unreachable!()
    }

    pub fn list(&self) -> Result<Vec<Record>, String> {
        let mut records = self.records()?;
        for record in &mut records {
            record.exists = record.path.is_file();
        }
        Ok(records)
    }

    pub fn delete(&self, id: Option<String>) -> Result<(), String> {
        let _guard = self.lock.lock().map_err(|e| e.to_string())?;
        let mut records = self.records()?;
        records.retain(|r| id.as_ref().is_some_and(|id| &r.id != id));
        self.persist(&records)
    }

    fn allowed(&self, path: &Path) -> Result<PathBuf, String> {
        if path == self.dir {
            fs::create_dir_all(path).map_err(|e| e.to_string())?;
        }
        let target = match path.canonicalize() {
            Ok(p) => p,
            Err(e) if e.kind() == ErrorKind::NotFound && fs::symlink_metadata(path).is_err() => {
                path.parent()
                    .and_then(|p| p.canonicalize().ok())
                    .zip(path.file_name())
                    .map(|(p, n)| p.join(n))
                    .ok_or_else(|| e.to_string())?
            }
            Err(e) => return Err(e.to_string()),
        };
        if self.dir.canonicalize().is_ok_and(|d| target.starts_with(d))
            || self.data.canonicalize().is_ok_and(|d| target == d)
            || self
                .records()?
                .iter()
                .any(|r| target == r.path || target == r.dir)
        {
            Ok(target)
        } else {
            Err("Path outside downloads".into())
        }
    }

    pub fn reveal(&self, path: &Path) -> Result<(), String> {
        let target = self.allowed(path)?;
        let dir = if target.is_dir() {
            &target
        } else {
            target.parent().ok_or("Missing parent")?
        };
        #[cfg(target_os = "macos")]
        let mut cmd = {
            let mut c = Command::new("open");
            if target.is_file() {
                c.arg("-R").arg(&target);
            } else {
                c.arg(dir);
            }
            c
        };
        #[cfg(target_os = "windows")]
        let mut cmd = {
            let mut c = Command::new("explorer");
            if target.is_file() {
                c.arg(format!("/select,{}", target.display()));
            } else {
                c.arg(dir);
            }
            c
        };
        #[cfg(all(unix, not(target_os = "macos")))]
        let mut cmd = {
            let mut c = Command::new("xdg-open");
            c.arg(dir);
            c
        };
        let mut child = cmd.spawn().map_err(|e| e.to_string())?;
        std::thread::spawn(move || {
            let _ = child.wait();
        });
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn names() {
        assert_eq!(basename("../sub\\...foo\0.json"), "foo.json");
        assert_eq!(basename("../.."), "download.txt");
        assert_eq!(basename("CON.txt"), "download.txt");
    }
    #[test]
    fn history_and_paths() {
        let temp = tempfile::tempdir().unwrap();
        let mut store = Downloads::new(temp.path());
        store.dir = temp.path().join("out");
        let save = || {
            store
                .save(Payload {
                    filename: "foo.json".into(),
                    content: None,
                    content_base64: Some("AAE=".into()),
                    mime_type: "application/json".into(),
                    source: "response".into(),
                    request_name: None,
                })
                .unwrap()
        };
        let first = save();
        let second = save();
        assert_eq!(second.filename, "foo (1).json");
        assert_eq!(fs::read(&second.path).unwrap(), [0, 1]);
        assert!(store.allowed(&second.path).is_ok());
        assert!(store.allowed(temp.path()).is_ok());
        assert!(store.allowed(&store.dir.join("../downloads.json")).is_err());
        #[cfg(unix)]
        {
            std::os::unix::fs::symlink(temp.path(), store.dir.join("link")).unwrap();
            assert!(store
                .allowed(&store.dir.join("link/downloads.json"))
                .is_err());
        }
        fs::remove_file(&first.path).unwrap();
        assert!(!store.list().unwrap()[1].exists);
        assert!(store.allowed(&first.path).is_ok());
        store.delete(Some(first.id)).unwrap();
        assert_eq!(store.records().unwrap().len(), 1);
        store.delete(None).unwrap();
        assert!(store.records().unwrap().is_empty());
        assert!(second.path.exists());
    }
}
