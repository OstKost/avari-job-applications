import {
  useEffect,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import { useLocation, type Location } from "react-router-dom";

const reducedMotion = () =>
  window.matchMedia("(prefers-reduced-motion: reduce)").matches;
const subscribeMotion = (listener: () => void) => {
  const preference = window.matchMedia("(prefers-reduced-motion: reduce)");
  preference.addEventListener("change", listener);
  return () => preference.removeEventListener("change", listener);
};

// Keep the previous route mounted for its short exit, then mount the next route.
// Cancel the exit when navigation changes again, so rapid clicks show the latest page.
export function PageTransition({
  children,
}: {
  children: (location: Location) => ReactNode;
}) {
  const location = useLocation();
  const reduceMotion = useSyncExternalStore(subscribeMotion, reducedMotion);
  const [displayed, setDisplayed] = useState(location);
  const exiting = !reduceMotion && displayed.pathname !== location.pathname;

  useEffect(() => {
    if (reduceMotion || displayed.pathname === location.pathname) {
      setDisplayed(location);
      return;
    }
    const timer = window.setTimeout(() => setDisplayed(location), 120);
    return () => window.clearTimeout(timer);
  }, [location, displayed.pathname, reduceMotion]);

  const current = reduceMotion ? location : displayed;
  return (
    <div
      className={"page-transition" + (exiting ? " page-transition-exit" : "")}
      inert={exiting}
      aria-busy={exiting}
    >
      <div className="page-content" key={current.pathname}>
        {children(current)}
      </div>
    </div>
  );
}
