import { DiceRoller } from 'open-dice-dnd';
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Vector3 } from 'three';

export type Dice3dThrow = { name: string; die: number };

export const DICE_HIT_SOUNDS = [
  '/dice/plastic-1.mp3',
  '/dice/plastic-2.mp3',
  '/dice/plastic-3.mp3',
  '/dice/plastic-4.mp3',
  '/dice/plastic-5.mp3',
  '/dice/plastic-6.mp3',
];

const PALETTE: Array<{ diceColor: number; textColor: string; backgroundColor: string }> = [
  { diceColor: 0x2e6b8a, textColor: '#ffffff', backgroundColor: '#164e63' },
  { diceColor: 0x6b3d8a, textColor: '#ffffff', backgroundColor: '#581c87' },
  { diceColor: 0x8a5a2e, textColor: '#fff8e7', backgroundColor: '#7c3f12' },
  { diceColor: 0x2e8a5a, textColor: '#ffffff', backgroundColor: '#14532d' },
  { diceColor: 0x8a2e3d, textColor: '#ffffff', backgroundColor: '#7f1d1d' },
  { diceColor: 0x2e4a8a, textColor: '#e8f0ff', backgroundColor: '#1e3a8a' },
  { diceColor: 0x8a7a2e, textColor: '#1a1508', backgroundColor: '#854d0e' },
  { diceColor: 0x5a8a2e, textColor: '#f7fee7', backgroundColor: '#3f6212' },
  { diceColor: 0x8a2e7a, textColor: '#ffffff', backgroundColor: '#9d174d' },
  { diceColor: 0x2e8a8a, textColor: '#ffffff', backgroundColor: '#115e59' },
];

export function clampDie(value: number) {
  if (!Number.isFinite(value)) return 1;
  return Math.min(20, Math.max(1, Math.round(value)));
}

export function dice3dRollConfig(throws: Dice3dThrow[]) {
  return throws.map((item, index) => ({
    dice: 'd20' as const,
    rolled: clampDie(item.die),
    ...PALETTE[index % PALETTE.length],
  }));
}

function project(mesh: { getWorldPosition: (target: Vector3) => Vector3 }, camera: import('three').Camera, host: HTMLElement) {
  const vector = new Vector3();
  mesh.getWorldPosition(vector);
  vector.project(camera);
  return {
    x: (vector.x * 0.5 + 0.5) * host.clientWidth,
    y: (-vector.y * 0.5 + 0.5) * host.clientHeight,
  };
}

/** Keep a label box inside the overlay. `top` is the vertical center (`-translate-y-1/2`). */
export function placeDiceLabel(
  anchor: { x: number; y: number },
  viewport: { width: number; height: number },
  label: { width: number; height: number },
  padding = 8,
) {
  const minX = padding;
  const maxX = Math.max(minX, viewport.width - padding - label.width);
  const halfH = label.height / 2;
  const minY = padding + halfH;
  const maxY = Math.max(minY, viewport.height - padding - halfH);
  return {
    x: Math.min(Math.max(anchor.x, minX), maxX),
    y: Math.min(Math.max(anchor.y, minY), maxY),
  };
}

export function Dice3dOverlay({ throws, onClose }: { throws: Dice3dThrow[]; onClose: () => void }) {
  const hostRef = useRef<HTMLDivElement>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const [labels, setLabels] = useState<Array<{ name: string; x: number; y: number }>>([]);

  useEffect(() => {
    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === 'Escape') onCloseRef.current();
    }
    document.addEventListener('keydown', closeOnEscape);
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', closeOnEscape);
      document.body.style.overflow = overflow;
    };
  }, []);

  useEffect(() => {
    const host = hostRef.current;
    if (!host || throws.length === 0) return;
    const box = host;
    const roller = new DiceRoller({
      container: box,
      width: box.clientWidth || window.innerWidth,
      height: box.clientHeight || window.innerHeight,
      sounds: DICE_HIT_SOUNDS,
      soundVolume: 0.7,
    });
    let cancelled = false;
    let raf = 0;
    const started = performance.now();

    function syncLabels() {
      const viewport = { width: box.clientWidth, height: box.clientHeight };
      const next = throws.map((item, index) => {
        const die = roller.dice[index];
        const point = die?.mesh ? project(die.mesh, roller.camera, box) : { x: viewport.width / 2, y: viewport.height / 2 };
        const node = box.parentElement?.querySelector(`[data-dice-label="${index}"]`);
        const measured = node?.getBoundingClientRect();
        const placed = placeDiceLabel(
          { x: point.x + 28, y: point.y - 8 },
          viewport,
          { width: measured?.width ?? Math.min(280, item.name.length * 7.2 + 16), height: measured?.height ?? 22 },
        );
        return { name: item.name, x: placed.x, y: placed.y };
      });
      setLabels(next);
      raf = requestAnimationFrame(syncLabels);
    }

    void (async () => {
      try {
        await roller.roll(dice3dRollConfig(throws));
      } catch {
        if (!cancelled) onCloseRef.current();
        return;
      }
      const wait = 2000 - (performance.now() - started);
      if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
      if (cancelled) return;
      syncLabels();
    })();

    return () => {
      cancelled = true;
      cancelAnimationFrame(raf);
      roller.destroy();
    };
  }, [throws]);

  return createPortal(
    <div
      className='fixed inset-0 z-[220] bg-[#1a1814]/90'
      role='presentation'
      onClick={() => onClose()}
    >
      <div ref={hostRef} className='absolute inset-0 [&>canvas]:block [&>canvas]:h-full [&>canvas]:w-full' />
      {labels.map((label, index) => (
        <span
          key={`${label.name}-${index}`}
          data-dice-label={index}
          className='pointer-events-none absolute max-w-[calc(100vw-16px)] -translate-y-1/2 truncate rounded bg-black/70 px-2 py-0.5 text-xs font-semibold text-white shadow'
          style={{ left: label.x, top: label.y }}
        >
          {label.name}
        </span>
      ))}
    </div>,
    document.body
  );
}
