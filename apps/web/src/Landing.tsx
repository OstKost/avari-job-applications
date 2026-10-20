import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import {
  ArrowDown,
  ArrowRight,
  ArrowUpRight,
  BarChart3,
  Bell,
  Bot,
  BriefcaseBusiness,
  CalendarDays,
  Check,
  CheckCheck,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Cloud,
  Download,
  Github,
  Globe,
  HardDrive,
  LayoutDashboard,
  Link2,
  ListChecks,
  Monitor,
  PlusCircle,
  Puzzle,
  Pause,
  Play,
  Sparkles,
  Trophy,
  Send,
  Target,
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
  {
    id: "extension-save", label: "Плагин: сохранение", icon: Puzzle,
    title: "Сохраните вакансию прямо со страницы",
    description: "Расширение распознает вакансию. Проверьте данные и дополните карточку перед сохранением.",
    alt: "Расширение Avari.Jobs: просмотр и редактирование вакансии",
    pair: [
      { id: "overview", caption: "Вакансия распознана", alt: "Расширение с распознанной вакансией Frontend developer" },
      { id: "edit", caption: "Проверьте и дополните", alt: "Форма редактирования вакансии в расширении" },
    ],
  },
  {
    id: "extension-track", label: "Плагин: этапы", icon: Puzzle,
    title: "Обновляйте этапы, продолжая поиск",
    description: "Сохранённая вакансия связана с журналом. Расширение замечает отклик и предлагает обновить этап.",
    alt: "Расширение Avari.Jobs: сохранённая вакансия и обновление этапа",
    pair: [
      { id: "saved", caption: "Вакансия в журнале", alt: "Карточка сохранённой вакансии в расширении" },
      { id: "update", caption: "Новый этап найден", alt: "Предложение отметить отклик на вакансию в расширении" },
    ],
  },
];
const journey = [
  { label: "Сохранена", icon: Link2, color: "#75d9ed", title: "Нашли ту самую вакансию", action: "Сохраните ссылку на вакансию продуктового дизайнера. Добавьте заметку: «Сильная команда, хочу узнать больше».", result: "Ссылка, описание и ваши заметки сохранены", note: "Больше не нужно искать нужную вкладку", artifact: "Продуктовый дизайнер · Команда Маяк", detail: "Вакансия и первое впечатление — в журнале" },
  { label: "Отклик", icon: CheckCheck, color: "#97a8ff", title: "Откликнулись — и знаете, что дальше", action: "Отметьте отправленный отклик и добавьте задачу уточнить статус через несколько дней, если ответа не будет.", result: "Отклик отмечен, следующий шаг запланирован", note: "Ни один интересный отклик не потеряется", artifact: "Уточнить статус отклика · пятница", detail: "Задача добавлена в план поиска" },
  { label: "HR", icon: BriefcaseBusiness, color: "#d6a0f6", title: "Договорённости остаются с вами", action: "После звонка запишите ожидания по роли, условия и имя рекрутера. Назначьте встречу с командой в календаре.", result: "Условия и договорённости записаны", note: "К следующему разговору весь контекст под рукой", artifact: "Встреча с командой · вторник, 14:00", detail: "Контакт, заметки и встреча связаны с вакансией" },
  { label: "Интервью", icon: CalendarDays, color: "#ffbc7d", title: "Приходите на встречу подготовленными", action: "Добавьте задачу разобрать кейс перед встречей. После интервью сохраните обратную связь и вопросы к следующему этапу.", result: "Подготовка и обратная связь в одном месте", note: "Меньше суеты перед важным разговором", artifact: "Разобрать кейс · до встречи с командой", detail: "Подготовка видна в календаре и плане дня" },
  { label: "Финал", icon: ListChecks, color: "#f4d77b", title: "Все детали перед решением", action: "Откройте историю общения перед финальным разговором. Уточните оставшиеся вопросы о задачах, команде и условиях.", result: "Вопросы закрыты, условия уточнены", note: "Не приходится восстанавливать историю по перепискам", artifact: "Уточнить условия · финальная встреча", detail: "Заметки с прошлых этапов всегда рядом" },
  { label: "Оффер", icon: Trophy, color: "#8be0b6", title: "Принимайте решение с полной картиной", action: "Сохраните условия предложения и сравните их со своими заметками. Отметьте итог поиска в журнале.", result: "Предложение и история поиска сохранены", note: "От первой ссылки до взвешенного решения", artifact: "Оффер получен · решение за вами", detail: "Весь путь по вакансии — в одной истории" },
];

const JOURNEY_LETTER_MS = 24;
const JOURNEY_ENTER_MS = 450;

function JourneyTyping({ text, enabled }: { text: string; enabled: boolean }) {
  const [length, setLength] = useState(0);
  useEffect(() => {
    if (!enabled || window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      setLength(text.length);
      return;
    }
    setLength(0);
    const started = performance.now() + JOURNEY_ENTER_MS;
    let frame: number;
    const tick = (now: number) => {
      const next = Math.max(0, Math.floor((now - started) / JOURNEY_LETTER_MS));
      setLength(Math.min(next, text.length));
      if (next < text.length) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [text, enabled]);
  return <span className="landing-journey-typing"><span className="landing-journey-text-size">{text}</span><span className="landing-journey-typed" aria-hidden="true">{text.slice(0, length)}{enabled && length < text.length && <span className="landing-journey-caret" />}</span></span>;
}

function LandingJourney() {
  const [active, setActive] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [visible, setVisible] = useState(false);
  const [started, setStarted] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const autoStarted = useRef(false);
  const transitionTimer = useRef<number | undefined>(undefined);
  const container = useRef<HTMLDivElement>(null);
  const goTo = (index: number) => {
    window.clearTimeout(transitionTimer.current);
    if (index === active) { setLeaving(false); return; }
    setLeaving(true);
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    transitionTimer.current = window.setTimeout(() => {
      setActive(index);
      setLeaving(false);
    }, reduced ? 0 : 220);
  };
  useEffect(() => () => window.clearTimeout(transitionTimer.current), []);
  useEffect(() => {
    const motion = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => { if (motion.matches) setPlaying(false); };
    motion.addEventListener("change", update);
    const observer = new IntersectionObserver(([entry]) => {
      setVisible(entry.isIntersecting);
      if (entry.isIntersecting && !autoStarted.current) {
        autoStarted.current = true;
        setStarted(true);
        setPlaying(!motion.matches);
      }
    }, { threshold: 0.25 });
    if (container.current) observer.observe(container.current);
    return () => { observer.disconnect(); motion.removeEventListener("change", update); };
  }, []);
  useEffect(() => {
    if (!playing || !visible) return;
    // Finish typing, then leave enough time to read the result before moving on.
    const duration = JOURNEY_ENTER_MS + journey[active].action.length * JOURNEY_LETTER_MS + 3500;
    const timer = window.setTimeout(() => {
      if (active === journey.length - 1) setPlaying(false);
      else goTo(active + 1);
    }, duration);
    return () => window.clearTimeout(timer);
  }, [active, playing, visible]);
  const stage = journey[active];
  return (
    <div className="landing-journey" ref={container} aria-labelledby="journey-heading">
      <div className="landing-journey-heading">
        <div><p className="landing-eyebrow"><Sparkles size={14} /> Один из возможных сценариев</p><h3 id="journey-heading">Хорошая вакансия. Понятный путь до решения.</h3><p>Посмотрите, как журнал помогает на каждом этапе поиска.</p></div>
        <button type="button" className="landing-journey-control" onClick={() => { autoStarted.current = true; setStarted(true); if (!playing && active === journey.length - 1) goTo(0); setPlaying(!playing); }} aria-label={playing ? "Приостановить сценарий" : "Воспроизвести сценарий"}>{playing ? <Pause size={14} /> : <Play size={14} />}{playing ? "Пауза" : "Смотреть"}</button>
      </div>
      <ol className="landing-journey-flow" aria-label="Этапы примера поиска работы">
        {journey.map((item, index) => (
          <li key={item.label} className={index < active ? "is-complete" : index === active ? "is-current" : ""} style={{ "--stage-color": item.color } as React.CSSProperties}>
            <button type="button" aria-current={index === active ? "step" : undefined} onClick={() => { autoStarted.current = true; setStarted(true); goTo(index); setPlaying(false); }}>
              <span className="landing-journey-node">{index < active ? <Check size={22} /> : <item.icon size={22} />}</span>
              <strong>{item.label}</strong><small>{index < active ? "Готово" : index === active ? "Сейчас" : `0${index + 1}`}</small>
            </button>
            {index < active && <p className="landing-journey-result"><Check size={12} />{item.result}</p>}
          </li>
        ))}
      </ol>
      <div className="landing-journey-scene-window">
      <div key={active} className={`landing-journey-scene${leaving ? " is-leaving" : ""}`} style={{ "--stage-color": stage.color } as React.CSSProperties}>
        <div className="landing-journey-story" key={active}>
          <span className="landing-journey-kicker">ШАГ 0{active + 1} / 06 · {stage.label}</span>
          <h4>{stage.title}</h4><p><JourneyTyping text={stage.action} enabled={started} /></p>
          <div className="landing-journey-benefit"><Sparkles size={16} />{stage.note}</div>
        </div>
        <div className="landing-journey-artifact" key={`artifact-${active}`}>
          <span>ВАШ ЖУРНАЛ <span>· Пример</span></span>
          <div className="landing-journey-artifact-content"><span className="landing-journey-artifact-icon"><stage.icon size={25} /></span><strong>{stage.artifact}</strong><p>{stage.detail}</p></div>
          <div className="landing-journey-saved"><CheckCheck size={15} />{stage.result}</div>
        </div>
      </div>
      </div>
      <div className="landing-journey-footer"><span>Пример удачного пути: этапы и результат у каждого свои.</span><button type="button" onClick={() => { autoStarted.current = true; setStarted(true); goTo((active + 1) % journey.length); setPlaying(false); }}>{active === journey.length - 1 ? "В начало" : "Следующий этап"}<ArrowRight size={15} /></button></div>
    </div>
  );
}

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
  const [isAutoPlaying, setIsAutoPlaying] = useState(true);
  const [timerProgress, setTimerProgress] = useState(0); // 0 to 1
  const [isHovered, setIsHovered] = useState(false);
  const swipeStart = useRef<number | null>(null);
  const changeSlide = (direction: number) => {
    setSelected((current) => (current + direction + screens.length) % screens.length);
    setTimerProgress(0);
  };
  const root = useRef<HTMLDivElement>(null);
  const featuresRef = useRef<HTMLElement>(null);
  const isVisible = useRef(false);

  const CYCLE_DURATION_MS = 7000;

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

  // Observe when the features section is visible on screen
  useEffect(() => {
    if (!featuresRef.current || !("IntersectionObserver" in window)) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        isVisible.current = entry.isIntersecting;
      },
      { threshold: 0.1 },
    );
    observer.observe(featuresRef.current);
    return () => observer.disconnect();
  }, []);

  // Timer loop for auto-switching tabs
  useEffect(() => {
    const prefersReducedMotion = window.matchMedia(
      "(prefers-reduced-motion: reduce)",
    ).matches;
    if (prefersReducedMotion || !isAutoPlaying) {
      setTimerProgress(0);
      return;
    }

    let animationFrame: number;
    let lastTime = performance.now();
    let accumulated = 0;

    const tick = (now: number) => {
      const delta = now - lastTime;
      lastTime = now;

      // Only advance progress if visible and not hovered
      if (isVisible.current && !isHovered) {
        accumulated += delta;
        if (accumulated >= CYCLE_DURATION_MS) {
          accumulated = 0;
          setSelected((prev) => (prev + 1) % screens.length);
        }
        setTimerProgress(Math.min(1, accumulated / CYCLE_DURATION_MS));
      }

      animationFrame = requestAnimationFrame(tick);
    };

    animationFrame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(animationFrame);
  }, [isAutoPlaying, isHovered, selected]);

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
                className="landing-button landing-primary primary"
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
        </section>

        <section
          ref={featuresRef}
          className="landing-product landing-section"
          id="features"
          aria-labelledby="product-heading"
          data-reveal
          onMouseEnter={() => setIsHovered(true)}
          onMouseLeave={() => setIsHovered(false)}
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
                  onClick={() => {
                    setSelected(index);
                    setTimerProgress(0);
                  }}
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
                    setTimerProgress(0);
                    document
                      .getElementById(`preview-tab-${screens[next].id}`)
                      ?.focus();
                  }}
                >
                  <screen.icon size={16} />
                  {screen.label}
                </button>
              ))}

              <span className="landing-tab-divider" aria-hidden="true" />

              {/* Круговой индикатор таймера автопереключения */}
              <button
                type="button"
                className="landing-tab-timer"
                title={
                  isAutoPlaying
                    ? isHovered
                      ? "Автопереключение приостановлено при наведении"
                      : "Нажмите, чтобы остановить автопереключение"
                    : "Нажмите, чтобы включить автопереключение"
                }
                aria-label={
                  isAutoPlaying
                    ? "Приостановить автоматическую смену вкладок"
                    : "Возобновить автоматическую смену вкладок"
                }
                onClick={() => {
                  setIsAutoPlaying((prev) => !prev);
                  setTimerProgress(0);
                }}
              >
                <svg
                  className="landing-timer-ring"
                  viewBox="0 0 24 24"
                  width="18"
                  height="18"
                  aria-hidden="true"
                >
                  <circle
                    className="landing-timer-ring-bg"
                    cx="12"
                    cy="12"
                    r="8.5"
                  />
                  <circle
                    className="landing-timer-ring-progress"
                    cx="12"
                    cy="12"
                    r="8.5"
                    style={{
                      strokeDasharray: 2 * Math.PI * 8.5,
                      strokeDashoffset:
                        2 * Math.PI * 8.5 * (1 - (isAutoPlaying ? timerProgress : 0)),
                    }}
                  />
                </svg>
                <span className="landing-timer-icon">
                  {isAutoPlaying ? (
                    <Pause size={9} />
                  ) : (
                    <Play size={9} style={{ marginLeft: "1px" }} />
                  )}
                </span>
              </button>
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
            <div className="landing-carousel-track"
              style={{ transform: `translateX(-${selected * 100}%)` }}
              onTouchStart={(event) => { swipeStart.current = event.touches[0].clientX; }}
              onTouchEnd={(event) => {
                if (swipeStart.current === null) return;
                const distance = swipeStart.current - event.changedTouches[0].clientX;
                if (Math.abs(distance) > 50) changeSlide(distance > 0 ? 1 : -1);
                swipeStart.current = null;
              }}
            >
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
                {screen.pair ? (
                  <div className="landing-extension-pair">
                    {screen.pair.map((image) => (
                      <figure key={image.id}>
                        <figcaption>{image.caption}</figcaption>
                        <img src={`/landing/extension-${image.id}.webp`} alt={image.alt} width="390" height="600" loading="lazy" />
                      </figure>
                    ))}
                  </div>
                ) : <picture>
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
                </picture>}
              </div>
            ))}
            </div>
          </div>
          <div className="landing-carousel-controls" aria-label="Управление каруселью">
            <button type="button" aria-label="Предыдущий скриншот" onClick={() => changeSlide(-1)}><ChevronLeft size={20} /></button>
            <span aria-live="polite">{selected + 1} / {screens.length}</span>
            <button type="button" aria-label="Следующий скриншот" onClick={() => changeSlide(1)}><ChevronRight size={20} /></button>
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
          <LandingJourney />
        </section>

        <section
          className="landing-section landing-versions"
          id="versions"
          aria-labelledby="versions-heading"
          data-reveal
        >
          <div className="landing-section-heading">
            <div>
              <p className="landing-eyebrow">Экосистема и возможности</p>
              <h2 id="versions-heading">
                Всё для системного
                <br />
                <span>поиска работы.</span>
              </h2>
            </div>
            <p>
              Выбирайте удобный формат работы, наполняйте журнал любым способом
              и держите под контролем каждый шаг до оффера.
            </p>
          </div>

          <div className="landing-capabilities-stack">
            {/* Блок 1: Форматы работы: Онлайн / Офлайн */}
            <div className="landing-capability-group">
              <div className="landing-capability-header">
                <span className="landing-capability-badge">01. Форматы работы</span>
                <h3>Онлайн в облаке или локально на компьютере</h3>
                <p>
                  Работайте в браузере с синхронизацией между устройствами или
                  сохраняйте полную приватность на своем ПК.
                </p>
              </div>
              <div className="landing-version-grid">
                <article className="landing-version landing-version-online">
                  <span className="landing-version-tag">Быстрый старт</span>
                  <Globe size={27} strokeWidth={1.5} />
                  <h3>Онлайн-версия</h3>
                  <p>
                    Откройте журнал в браузере на компьютере или телефоне (PWA).
                    Данные безопасно хранятся на сервере с мгновенным доступом.
                  </p>
                  <Link
                    className="landing-button landing-primary primary"
                    to="/login?mode=register"
                  >
                    Начать онлайн <ArrowRight size={17} />
                  </Link>
                </article>

                <article className="landing-version">
                  <HardDrive size={27} strokeWidth={1.5} />
                  <h3>Локально на компьютере (Офлайн)</h3>
                  <p>
                    Десктопное приложение для Windows и macOS. База данных SQLite
                    хранится только на вашем диске и не передаётся в сеть.
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
                переноса данных всегда доступен экспорт и импорт в JSON / Excel.
              </p>
            </div>

            {/* Блок 2: Наполнение вакансиями */}
            <div className="landing-capability-group">
              <div className="landing-capability-header">
                <span className="landing-capability-badge">02. Наполнение журнала</span>
                <h3>Сохраняйте отклики за секунды из любого источника</h3>
                <p>
                  Не тратьте время на рутину — добавляйте вакансии так, как удобно вам прямо сейчас.
                </p>
              </div>
              <div className="landing-features-grid landing-features-grid-4">
                <article className="landing-version-feature">
                  <div className="landing-feature-icon">
                    <PlusCircle size={22} strokeWidth={1.5} />
                  </div>
                  <h4>Вручную</h4>
                  <p>
                    Удобная карточка с автоподстановкой городов, грейдов, валют зарплаты и кастомными заметками.
                  </p>
                </article>

                <article className="landing-version-feature">
                  <div className="landing-feature-icon">
                    <Link2 size={22} strokeWidth={1.5} />
                  </div>
                  <h4>По ссылке</h4>
                  <p>
                    Вставьте URL вакансии (hh.ru, Habr Career, LinkedIn) — парсер сам заполнит название, компанию и вилку.
                  </p>
                </article>

                <article className="landing-version-feature landing-feature-highlight">
                  <div className="landing-feature-top-row">
                    <div className="landing-feature-icon">
                      <Puzzle size={22} strokeWidth={1.5} />
                    </div>
                    <span className="landing-pill">Плагин</span>
                  </div>
                  <h4>Расширение для браузера</h4>
                  <p>
                    Сохраняйте вакансии в один клик прямо со страницы карьерного сайта без перехода в журнал.
                  </p>
                  <Link className="landing-text-link" to="/extension">
                    О расширении <ArrowUpRight size={15} />
                  </Link>
                </article>

                <article className="landing-version-feature">
                  <div className="landing-feature-icon">
                    <Send size={22} strokeWidth={1.5} />
                  </div>
                  <h4>Telegram-бот</h4>
                  <p>
                    Пересылайте посты и ссылки на вакансии боту из каналов и чатов — проверьте карточку и подтвердите сохранение.
                  </p>
                  <a href="https://t.me/AvariJobsBot" target="_blank" rel="noopener noreferrer">Открыть бота <ArrowUpRight size={14} /></a>
                </article>
              </div>
            </div>

            {/* Блок 3: Контроль и аналитика */}
            <div className="landing-capability-group">
              <div className="landing-capability-header">
                <span className="landing-capability-badge">03. Контроль и аналитика</span>
                <h3>Держите темп и управляйте воронкой офферов</h3>
                <p>
                  Инструменты, которые помогают не перегореть и системно дойти до желанного предложения.
                </p>
              </div>
              <div className="landing-features-grid landing-features-grid-3">
                <article className="landing-version-feature">
                  <div className="landing-feature-icon">
                    <Bell size={22} strokeWidth={1.5} />
                  </div>
                  <h4>Умные уведомления</h4>
                  <p>
                    Браузерные Push-уведомления и оповещения в Telegram о назначенных звонках, собеседованиях и дедлайнах.
                  </p>
                </article>

                <article className="landing-version-feature">
                  <div className="landing-feature-icon">
                    <Target size={22} strokeWidth={1.5} />
                  </div>
                  <h4>Цели поиска</h4>
                  <p>
                    Задавайте дневную цель откликов (например, 5 в день), следите за стриком активности и сохраняйте фокус.
                  </p>
                </article>

                <article className="landing-version-feature">
                  <div className="landing-feature-icon">
                    <BarChart3 size={22} strokeWidth={1.5} />
                  </div>
                  <h4>Статистика и воронка</h4>
                  <p>
                    Наглядная конверсия по этапам (отклики → скрининг → интервью → оффер) и аналитика самых результативных источников.
                  </p>
                </article>
              </div>
            </div>
          </div>
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
            className="landing-button landing-primary primary"
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
