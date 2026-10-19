import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import {
  ArrowDown,
  ArrowRight,
  ArrowUpRight,
  BriefcaseBusiness,
  CalendarDays,
  Check,
  CheckCheck,
  ChevronDown,
  Download,
  Github,
  LayoutDashboard,
  Link2,
  ListChecks,
  Monitor,
  Puzzle,
} from "lucide-react";
import { Brand } from "./Brand";
import { useTheme } from "@avari/shared/ui";
import "./landing.css";

const screens = [
  {
    id: "journal",
    label: "Отклики",
    icon: BriefcaseBusiness,
    title: "Всё, что важно по каждой вакансии",
    description:
      "Компания, этап общения, заметки и ближайшее действие — в одной строке.",
    alt: "Журнал откликов Avari.Jobs с группировкой вакансий по этапам",
  },
  {
    id: "calendar",
    label: "Календарь",
    icon: CalendarDays,
    title: "Встречи и задачи на одной неделе",
    description:
      "Планируйте собеседования и подготовку к ним в общем календаре.",
    alt: "Календарь Avari.Jobs с собеседованиями и задачами",
  },
  {
    id: "dashboard",
    label: "План дня",
    icon: LayoutDashboard,
    title: "Следующие шаги перед глазами",
    description:
      "Откройте главную, чтобы увидеть задачи на сегодня и ближайшие встречи.",
    alt: "Главная Avari.Jobs с планом на день и ближайшими собеседованиями",
  },
];
const steps = [
  {
    number: "01",
    icon: Link2,
    title: "Сохраните вакансию",
    text: "Вставьте ссылку или добавьте вакансию через расширение. Проверьте данные и сохраните то, что вам интересно.",
    detail: "Из разных источников → в один журнал",
  },
  {
    number: "02",
    icon: ListChecks,
    title: "Отмечайте, что происходит",
    text: "Отправили отклик, поговорили с рекрутером, прошли интервью — обновите этап и запишите договорённости.",
    detail: "История общения всегда под рукой",
  },
  {
    number: "03",
    icon: CalendarDays,
    title: "Запланируйте следующий шаг",
    text: "Добавьте собеседование, подготовку к встрече или задачу написать рекрутеру. Посмотрите, что предстоит сегодня.",
    detail: "Встречи и задачи в общем календаре",
  },
];
const questions = [
  [
    "Это сервис с вакансиями?",
    "Avari.Jobs — личный журнал поиска работы. Находите вакансии на привычных площадках, а здесь сохраняйте их, ведите историю откликов и планируйте встречи.",
  ],
  [
    "Как начать пользоваться?",
    "Создайте аккаунт в онлайн-версии. Регистрацию можно подтвердить через Telegram, если он доступен, или дождаться одобрения администратором. Затем сохраните первую вакансию — вручную, по ссылке или через расширение.",
  ],
  [
    "Обязательно устанавливать расширение?",
    "Нет. Журнал работает в браузере без расширения. Расширение удобно, если вы хотите сохранять вакансии прямо со страницы поддерживаемой площадки.",
  ],
  [
    "Чем отличается локальная версия?",
    "Локальная версия устанавливается на Windows или macOS и хранит журнал на вашем компьютере. Онлайн-версия хранит данные на сервере. Автоматической синхронизации между версиями нет; для переноса доступен экспорт и импорт журнала.",
  ],
];

export function Landing() {
  useTheme();
  const [selected, setSelected] = useState(0);
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!root.current || !("IntersectionObserver" in window)) return;
    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            entry.target.classList.add("landing-visible");
            observer.unobserve(entry.target);
          }
        });
      },
      { threshold: 0.08 },
    );
    root.current.querySelectorAll("[data-reveal]").forEach((element) => {
      observer.observe(element);
    });
    return () => {
      observer.disconnect();
    };
  }, []);

  return (
    <div className="landing" ref={root}>
      <a className="landing-skip" href="#landing-main">
        Перейти к содержимому
      </a>
      <header className="landing-header">
        <Link to="/" aria-label="Avari.Jobs — главная">
          <Brand />
        </Link>
        <nav aria-label="Навигация по лендингу">
          <a href="#features">Возможности</a>
          <a href="#how-it-works">Как пользоваться</a>
          <a href="#versions">Версии</a>
        </nav>
        <Link className="landing-login" to="/login">
          Войти <ArrowUpRight size={16} />
        </Link>
      </header>
      <main id="landing-main">
        <section className="landing-hero">
          <div className="landing-hero-copy">
            <p className="landing-eyebrow">
              <span /> Личный журнал поиска работы
            </p>
            <h1>
              Вакансии, отклики
              <br />и собеседования —<br />
              <span>в одном журнале.</span>
            </h1>
            <p className="landing-lead">
              Сохраняйте вакансии, отмечайте этапы откликов и планируйте
              следующие действия. Не придётся искать всё по вкладкам и
              перепискам.
            </p>
            <div className="landing-actions">
              <Link
                className="landing-button landing-primary"
                to="/login?mode=register"
              >
                Начать онлайн <ArrowRight size={18} />
              </Link>
              <a className="landing-text-link" href="#features">
                Посмотреть, как работает <ArrowDown size={16} />
              </a>
            </div>
            <p className="landing-hero-note">
              <Check size={14} /> Работает в браузере <span>·</span> Можно
              начать без установки
            </p>
          </div>
          <aside
            className="landing-day-card"
            aria-label="Пример плана поиска работы"
          >
            <div className="landing-day-heading">
              <span className="landing-mini-icon">
                <ListChecks size={19} />
              </span>
              <span>Следующий шаг</span>
              <span className="landing-live-dot" />
            </div>
            <div className="landing-day-body">
              <span className="landing-day-label">Всё в своём порядке</span>
              <h2>На чём остановились?</h2>
              <p>
                Не нужно вспоминать.
                <br />
                Достаточно открыть журнал.
              </p>
            </div>
            <div className="landing-sample-row">
              <span className="landing-sample-icon">
                <CheckCheck size={17} />
              </span>
              <div>
                <strong>Отклик отправлен</strong>
                <span>Этап сохранён в журнале</span>
              </div>
              <span className="landing-sample-check">
                <Check size={15} />
              </span>
            </div>
            <div className="landing-sample-row">
              <span className="landing-sample-icon">
                <CalendarDays size={17} />
              </span>
              <div>
                <strong>Встреча с командой</strong>
                <span>В календаре и плане дня</span>
              </div>
              <ArrowUpRight size={17} />
            </div>
            <div className="landing-day-footer">
              <span /> Пример организации поиска
            </div>
          </aside>
          <div className="landing-hero-bottom">
            <span>ОТ ПЕРВОЙ ССЫЛКИ ДО РЕШЕНИЯ</span>
            <span>
              Ваши вакансии. Ваша история поиска.
              <ArrowDown size={15} />
            </span>
          </div>
        </section>

        <section
          className="landing-product landing-section"
          id="features"
          aria-labelledby="product-heading"
          data-reveal
        >
          <div className="landing-section-heading">
            <div>
              <p className="landing-eyebrow">Вместо разрозненных записей</p>
              <h2 id="product-heading">
                Откройте журнал.
                <br />
                <span>Продолжите с того же места.</span>
              </h2>
            </div>
            <p>
              Где ждёте ответа, с кем договорились о встрече и что сделать
              дальше — всё перед глазами.
            </p>
          </div>
          <div className="landing-preview-toolbar">
            <div
              className="landing-preview-tabs"
              role="tablist"
              aria-label="Примеры интерфейса"
            >
              {screens.map((screen, index) => (
                <button
                  key={screen.id}
                  id={`preview-tab-${screen.id}`}
                  role="tab"
                  type="button"
                  aria-selected={selected === index}
                  aria-controls={`preview-panel-${screen.id}`}
                  tabIndex={selected === index ? 0 : -1}
                  onClick={() => setSelected(index)}
                  onKeyDown={(event) => {
                    let next = index;
                    if (event.key === "ArrowRight")
                      next = (index + 1) % screens.length;
                    else if (event.key === "ArrowLeft")
                      next = (index + screens.length - 1) % screens.length;
                    else if (event.key === "Home") next = 0;
                    else if (event.key === "End") next = screens.length - 1;
                    else return;
                    event.preventDefault();
                    setSelected(next);
                    document
                      .getElementById(`preview-tab-${screens[next].id}`)
                      ?.focus();
                  }}
                >
                  <screen.icon size={16} />
                  {screen.label}
                </button>
              ))}
            </div>
            <span className="landing-preview-caption">
              <span /> Настоящий интерфейс Avari.Jobs
            </span>
          </div>
          <div className="landing-preview-frame">
            <div className="landing-window-bar">
              <span className="landing-window-dots">
                <i />
                <i />
                <i />
              </span>
              <span>jobs.avari.dev</span>
              <span className="landing-window-secure">
                <Check size={12} /> Личный журнал
              </span>
            </div>
            {screens.map((screen, index) => (
              <div
                key={screen.id}
                role="tabpanel"
                id={`preview-panel-${screen.id}`}
                aria-labelledby={`preview-tab-${screen.id}`}
                hidden={selected !== index}
                tabIndex={0}
                className="landing-screen-panel"
              >
                <picture>
                  <source
                    media="(max-width: 600px)"
                    srcSet={`/landing/${screen.id}-mobile.webp`}
                  />
                  <img
                    src={`/landing/${screen.id}.webp`}
                    alt={screen.alt}
                    width="1440"
                    height="1000"
                    loading="lazy"
                  />
                </picture>
              </div>
            ))}
          </div>
          <div className="landing-preview-description">
            <div>
              <h3>{screens[selected].title}</h3>
              <p>{screens[selected].description}</p>
            </div>
            <span>На скриншотах — демонстрационные данные</span>
          </div>
        </section>

        <section
          className="landing-section landing-how"
          id="how-it-works"
          aria-labelledby="how-heading"
          data-reveal
        >
          <div className="landing-section-heading">
            <div>
              <p className="landing-eyebrow">Как пользоваться</p>
              <h2 id="how-heading">
                Три привычных действия.
                <br />
                <span>Один понятный процесс.</span>
              </h2>
            </div>
            <p>
              Ведите журнал по ходу поиска.
              <br />
              Начните с одной интересной вакансии.
            </p>
          </div>
          <div className="landing-steps">
            {steps.map((step) => (
              <article className="landing-step" key={step.number}>
                <div className="landing-step-top">
                  <span>{step.number}</span>
                  <step.icon size={24} strokeWidth={1.5} />
                </div>
                <h3>{step.title}</h3>
                <p>{step.text}</p>
                <div className="landing-step-detail">
                  <span />
                  {step.detail}
                </div>
              </article>
            ))}
          </div>
          <div className="landing-stages">
            <span>По каждой вакансии</span>
            <div>
              {["Сохранена", "Отклик", "HR", "Интервью", "Финал", "Оффер"].map(
                (stage, index) => (
                  <span key={stage}>
                    {index > 0 && <ArrowRight size={13} />}
                    <b>{stage}</b>
                  </span>
                ),
              )}
            </div>
          </div>
        </section>

        <section
          className="landing-section landing-versions"
          id="versions"
          aria-labelledby="versions-heading"
          data-reveal
        >
          <div className="landing-section-heading">
            <div>
              <p className="landing-eyebrow">Где вам удобно</p>
              <h2 id="versions-heading">
                Начните в браузере.
                <br />
                <span>Остальное — по желанию.</span>
              </h2>
            </div>
          </div>
          <div className="landing-version-grid">
            <article className="landing-version landing-version-online">
              <span className="landing-version-tag">Быстрый старт</span>
              <Monitor size={27} strokeWidth={1.5} />
              <h3>Онлайн</h3>
              <p>
                Откройте журнал в браузере на компьютере или телефоне. Данные
                хранятся на сервере.
              </p>
              <Link
                className="landing-button landing-primary"
                to="/login?mode=register"
              >
                Начать онлайн <ArrowRight size={17} />
              </Link>
            </article>
            <article className="landing-version">
              <Puzzle size={27} strokeWidth={1.5} />
              <h3>Расширение</h3>
              <p>
                Сохраняйте вакансии прямо со страницы площадки. Перед
                добавлением проверьте данные.
              </p>
              <Link className="landing-text-link" to="/extension">
                О расширении <ArrowUpRight size={17} />
              </Link>
            </article>
            <article className="landing-version">
              <Download size={27} strokeWidth={1.5} />
              <h3>На компьютере</h3>
              <p>
                Локальная версия для Windows и macOS. Журнал хранится на вашем
                компьютере.
              </p>
              <a
                className="landing-text-link"
                href="https://ostkost.github.io/avari-job-applications/"
              >
                Скачать и настроить <ArrowUpRight size={17} />
              </a>
            </article>
          </div>
          <p className="landing-version-note">
            Онлайн-версия и локальная версия ведут отдельные журналы. Для
            переноса данных есть импорт и экспорт.
          </p>
        </section>

        <section
          className="landing-section landing-faq"
          aria-labelledby="faq-heading"
          data-reveal
        >
          <div>
            <p className="landing-eyebrow">Перед началом</p>
            <h2 id="faq-heading">
              Несколько
              <br />
              <span>полезных ответов.</span>
            </h2>
          </div>
          <div className="landing-questions">
            {questions.map(([question, answer]) => (
              <details key={question}>
                <summary>
                  {question}
                  <ChevronDown size={18} />
                </summary>
                <p>{answer}</p>
              </details>
            ))}
          </div>
        </section>
        <section className="landing-closing" data-reveal>
          <div>
            <p className="landing-eyebrow">Первый шаг — сохранить вакансию</p>
            <h2>
              В следующий раз
              <br />
              <span>не придётся вспоминать.</span>
            </h2>
            <p>Все отклики и договорённости будут в вашем журнале.</p>
          </div>
          <Link
            className="landing-button landing-primary"
            to="/login?mode=register"
          >
            Начать онлайн <ArrowRight size={18} />
          </Link>
        </section>
      </main>
      <footer className="landing-footer">
        <Link to="/" aria-label="Avari.Jobs — главная">
          <Brand />
        </Link>
        <p>Личный журнал поиска работы</p>
        <div>
          <Link to="/privacy">Конфиденциальность</Link>
          <a href="https://github.com/OstKost/avari-job-applications">
            <Github size={16} /> GitHub <ArrowUpRight size={13} />
          </a>
        </div>
      </footer>
    </div>
  );
}
