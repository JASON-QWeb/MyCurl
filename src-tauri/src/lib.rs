//! MyCurl Rust 核心入口（Tauri v2）

pub mod http_engine;
pub mod storage;

use crate::http_engine::{CancelRegistry, SendPayload, StreamEvent};
use crate::storage::{LoadDataResult, Storage};
use serde::Serialize;
use serde_json::Value;
use tauri::ipc::Channel;
use tauri::{AppHandle, State};
use tauri_plugin_clipboard_manager::ClipboardExt;

pub struct AppState {
    pub storage: Storage,
    pub cancels: CancelRegistry,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AppInfo {
    pub version: String,
    pub data_dir: String,
    pub platform: String,
    pub arch: String,
    pub runtime: String,
}

#[tauri::command]
fn app_info(state: State<'_, AppState>) -> AppInfo {
    AppInfo {
        version: env!("CARGO_PKG_VERSION").to_string(),
        data_dir: state.storage.data_dir().to_string_lossy().to_string(),
        platform: std::env::consts::OS.to_string(),
        arch: std::env::consts::ARCH.to_string(),
        runtime: "rust-tauri".to_string(),
    }
}

#[tauri::command]
fn load_data(state: State<'_, AppState>) -> Result<LoadDataResult, String> {
    state.storage.load_data()
}

#[tauri::command]
fn save_data(state: State<'_, AppState>, data: Value) -> Result<(), String> {
    state.storage.save_data(&data)
}

#[tauri::command]
fn load_history(state: State<'_, AppState>, request_id: String) -> Result<Vec<Value>, String> {
    state.storage.load_history(&request_id)
}

#[tauri::command]
fn save_history(
    state: State<'_, AppState>,
    request_id: String,
    record: Value,
) -> Result<(), String> {
    state.storage.save_history(&request_id, record)
}

#[tauri::command]
fn delete_history(
    state: State<'_, AppState>,
    request_id: String,
    item_id: Option<String>,
) -> Result<(), String> {
    state
        .storage
        .delete_history(&request_id, item_id.as_deref())
}

#[tauri::command]
async fn send_request(
    state: State<'_, AppState>,
    payload: SendPayload,
    on_event: Channel<StreamEvent>,
) -> Result<(), String> {
    let cancel_key = payload
        .request_id
        .clone()
        .unwrap_or_else(|| "default".to_string());
    let cancel_rx = state.cancels.register(cancel_key.clone());

    http_engine::execute(payload, cancel_rx, |ev| {
        let _ = on_event.send(ev);
    })
    .await;

    state.cancels.remove(&cancel_key);
    Ok(())
}

#[tauri::command]
fn cancel_request(state: State<'_, AppState>, request_id: String) -> bool {
    state.cancels.cancel(&request_id)
}

#[tauri::command]
fn read_clipboard(app: AppHandle) -> Result<String, String> {
    app.clipboard().read_text().map_err(|e| e.to_string())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let storage =
        Storage::new(Storage::default_data_dir()).expect("无法初始化 MyCurl 本地存储目录");
    let state = AppState {
        storage,
        cancels: CancelRegistry::default(),
    };

    tauri::Builder::default()
        .plugin(tauri_plugin_clipboard_manager::init())
        .manage(state)
        .invoke_handler(tauri::generate_handler![
            app_info,
            load_data,
            save_data,
            load_history,
            save_history,
            delete_history,
            send_request,
            cancel_request,
            read_clipboard,
        ])
        .run(tauri::generate_context!())
        .expect("启动 MyCurl 桌面应用失败");
}
