# Onboarding

The first-run screen, in three steps. A fresh desk says hello, then asks for a key, then offers four examples. The examples render only after the host reports `allowed`. The renderer displays that decision and does not decide it. The in-app name is `{productName}` (DPSBuddy). There is no password and no sign-in form, and the gateway address is not on the screen. How the gate is derived is [gateway-gate.md](./gateway-gate.md); the document-reader panel is [components.md](./components.md).

## Sub-features

- `onboarding-hello` is a fresh desk: `onboarding-welcome` (gradient hello in the in-app name, one short sentence) and `onboarding-next`. `onboarding-form` has count 0 on this step.
- `onboarding-key` is the paste: `onboarding-form`, `onboarding-key`, `onboarding-continue` ("Check this key"), and `onboarding-back`. A desk the host already closed (`invalid_key`, `unreachable`, `error`) skips the hello and opens here, with `onboarding-gate-reason` and `onboarding-recheck`. A fresh `needs_key` desk has neither.
- `onboarding-examples` is `onboarding-try`: `onboarding-key-success`, four `onboarding-example` cards (`data-example` `chat` / `document` / `finance` / `images`), and `onboarding-start`, which opens Chat (`chat-empty`). This step exists only after `resolveGate` says `"app"`.
- `onboarding-setup` is `component-setup` inside `onboarding-setup-check`, on the key step, above the key form. It does not block the form. When the reader shipped inside the app the section is absent. Drive the install itself in [components.md](./components.md).

## How to get to it (user POV)

- Open the app on a machine with no saved key. The hello is the whole window: no rail, no Settings, no Chat.
- Continue, paste a Toko Token key, and press Check this key. A key the gateway accepts moves to the examples. A key it rejects stays on the form and says so in plain words.
- Pick an example, or Start in Chat. Chat opens.

## Driving it with the DPSBuddy harness

Preconditions:

- Doctor the instance you started. Use a throwaway `AGENTFORGE_DATA_DIR`.
- `AGENTFORGE_RUNTIME=stub` reports `allowed: true` before it looks at the key, so this screen never appears. Start with the runtime unset, or `AGENTFORGE_RUNTIME=ai` and no key saved. `GET /api/v1/settings` must report `gateway.status: "needs_key"` and `allowed: false` before the first screenshot.
- Never paste a real key, and never drive this on a desk you do not own.

- **Hello.** Open `/chat`. `onboarding-welcome` is visible and reads "Welcome to DPSBuddy". `onboarding-next` is visible. `onboarding-form`, `onboarding-try`, `onboarding-gateway-host` and `onboarding-endpoint` have count 0. No text on the screen contains `tokotokenai` or `Nultron`.
- **Key.** Click `onboarding-next`. `onboarding-form` and `onboarding-key` are visible. `onboarding-continue` is disabled until the field has text. The step list marks `onboarding-step-key` with `aria-current="step"`.
- **Rejected key.** On your own desk, paste a bogus string and click `onboarding-continue`. `onboarding-gate-reason` reads "That key didn't work. Check it at Toko Token and paste it again." `onboarding-recheck` is visible. `onboarding-try` still has count 0. The host's technical `message` (HTTP status, URL) is not on the screen.
- **Examples only after `allowed`.** When the host next reports `allowed: true` (a key it accepts, or opening another desk whose verdict is allowed), `onboarding-try` appears and the four `onboarding-example` values are `chat`, `document`, `finance`, `images`. Do not record this step against a payload that still says `allowed: false`.
- **Start.** Click `onboarding-start` (or any `onboarding-example`). The desk is Chat: `chat-empty` reads "Work starts here."
- **Setup panel.** On the key step, `component-setup` is inside `onboarding-setup-check` and above `onboarding-form`. With `anydoc` `state: "ready"` and `source: "bundled"`, both have count 0. That absence is the pass.
- **Evidence.** Screenshots of the hello, the key step, a rejected key, the examples, and Chat, under `evidence/onboarding/<run-id>/`, plus the settings JSON that showed `allowed` before the examples shot.

## Gotchas

- **Stub hides the screen.** A green doctor on `:3000` with `runtime: "stub"` is not a drive of this recipe. The gate is open and Chat renders.
- **`needs_key` has no reason and no re-check.** Their absence on a fresh desk is the pass. They appear after a rejected, unreachable, or error verdict.
- **The examples are not a second hello.** Reloading after the host has already allowed the desk skips onboarding and opens the app. The examples step is the in-screen step that runs when `allowed` flips while the screen is still mounted.
- **One input.** The only field is `onboarding-key`. An endpoint field, a host line, or a password field is a regression.
- **Other desks.** `onboarding-desks` / `onboarding-open-desk` render only when the install has another desk. Opening one asks the host for that desk's gate and applies it. A one-desk install correctly shows nothing there.
