#!/usr/bin/env python3
"""Build a macOS dmg from an .app bundle without hdiutil.

Layout matches what electron-builder produces on a Mac: a volume holding <App>.app and a
symlink to /Applications for drag-and-drop install. Steps:

  1. mkfs.hfsplus on a sparse file sized to the bundle (hfsprogs)
  2. hfsplus (libdmg-hfsplus) populates it entry by entry: mkdir / add / symlink / chmod.
     Symlinks are recreated as symlinks (the Electron framework needs Versions/Current -> A),
     and execute bits are carried over. addall is not used because it follows symlinks.
  3. dmg build (libdmg-hfsplus) wraps the image as a zlib-compressed UDIF (UDZO).

Usage: make-dmg.py --app <path/App.app> --out <file.dmg> --volume <name>
"""
from __future__ import annotations

import argparse
import os
import shutil
import stat
import subprocess
import sys
import tempfile
from pathlib import Path

MIN_SIZE_MB = 64
SLACK_RATIO = 0.25
PER_ENTRY_OVERHEAD = 8192
MAX_SIZE_MB = 2048
MAX_ATTEMPTS = 3


def log(message: str) -> None:
    print(f"make-dmg: {message}", flush=True)


class VolumeFullError(Exception):
    """hfsplus mkdir/add returned 0 but the catalog did not grow."""


def fail(message: str) -> "NoReturn":
    print(f"make-dmg: ERROR: {message}", file=sys.stderr, flush=True)
    sys.exit(1)


def run(args: list[str], *, check_output_for: tuple[str, ...] = ()) -> str:
    result = subprocess.run(args, capture_output=True, text=True)
    output = (result.stdout or "") + (result.stderr or "")
    if result.returncode != 0:
        fail(f"{' '.join(args[:3])} ... exited {result.returncode}\n{output[-2000:]}")
    for marker in check_output_for:
        if marker in output:
            fail(f"{' '.join(args[:3])} ... reported '{marker}'\n{output[-2000:]}")
    return output


class HfsImage:
    """Thin driver around the hfsplus CLI. Every call is a separate process; the tool prints
    errors instead of failing, so the known error strings are checked on each call."""

    ERRORS = ("Not enough arguments", "not found", "No such file")

    def __init__(self, image: Path) -> None:
        self.image = str(image)
        self.calls = 0

    def _cmd(self, *args: str) -> str:
        self.calls += 1
        return run(["hfsplus", self.image, *args], check_output_for=self.ERRORS)

    def mkdir(self, dest: str) -> None:
        self._cmd("mkdir", dest)

    def add(self, local: Path, dest: str) -> None:
        self._cmd("add", str(local), dest)

    def symlink(self, dest: str, target: str) -> None:
        self._cmd("symlink", dest, target)

    def chmod(self, mode: int, dest: str) -> None:
        self._cmd("chmod", f"{mode:o}", dest)

    def ls(self, dest: str) -> str:
        return self._cmd("ls", dest)

    def names(self, dest: str) -> set[str]:
        """Entry names in a directory, parsed from `ls`.

        libdmg-hfsplus prints either a ctime date (`Jan 01 1980`, 8 columns) or a
        numeric date (`8/12/2026 12:17`, 7 columns). The name is always the last field.
        """
        found: set[str] = set()
        for line in self.ls(dest).splitlines():
            parts = line.split()
            if len(parts) >= 5 and parts[0].isdigit():
                found.add(parts[-1])
        return found

    def expect(self, dest_dir: str, names: list[str]) -> None:
        """hfsplus returns 0 and prints nothing when the catalog cannot grow (e.g. volume full),
        so every directory is read back once after it is filled."""
        present = self.names(dest_dir)
        missing = [name for name in names if name not in present]
        if missing:
            raise VolumeFullError(
                f"{dest_dir}: {len(missing)} entries did not land in the image (volume full?): {missing[:5]}"
            )


def bundle_size(app: Path) -> tuple[int, int]:
    total = 0
    entries = 0
    for root, dirs, files in os.walk(app):
        entries += 1 + len(dirs) + len(files)
        for name in files:
            path = Path(root) / name
            if path.is_symlink():
                continue
            total += path.stat().st_size
    return total, entries


def image_size_bytes(app: Path) -> int:
    total, entries = bundle_size(app)
    padded = int(total * (1 + SLACK_RATIO)) + entries * PER_ENTRY_OVERHEAD + 16 * 1024 * 1024
    megabytes = max(MIN_SIZE_MB, (padded + 1024 * 1024 - 1) // (1024 * 1024))
    return megabytes * 1024 * 1024


def populate(image: HfsImage, app: Path, volume_root: str) -> dict[str, int]:
    """Walk the bundle top-down and mirror it into the image. Returns counts."""
    counts = {"dirs": 0, "files": 0, "symlinks": 0, "executables": 0}
    app_dest = f"{volume_root}/{app.name}"
    image.mkdir(app_dest)
    counts["dirs"] += 1
    for root, dirs, files in os.walk(app, topdown=True, followlinks=False):
        root_path = Path(root)
        rel_root = root_path.relative_to(app)
        dest_root = app_dest if str(rel_root) == "." else f"{app_dest}/{rel_root.as_posix()}"
        # Directory symlinks show up in dirs; handle them as links and do not descend.
        real_dirs = []
        for name in sorted(dirs):
            path = root_path / name
            if path.is_symlink():
                image.symlink(f"{dest_root}/{name}", os.readlink(path))
                counts["symlinks"] += 1
            else:
                image.mkdir(f"{dest_root}/{name}")
                counts["dirs"] += 1
                real_dirs.append(name)
        dirs[:] = real_dirs
        for name in sorted(files):
            path = root_path / name
            dest = f"{dest_root}/{name}"
            if path.is_symlink():
                image.symlink(dest, os.readlink(path))
                counts["symlinks"] += 1
                continue
            image.add(path, dest)
            counts["files"] += 1
            mode = path.stat().st_mode
            if mode & stat.S_IXUSR:
                image.chmod(0o755, dest)
                counts["executables"] += 1
        image.expect(dest_root, sorted(dirs) + sorted(files) + [d for d in os.listdir(root_path) if (root_path / d).is_symlink()])
    return counts


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--app", required=True, type=Path)
    parser.add_argument("--out", required=True, type=Path)
    parser.add_argument("--volume", required=True)
    parser.add_argument("--keep-image", action="store_true", help="leave the raw .hfs next to the dmg")
    args = parser.parse_args()

    app: Path = args.app
    if not app.is_dir() or app.suffix != ".app":
        fail(f"{app} is not an .app directory")
    for tool in ("mkfs.hfsplus", "hfsplus", "dmg"):
        if shutil.which(tool) is None:
            fail(f"{tool} not on PATH")

    args.out.parent.mkdir(parents=True, exist_ok=True)
    if args.out.exists():
        args.out.unlink()

    size = image_size_bytes(app)
    max_size = MAX_SIZE_MB * 1024 * 1024
    workdir = Path(tempfile.mkdtemp(prefix="make-dmg-"))
    raw = workdir / "volume.hfs"
    try:
        for attempt in range(1, MAX_ATTEMPTS + 1):
            if raw.exists():
                raw.unlink()
            log(f"creating {size // (1024 * 1024)} MB HFS+ image for {app.name} (attempt {attempt})")
            with raw.open("wb") as handle:
                handle.truncate(size)
            run(["mkfs.hfsplus", "-v", args.volume, str(raw)])

            image = HfsImage(raw)
            try:
                counts = populate(image, app, "")
            except VolumeFullError as err:
                if attempt == MAX_ATTEMPTS or size >= max_size:
                    fail(str(err))
                size = min(size * 2, max_size)
                log(f"volume full; retrying at {size // (1024 * 1024)} MB ({err})")
                continue

            image.symlink("/Applications", "/Applications")
            counts["symlinks"] += 1
            log(
                "populated: {dirs} dirs, {files} files, {symlinks} symlinks, {executables} executables "
                "({calls} hfsplus calls)".format(**counts, calls=image.calls)
            )

            listing = image.ls("/")
            if app.name not in listing or "Applications" not in listing:
                fail(f"volume root does not list {app.name} and Applications:\n{listing}")

            log(f"building UDZO dmg -> {args.out}")
            run(["dmg", "build", str(raw), str(args.out)])
            if not args.out.exists() or args.out.stat().st_size < 1024 * 1024:
                fail("dmg build produced no usable file")
            log(f"dmg size {args.out.stat().st_size // (1024 * 1024)} MB")
            if args.keep_image:
                shutil.copy2(raw, args.out.with_suffix(".hfs"))
            break
    finally:
        shutil.rmtree(workdir, ignore_errors=True)


if __name__ == "__main__":
    main()
