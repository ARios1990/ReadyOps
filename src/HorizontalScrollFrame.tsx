import { useEffect, useRef, useState, type ReactNode } from "react";

type Props = {
  children: ReactNode;
  className?: string;
  ariaLabel?: string;
};

export function HorizontalScrollFrame({ children, className = "", ariaLabel }: Props) {
  const topRef = useRef<HTMLDivElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const [overflow, setOverflow] = useState(false);
  const [contentWidth, setContentWidth] = useState(0);

  useEffect(() => {
    const body = bodyRef.current;
    const top = topRef.current;
    if (!body || !top) return;

    let syncingFromTop = false;
    let syncingFromBody = false;

    const onBodyScroll = () => {
      if (syncingFromTop) return;
      syncingFromBody = true;
      top.scrollLeft = body.scrollLeft;
      syncingFromBody = false;
    };
    const onTopScroll = () => {
      if (syncingFromBody) return;
      syncingFromTop = true;
      body.scrollLeft = top.scrollLeft;
      syncingFromTop = false;
    };
    const onTopKey = (event: KeyboardEvent) => {
      const step = event.shiftKey ? 200 : 60;
      if (event.key === "ArrowLeft") {
        event.preventDefault();
        body.scrollLeft -= step;
      } else if (event.key === "ArrowRight") {
        event.preventDefault();
        body.scrollLeft += step;
      } else if (event.key === "Home") {
        event.preventDefault();
        body.scrollLeft = 0;
      } else if (event.key === "End") {
        event.preventDefault();
        body.scrollLeft = body.scrollWidth;
      }
    };

    const update = () => {
      const overflows = body.scrollWidth > body.clientWidth + 1;
      setOverflow(overflows);
      setContentWidth(body.scrollWidth);
    };

    body.addEventListener("scroll", onBodyScroll, { passive: true });
    top.addEventListener("scroll", onTopScroll, { passive: true });
    top.addEventListener("keydown", onTopKey);

    update();
    const resizeObserver = new ResizeObserver(update);
    resizeObserver.observe(body);
    Array.from(body.children).forEach((child) => resizeObserver.observe(child as Element));
    const mutationObserver = new MutationObserver(update);
    mutationObserver.observe(body, {
      childList: true,
      subtree: true,
      attributes: true,
      characterData: true,
    });
    window.addEventListener("resize", update);

    return () => {
      body.removeEventListener("scroll", onBodyScroll);
      top.removeEventListener("scroll", onTopScroll);
      top.removeEventListener("keydown", onTopKey);
      resizeObserver.disconnect();
      mutationObserver.disconnect();
      window.removeEventListener("resize", update);
    };
  }, []);

  return (
    <div className={`readyops-hscroll ${className}`}>
      <div
        ref={topRef}
        className="readyops-hscroll-top"
        role="scrollbar"
        aria-orientation="horizontal"
        aria-label={ariaLabel || "Horizontal scroll"}
        tabIndex={overflow ? 0 : -1}
        aria-hidden={!overflow}
        data-overflow={overflow ? "true" : "false"}
      >
        <div className="readyops-hscroll-top-track" style={{ width: contentWidth || 0 }} />
      </div>
      <div ref={bodyRef} className="readyops-hscroll-body" tabIndex={0}>
        {children}
      </div>
    </div>
  );
}
