#!/usr/bin/env python3
"""Create the Chrome Web Store upload ZIP using only Python's standard library."""

import json
import re
import sys
import tempfile
import zipfile
from pathlib import Path


ROOT = Path(__file__).resolve().parent
# Keep this list in sync when adding extension assets. Development files stay out.
PACKAGE_FILES = (
    "manifest.json",
    "background.js",
    "content.js",
    "style.css",
    "options.html",
    "options.js",
    "icons/icon16.png",
    "icons/icon48.png",
    "icons/icon128.png",
    "LICENSE",
)


def main():
    manifest = json.loads((ROOT / "manifest.json").read_text(encoding="utf-8"))
    if manifest.get("manifest_version") != 3:
        raise ValueError("Expected a Manifest V3 extension.")
    version = manifest.get("version", "")
    if not isinstance(version, str) or not re.fullmatch(r"[0-9]+(?:\.[0-9]+){0,3}", version):
        raise ValueError("The manifest must contain a numeric extension version.")

    missing = [name for name in PACKAGE_FILES if not (ROOT / name).is_file()]
    if missing:
        raise ValueError("Missing package files: " + ", ".join(missing))

    output_dir = ROOT / "dist"
    output_dir.mkdir(exist_ok=True)
    output = output_dir / f"freeform-text-copy-{version}.zip"
    # Build separately so a failed run cannot replace an existing upload ZIP.
    with tempfile.TemporaryDirectory(dir=output_dir) as staging:
        temporary_zip = Path(staging) / "extension.zip"
        with zipfile.ZipFile(temporary_zip, "w", zipfile.ZIP_DEFLATED) as archive:
            for name in PACKAGE_FILES:
                archive.write(ROOT / name, arcname=name)
        temporary_zip.replace(output)

    print(f"Created: {output}")
    print("Upload this ZIP in the Chrome Web Store Developer Dashboard.")


if __name__ == "__main__":
    try:
        main()
    except (OSError, ValueError, zipfile.BadZipFile) as error:
        print(f"Packaging failed: {error}", file=sys.stderr)
        sys.exit(1)
