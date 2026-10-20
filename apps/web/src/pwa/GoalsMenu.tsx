import { useId, useRef, useState } from "react";
import { Target, X } from "lucide-react";
import type { Transport } from "@avari/shared";
import { DailyGoal } from "./DailyGoal";

export function GoalsMenu({
  userId,
  api,
  collapsed = false,
  mobile = false,
}: {
  userId: string;
  api: Transport;
  collapsed?: boolean;
  mobile?: boolean;
}) {
  const id = useId();
  const panel = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState({ left: 0, top: 0 });

  return (
    <>
      <button
        type="button"
        className={`goals-menu-trigger${mobile ? " mobile-drawer-link" : ""}${open ? " active" : ""}`}
        aria-label="Цели"
        title={collapsed ? "Цели" : undefined}
        aria-expanded={open}
        aria-controls={id}
        aria-haspopup="dialog"
        popoverTarget={id}
        popoverTargetAction="toggle"
        onClick={(event) => {
          const rect = event.currentTarget.getBoundingClientRect();
          const width = Math.min(380, window.innerWidth - 32);
          setPosition({
            left: mobile
              ? (window.innerWidth - width) / 2
              : Math.min(rect.right + 12, window.innerWidth - width - 16),
            top: Math.max(16, Math.min(rect.top, window.innerHeight - 340)),
          });
        }}
      >
        <Target size={mobile ? 20 : 18} />
        <span className={collapsed && !mobile ? "sr-only" : undefined}>
          Цели
        </span>
      </button>
      <div
        id={id}
        ref={panel}
        popover="auto"
        role="dialog"
        aria-label="Цели на сегодня"
        className="goals-popover"
        style={position}
        onToggle={(event) => setOpen(event.newState === "open")}
      >
        <div className="goals-popover-heading">
          <span>Цели на сегодня</span>
          <button
            type="button"
            className="icon-button"
            aria-label="Закрыть цели"
            onClick={() => panel.current?.hidePopover()}
          >
            <X size={18} />
          </button>
        </div>
        {open && <DailyGoal userId={userId} api={api} />}
      </div>
    </>
  );
}
