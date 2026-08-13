import type { CSSProperties, ReactNode } from 'react';
import { ActionCost } from '@schemas/content';
import { ActionGlyphId, resolveActionGlyph } from '@utils/actions';

interface ActionGlyphProps {
  symbol: ActionGlyphId;
  size?: string | number;
  color?: string;
  label?: string;
}

const GLYPH_ASPECT: Record<ActionGlyphId, number> = {
  1: 14 / 10,
  2: 22 / 10,
  3: 30 / 10,
  4: 14 / 10,
  5: 1,
};

function OneActionGlyph() {
  return (
    <svg viewBox='0 0 14 10' width='100%' height='100%' aria-hidden='true' focusable='false'>
      <polygon fill='currentColor' points='1,5 4,1 10,1 13,5 10,9 4,9' />
    </svg>
  );
}

function TwoActionsGlyph() {
  return (
    <svg viewBox='0 0 22 10' width='100%' height='100%' aria-hidden='true' focusable='false'>
      <polygon fill='currentColor' points='1,5 4,1 10,1 13,5 10,9 4,9' />
      <polygon fill='currentColor' points='9,5 12,1 18,1 21,5 18,9 12,9' />
    </svg>
  );
}

function ThreeActionsGlyph() {
  return (
    <svg viewBox='0 0 30 10' width='100%' height='100%' aria-hidden='true' focusable='false'>
      <polygon fill='currentColor' points='1,5 4,1 10,1 13,5 10,9 4,9' />
      <polygon fill='currentColor' points='9,5 12,1 18,1 21,5 18,9 12,9' />
      <polygon fill='currentColor' points='17,5 20,1 26,1 29,5 26,9 20,9' />
    </svg>
  );
}

function FreeActionGlyph() {
  return (
    <svg viewBox='0 0 14 10' width='100%' height='100%' aria-hidden='true' focusable='false'>
      <polygon
        fill='none'
        stroke='currentColor'
        strokeWidth='1.35'
        strokeLinejoin='round'
        points='1.7,5 4.4,1.65 9.6,1.65 12.3,5 9.6,8.35 4.4,8.35'
      />
    </svg>
  );
}

function ReactionGlyph() {
  return (
    <svg viewBox='0 0 14 14' width='100%' height='100%' aria-hidden='true' focusable='false'>
      <path
        fill='none'
        stroke='currentColor'
        strokeWidth='1.85'
        strokeLinecap='round'
        d='M5.1 3.05a5.15 5.15 0 1 1-1.35 7.35'
      />
      <path fill='currentColor' d='M5.15 3.05 L1.55 4.35 L5.55 7.15 Z' />
    </svg>
  );
}

function renderGlyph(symbol: ActionGlyphId) {
  switch (symbol) {
    case 1:
      return <OneActionGlyph />;
    case 2:
      return <TwoActionsGlyph />;
    case 3:
      return <ThreeActionsGlyph />;
    case 4:
      return <FreeActionGlyph />;
    case 5:
      return <ReactionGlyph />;
  }
}

function toCssColor(color?: string) {
  if (color == null || color === '') return 'currentColor';
  const value = String(color);
  if (
    value.startsWith('#') ||
    value.startsWith('rgb') ||
    value.startsWith('hsl') ||
    value.startsWith('var(') ||
    value.includes(' ')
  ) {
    return value;
  }
  const [name, shade] = value.split('.');
  if (shade) return `var(--mantine-color-${name}-${shade}, currentColor)`;
  if (/^[a-zA-Z][\w-]*$/.test(name)) {
    return `var(--mantine-color-${name}-filled, var(--mantine-color-${name}-6, currentColor))`;
  }
  return value;
}

function toCssSize(value?: string | number) {
  if (value == null) return undefined;
  if (typeof value === 'number') return `${value}px`;
  return value;
}

export function ActionGlyph(props: ActionGlyphProps) {
  const label = props.label ?? resolveActionGlyph(props.symbol)?.label ?? 'Action';
  const height = typeof props.size === 'number' ? `${props.size}px` : (props.size ?? '20px');

  return (
    <span
      title={label}
      aria-label={label}
      style={{
        display: 'inline-flex',
        color: toCssColor(props.color),
        height,
        width: `calc(${height} * ${GLYPH_ASPECT[props.symbol]})`,
        flexShrink: 0,
        alignItems: 'center',
        verticalAlign: 'middle',
      }}
    >
      {renderGlyph(props.symbol)}
    </span>
  );
}

interface ActionSymbolProps {
  cost: ActionCost | string | number | null | undefined;
  gap?: number;
  size?: string | number;
  c?: string;
  pl?: string | number;
  style?: CSSProperties;
  className?: string;
  textProps?: { size?: string | number; c?: string };
}

function RangeGlyphs(props: {
  children: ReactNode;
  gap?: number;
  color?: string;
  pl?: string | number;
  style?: CSSProperties;
  className?: string;
}) {
  return (
    <span
      className={props.className}
      style={{
        display: 'inline-flex',
        flexWrap: 'nowrap',
        alignItems: 'center',
        gap: props.gap ?? 6,
        color: toCssColor(props.color),
        paddingLeft: toCssSize(props.pl),
        ...props.style,
      }}
    >
      {props.children}
    </span>
  );
}

function RangeLabel(props: { children: ReactNode; color?: string; textProps?: ActionSymbolProps['textProps'] }) {
  const size = props.textProps?.size;
  return (
    <span
      style={{
        color: toCssColor(props.textProps?.c ?? props.color),
        fontSize: size === 'xs' ? '0.75rem' : size === 'sm' ? '0.875rem' : toCssSize(typeof size === 'number' || typeof size === 'string' ? size : undefined),
      }}
    >
      {props.children}
    </span>
  );
}

export function ActionSymbol(props: ActionSymbolProps) {
  const { cost, gap, size, textProps, c, pl, style, className } = props;
  const glyph = resolveActionGlyph(cost ?? undefined);

  if (glyph) {
    return <ActionGlyph symbol={glyph.id} size={size} color={c} label={glyph.label} />;
  }

  const range = (content: ReactNode) => (
    <RangeGlyphs gap={gap} color={c} pl={pl} style={style} className={className}>
      {content}
    </RangeGlyphs>
  );

  switch (cost) {
    case 'ONE-TO-TWO-ACTIONS':
      return range(
        <>
          <ActionGlyph symbol={1} size={size} color={c} />
          <RangeLabel color={c} textProps={textProps}>
            to
          </RangeLabel>
          <ActionGlyph symbol={2} size={size} color={c} />
        </>
      );
    case 'ONE-TO-THREE-ACTIONS':
      return range(
        <>
          <ActionGlyph symbol={1} size={size} color={c} />
          <RangeLabel color={c} textProps={textProps}>
            to
          </RangeLabel>
          <ActionGlyph symbol={3} size={size} color={c} />
        </>
      );
    case 'TWO-TO-THREE-ACTIONS':
      return range(
        <>
          <ActionGlyph symbol={2} size={size} color={c} />
          <RangeLabel color={c} textProps={textProps}>
            to
          </RangeLabel>
          <ActionGlyph symbol={3} size={size} color={c} />
        </>
      );
    case 'TWO-TO-TWO-ROUNDS':
      return range(
        <>
          <ActionGlyph symbol={2} size={size} color={c} />
          <RangeLabel color={c} textProps={textProps}>
            to 2 rounds
          </RangeLabel>
        </>
      );
    case 'THREE-TO-TWO-ROUNDS':
      return range(
        <>
          <ActionGlyph symbol={3} size={size} color={c} />
          <RangeLabel color={c} textProps={textProps}>
            to 2 rounds
          </RangeLabel>
        </>
      );
    case 'TWO-TO-THREE-ROUNDS':
      return range(
        <>
          <ActionGlyph symbol={2} size={size} color={c} />
          <RangeLabel color={c} textProps={textProps}>
            to 3 rounds
          </RangeLabel>
        </>
      );
    case 'THREE-TO-THREE-ROUNDS':
      return range(
        <>
          <ActionGlyph symbol={3} size={size} color={c} />
          <RangeLabel color={c} textProps={textProps}>
            to 3 rounds
          </RangeLabel>
        </>
      );
    default:
      return null;
  }
}
