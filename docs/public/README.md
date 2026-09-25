# Public release notes

Every notes file here is published verbatim to a public release repo. None of them may name the internal engineering notes, an AI tool, or an agent. The release scripts refuse a notes file that does.

- `<version>-notes.md` (for example `0.15.0-notes.md`) is a **Personal** desktop release on [`Kyoo032/DPSBuddy`](https://github.com/Kyoo032/DPSBuddy), published by `pnpm desktop:release`.
- `ent-<date>-notes.md` (for example `ent-2026.09.23-notes.md`) is an **Enterprise** hosted web release on [`Kyoo032/DPSBuddy-Ent`](https://github.com/Kyoo032/DPSBuddy-Ent), published by `node scripts/release-web.mjs`. The same run pushes the image `ghcr.io/kyoo032/dpsbuddy-ent:<tag>` and commits the deploy bundle to that repo's `main`: `compose.yml` pinned to the image, `.env.example`, `DEPLOY.md` and `Caddyfile`. It appends the source commit sha and the image to the release body.
- `releases-readme.md` is the README of the DPSBuddy repo (Personal).
- `ent-readme.md` is the README of the DPSBuddy-Ent repo (Enterprise).

The public name of both products is **Nultron** (Rizky, 2026-09-25). Only public copy uses it; the source repo stays `agentforge`, and the app, installers, data folders, image and release repo names stay DPSBuddy until the in-app rename lands with the new logo. Public text may not contain the substring "agent" (see `scripts/release-marks.mjs`).

Neither release repo is ever cloned by hand. The only local checkout is the source repo, and each release repo is written only by its release script.
