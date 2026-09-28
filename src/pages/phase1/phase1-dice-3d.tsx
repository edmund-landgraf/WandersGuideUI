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

export function parseInitiativeDie(calculation: string | undefined) {
  if (!calculation) return null;
  const match = calculation.match(/d20\s*\((\d+)\)/i);
  if (!match) return null;
  const value = Number(match[1]);
  if (!Number.isFinite(value)) return null;
  return clampDie(value);
}

export function initiativeRoundDiceKey(round: { id?: string; round?: number; entries: Array<{ combatant_id?: string; calculation?: string }> } | undefined) {
  if (!round) return '';
  if (round.id) return round.id;
  return `${round.round ?? ''}:${round.entries.map((entry) => `${entry.combatant_id ?? ''}:${entry.calculation ?? ''}`).join('|')}`;
}

export function diceCheckOverlayTitle(dc: number, statLabel: string) {
  return `DC ${dc} vs ${statLabel}`;
}

export function diceRollLogKey(log: { id?: string; dc?: number; defaultStat?: string; entries: Array<{ combatant_id?: string; calculation?: string }> } | undefined) {
  if (!log) return '';
  if (log.id) return log.id;
  return `${log.dc ?? ''}:${log.defaultStat ?? ''}:${log.entries.map((entry) => `${entry.combatant_id ?? ''}:${entry.calculation ?? ''}`).join('|')}`;
}

export function dice3dThrowsFromCheckLog(
  log: { entries: Array<{ name: string; ally?: boolean; calculation?: string }> },
  labelName: (entry: { name: string; ally?: boolean }) => string = (entry) => entry.name,
): Dice3dThrow[] {
  return dice3dThrowsFromInitiativeRound(log, labelName);
}

export function dice3dThrowsFromInitiativeRound(
  round: { entries: Array<{ name: string; ally?: boolean; calculation?: string }> },
  labelName: (entry: { name: string; ally?: boolean }) => string = (entry) => entry.name,
): Dice3dThrow[] {
  return round.entries.flatMap((entry) => {
    const die = parseInitiativeDie(entry.calculation);
    if (die == null) return [];
    return [{ name: labelName(entry), die }];
  });
}

function dieScreenRadius(mesh: import('three').Object3D, camera: import('three').Camera, host: HTMLElement) {
  let best = 0;
  mesh.traverse((node) => {
    const geometry = (node as import('three').Mesh).geometry;
    if (!geometry) return;
    if (!geometry.boundingSphere) geometry.computeBoundingSphere();
    const sphere = geometry.boundingSphere;
    if (!sphere) return;
    const scale = new Vector3();
    node.getWorldScale(scale);
    best = Math.max(best, sphere.radius * Math.max(scale.x, scale.y, scale.z));
  });
  if (best <= 0) return 72;
  const center = new Vector3();
  mesh.getWorldPosition(center);
  const right = new Vector3().setFromMatrixColumn(camera.matrixWorld, 0).normalize();
  const edge = center.clone().addScaledVector(right, best);
  const a = project(mesh, camera, host);
  edge.project(camera);
  const b = {
    x: (edge.x * 0.5 + 0.5) * host.clientWidth,
    y: (-edge.y * 0.5 + 0.5) * host.clientHeight,
  };
  const radius = Math.hypot(b.x - a.x, b.y - a.y);
  return Number.isFinite(radius) && radius > 8 ? radius : 72;
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

/**
 * Sit the name on the die's screen-space edge so it clears the top-face number.
 * Prefer the right side; fall back to the left, then below, when the overlay edge is close.
 */
export function placeDiceLabelBeside(
  center: { x: number; y: number },
  radius: number,
  viewport: { width: number; height: number },
  label: { width: number; height: number },
  padding = 8,
) {
  const gap = 6;
  const reach = Math.max(0, radius) + gap;
  const rightX = center.x + reach;
  const leftX = center.x - reach - label.width;
  const rightFits = rightX + label.width <= viewport.width - padding;
  const leftFits = leftX >= padding;
  if (rightFits) return placeDiceLabel({ x: rightX, y: center.y }, viewport, label, padding);
  if (leftFits) return placeDiceLabel({ x: leftX, y: center.y }, viewport, label, padding);
  const belowY = center.y + reach + label.height / 2;
  const aboveY = center.y - reach - label.height / 2;
  const y = belowY + label.height / 2 <= viewport.height - padding ? belowY : aboveY;
  return placeDiceLabel({ x: center.x - label.width / 2, y }, viewport, label, padding);
}

export function Dice3dOverlay({ throws, title, onClose }: { throws: Dice3dThrow[]; title?: string; onClose: () => void }) {
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
        const radius = die?.mesh ? dieScreenRadius(die.mesh, roller.camera, box) : 72;
        const node = box.parentElement?.querySelector(`[data-dice-label="${index}"]`);
        const measured = node?.getBoundingClientRect();
        const placed = placeDiceLabelBeside(
          point,
          radius,
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
      {title && (
        <p className='pointer-events-none absolute inset-x-0 top-6 z-10 text-center text-2xl font-semibold tracking-wide text-white drop-shadow'>
          {title}
        </p>
      )}
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
