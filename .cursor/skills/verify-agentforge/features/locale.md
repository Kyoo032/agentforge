# Locale

DPSBuddy ships English and Bahasa Indonesia. Settings has one language select; picking a language saves it immediately but **does not retranslate the screen** — a restart banner appears, and only its button applies the new locale to the renderer and re-freezes the host's boot locale. Both the renderer (`apps/web/lib/i18n.ts`) and the host (`packages/host/src/locale-boot.ts`) hold the locale in a module-level frozen variable, which is why a page reload alone is not enough. Testids never change with locale, so every recipe in this map stays valid on an `id` desk — only the visible strings move.

## Sub-features

- `locale-select` is `settings-locale` on Settings: a `<select>` with `en` ("English") and `id` ("Bahasa Indonesia"). Label `Language` / `Bahasa`, help line "Applies after you restart DPSBuddy…" / "Berlaku setelah Anda mulai ulang DPSBuddy…".
- `locale-restart` shows `settings-locale-restart` (banner "Restart DPSBuddy to apply this language." / "Mulai ulang DPSBuddy untuk menerapkan bahasa ini.") with `settings-locale-restart-button` ("Restart DPSBuddy" / "Mulai ulang DPSBuddy") inside it. The banner is visible exactly while `savedLocale !== locale`.
- `locale-apply` is the button's effect: `POST /api/v1/settings/apply-locale`, then `applyLocale()` in the renderer and `applySavedLocaleAsBoot()` in the host. Packaged, it also asks the shell to relaunch; on webdev the relaunch is refused and the app just retranslates in place.
- `locale-walk` is the proof that the new locale reached the whole desk: the rail, Chat and at least one job mode read Indonesian.
- `locale-run-output` is the host half — `localeForRun()` (`packages/host/src/run-context.ts`) picks the run's locale, and `withOutputLanguage()` (`packages/core/src/output-language.ts`) appends the output-language rule for Documents, Research, Finance, Data, Videos, Edit and Knowledge. This is what makes a generated brief Indonesian, not just the chrome.
- `locale-parity` is the source check: 13 files under `apps/web/lib/*locale*.test.ts` assert en/id key parity per namespace.

## How to get to it (user POV)

- Rail → Settings (`settings-link`), then the Language row near the gateway block.
- Pick Bahasa Indonesia, then press the Restart button that appears under the select.
- Packaged, the app relaunches into the new language. On webdev it retranslates without a relaunch.

## Driving it with the DPSBuddy harness

Preconditions:

- Doctor exits 0.
- Drive this on your own isolated desk, not the operator's. It writes `locale` into that desk's settings, and leaving a desk in `id` is a visible change to someone else's app.
- Put the desk back on `en` at the end of the run. That restore is part of the drive, not cleanup you may skip.

- **Open Settings.** Click `settings-link`. `settings-locale` is visible, `settings-locale-restart` is absent (15s).
- **Select `id`.** Set `settings-locale` to `id`. `settings-locale-restart` appears (15s) and reads "Restart DPSBuddy to apply this language."; the rest of the page is **still English**. That is correct — do not call it a bug.
- **Apply.** Click `settings-locale-restart-button`. Within ~2s Settings reads "Pengaturan", "Kunci gateway, pengaturan tambahan, dan default untuk meja Default." and the language help line reads "Berlaku setelah Anda mulai ulang DPSBuddy."
- **Rail walk.** The rail reads "PERCAKAPAN / Chat", "MODE KERJA / Dokumen, Riset, Keuangan, Data, Pasar, Hukum, Gambar, Video, Edit, Presentasi", "AKUN / Basis pengetahuan, Ruang kerja, Pemakaian, Pengaturan". `mode-*` testids are unchanged.
- **Chat walk.** Open `/chat`. `chat-empty` reads "Anda sudah masuk. Tanya apa saja.", `new-chat` reads "Chat baru", `composer-text` placeholder is "Pesan", and `reasoning-effort` reads "Berpikir / Mati / Ringan / Normal / Dalam / Ekstra / Maks / Ultra".
- **Job-mode walk.** Open `/finance`. The studio reads "Keuangan", "TEMPEL ANGKA", "Uraikan menjadi pos", "POS", "Tambah pos", "PARAMETER (OPSIONAL)", "Tingkat diskonto %".
- **Restore.** Back to Settings, set `settings-locale` to `en`, click `settings-locale-restart-button`, and confirm `GET /api/v1/settings` reports `locale: "en"` **and** `savedLocale: "en"`. Both, not just one.
- **Source check.** `cd apps/web && npx vitest run lib/` covers the 13 `*locale*.test.ts` files. Run it when a catalog changed; it is not a substitute for the walk.
- **Evidence.** Screenshots of Settings before, the restart banner, Settings in `id`, Chat in `id`, the job mode in `id`, and Settings back in `en`, under `evidence/locale/<run-id>/`.

## Gotchas

- **Selecting a language retranslates nothing.** Only `settings-locale-restart-button` calls `applyLocale()`. A recipe that changes the select and immediately asserts Indonesian anywhere else fails, and the failure is the recipe's, not the app's.
- **`locale` and `savedLocale` are two different fields.** `savedLocale` is the pending pick and drives the select and the banner; `locale` is the applied, frozen one. The banner is visible exactly while they differ, so asserting the banner is really asserting the mismatch.
- **A page reload does not restart the host.** The Node host freezes its boot locale once (`locale-boot.ts`) and only `apply-locale` re-freezes it, so job output can stay in the old language even after the chrome flips if the apply call did not actually run.
- **Testids are locale-invariant.** `settings-locale`, `settings-locale-restart`, `settings-locale-restart-button` and every `mode-*` id read the same in both languages. Never match a control by its visible text in a locale drive.
- **Some strings are English on purpose.** "English", "Chat", "Edit", "Data", "Ultra", "Toko Token" and the literal `RESET` confirm word are whitelisted by the parity tests. An en value equal to its id value is not automatically an untranslated bug.
- **Model `bestFor` copy is not in the catalogs.** On an `id` desk the job model dropdowns still read "Fast drafts" / "Everyday chat" / "Deep reasoning", because those come from the model registry rather than `apps/web/locales/`. Observed on `/finance` in `id`. Report it as a product gap if it matters; it is not recipe drift.
- **Thread titles follow the locale at creation time.** `defaultThreadTitle(locale)` writes "New thread" or "Percakapan baru", and `isDefaultThreadTitle` recognises both, so a thread made under `en` stays "untouched" after switching to `id`. Do not assert a fresh thread's title matches the current UI locale.
- **"13 parity tests" is 13 files, not 13 cases.** Those files hold ~40 `it()` cases, and more locale tests live outside that glob in `packages/core` and `packages/host`. Do not script a check that expects exactly 13 results.
