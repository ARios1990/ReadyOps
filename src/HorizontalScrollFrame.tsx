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

    const syncScrollPosition = (source: HTMLDivElement, target: HTMLDivElement) => {
      const sourceRange = Math.max(0, source.scrollWidth - source.clientWidth);
      const targetRange = Math.max(0, target.scrollWidth - target.clientWidth);
      const nextScrollLeft = sourceRange
        ? (source.scrollLeft / sourceRange) * targetRange
        : 0;

      // Avoid producing a second scroll event when both frames are already aligned.
      if (Math.abs(target.scrollLeft - nextScrollLeft) > 0.5) {
        target.scrollLeft = nextScrollLeft;
      }
    };

    const onBodyScroll = () => {
      syncScrollPosition(body, top);
    };
    const onTopScroll = () => {
      syncScrollPosition(top, body);
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
      // The body may reserve width for its vertical scrollbar while the top
      // frame does not. Compensating for that gutter gives both horizontal
      // scrollbars the same range and prevents the right edge from snapping
      // back or becoming unreachable.
      const verticalScrollbarGutter = Math.max(0, top.clientWidth - body.clientWidth);
      setOverflow(overflows);
      setContentWidth(body.scrollWidth + verticalScrollbarGutter);
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
