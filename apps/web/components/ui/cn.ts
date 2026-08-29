/**
 * Minimal class-name joiner. Accepts strings, falsy values, and arrays so
 * components can build conditional class lists without pulling in `clsx`.
 * It does not de-duplicate or resolve Tailwind conflicts; keep the last-wins
 * ordering in mind when composing.
 */
export type ClassValue = string | number | false | null | undefined | ClassValue[];

export function cn(...values: ClassValue[]): string {
  const out: string[] = [];
  for (const value of values) {
    if (!value && value !== 0) continue;
    if (Array.isArray(value)) {
      const nested = cn(...value);
      if (nested) out.push(nested);
    } else {
      out.push(String(value).trim());
    }
  }
  return out.filter(Boolean).join(' ');
}
