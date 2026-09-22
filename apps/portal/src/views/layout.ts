/**
 * The page shell every screen is poured into.
 *
 * One `<style>` block and no script at all -- the CSP in `src/security/headers.ts` is
 * `script-src 'none'`, so a page that needed JavaScript would not run, which is the point. Every
 * screen here is a form and a button.
 *
 * The shell is also where the locale reaches the document: `<html lang>` and `dir` come from the
 * negotiated locale, so a screen reader and the browser's own translation prompt both get it right.
 */
import { html, raw, type SafeHtml } from "./escape";
import type { PortalLocale } from "./i18n";

/**
 * Where the shell asks for the brand mark. `src/routes/assets.ts` serves exactly this path.
 *
 * It lives here, with the markup that references it, rather than in the route: views never build a
 * route path in this codebase -- `pages.ts` takes every form `action` from its caller -- and this is
 * the one exception, because the mark is part of the shell rather than of any flow, so threading it
 * through all six screens would be ceremony around a constant.
 */
export const LOGO_PATH = "/assets/logo.png";

const STYLE = `
:root{color-scheme:light dark;--bg:#f6f7f9;--card:#fff;--ink:#14161a;--muted:#5b6270;--line:#d9dde4;--accent:#1b4ee0;--bad:#b3261e}
@media (prefers-color-scheme:dark){:root{--bg:#101214;--card:#191c20;--ink:#eef0f3;--muted:#9aa3b2;--line:#2c3138;--accent:#7fa2ff;--bad:#ff8a80}}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--ink);font:16px/1.5 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;
 display:flex;min-height:100vh;align-items:center;justify-content:center;padding:24px 16px}
main{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:28px 24px;width:100%;max-width:26rem}
h1{font-size:1.35rem;margin:0 0 .5rem}
p{margin:0 0 1rem;color:var(--muted)}
p.lead{color:var(--ink)}
label{display:block;font-weight:600;font-size:.9rem;margin-bottom:.35rem}
input{width:100%;padding:.7rem .75rem;font:inherit;color:var(--ink);background:transparent;
 border:1px solid var(--line);border-radius:8px}
input:focus{outline:2px solid var(--accent);outline-offset:1px}
button{width:100%;margin-top:1.25rem;padding:.75rem 1rem;font:inherit;font-weight:600;color:#fff;
 background:var(--accent);border:0;border-radius:8px;cursor:pointer}
button.secondary{background:transparent;color:var(--accent);border:1px solid var(--line);margin-top:.6rem}
dl{margin:0 0 1rem;display:grid;grid-template-columns:auto 1fr;gap:.35rem 1rem;font-size:.95rem}
dt{color:var(--muted)}
dd{margin:0;font-weight:600;word-break:break-word}
.code{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:1.3rem;letter-spacing:.12em}
.warn{border-left:3px solid var(--accent);padding-left:.75rem}
.bad{color:var(--bad);font-weight:600}
.brand{display:flex;align-items:center;gap:.5rem;font-size:.95rem;font-weight:600;letter-spacing:.01em;
 color:var(--ink);margin:0 0 1.25rem}
.brand img{width:24px;height:24px;flex:0 0 24px;object-fit:contain;border-radius:5px}
footer{margin-top:1.5rem;font-size:.8rem;color:var(--muted)}
`.trim();

export interface PageOptions {
  readonly locale: PortalLocale;
  readonly title: string;
  readonly product: string;
  readonly body: SafeHtml;
  readonly footer?: string;
}

export function page(options: PageOptions): string {
  return `<!doctype html>${html`<html lang="${options.locale}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex,nofollow">
<title>${options.title} — ${options.product}</title>
<style>${raw(STYLE)}</style>
</head>
<body>
<main>
<p class="brand"><img src="${LOGO_PATH}" alt="${options.product}" width="24" height="24">${options.product}</p>
${options.body}
${options.footer ? html`<footer>${options.footer}</footer>` : ""}
</main>
</body>
</html>`}`;
}
