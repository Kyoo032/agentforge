# Public release notes

Every notes file here is published verbatim to a public release repo. None of them may name the internal engineering notes, an AI tool, or an agent. The release scripts refuse a notes file that does.

- `<version>-notes.md` (for example `0.15.0-notes.md`) is a **Personal** desktop release on [`Kyoo032/Nultron`](https://github.com/Kyoo032/Nultron), published by `pnpm desktop:release`.
- `ent-<date>-notes.md` (for example `ent-2026.09.23-notes.md`) is an **Enterprise** hosted web release on [`Kyoo032/NultronEnt`](https://github.com/Kyoo032/NultronEnt), published by `node scripts/release-web.mjs`. The same run pushes the image `ghcr.io/kyoo032/nultron-ent:<tag>` and commits the deploy bundle to that repo's `main`: `compose.yml` pinned to the image, `.env.example`, `DEPLOY.md` and `Caddyfile`. It appends the source commit sha and the image to the release body.
- `releases-readme.md` is the README of the Nultron repo (Personal). The copy on that repo is `620689f`; this file was updated for the 2026-09-29 rename and is not pushed yet.
- `ent-readme.md` is the README of the NultronEnt repo (Enterprise). The copy on that repo is `54da47a`; this file was updated for the 2026-09-29 rename and is not pushed yet.

The public name of both products is **Nultron** (Rizky, 2026-09-25). The source repo stays `agentforge`. The public repos were renamed the same day from `Kyoo032/DPSBuddy` and `Kyoo032/DPSBuddy-Ent`; GitHub redirects the old URLs. On 2026-09-29 the app, installers, data folders and the image followed (`Nultron`, `ghcr.io/kyoo032/nultron-ent`); the first release under those names has not been cut. Notes files for earlier releases keep the name they were published under. Public text may not contain the substring "agent" (see `scripts/release-marks.mjs`).

Neither release repo is ever cloned by hand. The only local checkout is the source repo, and each release repo is written only by its release script.
