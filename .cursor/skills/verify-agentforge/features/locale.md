# Locale

DPSBuddy ships English and Bahasa Indonesia. Settings has one language select; picking a language saves it immediately but **does not retranslate the screen** — a restart banner appears, and only its button applies the new locale to the renderer and re-freezes the host's boot locale. Both the renderer (`apps/web/lib/i18n.ts`) and the host (`packages/host/src/locale-boot.ts`) hold the locale in a module-level frozen variable, which is why a page reload alone is not enough. Testids never change with locale, so every recipe in this map stays valid on an `id` desk — only the visible strings move.

## Sub-features

- `locale-select` is `settings-locale` on Settings: a `<select>` with `en` ("English") and `id` ("Bahasa Indonesia"). Label `Language` / `Bahasa`, help line "Applies after you restart DPSBuddy…" / "Berlaku setelah Anda mulai ulang DPSBuddy…".
- `locale-restart` shows `settings-locale-restart` (banner "Restart DPSBuddy to apply this language." / "Mulai ulang DPSBuddy untuk menerapkan bahasa ini.") with `settings-locale-restart-button` ("Restart DPSBuddy" / "Mulai ulang DPSBuddy") inside it. The banner is visible exactly while `savedLocale !== locale`.
- `locale-apply` is the button's effect: `POST /api/v1/settings/apply-locale`, then `applyLocale()` in the renderer and `applySavedLocaleAsBoot()` in the host. Packaged, it also asks the shell to relaunch; on webdev the relaunch is refused and the app just retranslates in place.
- `locale-walk` is the proof that the new locale reached the whole desk: the rail, Chat and at least one job mode read Indonesian.
- `locale-run-output` is the host half — `localeForRun()` (`packages/host/src/run-context.ts`) picks the run's locale, and `withOutputLanguage()` (`packages/core/src/output-language.ts`) appends the output-language rule for Documents, Research, Finance, Data, Videos, Edit and Knowledge. This is what makes a generated brief Indonesian, not just the chrome.
- `locale-parity` is the source check: **14** files under `apps/web/lib/*locale*.test.ts` assert en/id key parity per namespace (Market has two, `market-locale.test.ts` and `market-locale-catalog.test.ts`). The `common` namespace still has none.

## How to get to it (user POV)

- Rail → Settings (`settings-link`), then the Language row near the gateway block.
- Pick Bahasa Indonesia, then press the Restart button that appears under the select.
- Packaged, the app relaunches into the new language. On webdev it retranslates without a relaunch.

## Driving it with the DPSBuddy harness

Preconditions:

- Doctor exits 0.
- Drive this on `:3000` (the isolated webdev — SKILL.md **Who runs which harness**), never on a packaged desk you do not own. It writes `locale` into that desk's settings, and leaving a desk in `id` is a visible change to someone else's app.
- Restore in the same script **and** in a `finally` (or a second script you run immediately): on 2026-09-23 a drive stopped on an unrelated locator while the desk was on `id`, and only the separate restore put it back. Doctor again after the restore.
- **Read the desk's locale before you touch it** (`GET /api/v1/settings` → `savedLocale`) and put it back to **that** value at the end of the run — not to `en`. The owner's desk is normally `id`. Restoring to a hardcoded `en` is how a locale drive leaves the desk in a state the owner did not choose; it happened on 2026-09-17. The restore is part of the drive, not cleanup you may skip.

- **Open Settings.** Click `settings-link`. `settings-locale` is visible, `settings-locale-restart` is absent (15s).
- **Select `id`.** Set `settings-locale` to `id`. `settings-locale-restart` appears (15s) and reads "Restart DPSBuddy to apply this language."; the rest of the page is **still English**. That is correct — do not call it a bug.
- **Apply.** Click `settings-locale-restart-button`. Within ~2s Settings reads "Pengaturan" and the intro (0.15.0, one sentence pair) begins "Tempel kunci API gateway Toko Token dari api.tokotokenai.com untuk menjalankan chat dan mode kerja di meja Default." (`settings.intro`, `apps/web/locales/id/settings.json:3`). Match the prefix, not the whole paragraph. `runtime-status` reads `Status: Langsung · Kunci gateway tersimpan · …` on a desk with a key, and the Start-over heading reads `Mulai ulang dari awal`. `applyLocale` also sets `document.documentElement.lang`, so `html[lang="id"]` is a cheap, locale-invariant assertion that the apply really ran. Driven 2026-09-23.
- **Rail walk.** Wait until the rail shows the new group label — a fixed delay can sample the page before apply finishes. The rail then reads `Percakapan` / Chat, `Chat baru`; `Buat` / Dokumen, Riset, Keuangan, Data, Pasar, Hukum, Rapat, Gambar, Video, Musik, Edit, Presentasi; `Akun` / Basis pengetahuan, Kanal, Ruang kerja, Pemakaian, Pengaturan (group labels are sentence case; do not assert capitals — CSS may upper-case them). `mode-*` testids are unchanged. The jobs group used to read `Mode kerja`; that string is gone. `Buat` has count 0 while the rail is collapsed (`data-rail=min` draws a divider instead of the word) and while the current desk has no job modes.
- **Chat walk.** Open `/chat`. `chat-empty` reads "Kerja dimulai di sini.", `new-chat-link` reads "Chat baru", `composer-text` placeholder is "Tanyakan apa saja, atau lepas tangkapan layar, klip, atau berkas teks", `composer-send` reads "Kirim", the first `chat-suggestion` reads "Susun rencana", and `reasoning-effort` options read "Mati / Ringan / Normal / Dalam / Ekstra / Maks / Ultra" — the seven option labels only; "Berpikir" is its `aria-label`, not text.
- **Job-mode walk.** Open `/finance`. The studio reads "Keuangan", and its two disclosures read "Cara kerjanya" (`finance-how`) and "Lanjutan" (`finance-parameters`). The inputs read "Tempel angka", "Uraikan menjadi pos", "Tambah pos"; the parameters ("Parameter (opsional)", "Tingkat diskonto %") are inside "Lanjutan" and need it opened first.
- **Restore.** Back to Settings, set `settings-locale` to the value you recorded at the start, click `settings-locale-restart-button`, and confirm `GET /api/v1/settings` reports **both** `locale` and `savedLocale` equal to that starting value. Both, not just one. If the run started on `id`, the desk ends on `id`. Record the start and end values in the evidence `action.md`.
- **Source check.** `cd apps/web && npx vitest run lib/` covers whatever `*locale*.test.ts` files exist at this sha (14 on 2026-09-17). Assert they pass, not how many there are. Run it when a catalog changed; it is not a substitute for the walk.
- **Evidence.** Screenshots of Settings before, the restart banner, Settings in `id`, Chat in `id`, the job mode in `id`, and Settings back on the locale the desk started on, under `evidence/locale/<run-id>/`.

## Gotchas

- **Selecting a language retranslates nothing.** Only `settings-locale-restart-button` calls `applyLocale()`. A recipe that changes the select and immediately asserts Indonesian anywhere else fails, and the failure is the recipe's, not the app's.
- **`locale` and `savedLocale` are two different fields.** `savedLocale` is the pending pick and drives the select and the banner; `locale` is the applied, frozen one. The banner is visible exactly while they differ, so asserting the banner is really asserting the mismatch.
- **A page reload does not restart the host.** The Node host freezes its boot locale once (`locale-boot.ts`) and only `apply-locale` re-freezes it, so job output can stay in the old language even after the chrome flips if the apply call did not actually run.
- **Testids are locale-invariant.** `settings-locale`, `settings-locale-restart`, `settings-locale-restart-button` and every `mode-*` id read the same in both languages. Never match a control by its visible text in a locale drive.
- **Some strings are English on purpose.** "English", "Chat", "Edit", "Data", "Ultra", "Toko Token" and the literal `RESET` confirm word are whitelisted by the parity tests. An en value equal to its id value is not automatically an untranslated bug.
- **Model `bestFor` copy is not in the catalogs.** On an `id` desk the job model dropdowns still read "Fast drafts" / "Everyday chat" / "Deep reasoning", because those come from the model registry rather than `apps/web/locales/`. Observed on `/finance` in `id`. Report it as a product gap if it matters; it is not recipe drift.
- **Thread titles follow the locale at creation time.** `defaultThreadTitle(locale)` writes "New thread" or "Percakapan baru", and `isDefaultThreadTitle` recognises both, so a thread made under `en` stays "untouched" after switching to `id`. Do not assert a fresh thread's title matches the current UI locale.
- **The parity count is a moving target.** The glob matched 13 files on 2026-09-15 and 14 on 2026-09-17, and those files hold ~40 `it()` cases between them, with more locale tests outside the glob in `packages/core` and `packages/host`. Do not script a check that expects an exact number of files or results.
