#!/usr/bin/env python3
"""Static checks on a macOS .app built off-platform, plus dmg / zip round trips.

Nothing here launches the app (that needs a Mac). It proves the things that make an
off-platform build unstable when they are wrong:

  - every Mach-O in the bundle is for the requested arch; no Linux ELF or Windows PE slipped in
    (the Linux pnpm install leaves native modules for the host that must have been swapped)
  - the native modules the host needs are darwin binaries of the right arch
  - the Electron framework symlinks survived (Versions/Current -> A)
  - Info.plist names the product, id and version
  - app.asar holds every shell module main.cjs requires (missing one = crash on require)
  - staged resources (renderer, drizzle, brand, starters) are present
  - the main binary, framework and helpers carry an ad-hoc signature rcodesign accepts
  - with --dmg / --zip: the archive lists the same files at the same sizes, and the framework
    symlink is stored as a link, not a copy

Usage: verify-bundle.py --app <App.app> --arch arm64|x64 --version <v> [--dmg f] [--zip f]
"""
from __future__ import annotations

import argparse
import json
import os
import plistlib
import re
import shutil
import struct
import subprocess
import sys
import tempfile
from pathlib import Path

MACHO_MAGICS = {b"\xcf\xfa\xed\xfe": "<", b"\xce\xfa\xed\xfe": "<", b"\xfe\xed\xfa\xcf": ">", b"\xfe\xed\xfa\xce": ">"}
FAT_MAGICS = {b"\xca\xfe\xba\xbe", b"\xca\xfe\xba\xbf"}
CPU_TYPES = {0x0100000C: "arm64", 0x01000007: "x64"}
ELF_MAGIC = b"\x7fELF"
PE_MAGIC = b"MZ"

REQUIRED_ASAR_ENTRIES = [
    "/main.cjs",
    "/preload.cjs",
    "/brand-read.cjs",
    "/auto-update.cjs",
    "/edit-menu.cjs",
    "/lifecycle.cjs",
    "/host.cjs",
    "/package.json",
    "/splash/index.html",
]
REQUIRED_RESOURCES = [
    "Contents/Resources/app.asar",
    "Contents/Resources/renderer/index.html",
    "Contents/Resources/drizzle/meta/_journal.json",
    "Contents/Resources/brand/brand.json",
    "Contents/Resources/starters",
    "Contents/Resources/app.asar.unpacked/node_modules/keytar/build/Release/keytar.node",
]
FRAMEWORK = "Contents/Frameworks/Electron Framework.framework"
HELPERS = ["Agentforge Helper", "Agentforge Helper (GPU)", "Agentforge Helper (Plugin)", "Agentforge Helper (Renderer)"]


class Report:
    def __init__(self) -> None:
        self.failures: list[str] = []
        self.notes: list[str] = []

    def ok(self, message: str) -> None:
        print(f"verify: ok - {message}", flush=True)

    def fail(self, message: str) -> None:
        self.failures.append(message)
        print(f"verify: FAIL - {message}", flush=True)

    def note(self, message: str) -> None:
        self.notes.append(message)
        print(f"verify: note - {message}", flush=True)


def macho_archs(path: Path) -> list[str] | None:
    """Return the arch list for a Mach-O (thin or fat), None when not Mach-O."""
    with path.open("rb") as handle:
        head = handle.read(8)
        if len(head) < 8:
            return None
        magic = head[:4]
        if magic in MACHO_MAGICS:
            (cputype,) = struct.unpack(MACHO_MAGICS[magic] + "I", head[4:8])
            return [CPU_TYPES.get(cputype, f"cpu:{cputype:#x}")]
        if magic in FAT_MAGICS:
            (count,) = struct.unpack(">I", head[4:8])
            archs = []
            for _ in range(min(count, 8)):
                entry = handle.read(20 if magic == b"\xca\xfe\xba\xbe" else 32)
                (cputype,) = struct.unpack(">I", entry[:4])
                archs.append(CPU_TYPES.get(cputype, f"cpu:{cputype:#x}"))
            return archs
    return None


def foreign_binary(path: Path) -> str | None:
    with path.open("rb") as handle:
        head = handle.read(4)
    if head == ELF_MAGIC:
        return "ELF"
    if head[:2] == PE_MAGIC and path.suffix.lower() in {".node", ".dll", ".exe"}:
        return "PE"
    return None


def walk_files(app: Path):
    for root, dirs, files in os.walk(app, followlinks=False):
        for name in files:
            path = Path(root) / name
            if not path.is_symlink():
                yield path


def check_binaries(report: Report, app: Path, arch: str) -> None:
    machos = 0
    wrong: list[str] = []
    foreign: list[str] = []
    for path in walk_files(app):
        kind = foreign_binary(path)
        if kind:
            foreign.append(f"{kind} {path.relative_to(app)}")
            continue
        archs = macho_archs(path)
        if archs is None:
            continue
        machos += 1
        if arch not in archs:
            wrong.append(f"{path.relative_to(app)} -> {','.join(archs)}")
    if foreign:
        report.fail(f"{len(foreign)} non-Mach-O native binaries: {foreign[:5]}")
    else:
        report.ok("no ELF / PE binaries in the bundle")
    if wrong:
        report.fail(f"{len(wrong)} Mach-O files without {arch}: {wrong[:5]}")
    else:
        report.ok(f"all {machos} Mach-O files contain {arch}")
    sqlite = app / f"Contents/Resources/app.asar.unpacked/node_modules/better-sqlite3/prebuilds/darwin-{arch}.node"
    if sqlite.is_file() and macho_archs(sqlite) == [arch]:
        report.ok(f"better-sqlite3 prebuild darwin-{arch} present")
    else:
        report.fail(f"better-sqlite3 prebuild missing or wrong arch: {sqlite}")
    keytar = app / "Contents/Resources/app.asar.unpacked/node_modules/keytar/build/Release/keytar.node"
    if keytar.is_file() and macho_archs(keytar) == [arch]:
        report.ok(f"keytar.node is darwin-{arch}")
    else:
        report.fail("keytar.node missing or not the requested arch")
    sqlite_build = app / "Contents/Resources/app.asar.unpacked/node_modules/better-sqlite3/build"
    if sqlite_build.exists():
        report.fail("better-sqlite3/build exists in the bundle (host compile leaked)")


def check_layout(report: Report, app: Path, version: str) -> None:
    for rel in REQUIRED_RESOURCES:
        if (app / rel).exists():
            report.ok(f"present: {rel}")
        else:
            report.fail(f"missing: {rel}")
    main = app / "Contents/MacOS/Agentforge"
    if main.is_file() and os.access(main, os.X_OK):
        report.ok("main executable is executable")
    else:
        report.fail("Contents/MacOS/Agentforge missing or not executable")
    for helper in HELPERS:
        exe = app / f"Contents/Frameworks/{helper}.app/Contents/MacOS/{helper}"
        if not exe.is_file():
            report.fail(f"helper missing: {helper}")
        elif not os.access(exe, os.X_OK):
            report.fail(f"helper not executable: {helper}")
    report.ok(f"{len(HELPERS)} helper apps present and executable") if not any(
        message.startswith("helper") for message in report.failures
    ) else None
    current = app / FRAMEWORK / "Versions/Current"
    if current.is_symlink() and os.readlink(current) == "A":
        report.ok("Electron Framework Versions/Current -> A symlink intact")
    else:
        report.fail("Electron Framework Versions/Current is not a symlink to A")
    binary_link = app / FRAMEWORK / "Electron Framework"
    if not binary_link.is_symlink():
        report.fail("Electron Framework top-level binary link is not a symlink")
    plist_path = app / "Contents/Info.plist"
    try:
        with plist_path.open("rb") as handle:
            plist = plistlib.load(handle)
    except Exception as error:  # noqa: BLE001
        report.fail(f"Info.plist unreadable: {error}")
        return
    expected = {
        "CFBundleExecutable": "Agentforge",
        "CFBundleIdentifier": "com.tokotoken.agentforge",
        "CFBundleShortVersionString": version,
        "CFBundleName": "Agentforge",
    }
    for key, value in expected.items():
        if plist.get(key) == value:
            report.ok(f"Info.plist {key} = {value}")
        else:
            report.fail(f"Info.plist {key} = {plist.get(key)!r}, expected {value!r}")
    if "LSMinimumSystemVersion" in plist:
        report.note(f"LSMinimumSystemVersion {plist['LSMinimumSystemVersion']}")


def check_asar(report: Report, app: Path) -> None:
    asar = app / "Contents/Resources/app.asar"
    script = (
        "const asar=require('@electron/asar');"
        "console.log(JSON.stringify(asar.listPackage(process.argv[1], { isPack: false })))"
    )
    # @electron/asar comes from the workspace's node_modules: the build clone at /work, or the
    # mounted checkout at /src when verifying a finished artifact outside a build.
    cwd = next((path for path in ("/work", "/src") if os.path.isdir(os.path.join(path, "node_modules"))), None)
    if cwd is None:
        report.fail("no node_modules with @electron/asar reachable (/work or /src)")
        return
    result = subprocess.run(["node", "-e", script, str(asar.resolve())], capture_output=True, text=True, cwd=cwd)
    if result.returncode != 0:
        report.fail(f"could not list app.asar: {result.stderr[-500:]}")
        return
    entries = set(json.loads(result.stdout))
    missing = [entry for entry in REQUIRED_ASAR_ENTRIES if entry not in entries]
    if missing:
        report.fail(f"app.asar missing {missing}")
    else:
        report.ok(f"app.asar holds all {len(REQUIRED_ASAR_ENTRIES)} shell modules ({len(entries)} entries)")


def check_signatures(report: Report, app: Path) -> None:
    # Apple silicon enforces the signature on every Mach-O it loads, so all four helpers and the
    # framework are checked, not just the main binary.
    targets = [
        app / "Contents/MacOS/Agentforge",
        app / FRAMEWORK / "Versions/A/Electron Framework",
        *[app / f"Contents/Frameworks/{helper}.app/Contents/MacOS/{helper}" for helper in HELPERS],
    ]
    # rcodesign `verify` only accepts signatures with a certificate chain ("no cryptographic
    # signature present" for ad-hoc), so read the embedded signature instead and require a
    # CodeDirectory whose flags say ADHOC. Apple silicon checks exactly that at launch.
    for target in targets:
        info = subprocess.run(["rcodesign", "print-signature-info", str(target)], capture_output=True, text=True)
        text = info.stdout
        lines = [line.strip() for line in text.splitlines()]
        flags = next((line for line in lines if line.startswith("flags:")), "")
        identifier = next((line.split(":", 1)[1].strip() for line in lines if line.startswith("identifier:")), "")
        digests = next((line for line in lines if line.startswith("code_digests_count:")), "")
        if info.returncode == 0 and "code_directory:" in text and "ADHOC" in flags:
            report.ok(f"ad-hoc signature: {target.relative_to(app)} [{identifier}] {flags} {digests}")
        else:
            report.fail(f"no ad-hoc CodeDirectory on {target.relative_to(app)}: {(info.stderr or text)[-300:]}")


def source_manifest(app: Path) -> dict[str, int]:
    manifest = {}
    for path in walk_files(app):
        manifest[path.relative_to(app).as_posix()] = path.stat().st_size
    return manifest


def parse_7z_listing(text: str) -> tuple[dict[str, int], dict[str, str], dict[str, str]]:
    """Parse `7z l -slt` output into {path: size} for regular files, {path: attributes}, and
    {path: symlink target} for entries 7-Zip reports as symbolic links."""
    sizes: dict[str, int] = {}
    attrs: dict[str, str] = {}
    links: dict[str, str] = {}
    current: dict[str, str] = {}
    for line in text.splitlines() + [""]:
        if line.strip() == "":
            if current.get("Path"):
                path = current["Path"]
                link = current.get("Symbolic Link", "")
                if link:
                    links[path] = link
                elif current.get("Folder", "-") != "+":
                    try:
                        sizes[path] = int(current.get("Size", "0") or 0)
                    except ValueError:
                        sizes[path] = 0
                attrs[path] = current.get("Attributes", "")
            current = {}
            continue
        if " = " in line:
            key, value = line.split(" = ", 1)
            current[key.strip()] = value.strip()
    return sizes, attrs, links


def compare_manifest(report: Report, label: str, source: dict[str, int], listed: dict[str, int], attrs: dict[str, str]) -> None:
    app_key = "Agentforge.app/"
    inside: dict[str, int] = {}
    for path, size in listed.items():
        index = path.find(app_key)
        if index >= 0:
            inside[path[index + len(app_key):]] = size
    missing = [path for path in source if path not in inside]
    size_diff = [path for path in source if path in inside and inside[path] != source[path]]
    extra = [path for path in inside if path not in source]
    if missing:
        report.fail(f"{label}: {len(missing)} files missing: {missing[:5]}")
    elif size_diff:
        report.fail(f"{label}: {len(size_diff)} files differ in size: {size_diff[:5]}")
    else:
        report.ok(f"{label}: all {len(source)} files present with matching sizes")
    if extra:
        report.fail(f"{label}: {len(extra)} regular files not in the source bundle: {extra[:5]}")


def source_symlinks(app: Path) -> dict[str, str]:
    found: dict[str, str] = {}
    for root, dirs, files in os.walk(app, followlinks=False):
        for name in dirs + files:
            path = Path(root) / name
            if path.is_symlink():
                found[path.relative_to(app).as_posix()] = os.readlink(path)
    return found


HFS_LS_LINE = re.compile(r"^(\d{6})\s+\d+\s+\d+\s+(\d+)\s+\d{1,2}/\s?\d{1,2}/\d{4}\s+\d{2}:\d{2}\s+(.*)$")


class HfsCatalog:
    """Reads the HFS+ catalog inside a dmg through libdmg-hfsplus (`dmg extract` + `hfsplus ls`).
    7-Zip shows HFS+ symlinks as small files, so the catalog's own mode bits are the proof."""

    def __init__(self, dmg: Path) -> None:
        self.workdir = Path(tempfile.mkdtemp(prefix="verify-dmg-"))
        self.raw = self.workdir / "volume.hfs"
        result = subprocess.run(["dmg", "extract", str(dmg), str(self.raw)], capture_output=True, text=True)
        if result.returncode != 0 or not self.raw.exists():
            raise RuntimeError(f"dmg extract failed: {result.stderr[-300:] or result.stdout[-300:]}")
        self._cache: dict[str, dict[str, tuple[str, int]]] = {}

    def close(self) -> None:
        shutil.rmtree(self.workdir, ignore_errors=True)

    def listing(self, directory: str) -> dict[str, tuple[str, int]]:
        if directory not in self._cache:
            result = subprocess.run(["hfsplus", str(self.raw), "ls", directory], capture_output=True, text=True)
            entries: dict[str, tuple[str, int]] = {}
            for line in result.stdout.splitlines():
                match = HFS_LS_LINE.match(line)
                if match:
                    entries[match.group(3)] = (match.group(1), int(match.group(2)))
            self._cache[directory] = entries
        return self._cache[directory]

    def mode(self, path: str) -> str | None:
        directory, _, name = path.rpartition("/")
        entry = self.listing(directory or "/").get(name)
        return entry[0] if entry else None


def check_dmg_catalog(report: Report, app: Path, dmg: Path) -> None:
    try:
        catalog = HfsCatalog(dmg)
    except RuntimeError as error:
        report.fail(str(error))
        return
    try:
        root = f"/{app.name}"
        expected_links = source_symlinks(app)
        not_links = [rel for rel in expected_links if not (catalog.mode(f"{root}/{rel}") or "").startswith("12")]
        if not_links:
            report.fail(f"dmg catalog: {len(not_links)} entries are not symlinks: {not_links[:5]}")
        else:
            report.ok(f"dmg catalog: all {len(expected_links)} symlinks have S_IFLNK mode")
        applications = catalog.mode("/Applications")
        if applications and applications.startswith("12"):
            report.ok("dmg catalog: /Applications is a symlink at the volume root")
        else:
            report.fail(f"dmg catalog: /Applications mode {applications}")
        executables = []
        for path in walk_files(app):
            if path.stat().st_mode & 0o111:
                executables.append(path.relative_to(app).as_posix())
        lost = [rel for rel in executables if not (catalog.mode(f"{root}/{rel}") or "").endswith("755")]
        if lost:
            report.fail(f"dmg catalog: execute bit lost on {len(lost)} files: {lost[:5]}")
        else:
            report.ok(f"dmg catalog: execute bit kept on all {len(executables)} executables")
        main_mode = catalog.mode(f"{root}/Contents/MacOS/Agentforge")
        report.note(f"dmg catalog: Contents/MacOS/Agentforge mode {main_mode}")
    finally:
        catalog.close()


def check_dmg(report: Report, app: Path, dmg: Path) -> None:
    if shutil.which("7z") is None:
        report.fail("7z not available to read the dmg back")
        return
    result = subprocess.run(["7z", "l", "-slt", str(dmg)], capture_output=True, text=True)
    if result.returncode != 0:
        report.fail(f"7z could not read the dmg: {result.stderr[-300:]}")
        return
    sizes, attrs, _links = parse_7z_listing(result.stdout)
    # 7-Zip lists HFS+ symlinks as files whose size is the target length; drop those before comparing.
    app_key = "Agentforge.app/"
    expected_links = source_symlinks(app)
    files_only: dict[str, int] = {}
    link_size_mismatch = []
    for path, size in sizes.items():
        index = path.find(app_key)
        rel = path[index + len(app_key):] if index >= 0 else None
        if rel in expected_links:
            if size != len(expected_links[rel]):
                link_size_mismatch.append(f"{rel} size {size} != len({expected_links[rel]!r})")
            continue
        if path.rstrip("/").endswith("Applications") and index < 0:
            continue
        files_only[path] = size
    if link_size_mismatch:
        report.fail(f"dmg: symlink payloads differ: {link_size_mismatch[:5]}")
    else:
        report.ok(f"dmg: 7-Zip sees {len(expected_links)} symlink entries whose payload is the link target")
    compare_manifest(report, "dmg", source_manifest(app), files_only, attrs)
    check_dmg_catalog(report, app, dmg)


def check_zip(report: Report, app: Path, zip_path: Path) -> None:
    result = subprocess.run(["zipinfo", str(zip_path)], capture_output=True, text=True)
    if result.returncode != 0:
        report.fail(f"zipinfo failed: {result.stderr[-300:]}")
        return
    sizes: dict[str, int] = {}
    modes: dict[str, str] = {}
    for line in result.stdout.splitlines():
        parts = line.split()
        if len(parts) < 9 or not parts[0].startswith(("-", "l", "d")):
            continue
        name = line.split(maxsplit=8)[8]
        modes[name] = parts[0]
        if parts[0].startswith("-"):
            sizes[name] = int(parts[3])
    compare_manifest(report, "zip", source_manifest(app), sizes, {})
    current = next((mode for name, mode in modes.items() if name.endswith("Versions/Current")), None)
    if current and current.startswith("l"):
        report.ok("zip stores Versions/Current as a symlink")
    else:
        report.fail(f"zip does not store Versions/Current as a symlink (mode {current})")
    main_mode = next((mode for name, mode in modes.items() if name.endswith("Contents/MacOS/Agentforge")), "")
    if "x" in main_mode:
        report.ok("zip keeps the execute bit on the main binary")
    else:
        report.fail(f"zip lost the execute bit on the main binary (mode {main_mode})")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--app", required=True, type=Path)
    parser.add_argument("--arch", required=True, choices=["arm64", "x64"])
    parser.add_argument("--version", required=True)
    parser.add_argument("--dmg", type=Path)
    parser.add_argument("--zip", type=Path)
    args = parser.parse_args()

    report = Report()
    app: Path = args.app
    if not app.is_dir():
        report.fail(f"{app} is not a directory")
    else:
        if args.dmg is None and args.zip is None:
            check_binaries(report, app, args.arch)
            check_layout(report, app, args.version)
            check_asar(report, app)
            check_signatures(report, app)
        if args.dmg is not None:
            check_dmg(report, app, args.dmg)
        if args.zip is not None:
            check_zip(report, app, args.zip)
    if report.failures:
        print(f"verify: {len(report.failures)} failure(s)", file=sys.stderr)
        sys.exit(1)
    print("verify: all checks passed", flush=True)


if __name__ == "__main__":
    main()
