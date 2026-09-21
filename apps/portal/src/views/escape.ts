/**
 * The one escaping helper, and the tagged template that makes it impossible to forget.
 *
 * Every page in `./pages.ts` is built with the `html` tag, which escapes **every** interpolation.
 * The only way to put markup into a page is `raw(...)`, which is greppable: if a review wants to
 * know where unescaped output can enter, the answer is every call site of `raw` and nowhere else.
 *
 * That matters more here than in most server-rendered pages, because half the values on these
 * screens arrive from a query string that an attacker chooses: `state` is opaque and echoed,
 * `user_code` is typed by the user, `tenant_hint` comes off a branded build, and the e-mail is
 * whatever was posted. `src/views/views.test.ts` drives each of those with a payload.
 */

const ENTITIES: Readonly<Record<string, string>> = Object.freeze({
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
});

/**
 * `'` is escaped too, even though every attribute here is double-quoted: one un-quoted attribute
 * added later should not turn into an injection point, and the cost is five characters.
 */
export function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => ENTITIES[character]);
}

/** Markup that has already been escaped, or that this file produced. */
export class SafeHtml {
  readonly value: string;

  constructor(value: string) {
    this.value = value;
  }

  toString(): string {
    return this.value;
  }
}

/** The escape hatch. Grep for it to find every place unescaped markup can enter a page. */
export function raw(value: string): SafeHtml {
  return new SafeHtml(value);
}

function render(value: unknown): string {
  if (value instanceof SafeHtml) {
    return value.value;
  }
  if (Array.isArray(value)) {
    return value.map(render).join("");
  }
  if (value === null || value === undefined || value === false) {
    return "";
  }
  return escapeHtml(String(value));
}

export function html(strings: TemplateStringsArray, ...values: readonly unknown[]): SafeHtml {
  let out = strings[0];
  for (let i = 0; i < values.length; i += 1) {
    out += render(values[i]) + strings[i + 1];
  }
  return new SafeHtml(out);
}
