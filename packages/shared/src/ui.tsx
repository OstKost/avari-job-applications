import { VacancyAutofill } from "./VacancyAutofill";
import {
  useEffect,
  useId,
  useRef,
  useState,
  useSyncExternalStore,
  cloneElement,
  isValidElement,
  type ReactElement,
  type ReactNode,
  type FormEvent,
  type KeyboardEvent,
} from "react";
import { createPortal } from "react-dom";

import {
  Moon,
  Sun,
  X,
  LoaderCircle,
  AlertCircle,
  Check,
  ArrowRight,
  ArrowLeft,
  CalendarDays,
  ChevronDown,
} from "lucide-react";
import {
  type Application,
  type Field,
  type Task,
  type Proposal,
  type Transport,
  type Note,
  APIError,
  stages,
  states,
  outcomes,
  fieldLabels,
  displayValue,
  dateToday,
  nextWeekday,
  dateLabel,
  sortTasks,
  companyColorIndex,
  groupColorIndex,
  tagColorIndex,
  tagLabel,
  companyInitials,
  gravatarUrl,
} from "./index";
const themeSnapshot = () =>
  localStorage.getItem("avari-theme") === "light" ? "light" : "dark";
const subscribeTheme = (listener: () => void) => {
  window.addEventListener("avari-theme-change", listener);
  window.addEventListener("storage", listener);
  return () => {
    window.removeEventListener("avari-theme-change", listener);
    window.removeEventListener("storage", listener);
  };
};
export function useTheme() {
  const theme = useSyncExternalStore(subscribeTheme, themeSnapshot);
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);
  return {
    theme,
    toggle: () => {
      const next = theme === "dark" ? "light" : "dark";
      localStorage.setItem("avari-theme", next);
      document.documentElement.dataset.theme = next;
      window.dispatchEvent(new Event("avari-theme-change"));
    },
  };
}

export function handleFormSubmitShortcut(e: KeyboardEvent<HTMLFormElement>) {
  if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
    if (e.isDefaultPrevented()) return;
    e.preventDefault();
    if (typeof e.currentTarget.requestSubmit === "function") {
      e.currentTarget.requestSubmit();
    } else {
      e.currentTarget.dispatchEvent(
        new Event("submit", { bubbles: true, cancelable: true }),
      );
    }
  }
}

export function SubmitShortcutHint() {
  const isMac =
    typeof navigator !== "undefined" &&
    /Mac|iPod|iPhone|iPad/.test(navigator.platform || navigator.userAgent);
  return (
    <span
      className="submit-shortcut-hint"
      aria-hidden="true"
      title={isMac ? "Cmd + Enter" : "Ctrl + Enter"}
    >
      <kbd>{isMac ? "⌘" : "Ctrl"}</kbd>
      <span className="shortcut-plus">+</span>
      <kbd>↵</kbd>
    </span>
  );
}
export function ThemeButton() {
  const { theme, toggle } = useTheme();
  return (
    <button
      className="icon-button"
      onClick={toggle}
      title={theme === "dark" ? "Светлая тема" : "Тёмная тема"}
      aria-label={
        theme === "dark" ? "Включить светлую тему" : "Включить тёмную тему"
      }
    >
      {theme === "dark" ? <Sun size={20} /> : <Moon size={20} />}
    </button>
  );
}
export function Loading() {
  return (
    <div className="empty">
      <LoaderCircle className="spin" size={28} />
      <p>Загружаем данные…</p>
    </div>
  );
}
export function ErrorBox({
  error,
  retry,
}: {
  error: unknown;
  retry?: () => void;
}) {
  if (!error) return null;
  return (
    <div className="error" role="alert">
      <AlertCircle size={18} />
      <span>{error instanceof Error ? error.message : String(error)}</span>
      {retry && (
        <button className="text-button" onClick={retry}>
          Повторить
        </button>
      )}
    </div>
  );
}
export function Empty({
  title,
  children,
  action,
}: {
  title: string;
  children?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="empty">
      <div className="empty-icon">
        <CalendarDays size={28} />
      </div>
      <h3>{title}</h3>
      {children && <p>{children}</p>}
      {action}
    </div>
  );
}
export function Badge({
  value,
  kind = "stage",
}: {
  value: string;
  kind?: string;
}) {
  if (kind === "group") {
    if (!value) {
      return <span className="badge badge-group-none">Без группы</span>;
    }
    return (
      <span className={`badge badge-group tag-color-${groupColorIndex(value)}`}>
        {value}
      </span>
    );
  }
  return (
    <span className={`badge badge-${kind} badge-${value}`}>
      {displayValue(kind, value)}
    </span>
  );
}

export function OutcomeModal({
  isOpen,
  application,
  onClose,
  onConfirm,
}: {
  isOpen: boolean;
  application?: Application | null;
  onClose: () => void;
  onConfirm: (outcome: string) => Promise<void> | void;
}) {
  const [outcome, setOutcome] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<unknown>();

  useEffect(() => {
    if (isOpen) {
      setOutcome("");
      setPending(false);
      setError(undefined);
    }
  }, [isOpen, application?.id]);

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!outcome || pending) return;
    setPending(true);
    setError(undefined);
    try {
      await onConfirm(outcome);
      onClose();
    } catch (err) {
      setError(err);
    } finally {
      setPending(false);
    }
  };

  return (
    <Modal
      title={
        application
          ? `Результат закрытия: ${application.company}`
          : "Результат закрытия вакансии"
      }
      onClose={() => {
        if (!pending) onClose();
      }}
    >
      <form
        className="form"
        onSubmit={handleSubmit}
      >
        <p className="muted">
          При переходе в статус «Закрыт» необходимо указать результат закрытия.
        </p>
        <ErrorBox error={error} />
        <FieldInput label="Результат">
          <Select
            value={outcome}
            disabled={pending}
            onChange={setOutcome}
            items={outcomes}
            empty="Выберите результат"
          />
        </FieldInput>
        <div className="actions">
          <button type="submit" className="primary" disabled={pending || !outcome}>
            {pending ? "Закрытие…" : "Закрыть вакансию"}
          </button>
          <button type="button" disabled={pending} onClick={onClose}>
            Отмена
          </button>
        </div>
      </form>
    </Modal>
  );
}

export function StaleActionModal({
  isOpen,
  application,
  timezone,
  onClose,
  onPause,
  onCloseOutcome,
  onCreateTask,
}: {
  isOpen: boolean;
  application: Application | null;
  timezone?: string;
  onClose: () => void;
  onPause: () => Promise<void> | void;
  onCloseOutcome: (outcome: string) => Promise<void> | void;
  onCreateTask: (task: { title: string; date: string; time: string }) => Promise<void> | void;
}) {
  const [tab, setTab] = useState<"task" | "close">("task");
  const [taskTitle, setTaskTitle] = useState("Связаться по вакансии");
  const [taskDate, setTaskDate] = useState(() => nextWeekday(timezone));
  const [taskTime, setTaskTime] = useState("");
  const [outcome, setOutcome] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<unknown>();

  useEffect(() => {
    if (isOpen) {
      setTab("task");
      setTaskTitle("Связаться по вакансии");
      setTaskDate(nextWeekday(timezone));
      setTaskTime("");
      setOutcome("");
      setPending(false);
      setError(undefined);
    }
  }, [isOpen, timezone]);

  if (!isOpen || !application) return null;

  const handlePause = async () => {
    if (pending) return;
    setPending(true);
    setError(undefined);
    try {
      await onPause();
      onClose();
    } catch (e) {
      setError(e);
    } finally {
      setPending(false);
    }
  };

  const handleCreateTask = async () => {
    if (pending || !taskTitle.trim() || !taskDate) return;
    setPending(true);
    setError(undefined);
    try {
      await onCreateTask({
        title: taskTitle.trim(),
        date: taskDate,
        time: taskTime,
      });
      onClose();
    } catch (e) {
      setError(e);
    } finally {
      setPending(false);
    }
  };

  const handleCloseOutcome = async () => {
    if (pending || !outcome) return;
    setPending(true);
    setError(undefined);
    try {
      await onCloseOutcome(outcome);
      onClose();
    } catch (e) {
      setError(e);
    } finally {
      setPending(false);
    }
  };

  return (
    <Modal
      title={`Действие по вакансии: ${application.company}`}
      onClose={() => {
        if (!pending) onClose();
      }}
    >
      <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
        <p className="muted" style={{ margin: 0 }}>
          По этой вакансии нет активности более 10 дней (240 часов). Выберите следующее действие:
        </p>

        <ErrorBox error={error} />

        <div style={{ display: "flex", gap: 8 }}>
          <button
            type="button"
            disabled={pending}
            className={tab === "task" ? "primary" : ""}
            onClick={() => setTab("task")}
          >
            Запланировать задачу
          </button>
          <button
            type="button"
            disabled={pending}
            onClick={handlePause}
          >
            {pending && tab !== "task" && tab !== "close" ? "Приостановка…" : "Приостановить"}
          </button>
          <button
            type="button"
            disabled={pending}
            className={tab === "close" ? "primary" : ""}
            onClick={() => setTab("close")}
          >
            Закрыть вакансию
          </button>
        </div>

        {tab === "task" && (
          <form
            className="form"
            onSubmit={(e) => {
              e.preventDefault();
              void handleCreateTask();
            }}
          >
            <FieldInput label="Название задачи">
              <input
                type="text"
                required
                disabled={pending}
                value={taskTitle}
                onChange={(e) => setTaskTitle(e.target.value)}
              />
            </FieldInput>
            <div className="form-grid">
              <FieldInput label="Дата">
                <input
                  type="date"
                  required
                  disabled={pending}
                  value={taskDate}
                  onChange={(e) => setTaskDate(e.target.value)}
                />
              </FieldInput>
              <FieldInput label="Время (необязательно)">
                <input
                  type="time"
                  disabled={pending}
                  value={taskTime}
                  onChange={(e) => setTaskTime(e.target.value)}
                />
              </FieldInput>
            </div>
            <div className="actions">
              <button
                type="submit"
                className="primary"
                disabled={pending || !taskTitle.trim() || !taskDate}
              >
                {pending ? "Создание…" : "Создать задачу"}
              </button>
              <button
                type="button"
                disabled={pending}
                onClick={onClose}
              >
                Отмена
              </button>
            </div>
          </form>
        )}

        {tab === "close" && (
          <form
            className="form"
            onSubmit={(e) => {
              e.preventDefault();
              void handleCloseOutcome();
            }}
          >
            <FieldInput label="Результат закрытия">
              <Select
                value={outcome}
                disabled={pending}
                onChange={setOutcome}
                items={outcomes}
                empty="Выберите результат"
              />
            </FieldInput>
            <div className="actions">
              <button
                type="submit"
                className="primary"
                disabled={pending || !outcome}
              >
                {pending ? "Сохранение…" : "Подтвердить закрытие"}
              </button>
              <button
                type="button"
                disabled={pending}
                onClick={onClose}
              >
                Отмена
              </button>
            </div>
          </form>
        )}
      </div>
    </Modal>
  );
}


export function BadgeDropdown({
  value,
  kind = "stage",
  items: customItems,
  onChange,
  disabled = false,
  "aria-label": ariaLabel,
}: {
  value: string;
  kind?: "stage" | "state" | "group";
  items?: Record<string, string>;
  onChange: (nextValue: string) => void;
  disabled?: boolean;
  "aria-label"?: string;
}) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const menuId = useId();
  const items = customItems ?? (kind === "state" ? states : stages);
  const options = Object.entries(items);

  const [coords, setCoords] = useState<{
    top: number;
    left: number;
    maxHeight: number;
  } | null>(null);

  const updateCoords = () => {
    if (!triggerRef.current) return;
    const rect = triggerRef.current.getBoundingClientRect();
    const viewportHeight = window.innerHeight;
    const viewportWidth = window.innerWidth;

    // Measure actual menu dimensions if mounted, else estimate defaults
    const menuEl = menuRef.current;
    const menuHeight = menuEl
      ? menuEl.offsetHeight
      : kind === "stage"
        ? 220
        : 130;
    const menuWidth = menuEl ? menuEl.offsetWidth : 120;

    const spaceBelow = viewportHeight - rect.bottom - 8;
    const spaceAbove = rect.top - 8;

    const placeAbove = spaceBelow < menuHeight && spaceAbove > spaceBelow;
    const maxHeight = Math.max(100, placeAbove ? spaceAbove : spaceBelow);

    const top = placeAbove
      ? Math.max(8, rect.top - Math.min(menuHeight, maxHeight) - 4)
      : Math.min(
          viewportHeight - Math.min(menuHeight, maxHeight) - 8,
          rect.bottom + 4,
        );

    const left = Math.max(
      8,
      Math.min(viewportWidth - menuWidth - 8, rect.left),
    );

    setCoords({ top, left, maxHeight });
  };

  const close = () => {
    setOpen(false);
    triggerRef.current?.focus();
  };

  // When open changes, measure and position, then set focus on the active or first option
  useEffect(() => {
    if (!open) return;
    updateCoords();

    // Measure again after the positioned portal has mounted.
    const frameId = requestAnimationFrame(() => {
      updateCoords();
    });

    const onPointerDown = (e: PointerEvent) => {
      const target = e.target as Node;
      if (
        triggerRef.current?.contains(target) ||
        menuRef.current?.contains(target)
      ) {
        return;
      }
      setOpen(false);
    };

    const onScrollOrResize = () => updateCoords();
    document.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("scroll", onScrollOrResize, true);
    window.addEventListener("resize", onScrollOrResize);

    return () => {
      cancelAnimationFrame(frameId);
      document.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("scroll", onScrollOrResize, true);
      window.removeEventListener("resize", onScrollOrResize);
    };
  }, [open, value]);

  // Positioning first renders without a portal. Focus only after that portal
  // actually commits, rather than racing its mount in an animation frame.
  const positioned = coords !== null;
  useEffect(() => {
    if (!open || disabled || !positioned) return;
    const buttons = menuRef.current?.querySelectorAll<HTMLButtonElement>(
      '[role="menuitemradio"]',
    );
    const selected = Array.from(buttons ?? []).find(
      (button) => button.dataset.value === value,
    );
    (selected ?? buttons?.[0])?.focus();
  }, [open, disabled, positioned, value]);

  return (
    <>
      <button
        type="button"
        ref={triggerRef}
        className="badge-dropdown-trigger"
        disabled={disabled}
        aria-label={ariaLabel ?? (kind === "state" ? "Состояние" : "Этап")}
        aria-haspopup="menu"
        aria-expanded={open && !disabled}
        aria-controls={open ? menuId : undefined}
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          if (!disabled) {
            setOpen((prev) => !prev);
          }
        }}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown" || e.key === "ArrowUp") {
            e.preventDefault();
            e.stopPropagation();
            if (!disabled) setOpen(true);
          }
        }}
      >
        {customItems ? (
          value ? (
            <span
              className={`badge badge-group tag-color-${groupColorIndex(value)}`}
            >
              {items[value] ?? value}
            </span>
          ) : (
            <span className="badge badge-group-none">
              {items[value] ?? "Без группы"}
            </span>
          )
        ) : (
          <Badge value={value} kind={kind} />
        )}
      </button>

      {open &&
        !disabled &&
        coords &&
        createPortal(
          <div
            id={menuId}
            ref={menuRef}
            role="menu"
            aria-label={ariaLabel ?? (kind === "state" ? "Состояние" : "Этап")}
            className="status-select-menu badge-dropdown-menu-portal"
            style={{
              position: "fixed",
              top: `${coords.top}px`,
              left: `${coords.left}px`,
              right: "auto",
              width: "max-content",
              minWidth: "unset",
              maxWidth: "calc(100vw - 16px)",
              maxHeight: `${coords.maxHeight}px`,
              overflowY: "auto",
              zIndex: 99999,
            }}
            onClick={(e) => e.stopPropagation()}
            onKeyDown={(event) => {
              if (event.key === "Escape") {
                event.preventDefault();
                event.stopPropagation();
                close();
                return;
              }
              if (event.key === "Tab") {
                setOpen(false);
                return;
              }
              const buttons = Array.from(
                event.currentTarget.querySelectorAll<HTMLButtonElement>(
                  '[role="menuitemradio"]',
                ),
              );
              const index = buttons.indexOf(
                document.activeElement as HTMLButtonElement,
              );
              let next: number | undefined;
              if (event.key === "ArrowDown") {
                next = index >= 0 ? (index + 1) % buttons.length : 0;
              } else if (event.key === "ArrowUp") {
                next = index >= 0 ? (index - 1 + buttons.length) % buttons.length : buttons.length - 1;
              } else if (event.key === "Home") {
                next = 0;
              } else if (event.key === "End") {
                next = buttons.length - 1;
              }
              if (next !== undefined) {
                event.preventDefault();
                buttons[next]?.focus();
              }
            }}
          >
            {options.map(([k, label]) => {
              const isSelected = value === k;
              return (
                <button
                  type="button"
                  role="menuitemradio"
                  aria-checked={isSelected}
                  data-value={k}
                  key={k}
                  className="status-select-option"
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    onChange(k);
                    close();
                  }}
                >
                  {customItems ? (
                    k ? (
                      <span
                        className={`badge badge-group tag-color-${groupColorIndex(k)}`}
                      >
                        {label}
                      </span>
                    ) : (
                      <span className="badge badge-group-none">{label}</span>
                    )
                  ) : (
                    <Badge value={k} kind={kind} />
                  )}
                  {isSelected && <Check size={16} />}
                </button>
              );
            })}
          </div>,
          document.body,
        )}
    </>
  );
}


export function Modal({
  title,
  onClose,
  children,
  className = "",
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
  className?: string;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current;
    dialog?.showModal();
    return () => dialog?.close();
  }, []);
  return (
    <dialog
      ref={ref}
      className={`modal ${className}`}
      aria-label={title}
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <header>
        <h2>{title}</h2>
        <button className="icon-button" aria-label="Закрыть" onClick={onClose}>
          <X size={22} />
        </button>
      </header>
      {children}
    </dialog>
  );
}
export function FieldInput({
  label,
  children,
  hint,
}: {
  label: string;
  children: ReactNode;
  hint?: string;
}) {
  const id = useId();
  return (
    <div className="form-field">
      <label htmlFor={id}>{label}</label>
      {isValidElement(children)
        ? cloneElement(
            children as ReactElement<{ id?: string; "aria-label"?: string }>,
            { id, "aria-label": label },
          )
        : children}
      {hint && <small>{hint}</small>}
    </div>
  );
}
export function Select({
  value,
  onChange,
  items,
  empty,
  id,
  "aria-label": ariaLabel,
  disabled = false,
}: {
  value: string;
  onChange: (value: string) => void;
  items: Record<string, string>;
  empty?: string;
  disabled?: boolean;
  id?: string;
  "aria-label"?: string;
}) {
  if (items === stages || items === states) {
    return (
      <StatusSelect
        value={value}
        onChange={onChange}
        items={items}
        empty={empty}
        id={id}
        aria-label={ariaLabel}
        disabled={disabled}
      />
    );
  }
  return (
    <select
      disabled={disabled}
      id={id}
      aria-label={ariaLabel}
      value={value}
      onChange={(e) => onChange(e.target.value)}
    >
      {empty !== undefined && <option value="">{empty}</option>}
      {Object.entries(items).map(([k, v]) => (
        <option key={k} value={k}>
          {v}
        </option>
      ))}
    </select>
  );
}
function StatusSelect({
  value,
  onChange,
  items,
  empty,
  id,
  disabled,
  "aria-label": ariaLabel,
}: {
  value: string;
  onChange: (value: string) => void;
  items: Record<string, string>;
  empty?: string;
  id?: string;
  disabled?: boolean;
  "aria-label"?: string;
}) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const menuId = useId();
  const options = [
    ...(empty !== undefined ? [["", empty]] : []),
    ...Object.entries(items),
  ];
  const close = () => {
    setOpen(false);
    trigger.current?.focus();
  };
  useEffect(() => {
    if (!open) return;
    const outside = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", outside);
    const buttons = root.current?.querySelectorAll<HTMLButtonElement>(
      '[role="menuitemradio"]',
    );
    const selected = Array.from(buttons ?? []).find(
      (button) => button.dataset.value === value,
    );
    (selected ?? buttons?.[0])?.focus();
    return () => document.removeEventListener("pointerdown", outside);
  }, [open]);
  return (
    <div
      className="status-select"
      ref={root}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node))
          setOpen(false);
      }}
    >
      <button
        type="button"
        id={id}
        ref={trigger}
        className="status-select-trigger"
        disabled={disabled}
        aria-label={ariaLabel}
        aria-haspopup="menu"
        aria-expanded={open && !disabled}
        aria-controls={open ? menuId : undefined}
        onClick={() => setOpen(!open)}
        onKeyDown={(event) => {
          if (event.key === "ArrowDown" || event.key === "ArrowUp") {
            event.preventDefault();
            setOpen(true);
          }
        }}
      >
        {value && items[value] ? (
          <Badge value={value} kind={items === states ? "state" : "stage"} />
        ) : (
          <span>{empty ?? "Выберите"}</span>
        )}
        <ChevronDown size={16} />
      </button>
      {open && !disabled && (
        <div
          id={menuId}
          role="menu"
          aria-label={ariaLabel}
          className={`status-select-menu${items === stages ? " status-workflow-menu" : ""}`}
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              event.preventDefault();
              event.stopPropagation();
              close();
            }
            const buttons = Array.from(
              event.currentTarget.querySelectorAll<HTMLButtonElement>(
                '[role="menuitemradio"]',
              ),
            );
            const index = buttons.indexOf(
              document.activeElement as HTMLButtonElement,
            );
            let next: number | undefined;
            if (event.key === "ArrowDown") next = (index + 1) % buttons.length;
            if (event.key === "ArrowUp")
              next = (index - 1 + buttons.length) % buttons.length;
            if (event.key === "Home") next = 0;
            if (event.key === "End") next = buttons.length - 1;
            if (next !== undefined) {
              event.preventDefault();
              buttons[next]?.focus();
            }
          }}
        >
          {items === stages ? (
            <div className="status-workflow-flow">
              <div className="status-workflow-header">
                <span>Пайплайн этапов</span>
                <small>Нажмите на этап для выбора</small>
              </div>
              <ol className="status-workflow-list">
                {options.map(([key, label], idx) => {
                  const isCurrent = value === key;
                  const stepNum = empty !== undefined ? idx : idx + 1;
                  return (
                    <li key={key || "empty"} className="status-workflow-item">
                      {idx > 0 && (
                        <div
                          className={`status-workflow-connector${
                            Object.keys(stages).indexOf(value) >=
                            (empty !== undefined ? idx - 1 : idx)
                              ? " is-passed"
                              : ""
                          }`}
                          aria-hidden="true"
                        >
                          <span className="status-workflow-line" />
                          <ArrowRight
                            size={14}
                            className="status-workflow-arrow"
                          />
                        </div>
                      )}
                      <button
                        type="button"
                        role="menuitemradio"
                        aria-checked={isCurrent}
                        data-value={key}
                        className={`status-workflow-node${isCurrent ? " is-active" : ""}`}
                        onClick={() => {
                          onChange(key);
                          close();
                        }}
                      >
                        <div className="status-workflow-node-start">
                          <span className="status-workflow-num">{stepNum}</span>
                          {key ? (
                            <Badge value={key} kind="stage" />
                          ) : (
                            <span className="status-workflow-label">
                              {label}
                            </span>
                          )}
                        </div>
                        {isCurrent && (
                          <span className="status-workflow-current-pill">
                            <Check size={14} /> Текущий
                          </span>
                        )}
                      </button>
                    </li>
                  );
                })}
              </ol>
            </div>
          ) : (
            options.map(([key, label]) => (
              <button
                type="button"
                role="menuitemradio"
                aria-checked={value === key}
                data-value={key}
                key={key}
                className="status-select-option"
                onClick={() => {
                  onChange(key);
                  close();
                }}
              >
                {key ? (
                  <Badge value={key} kind="state" />
                ) : (
                  <span>{label}</span>
                )}
                {value === key && <Check size={16} />}
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
}
export function ConflictComparison({
  draft,
  current,
  onReload,
  label,
  fields = [],
  applications = [],
}: {
  draft: object;
  current: object;
  onReload: () => void;
  label: string;
  fields?: Field[];
  applications?: Application[];
}) {
  const mine = draft as Record<string, unknown>,
    actual = current as Record<string, unknown>;
  const keys = Object.keys(mine).filter(
    (k) =>
      !["id", "hhId", "version", "createdAt", "updatedAt"].includes(k) &&
      JSON.stringify(mine[k]) !== JSON.stringify(actual[k]),
  );
  return (
    <div className="conflict">
      <h3>Актуальное значение → ваша форма</h3>
      <div className="comparison">
        {keys.map((key) => (
          <div key={key} className="comparison-row">
            <span>{fieldLabels[key] ?? key}</span>
            <span>{displayValue(key, actual[key], fields, applications)}</span>
            <ArrowRight size={15} />
            <strong>
              {displayValue(key, mine[key], fields, applications)}
            </strong>
          </div>
        ))}
      </div>
      <button type="button" onClick={onReload}>
        {label}
      </button>
    </div>
  );
}
// Notify synchronously on edits so extension drafts survive immediate popup closure.
function useDraftState<T>(
  initial: T | (() => T),
  onDraftChange?: (value: T) => void,
) {
  const [value, update] = useState(initial);
  const latest = useRef(value);
  const set = (next: T | ((previous: T) => T)) => {
    const result =
      typeof next === "function"
        ? (next as (previous: T) => T)(latest.current)
        : next;
    latest.current = result;
    onDraftChange?.(result);
    update(result);
  };
  return [value, set] as const;
}
export function ApplicationForm({
  autofill = false,
  clipboardText,
  groupOptions = [],
  tagOptions = [],
  initial,
  fields,
  api,
  onSaved,
  onCancel,
  onDraftChange,
  actionsAtTop = false,
  onBack,
  title,
  draftAdapter,
  onDiscardDraft,
}: {
  initial: Application;
  autofill?: boolean;
  clipboardText?: Promise<string>;
  actionsAtTop?: boolean;
  onBack?: () => void;
  title?: ReactNode;
  groupOptions?: string[];
  tagOptions?: string[];
  fields: Field[];
  api: Transport;
  onSaved: (a: Application) => void;
  onCancel: () => void;
  onDraftChange?: (value: Application) => void;
  draftAdapter?: {
    hasStoredDraft?: boolean;
    onRestore?: () => void;
    onDiscard?: () => void;
  };
  onDiscardDraft?: () => void;
}) {
  const [a, setA] = useDraftState<Application>(
    () => structuredClone(initial),
    onDraftChange,
  );
  const [error, setError] = useState<unknown>();
  const [newTag, setNewTag] = useState("");
  const [current, setCurrent] = useState<Application>();
  const [busy, setBusy] = useState(false);
  const requestKey = useRef(crypto.randomUUID());
  const set = <K extends keyof Application>(k: K, v: Application[K]) =>
    setA((p) => ({ ...p, [k]: v }));
  const salary = (k: string, v: unknown) =>
    setA((p) => ({ ...p, salary: { ...p.salary, [k]: v } }));
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(undefined);
    try {
      const body: Record<string, any> = { ...a, hhId: "" };
      if (!body.companyLogo) {
        delete body.companyLogo;
      }
      onSaved(
        await api<Application>(
          a.id ? "/applications/" + a.id : "/applications",
          a.id ? "PUT" : "POST",
          body as Application,
          requestKey.current,
        ),
      );
    } catch (e) {
      setError(e);
      if (e instanceof APIError && e.status === 409 && e.current)
        setCurrent(e.current as Application);
    } finally {
      setBusy(false);
    }
  };
  const actions = (
    <div className={`form-actions${actionsAtTop ? " form-actions-top" : ""}`}>
      {onBack && (
        <button
          type="button"
          className="text-button popup-back"
          onClick={onBack}
        >
          <ArrowLeft size={16} /> Назад
        </button>
      )}
      <div className="form-actions-buttons">
        <button type="button" onClick={onCancel}>
          Отмена
        </button>
        <button className="primary" disabled={busy || !!current}>
          {busy ? "Сохраняем…" : "Сохранить"}
          <SubmitShortcutHint />
        </button>
      </div>
    </div>
  );
  return (
    <form
      onSubmit={submit}
      onKeyDown={handleFormSubmitShortcut}
      className="form"
    >
      {draftAdapter?.hasStoredDraft && (
        <div
          className="draft-restore-banner"
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 12,
            padding: "8px 14px",
            marginBottom: 12,
            background: "var(--panel-2, #204354)",
            border: "1px solid var(--accent, #57c8ed)",
            borderRadius: 8,
          }}
        >
          <span style={{ fontSize: "0.9em" }}>Обнаружен сохранённый черновик</span>
          <div style={{ display: "flex", gap: 8 }}>
            {draftAdapter.onRestore && (
              <button
                type="button"
                className="primary"
                style={{ padding: "4px 10px", fontSize: "0.85em" }}
                onClick={draftAdapter.onRestore}
              >
                Восстановить
              </button>
            )}
            {draftAdapter.onDiscard && (
              <button
                type="button"
                className="text-button"
                style={{ padding: "4px 8px", fontSize: "0.85em" }}
                onClick={draftAdapter.onDiscard}
              >
                Удалить
              </button>
            )}
          </div>
        </div>
      )}
      {actionsAtTop && actions}
      {title && (isValidElement(title) ? title : <h2>{title}</h2>)}
      <ErrorBox error={error} />
      {autofill && !initial.id && (
        <VacancyAutofill
          value={a}
          update={setA}
          api={api}
          enabled
          clipboardText={clipboardText}
          disabled={busy}
        />
      )}
      {current && (
        <ConflictComparison
          draft={a}
          current={current}
          fields={fields}
          onReload={() => {
            setA(structuredClone(current));
            setCurrent(undefined);
            setError(undefined);
          }}
          label="Загрузить актуальную запись"
        />
      )}
      <FieldInput
        label="Группа вакансии"
        hint="Основное направление или папка для группировки"
      >
        <input
          list="application-group-options"
          aria-label="Группа вакансии"
          placeholder="Например: Удалёнка или Руководство"
          maxLength={100}
          value={a.groups?.[0] ?? ""}
          onChange={(e) => {
            const val = e.target.value;
            set("groups", val.trim() ? [val] : []);
          }}
        />
        <datalist id="application-group-options">
          {Array.from(new Set([...groupOptions, ...(a.groups ?? [])]))
            .filter(Boolean)
            .map((g) => (
              <option key={g} value={g} />
            ))}
        </datalist>
      </FieldInput>
      <FieldInput
        label="Теги"
        hint="Метки компетенций, технологий, условий работы"
      >
        {!!a.tags?.length && (
          <div className="tag-chips" style={{ marginBottom: 8 }}>
            {a.tags.map((tag) => (
              <span
                className={`tag-chip tag-color-${tagColorIndex(tag)}`}
                key={tag}
              >
                <span>{tagLabel(tag)}</span>
                <button
                  type="button"
                  className="tag-chip-remove"
                  aria-label={`Удалить тег ${tag}`}
                  onClick={() =>
                    set(
                      "tags",
                      (a.tags ?? []).filter((t) => t !== tag),
                    )
                  }
                >
                  <X size={12} />
                </button>
              </span>
            ))}
          </div>
        )}
        <div className="tag-input-row">
          <input
            list="application-tag-options"
            aria-label="Название нового тега"
            placeholder="Например: React, AI, Гибрид, Релокация"
            maxLength={100}
            value={newTag}
            onChange={(e) => setNewTag(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                const tag = newTag.trim();
                if (
                  tag &&
                  (a.tags ?? []).length < 30 &&
                  !(a.tags ?? []).some(
                    (v) => v.toLocaleLowerCase() === tag.toLocaleLowerCase(),
                  )
                ) {
                  set("tags", [...(a.tags ?? []), tag]);
                  setNewTag("");
                }
              }
            }}
          />
          <datalist id="application-tag-options">
            {Array.from(new Set([...tagOptions, ...(a.tags ?? [])]))
              .filter(
                (t) =>
                  !(a.tags ?? []).some(
                    (existing) =>
                      existing.toLocaleLowerCase() === t.toLocaleLowerCase(),
                  ),
              )
              .map((t) => (
                <option key={t} value={t} />
              ))}
          </datalist>
          <button
            type="button"
            disabled={
              !newTag.trim() ||
              (a.tags ?? []).length >= 30 ||
              (a.tags ?? []).some(
                (v) =>
                  v.toLocaleLowerCase() === newTag.trim().toLocaleLowerCase(),
              )
            }
            onClick={() => {
              const tag = newTag.trim();
              if (
                tag &&
                !(a.tags ?? []).some(
                  (v) => v.toLocaleLowerCase() === tag.toLocaleLowerCase(),
                )
              ) {
                set("tags", [...(a.tags ?? []), tag]);
              }
              setNewTag("");
            }}
          >
            Добавить тег
          </button>
        </div>
      </FieldInput>
      <div className="form-grid">
        <FieldInput label="Компания *">
          <input
            required
            maxLength={500}
            value={a.company}
            onChange={(e) => set("company", e.target.value)}
            autoFocus={!autofill || !!initial.id}
          />
        </FieldInput>
        <FieldInput label="Позиция *">
          <input
            required
            maxLength={500}
            value={a.position}
            onChange={(e) => set("position", e.target.value)}
          />
        </FieldInput>
        {(!autofill || !!initial.id) && (
          <FieldInput label="Ссылка на вакансию">
            <input
              type="url"
              maxLength={2048}
              value={a.url}
              onChange={(e) => set("url", e.target.value)}
              placeholder="https://hh.ru/vacancy/…"
            />
          </FieldInput>
        )}
        <FieldInput label="Этап">
          <Select
            value={a.stage}
            onChange={(v) => {
              setA((p) => ({
                ...p,
                stage: v,
                appliedDate:
                  v !== "saved" && !p.appliedDate ? dateToday() : p.appliedDate,
              }));
            }}
            items={stages}
          />
        </FieldInput>
        <FieldInput label="Состояние">
          <Select
            value={a.state}
            onChange={(v) => {
              setA((p) => ({
                ...p,
                state: v,
                outcome: v === "closed" ? p.outcome : "",
              }));
            }}
            items={states}
          />
        </FieldInput>
        {a.state === "closed" && (
          <FieldInput label="Результат закрытия *">
            <Select
              value={a.outcome}
              onChange={(v) => set("outcome", v)}
              items={outcomes}
              empty="Выберите результат"
            />
          </FieldInput>
        )}
        <FieldInput label="Дата сохранения">
          <input
            type="date"
            required
            value={a.savedDate}
            onChange={(e) => set("savedDate", e.target.value)}
          />
        </FieldInput>
        <FieldInput label="Дата отклика">
          <input
            type="date"
            value={a.appliedDate}
            onChange={(e) => set("appliedDate", e.target.value)}
          />
        </FieldInput>
      </div>
      <details className="panel"><summary>Текст вакансии и краткое описание</summary>
 <FieldInput label="Полный текст вакансии"><textarea rows={8} maxLength={100000} value={a.ai?.text ?? ""} onChange={e=>setA(p=>({...p,ai:{...(p.ai ?? {text:"",summary:"",skills:[],source:"manual",processedAt:"",provider:"",model:"",textHash:"",stale:false}),text:e.target.value,source:"manual",stale:!!p.ai?.processedAt}}))} /></FieldInput>
 <FieldInput label="Краткое описание (до 400 символов)"><textarea rows={3} value={a.ai?.summary ?? ""} onChange={e=>setA(p=>({...p,ai:{...(p.ai ?? {text:"",summary:"",skills:[],source:"manual",processedAt:"",provider:"",model:"",textHash:"",stale:false}),summary:e.target.value}}))} /><small>{Array.from(a.ai?.summary ?? "").length}/400</small></FieldInput>
 </details>
 <h3>Условия и контакты</h3>
      <div className="form-grid">
        <FieldInput label="Зарплата от">
          <input
            type="number"
            min={0}
            step="any"
            value={a.salary.min ?? ""}
            onChange={(e) =>
              salary(
                "min",
                e.target.value === "" ? null : Number(e.target.value),
              )
            }
          />
        </FieldInput>
        <FieldInput label="Зарплата до">
          <input
            type="number"
            min={0}
            step="any"
            value={a.salary.max ?? ""}
            onChange={(e) =>
              salary(
                "max",
                e.target.value === "" ? null : Number(e.target.value),
              )
            }
          />
        </FieldInput>
        <FieldInput label="Валюта">
          <input
            maxLength={12}
            value={a.salary.currency}
            onChange={(e) => salary("currency", e.target.value)}
          />
        </FieldInput>
        <FieldInput label="Период">
          <Select
            value={a.salary.period}
            onChange={(v) => salary("period", v)}
            items={{
              month: "В месяц",
              year: "В год",
              hour: "В час",
              project: "За проект",
            }}
            empty="Не указан"
          />
        </FieldInput>
        <FieldInput label="Налоги">
          <Select
            value={a.salary.tax}
            onChange={(v) => salary("tax", v)}
            items={{ gross: "До вычета налогов", net: "На руки" }}
            empty="Не указано"
          />
        </FieldInput>
        <FieldInput label="Локация">
          <input
            maxLength={500}
            value={a.location}
            onChange={(e) => set("location", e.target.value)}
          />
        </FieldInput>
        <FieldInput label="Формат работы">
          <input
            maxLength={500}
            value={a.workFormat}
            onChange={(e) => set("workFormat", e.target.value)}
            placeholder="Удалённо, офис, гибрид"
          />
        </FieldInput>
        <FieldInput label="Контакт рекрутера">
          <input
            maxLength={2000}
            value={a.recruiter}
            onChange={(e) => set("recruiter", e.target.value)}
          />
        </FieldInput>
        <FieldInput
          label="Логотип компании (URL)"
          hint="Ссылка на аватар/логотип компании"
        >
          <input
            type="url"
            maxLength={2048}
            value={a.companyLogo ?? ""}
            onChange={(e) => set("companyLogo", e.target.value)}
            placeholder="https://…"
          />
        </FieldInput>
      </div>
      {fields.length > 0 && (
        <>
          <h3>Мои критерии</h3>
          <div className="form-grid">
            {fields.map((f) => (
              <FieldInput key={f.id} label={f.name}>
                {f.type === "flag" ? (
                  <div className="checkbox-label">
                    <input
                      type="checkbox"
                      aria-label={f.name}
                      checked={!!a.custom[f.id]}
                      onChange={(e) =>
                        set("custom", { ...a.custom, [f.id]: e.target.checked })
                      }
                    />
                    Да
                  </div>
                ) : f.type === "select" ? (
                  <Select
                    value={String(a.custom[f.id] ?? "")}
                    onChange={(v) => set("custom", { ...a.custom, [f.id]: v })}
                    items={Object.fromEntries(f.options.map((v) => [v, v]))}
                    empty="Не выбрано"
                  />
                ) : (
                  <input
                    type={f.type === "text" ? "text" : f.type}
                    maxLength={f.type === "text" ? 5000 : undefined}
                    step={f.type === "number" ? "any" : undefined}
                    value={String(a.custom[f.id] ?? "")}
                    onChange={(e) =>
                      set("custom", {
                        ...a.custom,
                        [f.id]:
                          f.type === "number" && e.target.value !== ""
                            ? Number(e.target.value)
                            : e.target.value,
                      })
                    }
                  />
                )}
              </FieldInput>
            ))}
          </div>
        </>
      )}
      {!actionsAtTop && actions}
    </form>
  );
}
export function TaskForm({
  initial,
  applications,
  api,
  onSaved,
  onCancel,
  onDraftChange,
  draftAdapter,
  onDiscardDraft,
}: {
  initial: Partial<Task>;
  applications: Application[];
  api: Transport;
  onSaved: () => void;
  onCancel: () => void;
  onDraftChange?: (value: Partial<Task>) => void;
  draftAdapter?: {
    hasStoredDraft?: boolean;
    onRestore?: () => void;
    onDiscard?: () => void;
  };
  onDiscardDraft?: () => void;
}) {
  const [task, setTask] = useDraftState<Partial<Task>>(
    {
      title: "",
      date: dateToday(),
      time: "",
      kind: "task",
      state: "open",
      applicationId: "",
      ...initial,
    },
    onDraftChange,
  );
  const [error, setError] = useState<unknown>();
  const [current, setCurrent] = useState<Task>();
  const [busy, setBusy] = useState(false);
  const key = useRef(crypto.randomUUID());
  const set = (k: string, v: string) => setTask((p) => ({ ...p, [k]: v }));
  return (
    <form
      className="form"
      onKeyDown={handleFormSubmitShortcut}
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        try {
          await api(
            task.id ? "/tasks/" + task.id : "/tasks",
            task.id ? "PUT" : "POST",
            task,
            key.current,
          );
          onSaved();
        } catch (e) {
          setError(e);
          if (e instanceof APIError && e.status === 409 && e.current)
            setCurrent(e.current as Task);
        } finally {
          setBusy(false);
        }
      }}
    >
      {draftAdapter?.hasStoredDraft && (
        <div
          className="draft-restore-banner"
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 12,
            padding: "8px 14px",
            marginBottom: 12,
            background: "var(--panel-2, #204354)",
            border: "1px solid var(--accent, #57c8ed)",
            borderRadius: 8,
          }}
        >
          <span style={{ fontSize: "0.9em" }}>Обнаружен сохранённый черновик</span>
          <div style={{ display: "flex", gap: 8 }}>
            {draftAdapter.onRestore && (
              <button
                type="button"
                className="primary"
                style={{ padding: "4px 10px", fontSize: "0.85em" }}
                onClick={draftAdapter.onRestore}
              >
                Восстановить
              </button>
            )}
            {draftAdapter.onDiscard && (
              <button
                type="button"
                className="text-button"
                style={{ padding: "4px 8px", fontSize: "0.85em" }}
                onClick={draftAdapter.onDiscard}
              >
                Удалить
              </button>
            )}
          </div>
        </div>
      )}
      <ErrorBox error={error} />
      {current && (
        <ConflictComparison
          draft={task}
          current={current}
          applications={applications}
          label="Загрузить актуальную задачу"
          onReload={() => {
            setTask(current);
            setCurrent(undefined);
            setError(undefined);
          }}
        />
      )}
      <FieldInput label="Название *">
        <input
          required
          maxLength={500}
          autoFocus
          value={task.title}
          onChange={(e) => set("title", e.target.value)}
          placeholder="Написать рекрутеру, подготовиться к интервью…"
        />
      </FieldInput>
      <div className="form-grid">
        <FieldInput label="Тип">
          <Select
            value={task.kind!}
            onChange={(v) => set("kind", v)}
            items={{ task: "Задача", interview: "Интервью" }}
          />
        </FieldInput>
        <FieldInput label="Вакансия">
          <Select
            value={task.applicationId!}
            onChange={(v) => set("applicationId", v)}
            items={Object.fromEntries(
              applications.map((a) => [a.id, a.company + " · " + a.position]),
            )}
            empty="Без привязки"
          />
        </FieldInput>
        <FieldInput label="Дата *">
          <input
            type="date"
            required
            value={task.date}
            onChange={(e) => set("date", e.target.value)}
          />
        </FieldInput>
        <FieldInput label="Время">
          <input
            type="time"
            value={task.time}
            onChange={(e) => set("time", e.target.value)}
          />
        </FieldInput>
        {task.id && (
          <FieldInput label="Состояние">
            <Select
              value={task.state!}
              onChange={(v) => set("state", v)}
              items={{ open: "Открыта", done: "Выполнена" }}
            />
          </FieldInput>
        )}
      </div>
      <footer className="form-actions">
        <button type="button" onClick={onCancel}>
          Отмена
        </button>
        <button className="primary" disabled={busy || !!current}>
          {busy ? "Сохраняем…" : "Сохранить задачу"}
          <SubmitShortcutHint />
        </button>
      </footer>
    </form>
  );
}
export function NoteForm({
  applicationId,
  initial,
  api,
  onSaved,
  onCancel,
  draftText,
  onDraftChange,
  draftAdapter,
  onDiscardDraft,
}: {
  applicationId: string;
  initial?: Note;
  api: Transport;
  onSaved: (n: Note) => void;
  onCancel: () => void;
  draftText?: string;
  onDraftChange?: (text: string) => void;
  draftAdapter?: {
    hasStoredDraft?: boolean;
    onRestore?: () => void;
    onDiscard?: () => void;
  };
  onDiscardDraft?: () => void;
}) {
  const [base, setBase] = useState(initial);
  const [text, setText] = useDraftState(
    draftText ?? initial?.text ?? "",
    onDraftChange,
  );
  const [current, setCurrent] = useState<Note>();
  const [error, setError] = useState<unknown>();
  const [busy, setBusy] = useState(false);
  const key = useRef(crypto.randomUUID());
  return (
    <form
      className="form"
      onKeyDown={handleFormSubmitShortcut}
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        try {
          onSaved(
            await api<Note>(
              base ? "/notes/" + base.id : "/notes",
              base ? "PUT" : "POST",
              base ? { ...base, text } : { applicationId, text },
              key.current,
            ),
          );
        } catch (e) {
          setError(e);
          if (e instanceof APIError && e.status === 409 && e.current)
            setCurrent(e.current as Note);
        } finally {
          setBusy(false);
        }
      }}
    >
      {draftAdapter?.hasStoredDraft && (
        <div
          className="draft-restore-banner"
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 12,
            padding: "8px 14px",
            marginBottom: 12,
            background: "var(--panel-2, #204354)",
            border: "1px solid var(--accent, #57c8ed)",
            borderRadius: 8,
          }}
        >
          <span style={{ fontSize: "0.9em" }}>Обнаружен сохранённый черновик</span>
          <div style={{ display: "flex", gap: 8 }}>
            {draftAdapter.onRestore && (
              <button
                type="button"
                className="primary"
                style={{ padding: "4px 10px", fontSize: "0.85em" }}
                onClick={draftAdapter.onRestore}
              >
                Восстановить
              </button>
            )}
            {draftAdapter.onDiscard && (
              <button
                type="button"
                className="text-button"
                style={{ padding: "4px 8px", fontSize: "0.85em" }}
                onClick={draftAdapter.onDiscard}
              >
                Удалить
              </button>
            )}
          </div>
        </div>
      )}
      <ErrorBox error={error} />
      {current && (
        <ConflictComparison
          draft={{ text }}
          current={current}
          label="Загрузить актуальный текст"
          onReload={() => {
            setBase(current);
            setText(current.text);
            setCurrent(undefined);
            setError(undefined);
          }}
        />
      )}
      <FieldInput label="Заметка">
        <textarea
          required
          rows={7}
          maxLength={20000}
          autoFocus
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Что стоит помнить об этой вакансии?"
        />
      </FieldInput>
      <footer className="form-actions">
        <button type="button" onClick={onCancel}>
          Отмена
        </button>
        <button className="primary" disabled={busy || !!current}>
          {base ? "Сохранить заметку" : "Добавить заметку"}
          <SubmitShortcutHint />
        </button>
      </footer>
    </form>
  );
}
export function TaskCard({
  task,
  application,
  onToggle,
  onEdit,
}: {
  task: Task;
  application?: Application;
  onToggle: () => void | Promise<void>;
  onEdit?: () => void;
}) {
  const [busy, setBusy] = useState(false);
  return (
    <article
      className={"task-card " + (task.state === "done" ? "task-done" : "")}
    >
      <button
        className="task-check"
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          try {
            await onToggle();
          } finally {
            setBusy(false);
          }
        }}
        aria-label={
          task.state === "open"
            ? "Отметить выполнение: " + task.title
            : "Вернуть задачу: " + task.title
        }
      >
        {task.state === "done" && <Check size={15} />}
      </button>
      <div className="task-content">
        <div className="task-meta">
          {task.time || "Без времени"}
          {task.kind === "interview" && (
            <span className="badge badge-interview">Интервью</span>
          )}
        </div>
        <button className="task-title" onClick={onEdit} disabled={!onEdit}>
          {task.title}
        </button>
        {application && (
          <p>
            {application.company}
            <span>{application.position}</span>
          </p>
        )}
      </div>
    </article>
  );
}
export function ProposalCard({
  proposal,
  application,
  api,
  onResolved,
}: {
  proposal: Proposal;
  application?: Application;
  api: Transport;
  onResolved: (action?: string) => void;
}) {
  const [p, setP] = useState(proposal);
  const [edit, setEdit] = useState(false);
  const [patch, setPatch] = useState({ ...proposal.changes });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>();
  useEffect(() => {
    if (edit) return;
    setP(proposal);
    setPatch({ ...proposal.changes });
  }, [
    proposal.id,
    proposal.current.version,
    proposal.status,
    proposal.detectedStatus,
  ]);
  const change = (key: string, value: string) =>
    setPatch((previous) => ({
      ...previous,
      [key]: value,
      ...(key === "state" && value !== "closed" ? { outcome: "" } : {}),
    }));
  const resolve = async (action: string) => {
    setBusy(true);
    setError(undefined);
    try {
      await api("/proposals/" + p.id, "POST", {
        action,
        version: p.current.version,
        ...(edit ? { changes: patch } : {}),
      });
      onResolved(action);
    } catch (e) {
      setError(e);
      if (e instanceof APIError && e.current) {
        const v = e.current as Proposal;
        setP(v);
        if (!edit) setPatch({ ...v.changes });
      }
    } finally {
      setBusy(false);
    }
  };
  return (
    <article className="proposal-card">
      <div className="eyebrow">
        Обнаружено расширением ·{" "}
        {dateLabel(p.createdAt, {
          day: "numeric",
          month: "short",
          hour: "2-digit",
          minute: "2-digit",
        })}
      </div>
      <h3>{application?.company ?? p.current.company}</h3>
      <p className="muted">{application?.position ?? p.current.position}</p>
      {p.kind === "create" && (
        <p className="muted">
          {p.detectedStatus === "favorite"
            ? "Избранная вакансия отсутствует в журнале. Сохранить?"
            : "Отклик за последний месяц отсутствует в журнале. Добавить вакансию?"}
        </p>
      )}
      {p.kind === "create" && (
        <a href={p.current.url} target="_blank" rel="noopener noreferrer">
          Открыть вакансию на hh.ru
        </a>
      )}
      <ErrorBox error={error} />
      <div className="comparison">
        {Object.entries(edit ? patch : p.changes).map(([key, value]) => (
          <div className="comparison-row" key={key}>
            <span>{fieldLabels[key] ?? key}</span>
            <span>
              {p.kind === "create"
                ? "—"
                : displayValue(
                    key,
                    (p.current as Record<string, unknown>)[key],
                  )}
            </span>
            <ArrowRight size={15} />
            <strong>
              {edit && ["stage", "state", "outcome"].includes(key) ? (
                <Select
                  value={String(value)}
                  onChange={(v) => change(key, v)}
                  items={
                    key === "stage"
                      ? stages
                      : key === "state"
                        ? states
                        : outcomes
                  }
                  empty={key === "outcome" ? "Не выбран" : undefined}
                />
              ) : edit && key === "appliedDate" ? (
                <input
                  type="date"
                  value={String(value)}
                  onChange={(e) => change(key, e.target.value)}
                />
              ) : (
                displayValue(key, value)
              )}
            </strong>
          </div>
        ))}
      </div>
      {edit && (
        <div className="form-grid">
          <FieldInput label="Этап">
            <Select
              value={String(patch.stage ?? p.current.stage)}
              onChange={(v) => change("stage", v)}
              items={stages}
            />
          </FieldInput>
          <FieldInput label="Состояние">
            <Select
              value={String(patch.state ?? p.current.state)}
              onChange={(v) => change("state", v)}
              items={states}
            />
          </FieldInput>
          {String(patch.state ?? p.current.state) === "closed" && (
            <FieldInput label="Результат закрытия">
              <Select
                value={String(patch.outcome ?? p.current.outcome)}
                onChange={(v) => change("outcome", v)}
                items={outcomes}
                empty="Выберите результат"
              />
            </FieldInput>
          )}
          <FieldInput label="Дата отклика">
            <input
              type="date"
              value={String(patch.appliedDate ?? p.current.appliedDate)}
              onChange={(e) => change("appliedDate", e.target.value)}
            />
          </FieldInput>
        </div>
      )}
      <div className="actions">
        <button
          className="primary"
          disabled={busy}
          onClick={() => resolve("apply")}
        >
          {p.kind === "create" ? "Добавить в журнал" : "Применить"}
        </button>
        <button disabled={busy} onClick={() => setEdit((v) => !v)}>
          {edit ? "Сравнение" : "Изменить"}
        </button>
        <button
          className="text-button"
          disabled={busy}
          onClick={() => resolve("dismiss")}
        >
          Отклонить
        </button>
      </div>
    </article>
  );
}
export function TaskList({
  tasks,
  applications,
  api,
  onChanged,
  onEdit,
}: {
  tasks: Task[];
  applications: Application[];
  api: Transport;
  onChanged: (updatedTask?: Task) => void;
  onEdit: (t: Task) => void;
}) {
  const [error, setError] = useState<unknown>();
  return (
    <>
      <ErrorBox error={error} />
      {sortTasks(tasks).map((t) => (
        <TaskCard
          key={t.id}
          task={t}
          application={applications.find((a) => a.id === t.applicationId)}
          onEdit={() => onEdit(t)}
          onToggle={async () => {
            try {
              const nextState: Task["state"] =
                t.state === "open" ? "done" : "open";
              const updated = {
                ...t,
                state: nextState,
              };
              await api("/tasks/" + t.id, "PUT", updated);
              onChanged(updated);
            } catch (e) {
              setError(e);
            }
          }}
        />
      ))}
    </>
  );
}

export function CompanyAvatar({
  name,
  logoUrl,
  className,
}: {
  name: string;
  logoUrl?: string;
  className?: string;
}) {
  const [imgFailed, setImgFailed] = useState(false);

  useEffect(() => {
    setImgFailed(false);
  }, [logoUrl]);

  const colorIndex = companyColorIndex(name);
  const initials = companyInitials(name);
  const classes = ["company-avatar", className].filter(Boolean).join(" ");

  if (logoUrl && !imgFailed) {
    return (
      <span
        className={`${classes} company-avatar-has-img`}
        data-color={colorIndex}
        aria-hidden="true"
      >
        <img
          src={logoUrl}
          alt=""
          className="company-avatar-img"
          loading="lazy"
          onError={() => setImgFailed(true)}
        />
      </span>
    );
  }

  return (
    <span className={classes} data-color={colorIndex} aria-hidden="true">
      {initials}
    </span>
  );
}

export function UserAvatar({
  email,
  size = 34,
  className,
}: {
  email: string;
  size?: number;
  className?: string;
}) {
  const [gravatar, setGravatar] = useState<string>("");
  const [imgFailed, setImgFailed] = useState(false);

  useEffect(() => {
    let active = true;
    setImgFailed(false);
    gravatarUrl(email, size * 2, "404").then((url) => {
      if (active && url) {
        setGravatar(url);
      }
    });
    return () => {
      active = false;
    };
  }, [email, size]);

  const letter = (email || "?").trim()[0]?.toUpperCase() || "?";
  const classes = ["account-avatar", className].filter(Boolean).join(" ");
  const style = { width: size, height: size, minWidth: size, minHeight: size };

  if (gravatar && !imgFailed) {
    return (
      <span className={classes} style={style} aria-hidden="true">
        <img
          src={gravatar}
          alt=""
          className="account-avatar-img"
          onError={() => setImgFailed(true)}
        />
      </span>
    );
  }

  return (
    <span className={classes} style={style} aria-hidden="true">
      {letter}
    </span>
  );
}
