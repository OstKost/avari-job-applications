#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use serde::{Deserialize, Serialize};
use std::{
    fs,
    io::{Read, Write},
    net::TcpListener,
    path::PathBuf,
    process::{Child, Command, Stdio},
    sync::{Arc, Mutex},
    thread,
    time::{Duration, Instant},
};
use subtle::ConstantTimeEq;
use tauri::{
    menu::{Menu, MenuItem},
    tray::TrayIconBuilder,
    Manager,
};
use tauri_plugin_autostart::ManagerExt;

#[derive(Serialize, Deserialize)]
struct Config {
    port: u16,
}
#[derive(Serialize)]
struct Status {
    ready: bool,
    error: String,
    origin: String,
    port: u16,
    data_directory: String,
}
struct Native {
    child: Mutex<Option<Child>>,
    config: Mutex<Config>,
    ready: Mutex<bool>,
    error: Mutex<String>,
    setup_token: Mutex<String>,
    directory: PathBuf,
    bridge_url: Mutex<String>,
    bridge_token: String,
    status_item: Mutex<Option<MenuItem<tauri::Wry>>>,
    operation: Mutex<()>,
}
fn secret() -> String {
    format!(
        "{}{}",
        uuid::Uuid::new_v4().simple(),
        uuid::Uuid::new_v4().simple()
    )
}
fn origin(state: &Native) -> String {
    format!("http://127.0.0.1:{}", state.config.lock().unwrap().port)
}
fn set_status(app: &tauri::AppHandle, ready: bool, error: String) {
    let state = app.state::<Arc<Native>>();
    *state.ready.lock().unwrap() = ready;
    *state.error.lock().unwrap() = error;
    if let Some(item) = state.status_item.lock().unwrap().as_ref() {
        let _ = item.set_text(if ready {
            "Сервис работает"
        } else {
            "Сервис остановлен"
        });
    };
}
fn show_launcher(app: &tauri::AppHandle) {
    if let Some(w) = app.get_webview_window("launcher") {
        let _ = w.show();
        let _ = w.set_focus();
    }
}
fn client() -> reqwest::blocking::Client {
    reqwest::blocking::Client::builder()
        .no_proxy()
        .timeout(Duration::from_secs(1))
        .build()
        .unwrap()
}
fn open_browser(app: &tauri::AppHandle, settings: bool) {
    let state = app.state::<Arc<Native>>();
    if !*state.ready.lock().unwrap() {
        show_launcher(app);
        return;
    }
    let base = origin(&state);
    let response = client()
        .get(format!("{base}/api/v1/local/status"))
        .send()
        .and_then(|r| r.error_for_status())
        .and_then(|r| r.json::<serde_json::Value>());
    match response {
        Ok(value) => {
            let url = if value["setupNeeded"] == true {
                format!("{base}/#setup={}", state.setup_token.lock().unwrap())
            } else if settings {
                format!("{base}/settings")
            } else {
                format!("{base}/")
            };
            if open::that(url).is_err() {
                set_status(
                    app,
                    true,
                    "Не удалось открыть браузер. Откройте адрес сервера вручную.".into(),
                );
                show_launcher(app);
            }
        }
        Err(_) => {
            set_status(
                app,
                false,
                "Сервис не отвечает. Нажмите «Перезапустить».".into(),
            );
            show_launcher(app);
        }
    }
}
fn stop_server(state: &Native) {
    *state.ready.lock().unwrap() = false;
    if let Some(mut child) = state.child.lock().unwrap().take() {
        if let Some(mut stdin) = child.stdin.take() {
            let _ = stdin.write_all(b"shutdown\n");
        }
        let deadline = Instant::now() + Duration::from_secs(12);
        loop {
            match child.try_wait() {
                Ok(Some(_)) => break,
                _ if Instant::now() < deadline => thread::sleep(Duration::from_millis(100)),
                _ => {
                    let _ = child.kill();
                    let _ = child.wait();
                    break;
                }
            }
        }
    }
}
fn start_server(app: &tauri::AppHandle, open_after: bool) -> Result<(), String> {
    let state = app.state::<Arc<Native>>();
    let _operation = state.operation.lock().unwrap();
    stop_server(&state);
    set_status(app, false, "Запускаем локальный сервис…".into());
    let port = state.config.lock().unwrap().port;
    let probe = TcpListener::bind(("127.0.0.1",port)).map_err(|_| format!("Порт {port} занят. Выберите другой порт ниже; адрес подключения расширения также изменится."))?;
    drop(probe);
    let executable = std::env::current_exe().map_err(|e| e.to_string())?;
    let server = executable
        .parent()
        .ok_or("Не найден каталог приложения")?
        .join(if cfg!(windows) {
            "avari-server.exe"
        } else {
            "avari-server"
        });
    let token = secret();
    *state.setup_token.lock().unwrap() = token.clone();
    let log = state.directory.join("server.log");
    if fs::metadata(&log)
        .map(|m| m.len() > 5 * 1024 * 1024)
        .unwrap_or(false)
    {
        let _ = fs::remove_file(state.directory.join("server.previous.log"));
        fs::rename(&log, state.directory.join("server.previous.log")).map_err(|e| e.to_string())?;
    }
    let output = fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(log)
        .map_err(|e| e.to_string())?;
    let mut command = Command::new(server);
    command
        .args(["--personal", "--launcher"])
        .env("AVARI_ADDR", format!("127.0.0.1:{port}"))
        .env("AVARI_ORIGIN", origin(&state))
        .env("AVARI_DB", state.directory.join("avari.db"))
        .env("AVARI_SETUP_TOKEN", token)
        .env(
            "AVARI_LAUNCHER_URL",
            state.bridge_url.lock().unwrap().as_str(),
        )
        .env("AVARI_LAUNCHER_TOKEN", &state.bridge_token)
        .stdin(Stdio::piped())
        .stdout(output.try_clone().map_err(|e| e.to_string())?)
        .stderr(output);
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        command.creation_flags(0x08000000);
    }
    let child = command
        .spawn()
        .map_err(|e| format!("Не удалось запустить сервис: {e}"))?;
    *state.child.lock().unwrap() = Some(child);
    let deadline = Instant::now() + Duration::from_secs(90);
    let http = client();
    while Instant::now() < deadline {
        let alive = {
            let mut child = state.child.lock().unwrap();
            match child.as_mut() {
                Some(c) => matches!(c.try_wait(), Ok(None)),
                None => false,
            }
        };
        if !alive {
            return Err("Сервис завершился при запуске. Проверьте server.log в каталоге данных. Если обновление базы не удалось, сохраните данные и восстановите копию из каталога backups.".into());
        }
        if http
            .get(format!("{}/readyz", origin(&state)))
            .send()
            .map(|r| r.status().is_success())
            .unwrap_or(false)
        {
            set_status(app, true, String::new());
            if open_after {
                open_browser(app, false);
            }
            return Ok(());
        }
        thread::sleep(Duration::from_millis(250));
    }
    stop_server(&state);
    Err("Запуск занял слишком много времени. Проверьте журнал и свободное место, затем повторите запуск.".into())
}
fn restart(app: tauri::AppHandle, open_after: bool) {
    thread::spawn(move || {
        if let Err(error) = start_server(&app, open_after) {
            set_status(&app, false, error);
            show_launcher(&app);
        }
    });
}

#[tauri::command]
fn launcher_status(state: tauri::State<'_, Arc<Native>>) -> Status {
    Status {
        ready: *state.ready.lock().unwrap(),
        error: state.error.lock().unwrap().clone(),
        origin: origin(&state),
        port: state.config.lock().unwrap().port,
        data_directory: state.directory.to_string_lossy().into(),
    }
}
#[tauri::command]
fn launcher_retry(app: tauri::AppHandle) {
    restart(app, true);
}
#[tauri::command]
fn launcher_quit(app: tauri::AppHandle) {
    app.exit(0);
}
#[tauri::command]
fn launcher_open(app: tauri::AppHandle) {
    open_browser(&app, false);
}
#[tauri::command]
fn launcher_data(app: tauri::AppHandle) -> Result<(), String> {
    open::that(&app.state::<Arc<Native>>().directory).map_err(|e| e.to_string())
}
#[tauri::command]
fn launcher_port(app: tauri::AppHandle, port: u16) -> Result<(), String> {
    if port < 1024 {
        return Err("Выберите порт от 1024 до 65535".into());
    }
    let state = app.state::<Arc<Native>>();
    if let Ok(_operation) = state.operation.try_lock() {
        let data = serde_json::to_vec(&Config { port }).map_err(|e| e.to_string())?;
        let config = state.directory.join("launcher.json");
        let mut file = fs::OpenOptions::new()
            .create(true)
            .truncate(true)
            .write(true)
            .open(&config)
            .map_err(|e| e.to_string())?;
        file.write_all(&data)
            .and_then(|_| file.sync_all())
            .map_err(|e| e.to_string())?;
        *state.config.lock().unwrap() = Config { port };
    } else {
        return Err("Дождитесь завершения запуска".into());
    }
    restart(app, true);
    Ok(())
}

fn bridge(app: &tauri::AppHandle) -> Result<(), String> {
    let server = tiny_http::Server::http("127.0.0.1:0").map_err(|e| e.to_string())?;
    let state = app.state::<Arc<Native>>();
    *state.bridge_url.lock().unwrap() = format!(
        "http://{}",
        server
            .server_addr()
            .to_ip()
            .ok_or("Не удалось открыть канал лаунчера")?
    );
    let handle = app.clone();
    thread::spawn(move || {
        for mut request in server.incoming_requests() {
            let state = handle.state::<Arc<Native>>();
            let supplied = request
                .headers()
                .iter()
                .find(|h| h.field.equiv("X-Avari-Launcher-Token"))
                .map(|h| h.value.as_str())
                .unwrap_or("");
            if !bool::from(supplied.as_bytes().ct_eq(state.bridge_token.as_bytes()))
                || request.url() != "/settings"
            {
                let _ = request.respond(tiny_http::Response::empty(403));
                continue;
            }
            let manager = handle.autolaunch();
            let result: Result<bool, String> = (|| {
                match request.method() {
                    tiny_http::Method::Put => {
                        #[derive(Deserialize)]
                        #[serde(deny_unknown_fields)]
                        struct Settings {
                            autostart: bool,
                        }
                        let mut raw = String::new();
                        request
                            .as_reader()
                            .take(4097)
                            .read_to_string(&mut raw)
                            .map_err(|e| e.to_string())?;
                        if raw.len() > 4096 {
                            return Err("Request too large".into());
                        }
                        let settings: Settings =
                            serde_json::from_str(&raw).map_err(|e| e.to_string())?;
                        if settings.autostart {
                            manager.enable()
                        } else {
                            manager.disable()
                        }
                        .map_err(|e| e.to_string())?;
                    }
                    tiny_http::Method::Get => {}
                    _ => return Err("Method not allowed".into()),
                }
                manager.is_enabled().map_err(|e| e.to_string())
            })();
            let response = match result {
                Ok(enabled) => tiny_http::Response::from_string(
                    serde_json::json!({"autostart":enabled}).to_string(),
                ),
                Err(_) => tiny_http::Response::from_string("{}").with_status_code(503),
            };
            let _ = request.respond(response.with_header(
                tiny_http::Header::from_bytes("Content-Type", "application/json").unwrap(),
            ));
        }
    });
    Ok(())
}
fn setup(app: &mut tauri::App) -> Result<(), Box<dyn std::error::Error>> {
    #[cfg(target_os = "macos")]
    app.set_activation_policy(tauri::ActivationPolicy::Accessory);
    let directory = app.path().app_local_data_dir()?;
    #[cfg(debug_assertions)]
    let directory = std::env::var_os("AVARI_DESKTOP_TEST_DIR")
        .map(PathBuf::from)
        .unwrap_or(directory);
    let directory_error = fs::create_dir_all(&directory)
        .err()
        .map(|e| format!("Не удалось создать каталог данных: {e}"))
        .unwrap_or_default();
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        if directory_error.is_empty() {
            fs::set_permissions(&directory, fs::Permissions::from_mode(0o700))?;
        }
    }
    let config_path = directory.join("launcher.json");
    let (config, mut config_error) = if config_path.exists() {
        match fs::read(&config_path)
            .ok()
            .and_then(|raw| serde_json::from_slice::<Config>(&raw).ok())
            .filter(|c| c.port >= 1024)
        {
            Some(c) => (c, String::new()),
            None => (
                Config { port: 47831 },
                "Не удалось прочитать настройки. Укажите порт и сохраните настройки ниже.".into(),
            ),
        }
    } else {
        (Config { port: 47831 }, String::new())
    };
    if !directory_error.is_empty() {
        config_error = directory_error;
    }
    app.manage(Arc::new(Native {
        child: Mutex::new(None),
        config: Mutex::new(config),
        ready: Mutex::new(false),
        error: Mutex::new(config_error.clone()),
        setup_token: Mutex::new(String::new()),
        directory,
        bridge_url: Mutex::new(String::new()),
        bridge_token: secret(),
        status_item: Mutex::new(None),
        operation: Mutex::new(()),
    }));
    let status = MenuItem::with_id(app, "status", "Запускаем сервис…", false, None::<&str>)?;
    let open = MenuItem::with_id(app, "open", "Открыть Avari.Jobs", true, None::<&str>)?;
    let settings = MenuItem::with_id(app, "settings", "Настройки", true, None::<&str>)?;
    let retry = MenuItem::with_id(app, "retry", "Перезапустить", true, None::<&str>)?;
    let diagnostics = MenuItem::with_id(
        app,
        "diagnostics",
        "Состояние и каталог данных",
        true,
        None::<&str>,
    )?;
    let quit = MenuItem::with_id(app, "quit", "Завершить", true, None::<&str>)?;
    let menu = Menu::with_items(
        app,
        &[&status, &open, &settings, &retry, &diagnostics, &quit],
    )?;
    *app.state::<Arc<Native>>().status_item.lock().unwrap() = Some(status);
    TrayIconBuilder::new()
        .icon(app.default_window_icon().unwrap().clone())
        .tooltip("Avari.Jobs — локальный журнал")
        .menu(&menu)
        .show_menu_on_left_click(true)
        .on_menu_event(|app, event| match event.id.as_ref() {
            "open" => open_browser(app, false),
            "settings" => open_browser(app, true),
            "retry" => restart(app.clone(), false),
            "diagnostics" => show_launcher(app),
            "quit" => app.exit(0),
            _ => {}
        })
        .build(app)?;
    bridge(app.handle()).map_err(std::io::Error::other)?;
    if config_error.is_empty() {
        restart(
            app.handle().clone(),
            !std::env::args().any(|a| a == "--background"),
        );
    } else {
        show_launcher(app.handle());
    }
    let monitor = app.handle().clone();
    thread::spawn(move || loop {
        thread::sleep(Duration::from_secs(2));
        let state = monitor.state::<Arc<Native>>();
        if let Ok(_operation) = state.operation.try_lock() {
            let terminated = {
                let mut child = state.child.lock().unwrap();
                match child.as_mut() {
                    Some(c) => matches!(c.try_wait(), Ok(Some(_))),
                    None => false,
                }
            };
            if terminated && *state.ready.lock().unwrap() {
                set_status(&monitor,false,"Локальный сервис остановился. Нажмите «Перезапустить»; подробности находятся в server.log.".into());
                show_launcher(&monitor);
            }
        };
    });
    if std::env::args().any(|a| a == "--diagnostics") {
        show_launcher(app.handle());
    }
    Ok(())
}
fn autostart_plugin() -> tauri::plugin::TauriPlugin<tauri::Wry> {
    let builder = tauri_plugin_autostart::Builder::new()
        .app_name("Avari.Jobs")
        .args(["--background"]);
    #[cfg(target_os = "macos")]
    let builder = builder.macos_launcher(tauri_plugin_autostart::MacosLauncher::LaunchAgent);
    builder.build()
}

fn main() {
    let app = tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, args, _| {
            if !args.iter().any(|a| a == "--background") {
                open_browser(app, false);
            }
        }))
        .plugin(autostart_plugin())
        .invoke_handler(tauri::generate_handler![
            launcher_status,
            launcher_retry,
            launcher_open,
            launcher_port,
            launcher_data,
            launcher_quit
        ])
        .setup(setup)
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                api.prevent_close();
                let _ = window.hide();
            }
        })
        .build(tauri::generate_context!())
        .expect("Не удалось запустить лаунчер Avari.Jobs");
    app.run(|app, event| {
        if matches!(event, tauri::RunEvent::Exit) {
            stop_server(&app.state::<Arc<Native>>());
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn bundled_service_keeps_data_and_stops_gracefully() {
        let binary = std::env::current_exe()
            .unwrap()
            .parent()
            .unwrap()
            .parent()
            .unwrap()
            .join(if cfg!(windows) {
                "avari-server.exe"
            } else {
                "avari-server"
            });
        assert!(
            binary.exists(),
            "Prepare the Go sidecar before running cargo test"
        );
        let directory =
            std::env::temp_dir().join(format!("avari-lifecycle-{}", uuid::Uuid::new_v4()));
        fs::create_dir_all(&directory).unwrap();
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let port = listener.local_addr().unwrap().port();
        drop(listener);
        let state = Native {
            child: Mutex::new(None),
            config: Mutex::new(Config { port }),
            ready: Mutex::new(false),
            error: Mutex::new(String::new()),
            setup_token: Mutex::new(String::new()),
            directory: directory.clone(),
            bridge_url: Mutex::new(String::new()),
            bridge_token: secret(),
            status_item: Mutex::new(None),
            operation: Mutex::new(()),
        };
        let http = client();
        for first_run in [true, false] {
            let token = secret();
            let child = Command::new(&binary)
                .args(["--personal", "--launcher"])
                .env("AVARI_ADDR", format!("127.0.0.1:{port}"))
                .env("AVARI_ORIGIN", origin(&state))
                .env("AVARI_DB", directory.join("avari.db"))
                .env("AVARI_SETUP_TOKEN", &token)
                .stdin(Stdio::piped())
                .stdout(Stdio::null())
                .stderr(Stdio::null())
                .spawn()
                .unwrap();
            *state.child.lock().unwrap() = Some(child);
            let deadline = Instant::now() + Duration::from_secs(10);
            loop {
                if http
                    .get(format!("{}/readyz", origin(&state)))
                    .send()
                    .map(|r| r.status().is_success())
                    .unwrap_or(false)
                {
                    break;
                }
                if Instant::now() >= deadline {
                    stop_server(&state);
                    panic!("Go service did not become ready");
                }
                thread::sleep(Duration::from_millis(50));
            }
            let status: serde_json::Value = http
                .get(format!("{}/api/v1/local/status", origin(&state)))
                .send()
                .unwrap()
                .json()
                .unwrap();
            assert_eq!(status["setupNeeded"], first_run);
            if first_run {
                let created = http.post(format!("{}/api/v1/local/setup", origin(&state))).json(&serde_json::json!({ "email":"owner@example.com", "password":"lifecycle-test-password", "timezone":"UTC", "token":token })).send().unwrap();
                assert_eq!(created.status(), 201);
            }
            stop_server(&state);
            assert!(
                TcpListener::bind(("127.0.0.1", port)).is_ok(),
                "Service still holds its port"
            );
        }
        fs::remove_dir_all(directory).unwrap();
    }
}
