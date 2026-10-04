import { clsx, type ClassValue } from 'clsx';
import { extendTailwindMerge } from 'tailwind-merge';

/**
 * Merge conditional class names, resolving conflicting Tailwind utilities in
 * favour of the last one supplied.
 */
/** The list type scale's sizes (`tokens.css`), so `text-ui` merges as a size, not a colour. */
const twMerge = extendTailwindMerge({ extend: { theme: { text: ['ui-lg', 'ui', 'ui-sm'] } } });

export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}

/**
 * What a renderer surface says when the bridge call itself failed, as opposed
 * to main refusing it. One sentence, so no surface phrases "the app is broken"
 * its own way.
 */
export const BRIDGE_ERROR = 'The app could not reach its own main process.';
