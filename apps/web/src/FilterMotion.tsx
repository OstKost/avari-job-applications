import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";

const reducedMotion = () =>
  window.matchMedia("(prefers-reduced-motion: reduce)").matches;

// Keep the outgoing rows in the table until the short exit cascade completes.
export function TableRowsMotion({
  transitionKey,
  children,
  cards = false,
}: {
  transitionKey: string;
  children: ReactNode;
  cards?: boolean;
}) {
  const [displayedKey, setDisplayedKey] = useState(transitionKey);
  const retained = useRef(children);
  useLayoutEffect(() => {
    if (displayedKey === transitionKey) retained.current = children;
  });
  useLayoutEffect(() => {
    if (displayedKey === transitionKey) return;
    if (reducedMotion()) {
      setDisplayedKey(transitionKey);
      return;
    }
    const timer = window.setTimeout(() => setDisplayedKey(transitionKey), 260);
    return () => window.clearTimeout(timer);
  }, [transitionKey, displayedKey]);
  const exiting = displayedKey !== transitionKey;
  const Tag = cards ? "div" : "tbody";
  return (
    <Tag
      key={displayedKey}
      className={`table-rows-motion${cards ? " application-cards cards-page-layer" : ""}${exiting ? " exiting" : ""}`}
      inert={exiting}
    >
      {exiting ? retained.current : children}
    </Tag>
  );
}

// Retain the previous content until its exit animation finishes.
export function FilterPresence({
  show,
  children,
  block = false,
}: {
  show: boolean;
  children: ReactNode;
  block?: boolean;
}) {
  const [mounted, setMounted] = useState(show);
  const previous = useRef(children);
  useLayoutEffect(() => {
    if (show) previous.current = children;
  }, [show, children]);
  useEffect(() => {
    if (show) {
      setMounted(true);
      return;
    }
    if (reducedMotion()) {
      setMounted(false);
      return;
    }
    const timer = window.setTimeout(() => setMounted(false), 160);
    return () => window.clearTimeout(timer);
  }, [show]);
  if (!show && !mounted) return null;
  const Tag = block ? "div" : "span";
  return (
    <Tag
      className={`filter-presence${block ? " filter-presence-block" : ""}${show ? "" : " exiting"}`}
      inert={!show}
      aria-hidden={!show || undefined}
    >
      {show ? children : previous.current}
    </Tag>
  );
}

export function FilterModalMotion({ children }: { children: ReactNode }) {
  const content = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const node = content.current;
    const dialog = node?.closest("dialog");
    if (!node || !dialog) return;
    let previousHeight = dialog.getBoundingClientRect().height;
    let animation: Animation | undefined;
    const observer = new ResizeObserver(() => {
      const currentHeight =
        animation?.playState === "running"
          ? dialog.getBoundingClientRect().height
          : previousHeight;
      animation?.cancel();
      const nextHeight = dialog.getBoundingClientRect().height;
      if (!reducedMotion() && Math.abs(nextHeight - previousHeight) > 1) {
        animation = dialog.animate(
          [{ height: `${currentHeight}px` }, { height: `${nextHeight}px` }],
          { duration: 240, easing: "cubic-bezier(0.22, 1, 0.36, 1)" },
        );
      }
      previousHeight = nextHeight;
    });
    observer.observe(node);
    return () => {
      observer.disconnect();
      animation?.cancel();
    };
  }, []);
  return (
    <div ref={content} className="spotlight-container">
      {children}
    </div>
  );
}
