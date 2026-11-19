import { useEffect, useLayoutEffect, useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

type Point = { left: number; top: number };

const POPOUT_MARGIN = 12;
const POPOUT_WIDTH = 360;

function placeNear(node: HTMLElement): Point {
  const rect = node.getBoundingClientRect();
  const maxHeight = Math.min(window.innerHeight * 0.5, 420);
  const left = Math.max(POPOUT_MARGIN, Math.min(rect.left, window.innerWidth - POPOUT_WIDTH - POPOUT_MARGIN));
  const roomBelow = window.innerHeight - rect.bottom - POPOUT_MARGIN;
  const roomAbove = rect.top - POPOUT_MARGIN;
  const top = roomBelow < maxHeight && roomAbove > roomBelow
    ? Math.max(POPOUT_MARGIN, rect.top - 6 - Math.min(maxHeight, roomAbove))
    : rect.bottom + 6;
  return { left, top };
}

function fitInViewport(card: HTMLElement, pos: Point): Point {
  const rect = card.getBoundingClientRect();
  const height = Math.min(rect.height, window.innerHeight - POPOUT_MARGIN * 2);
  const width = Math.min(rect.width, window.innerWidth - POPOUT_MARGIN * 2);
  return {
    left: Math.round(Math.max(POPOUT_MARGIN, Math.min(pos.left, window.innerWidth - width - POPOUT_MARGIN))),
    top: Math.round(Math.max(POPOUT_MARGIN, Math.min(pos.top, window.innerHeight - height - POPOUT_MARGIN))),
  };
}

export function ShopPopout({
  label,
  href,
  cardClassName,
  titleClassName,
  children,
}: {
  label: string;
  href?: string;
  cardClassName: string;
  titleClassName: string;
  children: ReactNode;
}) {
  const anchor = useRef<HTMLElement | null>(null);
  const cardRef = useRef<HTMLDivElement | null>(null);
  const showTimer = useRef(0);
  const hideTimer = useRef(0);
  const pinned = useRef(false);
  const [open, setOpen] = useState(false);
  const [stuck, setStuck] = useState(false);
  const [pos, setPos] = useState<Point>({ left: 12, top: 12 });

  const clearTimers = () => {
    window.clearTimeout(showTimer.current);
    window.clearTimeout(hideTimer.current);
  };
  const show = () => {
    const node = anchor.current;
    if (!node || pinned.current) return;
    setPos(placeNear(node));
    setOpen(true);
  };
  const hideSoon = () => {
    if (pinned.current) return;
    clearTimers();
    hideTimer.current = window.setTimeout(() => setOpen(false), 120);
  };
  const stick = (at?: Point) => {
    if (!pinned.current) {
      const node = anchor.current;
      if (at) setPos(at);
      else if (node) setPos(placeNear(node));
    }
    pinned.current = true;
    setStuck(true);
    setOpen(true);
  };
  useEffect(() => () => clearTimers(), []);
  useLayoutEffect(() => {
    if (!open) return;
    const card = cardRef.current;
    if (!card) return;
    const fit = () => {
      const rect = card.getBoundingClientRect();
      const next = fitInViewport(card, { left: rect.left, top: rect.top });
      setPos((current) => (current.left === next.left && current.top === next.top ? current : next));
    };
    fit();
    const observer = new ResizeObserver(fit);
    observer.observe(card);
    window.addEventListener('resize', fit);
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', fit);
    };
  }, [open]);
  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      pinned.current = false;
      setStuck(false);
      setOpen(false);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open]);

  function startDrag(event: ReactPointerEvent<HTMLElement>) {
    event.preventDefault();
    const card = event.currentTarget.closest('[data-shop-popout]') as HTMLElement | null;
    const rect = card?.getBoundingClientRect();
    const originX = rect?.left ?? pos.left;
    const originY = rect?.top ?? pos.top;
    stick(rect ? { left: rect.left, top: rect.top } : undefined);
    const startX = event.clientX;
    const startY = event.clientY;
    const move = (ev: PointerEvent) => {
      setPos({
        left: Math.max(8, originX + ev.clientX - startX),
        top: Math.max(8, originY + ev.clientY - startY),
      });
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  }

  const labelClass = 'text-left underline decoration-white/25 underline-offset-2 hover:decoration-white/70';
  const hover = {
    onMouseEnter: () => {
      if (pinned.current) return;
      clearTimers();
      showTimer.current = window.setTimeout(show, 250);
    },
    onMouseLeave: hideSoon,
    onFocus: show,
    onBlur: hideSoon,
  };

  return (
    <>
      {href ? (
        <a
          ref={(node) => { anchor.current = node; }}
          className={labelClass}
          href={href}
          target='_blank'
          rel='noreferrer'
          onClick={(event) => {
            event.preventDefault();
            stick();
          }}
          {...hover}
        >
          {label}
        </a>
      ) : (
        <button ref={(node) => { anchor.current = node; }} type='button' className={labelClass} onClick={() => stick()} {...hover}>
          {label}
        </button>
      )}
      {open && createPortal(
        <div
          ref={cardRef}
          data-shop-popout
          className={cardClassName}
          style={{ position: 'fixed', zIndex: 40, left: pos.left, top: pos.top, maxHeight: `min(420px, calc(100vh - ${POPOUT_MARGIN * 2}px))` }}
          onMouseEnter={clearTimers}
          onMouseLeave={hideSoon}
        >
          <header className='mb-2 flex items-start gap-2'>
            <span
              className='cursor-grab select-none px-0.5 text-xs leading-5 tracking-tight active:cursor-grabbing'
              title='Drag'
              onPointerDown={startDrag}
            >
              ⋮⋮
            </span>
            <p className={`min-w-0 flex-1 ${titleClassName}`}>{label}</p>
            {stuck && (
              <button type='button' className='text-xs underline opacity-70' onClick={() => {
                pinned.current = false;
                setStuck(false);
                setOpen(false);
              }}>
                Close
              </button>
            )}
          </header>
          {href && (
            <a className='mb-2 inline-block text-xs underline' href={href} target='_blank' rel='noreferrer' title='Archives of Nethys'>
              aon
            </a>
          )}
          {children}
        </div>,
        document.body,
      )}
    </>
  );
}
