use super::*;
use tauri_plugin_updater::{Update, UpdaterExt};

const RELEASE_URL: &str = "https://github.com/OstKost/avari-job-applications/releases/latest";
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateStatus {
    current_version: String,
    available_version: String,
    stage: String,
    downloaded: u64,
    can_install: bool,
    total: Option<u64>,
    checked_at: u64,
    snoozed_until: u64,
    notes: Vec<ReleaseNote>,
    error: String,
    release_url: String,
}
#[derive(Clone, Serialize, Deserialize)]
struct ReleaseNote {
    version: String,
    date: String,
    summary: String,
    features: Vec<String>,
    improvements: Vec<String>,
    fixes: Vec<String>,
}
#[derive(Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Preferences {
    version: String,
    until: u64,
}
impl Preferences {
    fn reminder_for(&self, version: &str, timestamp: u64) -> u64 {
        if self.version == version && self.until > timestamp {
            self.until
        } else {
            0
        }
    }
}
pub struct Updates {
    status: Mutex<UpdateStatus>,
    update: Mutex<Option<Update>>,
    bytes: Mutex<Option<Vec<u8>>>,
    preferences: Mutex<Preferences>,
}
fn now() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs()
}
fn newer(a: &str, b: &str) -> bool {
    match (semver::Version::parse(a), semver::Version::parse(b)) {
        (Ok(a), Ok(b)) => a > b && a.pre.is_empty(),
        _ => false,
    }
}
fn busy(stage: &str) -> bool {
    matches!(stage, "checking" | "downloading" | "installing")
}
fn fail_update(app: &tauri::AppHandle, message: &str) {
    let updates = app.state::<Updates>();
    let mut status = updates.status.lock().unwrap();
    status.stage = "error".into();
    status.error = message.into();
}
pub fn setup(app: &tauri::AppHandle) {
    let native = app.state::<Arc<Native>>();
    let preferences = fs::read(native.directory.join("updates.json"))
        .ok()
        .and_then(|raw| serde_json::from_slice(&raw).ok())
        .unwrap_or_default();
    app.manage(Updates {
        status: Mutex::new(UpdateStatus {
            current_version: app.package_info().version.to_string(),
            available_version: String::new(),
            stage: "idle".into(),
            downloaded: 0,
            can_install: false,
            total: None,
            checked_at: 0,
            snoozed_until: 0,
            notes: vec![],
            error: String::new(),
            release_url: RELEASE_URL.into(),
        }),
        update: Mutex::new(None),
        bytes: Mutex::new(None),
        preferences: Mutex::new(preferences),
    });
    let handle = app.clone();
    thread::spawn(move || {
        thread::sleep(Duration::from_secs(15));
        loop {
            let _ = action(&handle, "check");
            thread::sleep(Duration::from_secs(24 * 60 * 60));
        }
    });
}
pub fn status(app: &tauri::AppHandle) -> String {
    let updates = app.state::<Updates>();
    let mut status = updates.status.lock().unwrap();
    if status.snoozed_until <= now() {
        status.snoozed_until = 0;
    }
    serde_json::to_string(&*status).unwrap()
}
pub fn action(app: &tauri::AppHandle, action: &str) -> Result<(), (u16, &'static str)> {
    let updates = app.state::<Updates>();
    if action == "snooze" {
        let mut status = updates.status.lock().unwrap();
        if status.available_version.is_empty() || busy(&status.stage) {
            return Err((409, "Нет доступного обновления"));
        }
        let preferences = Preferences {
            version: status.available_version.clone(),
            until: now() + 7 * 24 * 60 * 60,
        };
        let directory = &app.state::<Arc<Native>>().directory;
        let temporary = directory.join("updates.json.tmp");
        let saved = (|| -> std::io::Result<()> {
            let mut file = fs::File::create(&temporary)?;
            file.write_all(&serde_json::to_vec(&preferences)?)?;
            file.sync_all()?;
            // On Windows rename cannot replace an existing destination.
            #[cfg(windows)]
            if directory.join("updates.json").exists() {
                fs::remove_file(directory.join("updates.json"))?;
            }
            fs::rename(&temporary, directory.join("updates.json"))
        })();
        if saved.is_err() {
            return Err((503, "Не удалось сохранить напоминание"));
        }
        status.snoozed_until = preferences.until;
        *updates.preferences.lock().unwrap() = preferences;
        return Ok(());
    }
    {
        let mut status = updates.status.lock().unwrap();
        if busy(&status.stage) {
            return Err((409, "Операция обновления уже выполняется"));
        }
        match action {
            "check" => {
                if updates.bytes.lock().unwrap().is_some() {
                    return Ok(());
                }
                status.stage = "checking".into();
            }
            "download" => {
                if updates.update.lock().unwrap().is_none()
                    || updates.bytes.lock().unwrap().is_some()
                {
                    return Err((409, "Сначала проверьте обновления"));
                }
                status.stage = "downloading".into();
                status.downloaded = 0;
                status.total = None;
            }
            "install" => {
                if updates.bytes.lock().unwrap().is_none() {
                    return Err((409, "Сначала скачайте обновление"));
                }
                status.stage = "installing".into();
            }
            _ => return Err((404, "Неизвестная операция")),
        }
        status.error.clear();
    }
    let handle = app.clone();
    let command = action.to_owned();
    thread::spawn(move || {
        let native = handle.state::<Arc<Native>>();
        let _operation = native.operation.lock().unwrap();
        let result = match command.as_str() {
            "check" => check(&handle),
            "download" => download(&handle),
            "install" => {
                // Allow the bridge and Go API to acknowledge before stopping the service.
                thread::sleep(Duration::from_millis(500));
                install(&handle)
            }
            _ => unreachable!(),
        };
        if let Err(message) = result {
            fail_update(&handle, &message);
        }
    });
    Ok(())
}
fn check(app: &tauri::AppHandle) -> Result<(), String> {
    let updates = app.state::<Updates>();
    let updater = app
        .updater_builder()
        .timeout(Duration::from_secs(30))
        .build()
        .map_err(|e| e.to_string())?;
    let found = tauri::async_runtime::block_on(updater.check()).map_err(|_| {
        "Не удалось проверить обновления. Проверьте подключение и попробуйте снова.".to_string()
    })?;
    let mut status = updates.status.lock().unwrap();
    status.checked_at = now();
    if let Some(mut update) = found.filter(|u| newer(&u.version, &status.current_version)) {
        // GitHub manifest links are restricted to immutable assets of this repository.
        let expected = format!(
            "/OstKost/avari-job-applications/releases/download/v{}/",
            update.version
        );
        if update.download_url.scheme() != "https"
            || update.download_url.host_str() != Some("github.com")
            || !update.download_url.path().starts_with(&expected)
        {
            return Err("Некорректный адрес пакета обновления".into());
        }
        let notes: Vec<ReleaseNote> = serde_json::from_value(
            update
                .raw_json
                .get("releases")
                .cloned()
                .ok_or("В обновлении отсутствует описание изменений")?,
        )
        .map_err(|_| "Некорректное описание изменений")?;
        status.notes = notes
            .into_iter()
            .filter(|n| {
                newer(&n.version, &status.current_version) && !newer(&n.version, &update.version)
            })
            .collect();
        if !status.notes.iter().any(|n| n.version == update.version) {
            return Err("Нет описания предлагаемой версии".into());
        }
        status.available_version = update.version.clone();
        let preferences = updates.preferences.lock().unwrap();
        status.snoozed_until = preferences.reminder_for(&update.version, now());
        status.stage = "available".into();
        update.timeout = Some(Duration::from_secs(15 * 60));
        *updates.update.lock().unwrap() = Some(update);
    } else {
        status.available_version.clear();
        status.notes.clear();
        status.snoozed_until = 0;
        status.stage = "idle".into();
        *updates.update.lock().unwrap() = None;
    }
    Ok(())
}
fn download(app: &tauri::AppHandle) -> Result<(), String> {
    let updates = app.state::<Updates>();
    let update = updates
        .update
        .lock()
        .unwrap()
        .clone()
        .ok_or("Сначала проверьте обновления")?;
    let bytes = tauri::async_runtime::block_on(update.download(
        |chunk, total| {
            let mut status = updates.status.lock().unwrap();
            status.downloaded += chunk as u64;
            status.total = total;
        },
        || {},
    ))
    .map_err(|_| {
        "Не удалось скачать или проверить подпись обновления. Текущая версия продолжает работать."
            .to_string()
    })?;
    *updates.bytes.lock().unwrap() = Some(bytes);
    let mut status = updates.status.lock().unwrap();
    status.stage = "ready".into();
    status.can_install = true;
    Ok(())
}
fn install(app: &tauri::AppHandle) -> Result<(), String> {
    let updates = app.state::<Updates>();
    let update = updates
        .update
        .lock()
        .unwrap()
        .clone()
        .ok_or("Пакет обновления недоступен")?;
    let bytes = updates
        .bytes
        .lock()
        .unwrap()
        .take()
        .ok_or("Пакет обновления недоступен")?;
    let native = app.state::<Arc<Native>>();
    stop_server(&native);
    if update.install(&bytes).is_err() {
        *updates.bytes.lock().unwrap() = Some(bytes);
        // macOS may already have replaced bundle files: require an explicit recovery action.
        #[cfg(windows)]
        {
            let recovery = app.clone();
            thread::spawn(move || restart(recovery, false));
        }
        set_status(app, false, "Не удалось установить обновление. Повторите запуск или переустановите приложение с официального GitHub Release. Данные находятся в прежнем каталоге.".into());
        show_launcher(app);
        return Err(format!("Не удалось установить обновление. Откройте диагностику или установите приложение вручную: {RELEASE_URL}"));
    }
    app.restart();
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn stable_semver_only_and_no_downgrades() {
        assert!(newer("1.10.0", "1.9.9"));
        assert!(!newer("1.3.0", "1.3.0"));
        assert!(!newer("1.2.9", "1.3.0"));
        assert!(!newer("2.0.0-beta.1", "1.3.0"));
        assert!(!newer("invalid", "1.3.0"));
    }
    #[test]
    fn persisted_reminder_expires_and_does_not_hide_next_version() {
        let preferences = Preferences {
            version: "1.4.0".into(),
            until: 604800,
        };
        let restored: Preferences =
            serde_json::from_slice(&serde_json::to_vec(&preferences).unwrap()).unwrap();
        assert_eq!(restored.reminder_for("1.4.0", 100), 604800);
        assert_eq!(restored.reminder_for("1.4.0", 604800), 0);
        assert_eq!(restored.reminder_for("1.5.0", 100), 0);
    }
    fn signing_key() -> minisign_verify::PublicKey {
        use base64::Engine;
        let config: serde_json::Value =
            serde_json::from_str(include_str!("../tauri.conf.json")).unwrap();
        let raw = base64::engine::general_purpose::STANDARD
            .decode(config["plugins"]["updater"]["pubkey"].as_str().unwrap())
            .unwrap();
        minisign_verify::PublicKey::decode(std::str::from_utf8(&raw).unwrap()).unwrap()
    }
    fn decode_signature(raw: &str) -> minisign_verify::Signature {
        use base64::Engine;
        let raw = base64::engine::general_purpose::STANDARD
            .decode(raw.trim())
            .unwrap();
        minisign_verify::Signature::decode(std::str::from_utf8(&raw).unwrap()).unwrap()
    }
    #[test]
    fn signed_payload_rejects_tampering() {
        let key = signing_key();
        let payload = include_bytes!("../tests/fixtures/update-payload.txt");
        let signature = decode_signature(include_str!("../tests/fixtures/update-payload.txt.sig"));
        key.verify(payload, &signature, false).unwrap();
        assert!(key.verify(b"tampered payload", &signature, false).is_err());
    }
    #[test]
    fn packaged_update_signatures_match_embedded_key() {
        let Some(directory) = std::env::var_os("AVARI_UPDATER_ARTIFACT_DIR") else {
            return;
        };
        let key = signing_key();
        let mut count = 0;
        for entry in fs::read_dir(directory).unwrap() {
            let path = entry.unwrap().path();
            if path.extension().and_then(|v| v.to_str()) != Some("sig") {
                continue;
            }
            let signature = decode_signature(&fs::read_to_string(&path).unwrap());
            let payload = fs::read(path.with_extension("")).unwrap();
            key.verify(&payload, &signature, false)
                .expect("Update signing key does not match embedded public key");
            count += 1;
        }
        assert!(count > 0, "No signed updater packages found");
    }
}
