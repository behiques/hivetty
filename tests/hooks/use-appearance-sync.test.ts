import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useAppearanceSync } from '@/hooks/use-appearance-sync';
import { useAppearanceStore } from '@stores/appearance-store';

/**
 * The listed appearance fields between the window and main (HIVE-284): reported on mount and on change,
 * applied when main sends them. A field that does not sync reports nothing.
 */

let pushApply: ((fields: unknown) => void) | null = null;
const report = vi.fn(() => Promise.resolve());

beforeEach(() => {
  localStorage.clear();
  useAppearanceStore.getState().reset();
  report.mockClear();
  pushApply = null;
  (window as { hive?: unknown }).hive = {
    sync: {
      reportAppearance: report,
      onApplyAppearance: (cb: (fields: unknown) => void) => {
        pushApply = cb;
        return () => {
          pushApply = null;
        };
      },
    },
  };
});

afterEach(() => {
  delete (window as { hive?: unknown }).hive;
});

describe('useAppearanceSync', () => {
  it('reports the listed fields on mount', () => {
    renderHook(() => useAppearanceSync());
    expect(report).toHaveBeenCalledTimes(1);
    const [fields] = report.mock.calls[0] as unknown as [Record<string, unknown>];
    expect(Object.keys(fields).sort()).toEqual(
      [
        'activeThemeId',
        'density',
        'editorFont',
        'editorFontSize',
        'editorLineNumbers',
        'editorTabWidth',
        'editorWordWrap',
        'terminalFont',
        'terminalFontSize',
        'theme',
        'themes',
      ].sort(),
    );
    expect(fields.density).toBe('comfortable');
  });

  it('reports again when a listed field changes, and not for a panel width', () => {
    renderHook(() => useAppearanceSync());
    act(() => useAppearanceStore.getState().setDensity('compact'));
    expect(report).toHaveBeenCalledTimes(2);
    expect((report.mock.calls[1] as unknown as [Record<string, unknown>])[0].density).toBe('compact');
    act(() => useAppearanceStore.getState().setListPanelWidth(321));
    expect(report).toHaveBeenCalledTimes(2);
  });

  it('applies what main sends, and the report that follows is what main holds', () => {
    renderHook(() => useAppearanceSync());
    act(() => pushApply?.({ density: 'compact', theme: undefined }));
    expect(useAppearanceStore.getState().density).toBe('compact');
    expect((report.mock.calls.at(-1) as unknown as [Record<string, unknown>])[0].density).toBe('compact');
  });

  it('stops listening on unmount', () => {
    const { unmount } = renderHook(() => useAppearanceSync());
    unmount();
    expect(pushApply).toBeNull();
  });
});
