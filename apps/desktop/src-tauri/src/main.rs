#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use rand::RngCore;
use std::net::TcpStream;
use std::process::{Child, Command, Stdio};
use std::sync::Mutex;
use std::time::Duration;
use tauri::{Manager, RunEvent};

const LOOPBACK: &str = "127.0.0.1:3000";
const APP_URL: &str = "http://127.0.0.1:3000";

fn random_hex() -> String {
    let mut buf = [0u8; 32];
    rand::thread_rng().fill_bytes(&mut buf);
    buf.iter().map(|b| format!("{b:02x}")).collect()
}

fn wrap_key() -> Result<String, String> {
    let entry = keyring::Entry::new("Agentforge", "wrap-key").map_err(|e| e.to_string())?;
    if let Ok(existing) = entry.get_password() {
        if !existing.trim().is_empty() {
            return Ok(existing);
        }
    }
    let secret = random_hex();
    entry.set_password(&secret).map_err(|e| e.to_string())?;
    Ok(secret)
}

fn port_open() -> bool {
    TcpStream::connect(LOOPBACK).is_ok()
}

fn wait_for_port() -> bool {
    for _ in 0..80 {
        if port_open() {
            return true;
        }
        std::thread::sleep(Duration::from_millis(250));
    }
    false
}

fn spawn_web(secret: &str, data_dir: &std::path::Path) -> Result<Child, String> {
    let mut cmd = Command::new("pnpm");
    cmd.args(["--filter", "@agentforge/web", "start"])
        .env("AGENTFORGE_SECRETS_KEY", secret)
        .env("AGENTFORGE_DATA_DIR", data_dir)
        .env("HOST", "127.0.0.1")
        .stdin(Stdio::null());
    cmd.spawn().map_err(|e| e.to_string())
}

fn main() {
    tauri::Builder::default()
        .setup(|app| {
            let secret = wrap_key().unwrap_or_else(|_| random_hex());
            std::env::set_var("AGENTFORGE_SECRETS_KEY", &secret);

            let data_dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
            std::fs::create_dir_all(&data_dir)?;
            std::env::set_var("AGENTFORGE_DATA_DIR", &data_dir);

            if !port_open() {
                match spawn_web(&secret, &data_dir) {
                    Ok(child) => {
                        app.manage(Mutex::new(Some(child)));
                    }
                    Err(err) => {
                        eprintln!("Could not spawn Next.js: {err}. Run `pnpm dev` then reopen Agentforge.");
                        app.manage(Mutex::new(None::<Child>));
                    }
                }
            }

            if wait_for_port() {
                if let Some(window) = app.get_webview_window("main") {
                    let _ = window.eval(&format!("window.location.replace('{APP_URL}')"));
                }
            }
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error while building Agentforge")
        .run(|app, event| {
            if let RunEvent::Exit = event {
                if let Some(state) = app.try_state::<Mutex<Option<Child>>>() {
                    if let Ok(mut guard) = state.lock() {
                        if let Some(child) = guard.as_mut() {
                            let _ = child.kill();
                        }
                    }
                }
            }
        });
}
