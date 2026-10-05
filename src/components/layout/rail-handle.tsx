import { useLayoutEffect, useState, type RefObject } from 'react';

import { SplitHandle } from '@components/ui/split-handle';
import { PANEL_WIDTHS, type PanelRail } from '@stores/appearance-store';

/** Half the handle's `w-3`: the ratio is the seam's centre, the stored width stops at its near edge. */
const HALF_HANDLE = 6;

interface RailHandleProps {
  /** The row the rails and the stage share: the handle's ratio is measured against it. */
  rowRef: RefObject<HTMLElement | null>;
  /** `list` sits on the row's left edge, `session` on its right. */
  rail: PanelRail;
  label: string;
  width: number;
  onWidth: (px: number) => void;
}

/**
 * The seam between a rail and the stage: the overmind's gutter-with-a-grip,
 * stood on its side. The store keeps pixels and `SplitHandle` speaks ratios of
 * its container, so this converts both ways against the row's width.
 */
export function RailHandle({ rowRef, rail, label, width, onWidth }: RailHandleProps) {
  // The observer stub in `tests/setup.ts` never calls back, so a unit test sees 0 and the slider's own 0–1 bounds.
  const [rowWidth, setRowWidth] = useState(0);

  useLayoutEffect(() => {
    const row = rowRef.current;
    if (row === null || typeof ResizeObserver === 'undefined') return undefined;
    const measure = () => {
      setRowWidth(row.getBoundingClientRect().width);
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(row);
    return () => {
      observer.disconnect();
    };
  }, [rowRef]);

  // The session rail grows leftwards, so its ratio runs the other way.
  const left = rail === 'list';
  const toRatio = (px: number) => (left ? px + HALF_HANDLE : rowWidth - px - HALF_HANDLE) / rowWidth;
  const { min, max, initial } = PANEL_WIDTHS[rail];
  const bounds = rowWidth > 0 ? { min: toRatio(left ? min : max), max: toRatio(left ? max : min) } : {};

  return (
    <SplitHandle
      axis="vertical"
      grip
      className="w-3 bg-bg"
      containerRef={rowRef}
      label={label}
      value={rowWidth > 0 ? toRatio(width) : 0}
      onValue={(ratio) => {
        // The live width, not the measured state: a drag's ratio is against the rect it read at pointerdown.
        const row = rowRef.current?.getBoundingClientRect().width ?? 0;
        if (row > 0) onWidth((left ? ratio * row : (1 - ratio) * row) - HALF_HANDLE);
      }}
      {...bounds}
      onReset={() => onWidth(initial)}
    />
  );
}
