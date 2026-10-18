import {
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { useQuery } from "@tanstack/react-query";
import {
  createAPI,
  dateToday,
  stages,
  type ActivityStatistics,
  type Application,
  type User,
} from "@avari/shared";
import { ErrorBox, Loading } from "@avari/shared/ui";
import {
  activityLevel,
  dailyApplications,
  distribution,
  shiftDay,
  stageColors,
} from "./statisticsData";
import "./statistics.css";

const api = createAPI();
const fullDate = (day: string) =>
  new Intl.DateTimeFormat("ru-RU", {
    dateStyle: "long",
    timeZone: "UTC",
  }).format(new Date(`${day}T00:00:00Z`));
const shortDate = (day: string) => `${day.slice(8, 10)}.${day.slice(5, 7)}`;
const plural = new Intl.PluralRules("ru-RU");
const noun = (count: number, one: string, few: string, many: string) =>
  ({ one, few, many, zero: many, two: few, other: many })[plural.select(count)];

function Tooltip({
  anchor,
  label,
  id,
}: {
  anchor: Element;
  label: string;
  id: string;
}) {
  const ref = useRef<HTMLSpanElement>(null);
  const [position, setPosition] = useState({ left: 8, top: 8 });
  useLayoutEffect(() => {
    const place = () => {
      const bounds = anchor.getBoundingClientRect();
      const box = ref.current?.getBoundingClientRect();
      const height = box?.height ?? 0;
      setPosition({
        left: Math.max(
          8,
          Math.min(bounds.left, window.innerWidth - (box?.width ?? 250) - 8),
        ),
        top:
          bounds.top - height - 8 >= 8
            ? bounds.top - height - 8
            : bounds.bottom + 8,
      });
    };
    place();
    window.addEventListener("scroll", place, true);
    window.addEventListener("resize", place);
    return () => {
      window.removeEventListener("scroll", place, true);
      window.removeEventListener("resize", place);
    };
  }, [anchor, label]);
  return createPortal(
    <span
      ref={ref}
      className="statistics-tooltip"
      role="tooltip"
      id={id}
      style={position}
    >
      {label}
    </span>,
    document.body,
  );
}

// The same tooltip works with a mouse, keyboard, and touch; its trigger is a real button.
function Hint({
  label,
  children,
  className = "",
}: {
  label: string;
  children: ReactNode;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const id = useId();
  const trigger = useRef<HTMLButtonElement>(null);
  return (
    <span
      className={`statistics-hint ${className}`}
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
    >
      <button
        ref={trigger}
        type="button"
        className="statistics-hint-trigger"
        aria-label={label}
        aria-describedby={open ? id : undefined}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        onClick={() => setOpen(true)}
        onKeyDown={(e) => {
          if (e.key === "Escape") setOpen(false);
        }}
      >
        {children}
      </button>
      {open && trigger.current && (
        <Tooltip anchor={trigger.current} label={label} id={id} />
      )}
    </span>
  );
}

function Activity({ user, today }: { user: User; today: string }) {
  const period = 90;
  const from = shiftDay(today, 1 - period);
  const query = useQuery({
    queryKey: ["statistics-activity", user.id, user.timezone, from, today],
    queryFn: () =>
      api<ActivityStatistics>(`/statistics/activity?from=${from}&to=${today}`),
    refetchInterval: 30000,
  });
  const days = query.data?.days ?? [];
  const scroll = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    if (scroll.current) scroll.current.scrollLeft = scroll.current.scrollWidth;
  }, [from, days.length]);
  const offset = (new Date(`${from}T00:00:00Z`).getUTCDay() + 6) % 7;
  const total = days.reduce((sum, day) => sum + day.count, 0);
  const activeDays = days.filter((day) => day.count > 0).length;
  const average = activeDays ? total / activeDays : 0;
  const weeks = Math.ceil((offset + days.length) / 7);
  return (
    <section
      className="panel statistics-panel statistics-activity"
      data-tone="mint"
      aria-labelledby="activity-heading"
    >
      <div className="statistics-section-header">
        <div>
          <h2 id="activity-heading">Активность</h2>
          <p className="muted">
            Добавления и изменения вакансий, заметок и связанных задач за
            последние 90 дней
          </p>
        </div>
      </div>
      {query.isPending ? (
        <Loading />
      ) : query.error ? (
        <ErrorBox error={query.error} retry={() => query.refetch()} />
      ) : (
        <>
          <dl className="activity-summary">
            <div>
              <dt>Действий</dt>
              <dd>{total}</dd>
            </div>
            <div>
              <dt>Активных дней</dt>
              <dd>
                {activeDays}
                <small> / {period}</small>
              </dd>
            </div>
            <div>
              <dt>За активный день</dt>
              <dd>
                {average.toLocaleString("ru-RU", {
                  minimumFractionDigits: 1,
                  maximumFractionDigits: 1,
                })}
              </dd>
            </div>
          </dl>
          <div className="activity-calendar">
            <div className="activity-calendar-caption">
              <span>
                {shortDate(from)} — {shortDate(today)}
              </span>
              <span>
                {Math.round((activeDays / period) * 100)}% дней с активностью
              </span>
            </div>
            <div
              ref={scroll}
              className="statistics-scroll"
              tabIndex={0}
              aria-label="Календарь активности"
            >
              <div className="statistics-heatmap">
                <div className="statistics-weekdays" aria-hidden="true">
                  {["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"].map((day) => (
                    <span key={day}>{day}</span>
                  ))}
                </div>
                <div className="activity-weeks">
                  <div className="activity-week-labels" aria-hidden="true">
                    {Array.from({ length: weeks }, (_, index) => (
                      <span key={index}>
                        {index % 2 === 0
                          ? shortDate(
                              index === 0
                                ? from
                                : shiftDay(from, index * 7 - offset),
                            )
                          : ""}
                      </span>
                    ))}
                  </div>
                  <div className="statistics-tiles">
                    {Array.from({ length: offset }, (_, i) => (
                      <span key={`empty-${i}`} />
                    ))}
                    {days.map((day) => (
                      <Hint
                        key={day.date}
                        label={`${fullDate(day.date)}: ${day.count} ${noun(day.count, "действие", "действия", "действий")}`}
                      >
                        <span
                          className={`statistics-tile level-${activityLevel(day.count)}`}
                        />
                      </Hint>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          </div>
          <div className="statistics-intensity" aria-label="Шкала активности">
            {["0", "1–2", "3–5", "6–9", "10+"].map((label, level) => (
              <span key={level}>
                <i className={`statistics-tile level-${level}`} />
                {label}
              </span>
            ))}
            <span>действий в день</span>
          </div>
          {total === 0 && (
            <p className="muted">
              Пока нет активности за этот период. Добавьте вакансию, заметку или
              задачу.
            </p>
          )}
        </>
      )}
    </section>
  );
}

function DailyChart({
  applications,
  today,
}: {
  applications: Application[];
  today: string;
}) {
  const period = 30;
  const from = shiftDay(today, 1 - period);
  const to = today;
  const days = dailyApplications(applications, from, to);
  const max =
    Math.ceil(days.reduce((max, day) => Math.max(max, day.total), 1) / 2) * 2;
  const scroll = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    if (scroll.current) scroll.current.scrollLeft = scroll.current.scrollWidth;
  }, [from, to, days.length]);
  const total = days.reduce((sum, day) => sum + day.total, 0);
  const chartHeight = 200;
  return (
    <section
      className="panel statistics-panel statistics-daily"
      data-tone="blue"
      aria-labelledby="daily-heading"
    >
      <div className="statistics-section-header">
        <div>
          <h2 id="daily-heading">Отклики по дням</h2>
          <p className="muted">
            Отклики по дате отправки и текущему этапу за последние 30 дней
          </p>
        </div>
      </div>
      <p>
        <strong>{total}</strong>{" "}
        {noun(total, "отклик", "отклика", "откликов")} · {shortDate(from)} —{" "}
        {shortDate(to)}
      </p>
          <div className="statistics-plot">
            <div className="statistics-y-axis" aria-hidden="true">
              <span>{max}</span>
              <span>{max > 1 ? Math.floor(max / 2) : ""}</span>
              <span>0</span>
            </div>
            <div
              ref={scroll}
              className="statistics-scroll"
              tabIndex={0}
              aria-label="График откликов по дням"
            >
              <div
                className="statistics-columns"
                style={{ minWidth: Math.max(300, days.length * 18 + 40) }}
              >
                {days.map((day, index) => {
                  const label = `${fullDate(day.date)}: ${day.total} ${noun(day.total, "отклик", "отклика", "откликов")}. ${Object.entries(
                    stages,
                  )
                    .map(([key, name]) => `${name}: ${day.counts[key]}`)
                    .join("; ")}`;
                  let y = chartHeight;
                  return (
                    <div className="statistics-column" key={day.date}>
                      <Hint label={label}>
                        <svg
                          viewBox={`0 0 24 ${chartHeight}`}
                          width="24"
                          height={chartHeight}
                          preserveAspectRatio="none"
                          aria-hidden="true"
                        >
                          {Object.keys(stages).map((key) => {
                            const height =
                              (day.counts[key] / max) * chartHeight;
                            y -= height;
                            return height > 0 ? (
                              <rect
                                key={key}
                                x="2"
                                y={y}
                                width="20"
                                height={height}
                                fill={stageColors[key]}
                                stroke="var(--panel)"
                                strokeWidth="0.6"
                              />
                            ) : null;
                          })}
                          {day.total === 0 && (
                            <line
                              x1="2"
                              x2="22"
                              y1="199"
                              y2="199"
                              stroke="var(--muted)"
                            />
                          )}
                        </svg>
                      </Hint>
                      <span className="statistics-date" aria-hidden="true">
                        {index === days.length - 1 ||
                        index % (days.length > 14 ? 3 : 1) === 0
                          ? shortDate(day.date)
                          : "\u00a0"}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
          {total === 0 && (
            <p className="muted">За последние 30 дней откликов нет.</p>
          )}
      <div className="statistics-legend">
        {Object.entries(stages).map(([key, label]) => (
          <span key={key}>
            <i style={{ background: stageColors[key] }} />
            {label}
          </span>
        ))}
      </div>
      <p className="muted statistics-caption">
        При смене этапа обновляется цвет сегмента в день отправки отклика.
        Вакансии без даты отклика здесь не учитываются.
      </p>
    </section>
  );
}

function PieChart({
  applications,
  kind,
  title,
}: {
  applications: Application[];
  kind: "stage" | "state";
  title: string;
}) {
  const segments = distribution(applications, kind);
  const [hint, setHint] = useState<{ label: string; anchor: Element } | null>(
    null,
  );
  const hintId = useId();
  let angle = -Math.PI / 2;
  return (
    <section
      className="panel statistics-panel"
      data-tone={kind === "stage" ? "violet" : "mint"}
      aria-label={title}
    >
      <h2>{title}</h2>
      <p className="muted">
        Весь журнал · {applications.length}{" "}
        {noun(applications.length, "вакансия", "вакансии", "вакансий")}
      </p>
      <div className="statistics-pie-layout">
        <div
          className="statistics-pie-container"
          onMouseLeave={() => setHint(null)}
        >
          <svg
            className="statistics-pie"
            viewBox="0 0 220 220"
            role="group"
            aria-label={title}
          >
            {applications.length === 0 ? (
              <circle cx="110" cy="110" r="100" fill="var(--panel-2)" />
            ) : (
              segments
                .filter((segment) => segment.count > 0)
                .map((segment) => {
                  const start = angle;
                  const sweep = (segment.percent / 100) * Math.PI * 2;
                  angle += sweep;
                  const label = `${segment.label}: ${segment.count} (${segment.percent.toLocaleString("ru-RU", { maximumFractionDigits: 1 })}%)`;
                  const path = `M 110 110 L ${110 + 100 * Math.cos(start)} ${110 + 100 * Math.sin(start)} A 100 100 0 ${sweep > Math.PI ? 1 : 0} 1 ${110 + 100 * Math.cos(angle)} ${110 + 100 * Math.sin(angle)} Z`;
                  return (
                    <g
                      key={segment.key}
                      className="statistics-sector"
                      tabIndex={0}
                      role="img"
                      aria-label={label}
                      aria-describedby={
                        hint?.label === label ? hintId : undefined
                      }
                      onMouseEnter={(event) =>
                        setHint({ label, anchor: event.currentTarget })
                      }
                      onFocus={(event) =>
                        setHint({ label, anchor: event.currentTarget })
                      }
                      onBlur={() => setHint(null)}
                      onClick={(event) =>
                        setHint({ label, anchor: event.currentTarget })
                      }
                      onKeyDown={(event) => {
                        if (event.key === "Escape") setHint(null);
                      }}
                    >
                      {segment.percent === 100 ? (
                        <circle
                          cx="110"
                          cy="110"
                          r="100"
                          fill={segment.color}
                        />
                      ) : (
                        <path
                          d={path}
                          fill={segment.color}
                          stroke="var(--panel)"
                          strokeWidth="1.5"
                        />
                      )}
                    </g>
                  );
                })
            )}
          </svg>
          {hint && (
            <Tooltip anchor={hint.anchor} label={hint.label} id={hintId} />
          )}
        </div>
        <div className="statistics-pie-legend">
          {segments.map((segment) => {
            const percent = segment.percent.toLocaleString("ru-RU", {
              maximumFractionDigits: 1,
            });
            return (
              <Hint
                key={segment.key}
                label={`${segment.label}: ${segment.count} (${percent}%)`}
              >
                <span className="statistics-pie-row">
                  <i style={{ background: segment.color }} />
                  <span>{segment.label}</span>
                  <strong>{segment.count}</strong>
                  <span className="muted">{percent}%</span>
                </span>
              </Hint>
            );
          })}
        </div>
      </div>
      {applications.length === 0 && (
        <p className="muted">
          Добавьте первую вакансию, чтобы увидеть распределение.
        </p>
      )}
    </section>
  );
}

export function Statistics({
  user,
  applications,
}: {
  user: User;
  applications: Application[];
}) {
  const [today, setToday] = useState(() => dateToday(user.timezone));
  useEffect(() => {
    setToday(dateToday(user.timezone));
    const timer = setInterval(() => setToday(dateToday(user.timezone)), 30000);
    return () => clearInterval(timer);
  }, [user.timezone]);
  return (
    <div className="statistics-page">
      <header>
        <h1>Статистика</h1>
        <p className="muted">
          Активность и ход поиска работы · часовой пояс: {user.timezone}
        </p>
      </header>
      <div className="statistics-overview">
        <Activity user={user} today={today} />
        <DailyChart applications={applications} today={today} />
      </div>
      <div className="statistics-pies">
        <PieChart
          applications={applications}
          kind="state"
          title="По состояниям"
        />
        <PieChart applications={applications} kind="stage" title="По этапам" />
      </div>
    </div>
  );
}
