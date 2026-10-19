import React from "react";
import { useQuery } from "@tanstack/react-query";
import type { Transport } from "@avari/shared";
import "./push-settings.css";

export interface DailyGoalProps {
  userId: string;
  api: Transport;
}

export interface DailySummaryData {
  today: string;
  timezone: string;
  goal: number;
  added: number;
  applied: number;
  completedTasks: number;
  completedInterviews: number;
  total: number;
  plannedTasks: number;
  plannedInterviews: number;
  completedTodayTasks: number;
  completedTodayInterviews: number;
}

/**
 * Returns the query key for the daily summary query.
 * Integrators can use this helper to invalidate or refetch the daily summary cache:
 * queryClient.invalidateQueries({ queryKey: getDailySummaryQueryKey(userId) })
 */
export function getDailySummaryQueryKey(
  userId: string,
): readonly [string, string] {
  return ["daily-summary", userId] as const;
}

/**
 * Pluralizes word for Russian language rules: 1 цель, 2 цели, 5 целей
 */
function pluralizeRussian(
  count: number,
  one: string,
  few: string,
  many: string,
): string {
  const abs = Math.abs(count) % 100;
  const num = abs % 10;
  if (abs > 10 && abs < 20) return many;
  if (num > 1 && num < 5) return few;
  if (num === 1) return one;
  return many;
}

export function DailyGoal({ userId, api }: DailyGoalProps) {
  const queryKey = getDailySummaryQueryKey(userId);

  const { data, isLoading, isError, refetch } = useQuery<DailySummaryData>({
    queryKey,
    queryFn: async () => {
      return await api<DailySummaryData>("/daily-summary", "GET");
    },
    // Bounded retry behavior, respects queryClient settings
    staleTime: 60 * 1000,
  });

  if (isLoading) {
    return (
      <div className="daily-goal-card" data-testid="daily-goal-card">
        <div className="daily-goal-header">
          <div className="daily-goal-title-wrap">
            <h3>Ежедневная цель</h3>
          </div>
        </div>
        <div className="daily-goal-subtitle">Загрузка данных...</div>
      </div>
    );
  }

  if (isError || !data) {
    return (
      <div className="daily-goal-card" data-testid="daily-goal-card">
        <div className="daily-goal-header">
          <div className="daily-goal-title-wrap">
            <h3>Ежедневная цель</h3>
            <span className="daily-goal-badge push-badge-inactive">
              Недоступно
            </span>
          </div>
          <button
            type="button"
            className="push-btn push-btn-outline"
            style={{ padding: "4px 8px", fontSize: 11 }}
            onClick={() => refetch()}
            data-testid="daily-goal-retry"
          >
            Повторить
          </button>
        </div>
        <div className="daily-goal-subtitle">
          Данные о цели временно недоступны. Повторите попытку позже.
        </div>
      </div>
    );
  }

  const {
    goal = 10,
    total = 0,
    added = 0,
    applied = 0,
    completedTasks = 0,
    completedInterviews = 0,
    plannedTasks = 0,
    plannedInterviews = 0,
  } = data;

  const targetGoal = goal > 0 ? goal : 10;
  const progressPercent = Math.min(100, Math.round((total / targetGoal) * 100));
  const remaining = Math.max(0, targetGoal - total);

  let encouragementText = "";
  if (total >= targetGoal) {
    encouragementText = "🎉 Отличный результат! Дневная цель выполнена!";
  } else {
    encouragementText = `Осталось выполнить ${remaining} ${pluralizeRussian(
      remaining,
      "действие",
      "действия",
      "действий",
    )} до цели.`;
  }

  return (
    <div className="daily-goal-card" data-testid="daily-goal-card">
      <div className="daily-goal-header">
        <div className="daily-goal-title-wrap">
          <h3>Ежедневная цель</h3>
          {total >= targetGoal ? (
            <span className="daily-goal-badge push-badge-active">
              Выполнена
            </span>
          ) : (
            <span className="daily-goal-badge push-badge-inactive">
              В процессе
            </span>
          )}
        </div>
        <div className="daily-goal-score" data-testid="daily-goal-score">
          {total}
          <span className="daily-goal-target">/{targetGoal}</span>
        </div>
      </div>

      <div
        className="daily-goal-progress-wrap"
        role="progressbar"
        aria-valuenow={Math.min(targetGoal, Math.max(0, total))}
        aria-valuemin={0}
        aria-valuemax={targetGoal}
        aria-label="Прогресс дневной цели"
      >
        <div
          className="daily-goal-progress-bar"
          style={{ width: `${progressPercent}%` }}
          data-testid="daily-goal-progress-bar"
        />
      </div>

      <div className="daily-goal-stats">
        <div className="daily-goal-stat-item">
          <span className="daily-goal-stat-label">Отклики</span>
          <span className="daily-goal-stat-val">{applied}</span>
        </div>
        <div className="daily-goal-stat-item">
          <span className="daily-goal-stat-label">Добавлено</span>
          <span className="daily-goal-stat-val">{added}</span>
        </div>
        <div className="daily-goal-stat-item">
          <span className="daily-goal-stat-label">Интервью</span>
          <span className="daily-goal-stat-val">
            {completedInterviews}
            {plannedInterviews > 0 ? ` (${plannedInterviews})` : ""}
          </span>
        </div>
        <div className="daily-goal-stat-item">
          <span className="daily-goal-stat-label">Задачи</span>
          <span className="daily-goal-stat-val">
            {completedTasks}
            {plannedTasks > 0 ? ` (${plannedTasks})` : ""}
          </span>
        </div>
      </div>

      <div
        className="daily-goal-encouragement"
        data-testid="daily-goal-encouragement"
      >
        {encouragementText}
      </div>
    </div>
  );
}
export default DailyGoal;
