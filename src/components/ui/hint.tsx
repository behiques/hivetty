import { cloneElement, type ReactElement, type ReactNode } from 'react';

import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@components/ui/tooltip';

/**
 * The app's hover hint: the `Tooltip` atom around one element, in place of a native `title`.
 *
 * `asChild` merges the trigger onto `children`, so no wrapper lands in the markup and a hint can
 * sit inside a row that is itself a `<button>`. No `label` draws `children` alone, which is what a
 * conditional `title={x ? reason : undefined}` meant.
 *
 * Each hint carries its own provider so it renders anywhere, a test's bare `render` included.
 * Radix's default `delayDuration` is `0`, which fires on incidental mouse transit across a strip
 * of icon buttons; `300` is the app's. A hint closes when the pointer leaves its element, as
 * `title` did: there is nothing in one to move onto.
 *
 * A string label is also the element's `aria-description`, which is what `title` gave a screen
 * reader; Radix's own `aria-describedby` only exists while the tooltip is open. A label the element
 * is already named by is not repeated.
 *
 * A `disabled` button still opens it: Electron's Chromium dispatches pointer events to one and
 * React blocks only its mouse events, and Radix opens on `pointermove`. A `pointer-events-none`
 * trigger never opens.
 */
export function Hint({
  label,
  children,
}: {
  label?: ReactNode;
  children: ReactElement<{ 'aria-label'?: string; 'aria-description'?: string }>;
}) {
  if (label === undefined || label === null || label === '') return children;
  const described =
    typeof label === 'string' && children.props['aria-label'] !== label
      ? cloneElement(children, { 'aria-description': label })
      : children;
  return (
    <TooltipProvider delayDuration={300} disableHoverableContent>
      <Tooltip>
        <TooltipTrigger asChild>{described}</TooltipTrigger>
        <TooltipContent className="max-w-xs">{label}</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
