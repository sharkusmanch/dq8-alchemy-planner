#!/usr/bin/env python3
"""Build the PS2 memory card fixtures used by src/save/card.test.ts.

An independent implementation (mymc++, PyPI package `mymcplusplus`) formats the cards and
writes the files, so the TypeScript reader is tested against a card it did not produce.
Install it into a throwaway venv, never into the repo:

    python3 -m venv /tmp/mymcvenv && /tmp/mymcvenv/bin/pip install mymcplusplus
    /tmp/mymcvenv/bin/python tools/make_card_fixture.py

Output (gzip, under src/save/__fixtures__/):
  dq8-card.ps2.gz    two synthetic DQ8 saves (slots 0 and 3, gold 111 and 333) plus one
                     unrelated save directory; slot 3 is added first so the reader must sort
  empty-card.ps2.gz  a freshly formatted card with no saves
Only synthetic saves are used; never put a real save in a fixture.
"""
import gzip
import os
import subprocess
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "src" / "save" / "__fixtures__"


def mymc(card: Path, *args: str) -> None:
    subprocess.run([sys.executable, "-m", "mymcplusplus", str(card), *args], check=True, stdout=subprocess.DEVNULL)


def add_save(card: Path, directory: str, source: Path) -> None:
    mymc(card, "mkdir", directory)
    mymc(card, "add", "-d", directory, str(source))


def gzip_to(src: Path, dest: Path) -> None:
    # mtime=0 keeps the output reproducible
    with open(src, "rb") as f, open(dest, "wb") as raw, gzip.GzipFile(filename="", mode="wb", fileobj=raw, mtime=0, compresslevel=9) as gz:
        gz.write(f.read())


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix="dq8-card-") as tmp_name:
        tmp = Path(tmp_name)
        saves = tmp / "saves"
        subprocess.run(["node", str(ROOT / "tools" / "emit_synthetic_saves.mjs"), str(saves)], check=True, cwd=ROOT)

        other = saves / "BESLES-99999other"
        other.write_bytes(b"not a Dragon Quest VIII save\n" * 4)

        card = tmp / "dq8-card.ps2"
        mymc(card, "format")
        add_save(card, "BASLUS-21207dq8_3", saves / "BASLUS-21207dq8_3")
        add_save(card, "BASLUS-21207dq8_0", saves / "BASLUS-21207dq8_0")
        add_save(card, "BESLES-99999other", other)
        gzip_to(card, OUT / "dq8-card.ps2.gz")

        empty = tmp / "empty-card.ps2"
        mymc(empty, "format")
        gzip_to(empty, OUT / "empty-card.ps2.gz")

    for name in ("dq8-card.ps2.gz", "empty-card.ps2.gz"):
        print(f"{name}: {os.path.getsize(OUT / name)} bytes")


if __name__ == "__main__":
    main()
