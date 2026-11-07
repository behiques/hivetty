import { buildQueries, queryAllByAttribute, screen, waitFor, type Matcher, type MatcherOptions } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

/**
 * `*ByTitle` for a `Hint`: finds the element by the `aria-description` its hint gives it.
 * The tooltip itself only renders on hover (`tests/components/ui/hint.test.tsx` proves that).
 */
const queryAllByHint = (container: HTMLElement, text: Matcher, options?: MatcherOptions) =>
  queryAllByAttribute('aria-description', container, text, options);

export const [queryByHint, getAllByHint, getByHint, findAllByHint, findByHint] = buildQueries(
  queryAllByHint,
  (_container, text) => `Found multiple elements with the hint: ${String(text)}`,
  (_container, text) => `Unable to find an element with the hint: ${String(text)}`,
);
export { queryAllByHint };

/**
 * What a `Hint` shows: hovers `element`, reads the tooltip, and moves away again.
 * For a hint that repeats the element's own name, which gets no `aria-description`.
 */
export async function hintOf(element: Element): Promise<string> {
  const user = userEvent.setup();
  await user.hover(element);
  const text = (await screen.findByRole('tooltip')).textContent ?? '';
  await user.unhover(element);
  // Closed, it unmounts; the next hover must not read this one.
  await waitFor(() => {
    if (screen.queryByRole('tooltip') !== null) throw new Error('the tooltip is still open');
  });
  return text;
}
