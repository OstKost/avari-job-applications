# Avari.Jobs PWA Offline Integration Cookbook

> Исторические примеры интеграции PWA и черновиков. Интеграция уже выполнена: не копируйте эти фрагменты поверх текущего приложения. Актуальное поведение описано в [руководстве пользователя](../../../../docs/Usage.md#pwa-автономный-режим-и-web-push), реализация находится в `apps/web/src/App.tsx` и модулях этой папки. Примеры ниже поясняют исходный замысел и могут отличаться от текущих сигнатур.

Все компоненты, менеджеры, адаптеры и хуки экспортируются из:
```ts
import {
  offlineManager,
  useIsOnline,
  useOfflineSettings,
  useOfflineHydration,
  OfflineNotice,
  OfflineSettingsPanel,
  OfflineApplicationForm,
  OfflineTaskForm,
  OfflineNoteForm,
  flushAllDrafts,
  hasDirtyDrafts,
} from "./offline";
```

---

## 1. Авторизация и холодный старт офлайн (`App.tsx` / `AuthenticatedApp`)

Когда сеть недоступна (`navigator.onLine === false`) или запрос `/me` завершается ошибкой сети (fetch error), при наличии активного Opt-in согласия восстанавливается сессия последнего пользователя:

```tsx
// Внутри AuthenticatedApp:
const me = useQuery({
  queryKey: ["me"],
  queryFn: async () => {
    try {
      const u = await api<User>("/me");
      return u;
    } catch (err) {
      // При сетевой ошибке проверяем наличие кэшированного аккаунта (opt-in)
      const offlineAccount = await offlineManager.restoreLastOptedInAccount();
      if (offlineAccount?.user) {
        return offlineAccount.user as User;
      }
      throw err;
    }
  },
  retry: false,
});
```

---

## 2. Кэширование журнала и карточек (только при Opt-in)

При успешной загрузке данных в `Workspace` или карточки отклика сохраняем снимки через `OfflineManager`.
Методы автоматически проверяют совпадение `userKey` с аккаунтом, давшим согласие, и отбрасывают устаревшие параллельные записи:

```tsx
// В Workspace после успешного запроса queryFn:
const query = useQuery({
  queryKey: ["data"],
  queryFn: async () => {
    const [applications, tasks, fields, proposals] = await Promise.all([
      api<Application[]>("/applications"),
      api<Task[]>("/tasks"),
      api<Field[]>("/fields"),
      api<Proposal[]>("/proposals"),
    ]);
    const result = { applications, tasks, fields, proposals };
    // Асинхронно сохраняем снимок для чтения офлайн
    void offlineManager.recordSuccessfulFetch(user.id, user, result);
    return result;
  },
});

// На странице деталей отклика (/applications/:id):
const q = useQuery({
  queryKey: ["detail", id],
  queryFn: async () => {
    try {
      const detail = await api<Detail>("/applications/" + id);
      void offlineManager.recordDetailFetch(user.id, id, detail);
      return detail;
    } catch (err) {
      // Если офлайн, достаем сохраненную копию детали
      const cached = await offlineManager.getCachedDetail(user.id, id);
      if (cached?.detail) {
        return cached.detail as Detail;
      }
      throw err;
    }
  },
});
```

---

## 3. Гидратация кэша React Query (`useOfflineHydration`)

При монтировании `Workspace` хук восстанавливает кэш React Query из IndexedDB, если сеть отсутствует:

```tsx
function Workspace({ user }: { user: User }) {
  const client = useQueryClient();
  const { hydrated, lastUpdated } = useOfflineHydration(client, user.id);

  // В шапке рабочей области отображаем баннер офлайн-режима:
  return (
    <div className="workspace">
      <OfflineNotice lastUpdated={lastUpdated} onRefresh={refresh} />
      {/* ... остальной UI ... */}
    </div>
  );
}
```

---

## 4. Завершение сессии и очистка (Logout / 401 / 403)

При выходе пользователя или аннулировании сессии вызывается `offlineManager.handleLogout`:

```tsx
const logout = async () => {
  try {
    await api("/auth/logout", "POST", {});
  } catch {}
  // Полная очистка: удаляет черновики, кэш чтения, сбрасывает Opt-in и указатель пользователя
  await offlineManager.handleLogout(user.id);
  clearSession(client);
};

// При перехвате 401 / 403 в api transport или событии avari-session-expired:
window.addEventListener("avari-session-expired", () => {
  void offlineManager.handleLogout();
  clearSession(client);
});
```

---

## 5. Защита черновиков перед PWA / Service Worker обновлением

Перед перезагрузкой вкладки при применении Service Worker обновления:

```tsx
import { flushAllDrafts, hasDirtyDrafts } from "./offline";

async function applyPwaUpdate(registration: ServiceWorkerRegistration) {
  if (hasDirtyDrafts()) {
    // Гарантированно сохраняем все активные черновики в IndexedDB
    await flushAllDrafts();
  }
  registration.waiting?.postMessage({ type: "SKIP_WAITING" });
}
```

---

## 6. Настройки Opt-in (`SettingsPage`)

В секцию настроек аккаунта добавляется панель управления автономным режимом:

```tsx
import { OfflineSettingsPanel } from "./offline";

// В компоненте Settings:
<OfflineSettingsPanel userKey={user.id} />
```

---

## 7. Модальные формы создания/редактирования

Вместо `ApplicationForm`, `TaskForm`, `NoteForm` в `Workspace` используются адаптеры с поддержкой автосохранения и восстановления черновиков:

```tsx
{form.kind === "application" ? (
  <OfflineApplicationForm
    userKey={user.id}
    initial={form.value as Application}
    fields={data.fields}
    api={api}
    onCancel={() => setForm(undefined)}
    onSaved={saved}
  />
) : form.kind === "task" ? (
  <OfflineTaskForm
    userKey={user.id}
    initial={form.value as Partial<Task>}
    applications={data.applications}
    api={api}
    onCancel={() => setForm(undefined)}
    onSaved={saved}
  />
) : (
  <OfflineNoteForm
    userKey={user.id}
    applicationId={typeof form.value === "string" ? form.value : (form.value as Note).applicationId}
    initial={typeof form.value === "string" ? undefined : (form.value as Note)}
    api={api}
    onCancel={() => setForm(undefined)}
    onSaved={saved}
  />
)}
```
