<#
.SYNOPSIS
    HARNESS, NEVER SHIPS. Prints (and with -Start, launches) the local Phase 9 review instance.

.DESCRIPTION
    The plan of record is docs/internal/web-phase9-portal-login.md, "Local review instance".

    Hosted mode cannot be reviewed over plain http: rejectPlaintext (packages/host/src/http-adapter.ts)
    answers 403 https_required without X-Forwarded-Proto: https, and trustedOrigins
    (packages/core/src/server-mode.ts) drops every http:// entry in server mode. So the review
    instance is four things on loopback:

        docker compose  apps/portal/compose.yml   postgres:16 + mailpit, loopback only
        portal          127.0.0.1:4000            apps/portal, its own Postgres and its own data dir
        app             127.0.0.1:3100            AGENTFORGE_SERVER=1, its OWN data dir
        proxy           127.0.0.1:3443            scripts/review-proxy.mjs, TLS, stamps the headers

    The reviewer opens https://localhost:3443 and accepts the self-signed warning once.

    TWO TOPOLOGIES, ONE COMMAND. With no URL arguments the app and the portal are reached on
    loopback exactly as above. With -AppPublicUrl / -PortalPublicUrl they are reached on whatever
    public https names a tunnel is publishing, and the four variables that have to agree with those
    names - AGENTFORGE_TRUSTED_ORIGINS, AGENTFORGE_PUBLIC_URL, AGENTFORGE_PORTAL_URL,
    PORTAL_PUBLIC_URL - are derived from them here rather than edited by hand in four places.

    WHAT THIS SCRIPT WILL NOT DO
      - It never touches :3000 or .webdev-data. That is the operator's shared webdev instance.
      - It refuses a data dir that resolves inside this checkout, or that is named .webdev-data.
      - It never starts Docker Desktop. If the daemon is down it says so and stops.
      - It never writes a secret into the repository. Generated secrets live in
        $HOME\.dpsbuddy-review\review.env, mode 600 where the filesystem supports it, and the
        printed output masks them.
      - -Stop kills only the three process ids THIS script recorded when it started them, and only
        when the running process still has the start time that was recorded with the id. It never
        kills by port, never by image name, and never anything it did not start.

    DEFAULT IS PRINT, NOT RUN. Without -Start this prints exactly what it would launch and exits 0,
    so the whole thing can be read before anything binds a port.

.PARAMETER Start
    Actually launch. Anything this script started earlier and is still running is stopped first, so
    -Start is also the relaunch. Each process gets its own console window.

.PARAMETER Stop
    Stop the three processes this script started, and nothing else.

.PARAMETER Production
    Run the app as the hosted deployment does: NODE_ENV=production, serving the built bundle from
    apps/web/dist rather than Vite's dev server. The bundle is built first when it is missing. The
    production CSP, the built shell and the hosted marker are only exercised this way - and so are
    the boot refusals in apps/web/lib/hosted-mode-guard.ts, which only fire on a production build.

.PARAMETER AppPublicUrl
    The https origin a browser reaches the APP on. Defaults to the loopback proxy,
    https://localhost:<ProxyPort>. Behind a tunnel this is the tunnel's app hostname; the proxy
    origin stays trusted as well, so both work at once.

.PARAMETER PortalPublicUrl
    The origin a browser - and the host, server to server - reaches the PORTAL on. Defaults to
    http://127.0.0.1:<PortalPort>. Behind a tunnel this is the tunnel's portal hostname, which also
    switches PORTAL_TRUST_PROXY on, because only then is there a proxy whose X-Forwarded-For is
    worth believing.

.EXAMPLE
    powershell -NoProfile -File scripts\review-instance.ps1
    powershell -NoProfile -File scripts\review-instance.ps1 -Start -Production
    powershell -NoProfile -File scripts\review-instance.ps1 -Start -Production `
        -AppPublicUrl https://app.example.trycloudflare.com `
        -PortalPublicUrl https://portal.example.trycloudflare.com
    powershell -NoProfile -File scripts\review-instance.ps1 -Stop
#>
[CmdletBinding()]
param(
    [switch] $Start,
    [switch] $Stop,
    [switch] $Production,
    [string] $AppPublicUrl    = '',
    [string] $PortalPublicUrl = '',
    [int]    $PortalPort   = 4000,
    [int]    $AppPort      = 3100,
    [int]    $ProxyPort    = 3443,
    [string] $ReviewRoot   = (Join-Path $HOME '.dpsbuddy-review'),
    # The seeded tenant, printed in the manual step below so the three commands can be pasted.
    [string] $SeedEmail    = 'admindps@privaro.me',
    [string] $SeedTenant   = 'dpsbuddy',
    # The DISPLAY name, which is what the sign-in mail prints when a tenant has chosen one. Passed
    # on every seed line below, so a tenant that ALREADY exists is renamed to it rather than keeping
    # whatever it was first seeded with. The 2026-09-21 rebrand needed exactly that, and a
    # hand-written UPDATE against the review database was not going to be how it happened.
    [string] $SeedTenantName = 'DPSBuddy',
    [string] $SeedOrg      = 'Kyo',
    [int]    $SeedSeatCap  = 2,
    # Postgres, as apps/portal/compose.yml publishes it. 5433 and not 5432 on purpose, so this can
    # never collide with a Postgres the operator already runs. Change these only alongside that file.
    [string] $PostgresService = 'postgres',
    [int]    $PostgresPort = 5433,
    [string] $PostgresUser = 'portal',
    [string] $PostgresDb   = 'tokotoken_portal',
    [int]    $PostgresWaitSeconds = 120,
    # `npx pnpm@9.15.9` is the documented fallback when corepack hits EPERM on Windows (AGENTS.md).
    [string] $PnpmCommand  = ''
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

<#
    How this desk runs pnpm.

    `pnpm` is not on PATH on every machine here - corepack hits EPERM on Windows and the documented
    fallback is `npx pnpm@9.15.9` (AGENTS.md, "How to run"). Hard-coding either one made this script
    unable to start anything on a desk that has the other, so it resolves: the real `pnpm` when
    there is one, `npx pnpm@9.15.9` when there is not. `-PnpmCommand` overrides the whole thing and
    may carry leading arguments, e.g. -PnpmCommand 'npx pnpm@9.15.9'.

    Returns the executable and the arguments that must come BEFORE the workspace filter, because
    Start-Process takes those two separately.
#>
<#
    The full path of a launcher Windows can actually execute, or $null.

    Node ships THREE files called `npx` in one directory: `npx.ps1`, `npx.cmd` and an extensionless
    `npx`, which is a bash shim. `Get-Command npx` answers with the .ps1, and handing the bare name
    to Start-Process resolves the extensionless one, which Windows cannot exec - it fails with
    "the system cannot find all the information required", which names neither the file nor the
    reason. The same shim is why `node_modules/.bin/tsx` breaks two test suites on this desk
    (AGENTS.md, "Known local reds"). So: only .exe, .cmd or .bat, and by full path.
#>
function Resolve-Launcher {
    param([string] $Name)

    $runnable = @('.exe', '.cmd', '.bat')
    foreach ($command in @(Get-Command $Name -All -CommandType Application -ErrorAction SilentlyContinue)) {
        $source = [string]$command.Source
        if ($runnable -contains [System.IO.Path]::GetExtension($source).ToLowerInvariant()) {
            return $source
        }
    }
    return $null
}

function Resolve-PnpmCommand {
    param([string] $Override)

    if ($Override.Trim()) {
        $parts = $Override.Trim() -split '\s+'
        $file = Resolve-Launcher -Name $parts[0]
        if (-not $file) { $file = $parts[0] }
        return @{ File = $file; Display = $parts[0]; Leading = @($parts | Select-Object -Skip 1) }
    }
    $pnpm = Resolve-Launcher -Name 'pnpm'
    if ($pnpm) {
        return @{ File = $pnpm; Display = 'pnpm'; Leading = @() }
    }
    $npx = Resolve-Launcher -Name 'npx'
    if (-not $npx) {
        throw "Neither ``pnpm`` nor ``npx`` is on PATH as a .exe, .cmd or .bat. Install Node.js, or pass -PnpmCommand with a full path."
    }
    return @{ File = $npx; Display = 'npx'; Leading = @('pnpm@9.15.9') }
}

$Pnpm        = Resolve-PnpmCommand -Override $PnpmCommand
$PnpmFile    = [string]$Pnpm.File
$PnpmLeading = [string[]]$Pnpm.Leading
# The printed form stays the short name, so every command line in the plan is copy-pasteable; only
# what Start-Process is handed is the resolved full path.
$PnpmDisplay = (@([string]$Pnpm.Display) + $PnpmLeading) -join ' '

$RepoRoot    = Split-Path -Parent $PSScriptRoot
$EnvFile     = Join-Path $ReviewRoot 'review.env'
$DataDir     = Join-Path $ReviewRoot 'data'
$PortalData  = Join-Path $ReviewRoot 'portal'
$CertDir     = Join-Path $ReviewRoot 'tls'
$PidFile     = Join-Path $ReviewRoot 'review-pids.json'
$ComposeFile = Join-Path $RepoRoot 'apps\portal\compose.yml'
# `name: agentforge-portal` + the `portal-pgdata` volume in that file. Docker names the volume
# <project>_<volume>, and this script only ever READS it - it never creates or removes one.
$ComposeVolume = 'agentforge-portal_portal-pgdata'
$DistIndex   = Join-Path $RepoRoot 'apps\web\dist\index.html'
# Declared here so Set-StrictMode never sees it unset; Start-PortalServices fills it in from
# review.env before the first compose call. See Invoke-Compose.
$ComposePassword = ''

<#
    The URLs, in one place, because four environment variables and one seed argument all have to
    agree with them. Everything below reads these and nothing re-derives an origin of its own.

    $ProxyOrigin is the loopback front door and is ALWAYS trusted, whatever else is: it is how the
    operator drives the instance with curl, and how the reviewer reaches it without the tunnel.
#>
function ConvertTo-Origin {
    param([string] $Value, [string] $Label)

    $trimmed = $Value.Trim()
    try {
        $uri = [System.Uri]::new($trimmed, [System.UriKind]::Absolute)
    } catch {
        throw "$Label must be an absolute URL, e.g. https://app.example.trycloudflare.com; got '$trimmed'."
    }
    if ($uri.Scheme -ne 'https' -and $uri.Scheme -ne 'http') {
        throw "$Label must be http or https; got '$trimmed'."
    }
    if ($uri.Scheme -eq 'http' -and -not $uri.IsLoopback) {
        # trustedOrigins (packages/core/src/server-mode.ts) drops every http:// entry in server
        # mode, so an http public URL would leave the allowlist short of the name it needs.
        throw "$Label must be https off loopback; server mode drops cleartext origins. Got '$trimmed'."
    }
    return $uri.GetLeftPart([System.UriPartial]::Authority)
}

$ProxyOrigin = "https://localhost:$ProxyPort"
$PortalLoopback = "http://127.0.0.1:$PortalPort"
$PublicUrl   = if ($AppPublicUrl) { ConvertTo-Origin -Value $AppPublicUrl -Label '-AppPublicUrl' } else { $ProxyOrigin }
$PortalUrl   = if ($PortalPublicUrl) { ConvertTo-Origin -Value $PortalPublicUrl -Label '-PortalPublicUrl' } else { $PortalLoopback }
# Both, de-duplicated and in this order: the proxy first because that is the origin curl uses.
$TrustedOrigins = (@($ProxyOrigin, $PublicUrl) | Select-Object -Unique) -join ','
# The portal is behind something only when it is not the loopback listener itself. PORTAL_TRUST_PROXY
# makes every rate-limit bucket key on X-Forwarded-For, so it is switched on exactly then.
$PortalBehindProxy = ($PortalUrl -ne $PortalLoopback)
# Both callbacks, so one seeded client serves the loopback drive and the tunnel at the same time.
$RedirectUris = @($ProxyOrigin, $PublicUrl) | Select-Object -Unique | ForEach-Object { "$_/auth/callback" }
# The filter form works today; lane A's root `portal:dev` / `portal:seed` / `portal:otp` aliases are
# the same scripts under shorter names, so either spelling is fine once they exist.
$PortalArgs  = $PnpmLeading + @('--filter', '@agentforge/portal')
$PortalRun   = "$PnpmDisplay --filter @agentforge/portal"
$MailpitUrl  = 'http://127.0.0.1:8025'
$SmtpHost    = '127.0.0.1'
$SmtpPort    = 1025
$SmtpFrom    = 'DPSBuddy review <no-reply@review.localhost>'

# ---------------------------------------------------------------------------
# Guards
# ---------------------------------------------------------------------------

function Get-FullPath {
    param([string] $Path)
    return [System.IO.Path]::GetFullPath($Path)
}

<#
    The one refusal that matters. A review instance pointed at the checkout would write a tenant
    database into the working tree, and pointed at .webdev-data it would overwrite the operator's
    shared webdev desk - which other agents are driving right now.
#>
function Assert-SafeDataDir {
    param([string] $Path, [string] $Label)

    $full = Get-FullPath $Path
    $repo = (Get-FullPath $RepoRoot).TrimEnd('\', '/') + [System.IO.Path]::DirectorySeparatorChar

    if ($full.TrimEnd('\', '/') -ieq $repo.TrimEnd('\', '/')) {
        throw "$Label resolves to the repository root ($full). Refusing."
    }
    if ($full.StartsWith($repo, [System.StringComparison]::OrdinalIgnoreCase)) {
        throw "$Label resolves inside this checkout ($full). The review instance keeps its state under $ReviewRoot, never in the tree. Refusing."
    }
    foreach ($segment in $full.Split([char]'\', [char]'/')) {
        if ($segment -ieq '.webdev-data') {
            throw "$Label points at .webdev-data ($full), which is the operator's shared webdev desk on :3000. Refusing."
        }
    }
    return $full
}

# ---------------------------------------------------------------------------
# review.env - generated once, never in the repo
# ---------------------------------------------------------------------------

function New-SecretHex {
    param([int] $Bytes = 32)

    $buffer = New-Object 'byte[]' $Bytes
    $rng = [System.Security.Cryptography.RandomNumberGenerator]::Create()
    try {
        $rng.GetBytes($buffer)
    } finally {
        $rng.Dispose()
    }
    return -join ($buffer | ForEach-Object { $_.ToString('x2') })
}

function Read-EnvFile {
    param([string] $Path)

    $values = @{}
    if (-not (Test-Path -LiteralPath $Path)) {
        return $values
    }
    foreach ($line in (Get-Content -LiteralPath $Path)) {
        $trimmed = $line.Trim()
        if ($trimmed -eq '' -or $trimmed.StartsWith('#')) {
            continue
        }
        $split = $trimmed.IndexOf('=')
        if ($split -lt 1) {
            continue
        }
        $values[$trimmed.Substring(0, $split).Trim()] = $trimmed.Substring($split + 1).Trim()
    }
    return $values
}

<#
    Fills in anything missing and leaves everything that is already there alone, so re-running this
    never rotates a key - AGENTFORGE_SECRETS_KEY in particular, because a changed wrap key makes the
    review instance's settings.enc undecryptable exactly as it would on the server.

    The two client fields stay EMPTY on purpose: they come from the portal's `seed` script, which
    prints the client secret exactly once, and the operator pastes both in here. Nothing generates them.
#>
function Initialize-ReviewEnv {
    $existing = Read-EnvFile $EnvFile
    $wanted = [ordered]@{
        'AGENTFORGE_SECRETS_KEY'           = { New-SecretHex 32 }
        'AGENTFORGE_BILLING_WEBHOOK_SECRET' = { New-SecretHex 32 }
        'PORTAL_SIGNING_KEY'               = { New-SecretHex 32 }
        # Generated for a FRESH review root, kept for an existing one - see Resolve-PostgresPassword.
        # It used to be the literal `portal`, seeded from here, which is a password in git whatever
        # the container is published on; compose now reads ${PORTAL_POSTGRES_PASSWORD:?...} and has
        # no default of its own. The one thing a generated value must not do is silently replace the
        # password an existing volume was initialised with, so that case stops rather than guesses.
        'PORTAL_POSTGRES_PASSWORD'         = { Resolve-PostgresPassword }
        'AGENTFORGE_PORTAL_CLIENT_ID'      = { '' }
        'AGENTFORGE_PORTAL_CLIENT_SECRET'  = { '' }
    }

    $changed = $false
    foreach ($name in $wanted.Keys) {
        if (-not $existing.ContainsKey($name)) {
            $existing[$name] = (& $wanted[$name])
            $changed = $true
        }
    }

    if ($changed) {
        if (-not (Test-Path -LiteralPath $ReviewRoot)) {
            New-Item -ItemType Directory -Path $ReviewRoot -Force | Out-Null
        }
        $lines = @(
            '# DPSBuddy Phase 9 local review instance. HARNESS, NEVER SHIPS.',
            '# Generated by scripts/review-instance.ps1. Real secrets - never copy this into the repo,',
            '# never paste it into a PR, and never reuse these values on a server.',
            '#',
            '# AGENTFORGE_PORTAL_CLIENT_ID / _SECRET are filled in BY HAND from the one-time output of',
            '#   pnpm --filter @agentforge/portal seed',
            ''
        )
        foreach ($name in $existing.Keys) {
            $lines += "$name=$($existing[$name])"
        }
        Set-Content -LiteralPath $EnvFile -Value $lines -Encoding utf8
        try {
            # Best effort: owner only. Windows ACLs do not map onto a mode, so this is not fatal.
            icacls $EnvFile /inheritance:r /grant:r "$($env:USERNAME):(R,W)" | Out-Null
        } catch {
            Write-Warning "Could not tighten permissions on $EnvFile. Check them yourself."
        }
        Write-Host "Wrote generated secrets to $EnvFile" -ForegroundColor Green
    }

    return $existing
}

<#
    Does the compose Postgres volume already exist?

    'present', 'absent', or 'unknown' when Docker cannot answer at all. `docker volume inspect` is
    a plain docker call, not a compose one, so it needs no PORTAL_POSTGRES_PASSWORD - which is the
    point, because this runs precisely when that value is the thing being decided.
#>
function Test-PortalVolume {
    $result = Invoke-Native -File 'docker' -Arguments @('volume', 'inspect', $ComposeVolume) -TimeoutMs 10000
    if (-not $result.Found -or $result.TimedOut -or $null -eq $result.ExitCode) {
        return 'unknown'
    }
    if ($result.ExitCode -eq 0) { return 'present' }
    # A non-zero exit is "no such volume" on a healthy daemon, and "cannot connect" on a dead one.
    if ($result.Output -match 'daemon|pipe|connect|denied') { return 'unknown' }
    return 'absent'
}

$VOLUME_HAS_ITS_OWN_PASSWORD = @'
The compose volume {0} already exists, and {1} has no PORTAL_POSTGRES_PASSWORD.

Postgres reads POSTGRES_PASSWORD once, in initdb, on the first start of an EMPTY volume. Generating
a fresh password now would build a DSN that database refuses, and the failure would look like a
portal bug. So this script stops instead, and you pick one:

  1. Put the password that volume was created with into {1}:
         PORTAL_POSTGRES_PASSWORD=<the old one>      # historically: portal
  2. Or change the volume's password to a new one and record it there:
         docker compose -f "{2}" exec postgres psql -U portal -c "\password portal"
  3. Or throw the local portal rows away and start clean (THIS DELETES THEM):
         docker compose -f "{2}" down -v
     then re-run this script, which will generate a password for the fresh volume.
'@

$VOLUME_UNKNOWN = @'
Cannot tell whether the compose volume {0} exists, because the Docker daemon did not answer - and
{1} has no PORTAL_POSTGRES_PASSWORD yet.

Both answers lead somewhere different (a fresh volume gets a generated password; an existing one
keeps the password it was built with), so this script will not guess. Start Docker Desktop and
re-run, or write the value into {1} yourself.
'@

<#
    The Postgres password, in the one place that is allowed to decide it.

    Called ONLY when review.env has no PORTAL_POSTGRES_PASSWORD, because Initialize-ReviewEnv fills
    in what is missing and never touches what is there. So an existing review root keeps whatever
    its volume was initialised with - which for every dev machine that predates this change is the
    literal `portal` this script used to seed, and which is exactly why that literal is gone: a
    password in a script is a password in git.
#>
function Resolve-PostgresPassword {
    $state = Test-PortalVolume
    if ($state -eq 'present') {
        throw ($VOLUME_HAS_ITS_OWN_PASSWORD -f $ComposeVolume, $EnvFile, $ComposeFile)
    }
    if ($state -eq 'unknown') {
        throw ($VOLUME_UNKNOWN -f $ComposeVolume, $EnvFile)
    }
    Write-Host "No $ComposeVolume yet: generating a Postgres password for a fresh volume." -ForegroundColor Cyan
    return New-SecretHex 18
}

function Format-Masked {
    param([string] $Value)

    if ([string]::IsNullOrEmpty($Value)) {
        return '<empty - fill it in from the portal seed output>'
    }
    if ($Value.Length -le 8) {
        return '********'
    }
    return $Value.Substring(0, 4) + ('*' * 8) + $Value.Substring($Value.Length - 4)
}

# ---------------------------------------------------------------------------
# Docker
# ---------------------------------------------------------------------------

<#
    Runs a console program with a hard timeout and hands back its output, without PowerShell 5.1's
    NativeCommandError behaviour on a native program's stderr.
#>
function Invoke-Native {
    param([string] $File, [string[]] $Arguments, [int] $TimeoutMs = 10000)

    $psi = New-Object System.Diagnostics.ProcessStartInfo
    $psi.FileName = $File
    $psi.Arguments = ($Arguments -join ' ')
    $psi.UseShellExecute = $false
    $psi.RedirectStandardOutput = $true
    $psi.RedirectStandardError = $true
    $psi.CreateNoWindow = $true

    try {
        $process = [System.Diagnostics.Process]::Start($psi)
    } catch {
        return @{ Found = $false; TimedOut = $false; ExitCode = $null; Output = $_.Exception.Message }
    }
    if (-not $process.WaitForExit($TimeoutMs)) {
        try { $process.Kill() } catch { }
        return @{ Found = $true; TimedOut = $true; ExitCode = $null; Output = '' }
    }
    $out = $process.StandardOutput.ReadToEnd() + $process.StandardError.ReadToEnd()
    return @{ Found = $true; TimedOut = $false; ExitCode = $process.ExitCode; Output = $out.Trim() }
}

$DOCKER_DOWN = @'
The Docker daemon is not answering, and this script will not start it for you.

  1. Start Docker Desktop yourself and wait for the whale icon to stop animating.
  2. Confirm with:  docker info --format "{{.ServerVersion}}"
  3. Re-run this script.

The portal needs Postgres and Mailpit from apps/portal/compose.yml (owner decision, 2026-09-21):
real Postgres from day one, and an SMTP sandbox rather than a dev outbox.
'@

function Assert-DockerUp {
    $result = Invoke-Native -File 'docker' -Arguments @('info', '--format', '"{{.ServerVersion}}"') -TimeoutMs 10000
    if (-not $result.Found) {
        throw "`docker` is not on PATH.`n$DOCKER_DOWN"
    }
    if ($result.TimedOut) {
        throw "``docker info`` did not answer within 10s.`n$DOCKER_DOWN"
    }
    if ($result.ExitCode -ne 0) {
        throw "``docker info`` failed: $($result.Output)`n$DOCKER_DOWN"
    }
    Write-Host "Docker daemon $($result.Output) is up." -ForegroundColor Green
}

<#
    THE ONLY PLACE A `docker compose` COMMAND LINE IS BUILT.

    `apps/portal/compose.yml` interpolates `${PORTAL_POSTGRES_PASSWORD:?…}` so that no literal
    password sits in git, and compose resolves that for EVERY subcommand - `ps` and `config` as
    much as `up`. Setting the variable around `up -d` alone is what made the health poll below run
    `docker compose ps -q postgres`, take a non-zero exit that had nothing to do with Postgres,
    never resolve a container id, and then refuse the launch after 120 seconds with "Postgres did
    not become healthy" while Postgres was healthy and already serving migrations.

    So the variable and the command line live together, and `scripts/review-instance.test.mjs`
    fails if a second compose call ever appears outside this function.
#>
function Invoke-Compose {
    param([string[]] $Arguments, [int] $TimeoutMs = 20000)

    $previous = [Environment]::GetEnvironmentVariable('PORTAL_POSTGRES_PASSWORD', 'Process')
    [Environment]::SetEnvironmentVariable('PORTAL_POSTGRES_PASSWORD', $script:ComposePassword, 'Process')
    try {
        return Invoke-Native -File 'docker' -Arguments (@('compose', '-f', "`"$ComposeFile`"") + $Arguments) -TimeoutMs $TimeoutMs
    } finally {
        [Environment]::SetEnvironmentVariable('PORTAL_POSTGRES_PASSWORD', $previous, 'Process')
    }
}

function Start-PortalServices {
    param([string] $PostgresPassword)

    if (-not (Test-Path -LiteralPath $ComposeFile)) {
        throw "$ComposeFile does not exist yet. It is lane A's file (postgres:16 + mailpit, loopback only). Nothing to start."
    }
    $script:ComposePassword = $PostgresPassword
    Write-Host "docker compose -f $ComposeFile up -d" -ForegroundColor Cyan
    $up = Invoke-Compose -Arguments @('up', '-d') -TimeoutMs 300000
    if ($up.TimedOut -or $up.ExitCode -ne 0) {
        throw "docker compose up failed: $($up.Output)"
    }
    Wait-ForPostgres
}

<#
    The portal opens a connection pool on boot, so it must not start before Postgres reports healthy
    - otherwise the first run dies on ECONNREFUSED and looks like a portal bug.
#>
function Wait-ForPostgres {
    $deadline = (Get-Date).AddSeconds($PostgresWaitSeconds)
    $containerId = $null

    while ((Get-Date) -lt $deadline) {
        if ([string]::IsNullOrEmpty($containerId)) {
            $ps = Invoke-Compose -Arguments @('ps', '-q', $PostgresService)
            if ($ps.ExitCode -eq 0 -and -not [string]::IsNullOrWhiteSpace($ps.Output)) {
                $containerId = ($ps.Output -split "`n")[0].Trim()
            }
        }
        if (-not [string]::IsNullOrEmpty($containerId)) {
            $health = Invoke-Native -File 'docker' -Arguments @('inspect', '-f', '"{{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}"', $containerId)
            $status = $health.Output
            if ($status -eq 'healthy') {
                Write-Host "Postgres is healthy." -ForegroundColor Green
                return
            }
            if ($status -eq 'none') {
                Write-Warning "The $PostgresService service declares no healthcheck; falling back to 'running'. Tell lane A."
                $running = Invoke-Native -File 'docker' -Arguments @('inspect', '-f', '"{{.State.Running}}"', $containerId)
                if ($running.Output -eq 'true') {
                    return
                }
            }
        }
        Start-Sleep -Seconds 2
    }
    throw "Postgres ($PostgresService) did not become healthy within $PostgresWaitSeconds seconds. Check: docker compose -f `"$ComposeFile`" logs $PostgresService"
}

# ---------------------------------------------------------------------------
# The three processes
# ---------------------------------------------------------------------------

<#
    Environment is handed over by setting it on THIS process just long enough for Start-Process to
    inherit it, then putting it back. Deliberately not `-Command "$env:X='...'; ..."`: that would put
    every secret on a command line, where anybody's Get-Process can read it.
#>
function Start-ReviewProcess {
    param([string] $Label, [hashtable] $Environment, [string] $File, [string[]] $Arguments)

    $previous = @{}
    foreach ($name in $Environment.Keys) {
        $previous[$name] = [Environment]::GetEnvironmentVariable($name, 'Process')
        [Environment]::SetEnvironmentVariable($name, $Environment[$name], 'Process')
    }
    try {
        $process = Start-Process -FilePath $File -ArgumentList $Arguments -WorkingDirectory $RepoRoot -PassThru
        Write-Host ("Started {0,-6} pid {1}" -f $Label, $process.Id) -ForegroundColor Green
        return [pscustomobject]@{
            label     = $Label
            pid       = $process.Id
            # Recorded so -Stop can tell THIS process from whatever later inherits its id. Windows
            # reuses process ids freely, and a stale pid file that kills a stranger is exactly the
            # accident this whole script is written to avoid.
            startedAt = $process.StartTime.ToString('o')
        }
    } finally {
        foreach ($name in $Environment.Keys) {
            [Environment]::SetEnvironmentVariable($name, $previous[$name], 'Process')
        }
    }
}

# ---------------------------------------------------------------------------
# The pid file - what -Stop is allowed to touch, and nothing else
# ---------------------------------------------------------------------------

function Read-ReviewPids {
    if (-not (Test-Path -LiteralPath $PidFile)) {
        return @()
    }
    try {
        $parsed = Get-Content -LiteralPath $PidFile -Raw | ConvertFrom-Json
    } catch {
        Write-Warning "$PidFile is not readable JSON; ignoring it. Delete it if nothing is running."
        return @()
    }
    return @($parsed)
}

function Write-ReviewPids {
    param([object[]] $Entries = @())

    if ($null -eq $Entries -or $Entries.Count -eq 0) {
        if (Test-Path -LiteralPath $PidFile) {
            Remove-Item -LiteralPath $PidFile -Force
        }
        return
    }
    Set-Content -LiteralPath $PidFile -Value (ConvertTo-Json @($Entries) -Depth 4) -Encoding utf8
}

<#
    Stops only what this script started.

    Three conditions, all of them required: the id is in our own pid file, a process with that id is
    alive, and its StartTime is the one recorded beside the id. The third is what makes a recycled
    id safe. Nothing here looks at a port, and :3000 - the operator's webdev - was never written
    into this file by anything, so it cannot be reached from here at all.
#>
function Stop-ReviewProcesses {
    # @() around the call, not just inside the function: PowerShell unrolls a returned empty array
    # into nothing at all, and under Set-StrictMode reading .Count off the resulting $null throws.
    $entries = @(Read-ReviewPids)
    if ($entries.Count -eq 0) {
        Write-Host 'Nothing recorded in the pid file; nothing to stop.' -ForegroundColor Yellow
        return
    }
    foreach ($entry in $entries) {
        $label = [string]$entry.label
        $processId = [int]$entry.pid
        $process = $null
        try {
            $process = Get-Process -Id $processId -ErrorAction Stop
        } catch {
            Write-Host ("{0,-6} pid {1} is already gone." -f $label, $processId)
            continue
        }
        $recorded = [string]$entry.startedAt
        $actual = ''
        try { $actual = $process.StartTime.ToString('o') } catch { }
        if ($recorded -and $actual -and $recorded -ne $actual) {
            Write-Warning "$label pid $processId is a different process now (started $actual, expected $recorded). Leaving it alone."
            continue
        }
        # THE WHOLE TREE, and this is not a detail. What this script starts is `npx` (or `pnpm`),
        # which starts pnpm, which starts tsx, which starts the node process that actually holds
        # the port. `Stop-Process -Id` kills the launcher at the top and orphans the listener, so
        # the next -Start waits out its twenty seconds on a port that is still bound and refuses.
        # `taskkill /T` walks down from the id verified above and takes the descendants with it;
        # Windows PowerShell 5.1 has no -Tree of its own. It still cannot reach anything that is
        # not a child of a process this script started, so :3000 is as unreachable as before.
        $kill = Invoke-Native -File 'taskkill' -Arguments @('/PID', "$processId", '/T', '/F')
        if ($kill.ExitCode -eq 0) {
            Write-Host ("Stopped {0,-6} pid {1} and its children" -f $label, $processId) -ForegroundColor Green
        } else {
            Write-Warning "Could not stop $label pid ${processId}: $($kill.Output)"
        }
    }
    Write-ReviewPids @()
}

<#
    A port freed by a Stop-Process is not free the instant the call returns, and the child node
    processes take a moment to notice their parent died. Waiting here turns "port in use" on a
    relaunch from a race into a real refusal.
#>
function Wait-ForPortFree {
    param([int] $Port, [string] $Label, [int] $TimeoutSeconds = 20)

    $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
    while ((Get-Date) -lt $deadline) {
        try {
            $listener = New-Object System.Net.Sockets.TcpListener([System.Net.IPAddress]::Loopback, $Port)
            $listener.Start()
            $listener.Stop()
            return
        } catch {
            Start-Sleep -Milliseconds 500
        }
    }
    throw "Port $Port ($Label) is still in use after $TimeoutSeconds seconds. Stop whatever holds it yourself, or pass a different port - this script never kills by port, and it must never reuse :3000, which is the shared webdev instance."
}

<#
    The built bundle, when -Production asked for one and there is none.

    Built here rather than left to the operator because -Production without a dist is not a
    configuration to warn about: apps/web/server.ts reads dist/index.html at boot and dies on
    ENOENT, so the instance would simply not come up.
#>
function Assert-WebBundle {
    if (Test-Path -LiteralPath $DistIndex) {
        Write-Host "Using the existing bundle at apps\web\dist." -ForegroundColor Green
        return
    }
    Write-Host 'apps\web\dist is missing; building it first.' -ForegroundColor Cyan
    # Start-Process rather than Invoke-Native: `pnpm` on Windows is a .cmd shim, which
    # Process.Start without a shell will not resolve, and the build's output belongs on this console.
    $build = Start-Process -FilePath $PnpmFile -ArgumentList ($PnpmLeading + @('--filter', '@agentforge/web', 'build')) `
        -WorkingDirectory $RepoRoot -NoNewWindow -Wait -PassThru
    if ($build.ExitCode -ne 0) {
        throw "The renderer build failed with exit code $($build.ExitCode), so -Production has nothing to serve."
    }
    if (-not (Test-Path -LiteralPath $DistIndex)) {
        throw "The renderer build reported success but $DistIndex does not exist."
    }
    Write-Host 'Built apps\web\dist.' -ForegroundColor Green
}

function Get-PortalEnvironment {
    param([hashtable] $Secrets)

    return @{
        'PORTAL_PORT'             = "$PortalPort"
        'PORTAL_DATA_DIR'         = $PortalData
        'PORTAL_DATABASE_URL'     = "postgres://$($PostgresUser):$($Secrets['PORTAL_POSTGRES_PASSWORD'])@127.0.0.1:$PostgresPort/$PostgresDb"
        'PORTAL_SIGNING_KEY'      = $Secrets['PORTAL_SIGNING_KEY']
        # The access token's `iss` and the device flow's verification_uri. A token minted with the
        # wrong issuer verifies nowhere, so this follows the name the browser actually used.
        'PORTAL_PUBLIC_URL'       = $PortalUrl
        # Only with something really in front. Every rate-limit bucket keys on the address this
        # decides, so believing a forwarded header with no proxy is handing the buckets away.
        'PORTAL_TRUST_PROXY'      = $(if ($PortalBehindProxy) { '1' } else { $null })
        'PORTAL_SMTP_HOST'        = $SmtpHost
        'PORTAL_SMTP_PORT'        = "$SmtpPort"
        'PORTAL_SMTP_FROM'        = $SmtpFrom
        # Owner decision 2026-09-21: the sandbox mailbox is the delivery path, and the manual
        # `pnpm --filter @agentforge/portal otp <email>` read-out is the fallback.
        # PORTAL_DEV_OUTBOX is gone.
        'PORTAL_ALLOW_MANUAL_OTP' = '1'
    }
}

function Get-AppEnvironment {
    param([hashtable] $Secrets)

    return @{
        'AGENTFORGE_SERVER'                 = '1'
        'PORT'                              = "$AppPort"
        'BIND_HOST'                         = '127.0.0.1'
        'AGENTFORGE_DATA_DIR'               = $DataDir
        # The Host header and the Origin are both checked against this, so these are the origins a
        # BROWSER uses, never the app's own port. See webapp-deploy/Caddyfile, and
        # packages/host/src/local-request.ts. Both the loopback proxy and the public name are in
        # the list, so a tunnel does not lock the operator out of their own curl drive.
        'AGENTFORGE_TRUSTED_ORIGINS'        = $TrustedOrigins
        'AGENTFORGE_PUBLIC_URL'             = $PublicUrl
        # Server to server AND the address bar: buildAuthorizeUrl (packages/host/src/auth/
        # portal-client.ts) builds the /authorize link the browser follows out of this same value,
        # so behind a tunnel it has to be the portal's public name, not the loopback one.
        'AGENTFORGE_PORTAL_URL'             = $PortalUrl
        'AGENTFORGE_PORTAL_CLIENT_ID'       = $Secrets['AGENTFORGE_PORTAL_CLIENT_ID']
        'AGENTFORGE_PORTAL_CLIENT_SECRET'   = $Secrets['AGENTFORGE_PORTAL_CLIENT_SECRET']
        'AGENTFORGE_SECRETS_KEY'            = $Secrets['AGENTFORGE_SECRETS_KEY']
        'AGENTFORGE_BILLING_WEBHOOK_SECRET' = $Secrets['AGENTFORGE_BILLING_WEBHOOK_SECRET']
        # Unset by default, so server.ts runs Vite and a renderer edit hot-reloads under the
        # reviewer. -Production sets it, which switches server.ts to apps/web/dist and turns on the
        # two boot refusals in apps/web/lib/hosted-mode-guard.ts - the mode the deployment runs in,
        # and the only way to see the production CSP against the real bundle.
        'NODE_ENV'                          = $(if ($Production) { 'production' } else { $null })
    }
}

# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

if ($Stop -and $Start) {
    throw 'Pass -Start or -Stop, not both. -Start already stops whatever it started last time.'
}

if ($Stop) {
    Write-Host "Stopping the processes recorded in $PidFile." -ForegroundColor Cyan
    Stop-ReviewProcesses
    Write-Host "Postgres and Mailpit are left running: docker compose -f `"$ComposeFile`" down stops those." -ForegroundColor Yellow
    return
}

$safeDataDir   = Assert-SafeDataDir -Path $DataDir   -Label 'AGENTFORGE_DATA_DIR'
$safePortalDir = Assert-SafeDataDir -Path $PortalData -Label 'PORTAL_DATA_DIR'
$secrets = Initialize-ReviewEnv

$portalEnv = Get-PortalEnvironment -Secrets $secrets
$appEnv    = Get-AppEnvironment -Secrets $secrets
$proxyArgs = @(
    (Join-Path $PSScriptRoot 'review-proxy.mjs'),
    '--listen', "$ProxyPort",
    '--upstream', "127.0.0.1:$AppPort",
    '--cert-dir', "`"$CertDir`""
)

Write-Host ''
Write-Host '=== DPSBuddy Phase 9 local review instance (harness, never ships) ===' -ForegroundColor Cyan
Write-Host "  repo        $RepoRoot"
Write-Host "  secrets     $EnvFile"
Write-Host "  app data    $safeDataDir"
Write-Host "  portal data $safePortalDir"
Write-Host "  certs       $CertDir"
Write-Host "  pids        $PidFile   (-Stop kills these three and nothing else)"
Write-Host "  mode        $(if ($Production) { 'production (NODE_ENV=production, apps\web\dist)' } else { 'development (Vite, hot reload)' })"
Write-Host "  proxy       $ProxyOrigin   (self-signed; accept the warning once)"
Write-Host "  app public  $PublicUrl"
Write-Host "  portal      $PortalUrl$(if ($PortalBehindProxy) { '   (PORTAL_TRUST_PROXY=1)' })"
Write-Host "  callbacks   $($RedirectUris -join ', ')"
Write-Host "  mailpit     $MailpitUrl"
Write-Host "  :3000 and .webdev-data are not touched by any of this."
Write-Host ''

Write-Host '--- 0. services and one-time setup (by hand, in this order) ---' -ForegroundColor Cyan
function Write-Step {
    param([string] $Command, [string] $Note)
    Write-Host ("  {0,-48}  # {1}" -f $Command, $Note)
}
$seedRedirects = ($RedirectUris | ForEach-Object { "--redirect $_" }) -join ' '
$seedTenantArgs = "--tenant $SeedTenant --tenant-name `"$SeedTenantName`" --org $SeedOrg --seat-cap $SeedSeatCap"
Write-Step "docker compose -f `"$ComposeFile`" up -d" "postgres:16 on $PostgresPort + mailpit, loopback only"
Write-Step "$PortalRun migrate" 'docs/internal/portal/migrations/0001-0005'
Write-Host "  $PortalRun seed -- --email $SeedEmail $seedTenantArgs $seedRedirects"
Write-Step '' "  -> prints the client id and secret ONCE; paste both into $EnvFile"
Write-Host "  $PortalRun seed -- --email second@$SeedTenant.test $seedTenantArgs"
Write-Host "  $PortalRun seed -- --email third@$SeedTenant.test  $seedTenantArgs"
Write-Step '' '  -> a re-run adds a user, keeps every id, and never reprints the secret'
Write-Step '' "  -> --tenant-name renames an EXISTING tenant to `"$SeedTenantName`" (name + branding)"
Write-Step "$PortalRun otp <email>" 'manual sign-in code (PORTAL_ALLOW_MANUAL_OTP=1)'
Write-Host "  (-Start does the compose step itself and waits for the Postgres healthcheck; migrate and"
Write-Host "   seed stay manual, because seed prints a secret exactly once. A re-seed with a new"
Write-Host "   --redirect ADDS it to the client and leaves the secret alone, so a tunnel URL can be"
Write-Host "   registered without re-pasting AGENTFORGE_PORTAL_CLIENT_SECRET.)"
Write-Host ''

Write-Host "--- 1. portal  ($PortalUrl) ---" -ForegroundColor Cyan
foreach ($name in ($portalEnv.Keys | Sort-Object)) {
    $value = $portalEnv[$name]
    if ($name -eq 'PORTAL_SIGNING_KEY') { $value = Format-Masked $value }
    if ($name -eq 'PORTAL_DATABASE_URL') { $value = "postgres://$($PostgresUser):********@127.0.0.1:$PostgresPort/$PostgresDb" }
    Write-Host ("  {0,-24} {1}" -f $name, $value)
}
Write-Host "  $PortalRun dev"
Write-Host ''

Write-Host "--- 2. app  (http://127.0.0.1:$AppPort, server mode) ---" -ForegroundColor Cyan
foreach ($name in ($appEnv.Keys | Sort-Object)) {
    $value = $appEnv[$name]
    if ($null -eq $value) { $value = '<unset, on purpose>' }
    elseif ($name -like '*SECRET*' -or $name -like '*KEY*' -or $value -eq '') { $value = Format-Masked $appEnv[$name] }
    Write-Host ("  {0,-34} {1}" -f $name, $value)
}
# `dev` and not `start`: apps/web's `start` script is `NODE_ENV=production tsx server.ts`, a POSIX
# env prefix that cmd.exe cannot run. The variable is inherited from this process instead, which is
# the same server.ts with the same NODE_ENV and works on Windows.
Write-Host "  $PnpmDisplay --filter @agentforge/web dev$(if ($Production) { '      # with NODE_ENV=production inherited' })"
Write-Host ''

Write-Host "--- 3. proxy  ($ProxyOrigin -> 127.0.0.1:$AppPort) ---" -ForegroundColor Cyan
Write-Host "  node $($proxyArgs -join ' ')"
Write-Host ''

if ([string]::IsNullOrEmpty($secrets['AGENTFORGE_PORTAL_CLIENT_SECRET'])) {
    Write-Warning "AGENTFORGE_PORTAL_CLIENT_SECRET is empty in $EnvFile. Sign-in will fail until you run ``$PortalRun seed`` and paste the client id and secret it prints into that file."
}

if (-not $Start) {
    Write-Host 'Print only. Re-run with -Start to launch all of it.' -ForegroundColor Yellow
    return
}

Write-Host 'Starting.' -ForegroundColor Cyan
# Relaunch is the same command: whatever this script started last time goes first, so the ports it
# owns are its own to reclaim. Anything else holding one is still a refusal.
Stop-ReviewProcesses
Assert-DockerUp
if ($Production) {
    Assert-WebBundle
}
foreach ($pair in @(@($PortalPort, 'portal'), @($AppPort, 'app'), @($ProxyPort, 'proxy'))) {
    Wait-ForPortFree -Port $pair[0] -Label $pair[1]
}
foreach ($dir in @($safeDataDir, $safePortalDir, $CertDir)) {
    if (-not (Test-Path -LiteralPath $dir)) {
        New-Item -ItemType Directory -Path $dir -Force | Out-Null
    }
}

Start-PortalServices -PostgresPassword $secrets['PORTAL_POSTGRES_PASSWORD']
$started = @(
    (Start-ReviewProcess -Label 'portal' -Environment $portalEnv -File $PnpmFile -Arguments ($PortalArgs + 'dev')),
    (Start-ReviewProcess -Label 'app'    -Environment $appEnv    -File $PnpmFile -Arguments ($PnpmLeading + @('--filter', '@agentforge/web', 'dev'))),
    (Start-ReviewProcess -Label 'proxy'  -Environment @{}        -File 'node'       -Arguments $proxyArgs)
)
Write-ReviewPids $started

Write-Host ''
Write-Host "Open      $PublicUrl" -ForegroundColor Green
Write-Host "Proxy     $ProxyOrigin        (always trusted, tunnel or not)" -ForegroundColor Green
Write-Host "Mailpit   $MailpitUrl        (every OTP the portal sends lands here)" -ForegroundColor Green
Write-Host "Manual    $PortalRun otp <email>   (newest live code, PORTAL_ALLOW_MANUAL_OTP=1)" -ForegroundColor Green
Write-Host "Stop      powershell -NoProfile -File scripts\review-instance.ps1 -Stop" -ForegroundColor Green
Write-Host "          (then docker compose -f `"$ComposeFile`" down for Postgres and Mailpit)" -ForegroundColor Green
