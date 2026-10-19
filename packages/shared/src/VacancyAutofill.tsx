import { useCallback, useEffect, useId, useRef, useState } from "react";
import type { Application, Transport } from "./index";
import { jobIdentity, jobSitesLabel } from "./job-sites";
import { mergeVacancyPreview, type VacancyPreview } from "./vacancy-preview";

export function VacancyAutofill({
  value,
  update,
  api,
  enabled,
  clipboardText,
  disabled,
}: {
  value: Application;
  update: (change: (previous: Application) => Application) => void;
  api: Transport;
  enabled: boolean;
  clipboardText?: Promise<string>;
  disabled: boolean;
}) {
  const inputId = useId();
  const [offer, setOffer] = useState<VacancyPreview>();
  const [status, setStatus] = useState("");
  const [loading, setLoading] = useState(false);
  const latest = useRef({ value, update });
  latest.current = { value, update };
  const generation = useRef(0);
  const timerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const controller = useRef<AbortController | undefined>(undefined);
  const lastApplied = useRef("");
  const cancel = useCallback(() => {
    generation.current++;
    clearTimeout(timerRef.current);
    controller.current?.abort();
  }, []);

  const load = useCallback(
    async (raw: string, fromClipboard: boolean) => {
      const identity = jobIdentity(raw);
      if (!identity) return;
      cancel();
      const request = generation.current;
      const abort = new AbortController();
      controller.current = abort;
      const baseline = structuredClone(latest.current.value);
      setLoading(true);
      setStatus("Загружаем данные…");
      setOffer(undefined);
      try {
        const preview = await api<VacancyPreview>(
          "/vacancies/preview",
          "POST",
          { url: raw },
          undefined,
          { signal: abort.signal },
        );
        if (request !== generation.current || abort.signal.aborted) return;
        if (fromClipboard) {
          setOffer(preview);
          setStatus("");
        } else {
          lastApplied.current = baseline.url !== preview.url ? preview.url : "";
          latest.current.update((current) =>
            mergeVacancyPreview(current, preview, baseline),
          );
          setStatus(
            "Данные вакансии заполнены. Проверьте их перед сохранением.",
          );
        }
      } catch (error) {
        if (request === generation.current && !abort.signal.aborted)
          setStatus(
            error instanceof Error
              ? error.message
              : "Не удалось загрузить данные. Заполните поля вручную или повторите загрузку.",
          );
      } finally {
        if (request === generation.current) setLoading(false);
      }
    },
    [api, cancel],
  );

  useEffect(() => {
    if (!enabled) return;
    cancel();
    setOffer(undefined);
    setLoading(false);
    const identity = jobIdentity(value.url.trim());
    if (value.url === lastApplied.current && lastApplied.current) {
      lastApplied.current = "";
      return cancel;
    }
    lastApplied.current = "";
    setStatus("");
    if (!identity) return cancel;
    timerRef.current = setTimeout(
      () => void load(value.url.trim(), false),
      500,
    );
    return cancel;
  }, [enabled, value.url, load, cancel]);

  useEffect(() => {
    if (!enabled || !clipboardText) return;
    const request = generation.current;
    let active = true;
    void clipboardText.then((raw) => {
      if (
        active &&
        request === generation.current &&
        !latest.current.value.url &&
        jobIdentity(raw)
      )
        void load(raw, true);
    });
    return () => {
      active = false;
      cancel();
    };
  }, [enabled, clipboardText, load, cancel]);

  return (
    <div className="form-field vacancy-autofill">
      <label htmlFor={inputId}>Ссылка на вакансию</label>
      <input
        autoFocus
        id={inputId}
        type="url"
        maxLength={2048}
        value={value.url}
        disabled={disabled}
        onChange={(event) => {
          cancel();
          setOffer(undefined);
          setLoading(false);
          setStatus("");
          const url = event.target.value;
          latest.current.update((previous) => ({ ...previous, url }));
        }}
        placeholder="https://hh.ru/vacancy/…"
      />
      {enabled && (
        <>
          <small>Автозаполнение: {jobSitesLabel}.</small>
          {offer && (
            <div className="vacancy-autofill-offer">
              <strong>Заполнить из буфера обмена?</strong>
              <p>
                {[offer.fields.position, offer.fields.company]
                  .filter(Boolean)
                  .join(" · ")}
              </p>
              <a href={offer.url} target="_blank" rel="noreferrer">
                {offer.url}
              </a>
              <div className="actions">
                <button
                  type="button"
                  disabled={disabled}
                  onClick={() => {
                    cancel();
                    lastApplied.current = offer.url;
                    latest.current.update((current) =>
                      mergeVacancyPreview(current, offer),
                    );
                    setOffer(undefined);
                    setStatus(
                      "Данные вакансии заполнены. Проверьте их перед сохранением.",
                    );
                  }}
                >
                  Заполнить
                </button>
                <button
                  type="button"
                  disabled={disabled}
                  onClick={() => {
                    cancel();
                    setOffer(undefined);
                  }}
                >
                  Пропустить
                </button>
              </div>
            </div>
          )}
          {status && (
            <p role="status" aria-live="polite">
              {status}
            </p>
          )}
          {jobIdentity(value.url.trim()) && (
            <button
              type="button"
              disabled={disabled || loading}
              onClick={() => void load(value.url.trim(), false)}
            >
              {loading ? "Загружаем…" : "Повторить загрузку"}
            </button>
          )}
        </>
      )}
    </div>
  );
}
