const invoke = window.__TAURI__.core.invoke;
const element = (id) => document.getElementById(id);
async function update() {
  try {
    const status = await invoke("launcher_status");
    element("status").textContent = status.ready ? "Сервис работает" : "Сервис ещё не готов";
    element("error").textContent = status.error;
    element("origin").textContent = status.origin;
    element("directory").textContent = status.data_directory;
    element("open").disabled = !status.ready;
    if (document.activeElement !== element("port")) element("port").value = status.port;
  } catch (error) { element("error").textContent = String(error); }
}
async function command(name, args) { try { await invoke(name, args); await update(); } catch (error) { element("error").textContent = String(error); } }
element("open").onclick = () => command("launcher_open");
element("retry").onclick = () => command("launcher_retry");
element("quit").onclick = () => command("launcher_quit");
element("data").onclick = () => command("launcher_data");
element("port-form").onsubmit = (event) => { event.preventDefault(); command("launcher_port", { port: Number(element("port").value) }); };
update(); setInterval(update, 2000);
