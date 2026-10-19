import { useState } from "react";
import { Modal, ErrorBox, FieldInput } from "@avari/shared/ui";
import { parseShareTargetParams, type ParsedShareData } from "./share-target";

export interface ShareFallbackModalProps {
  isOpen: boolean;
  onClose: () => void;
  onAddParsedVacancy: (data: ParsedShareData) => void;
}

export function ShareFallbackModal({
  isOpen,
  onClose,
  onAddParsedVacancy,
}: ShareFallbackModalProps) {
  const [inputText, setInputText] = useState("");
  const [error, setError] = useState<Error>();
  if (!isOpen) return null;

  return (
    <Modal title="Добавить вакансию по ссылке" onClose={onClose}>
      <form
        className="form"
        onSubmit={(event) => {
          event.preventDefault();
          const parsed = parseShareTargetParams(
            new URLSearchParams({ text: inputText }),
          );
          if (!parsed?.rawUrl) {
            setError(
              new Error(
                "Вставьте ссылку, начинающуюся с https:// или http://.",
              ),
            );
            return;
          }
          onAddParsedVacancy(parsed);
          setInputText("");
          setError(undefined);
          onClose();
        }}
      >
        <p>
          Если в меню «Поделиться» нет Avari.Jobs, скопируйте ссылку и вставьте
          её здесь. Вакансия откроется для проверки перед сохранением.
        </p>
        <ErrorBox error={error} />
        <FieldInput label="Ссылка или текст вакансии">
          <textarea
            autoFocus
            rows={4}
            maxLength={4000}
            value={inputText}
            onChange={(event) => {
              setInputText(event.target.value);
              setError(undefined);
            }}
          />
        </FieldInput>
        <div className="actions">
          <button
            type="button"
            onClick={async () => {
              try {
                setInputText(await navigator.clipboard.readText());
                setError(undefined);
              } catch {
                setError(
                  new Error(
                    "Вставьте ссылку вручную: браузер не разрешил чтение буфера обмена.",
                  ),
                );
              }
            }}
          >
            Вставить из буфера
          </button>
          <button type="button" onClick={onClose}>
            Отмена
          </button>
          <button className="primary">Продолжить</button>
        </div>
      </form>
    </Modal>
  );
}
