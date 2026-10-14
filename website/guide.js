const platforms = {
  windows: {
    title: "Avari.Jobs для Windows",
    detail: "Установщик .exe · Windows 10/11 x64",
    file: "avari-jobs-windows-x64-setup.exe",
    tip: "Откройте установщик .exe, завершите установку и запустите Avari.Jobs из меню «Пуск». Go, Node.js и Docker устанавливать не нужно.",
  },
  apple: {
    title: "Avari.Jobs для Mac с Apple Silicon",
    detail: "Образ .dmg · M1 и новее · macOS 13+",
    file: "avari-jobs-macos-apple-silicon.dmg",
    tip: "Откройте образ .dmg, перенесите Avari.Jobs в «Программы» и запустите оттуда. Учитывайте ограничения Gatekeeper для текущей неподписанной сборки.",
  },
  intel: {
    title: "Avari.Jobs для Mac с Intel",
    detail: "Образ .dmg · Intel · macOS 13+",
    file: "avari-jobs-macos-intel.dmg",
    tip: "Откройте образ .dmg, перенесите Avari.Jobs в «Программы» и запустите оттуда. Учитывайте ограничения Gatekeeper для текущей неподписанной сборки.",
  },
};
const releases =
  "https://github.com/OstKost/avari-job-applications/releases/latest/download/";
let selected = "windows";
let step = 0;
let releaseAssets;
function selectPlatform(value) {
  selected = value;
  for (const button of document.querySelectorAll("[data-platform]")) {
    button.classList.toggle("selected", button.dataset.platform === value);
    button.setAttribute(
      "aria-pressed",
      String(button.dataset.platform === value),
    );
  }
  const platform = platforms[value];
  document.getElementById("download-title").textContent = platform.title;
  document.getElementById("download-detail").textContent = platform.detail;
  const link = document.getElementById("download");
  const missing = releaseAssets && !releaseAssets.has(platform.file);
  link.href = missing
    ? "https://github.com/OstKost/avari-job-applications/releases/latest"
    : releaseAssets?.get(platform.file) || releases + platform.file;
  link.textContent = missing
    ? "Открыть доступные релизы ↗"
    : "Скачать приложение ↓";
  document.querySelector("#installation-tip p").textContent = platform.tip;
}
function selectStep(index) {
  step = Math.max(0, Math.min(3, index));
  for (const button of document.querySelectorAll("[data-step]")) {
    const active = Number(button.dataset.step) === step;
    button.classList.toggle("active", active);
    if (active) button.setAttribute("aria-current", "step");
    else button.removeAttribute("aria-current");
  }
  for (const panel of document.querySelectorAll("[data-panel]"))
    panel.hidden = Number(panel.dataset.panel) !== step;
  document.getElementById("back").disabled = step === 0;
  document.getElementById("next").disabled = step === 3;
  document.getElementById("next").textContent =
    step === 3 ? "Всё готово ✓" : "Далее →";
  document.getElementById("progress").textContent = `Шаг ${step + 1} из 4`;
}
for (const button of document.querySelectorAll("[data-step]"))
  button.onclick = () => selectStep(Number(button.dataset.step));
for (const button of document.querySelectorAll("[data-platform]"))
  button.onclick = () => selectPlatform(button.dataset.platform);
document.getElementById("next").onclick = () => selectStep(step + 1);
document.getElementById("back").onclick = () => selectStep(step - 1);
for (const button of document.querySelectorAll("[data-extension]"))
  button.onclick = () => {
    const store = button.dataset.extension === "store";
    for (const tab of document.querySelectorAll("[data-extension]"))
      tab.setAttribute("aria-selected", String(tab === button));
    document.getElementById("store-instructions").hidden = !store;
    document.getElementById("manual-instructions").hidden = store;
  };
for (const button of document.querySelectorAll("[data-copy]"))
  button.onclick = async () => {
    try {
      await navigator.clipboard.writeText(button.dataset.copy);
      button.textContent = "Скопировано ✓";
      document.getElementById("copy-status").textContent =
        "Адрес сервера скопирован";
    } catch {
      document.getElementById("copy-status").textContent =
        "Выделите и скопируйте адрес вручную";
      button.textContent = "Скопируйте вручную";
    }
  };
// Downloads still work when the GitHub API is unavailable or rate-limited.
fetch(
  "https://api.github.com/repos/OstKost/avari-job-applications/releases/latest",
)
  .then((response) => {
    if (!response.ok) throw new Error("Release unavailable");
    return response.json();
  })
  .then((release) => {
    releaseAssets = new Map(
      release.assets.map((asset) => [asset.name, asset.browser_download_url]),
    );
    document.getElementById("release-version").textContent = release.tag_name;
    selectPlatform(selected);
  })
  .catch(() => {});
