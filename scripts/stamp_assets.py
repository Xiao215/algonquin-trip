#!/usr/bin/env python3
"""Stamp docs/index.html's CSS and JS links with a hash of each file (styles.css?v=1a2b3c4d).

GitHub Pages lets browsers reuse files for 10 minutes, so right after a push a visitor can get the
new index.html with an old styles.css and see broken layout. A changed ?v= makes the browser fetch
the matching file. The pre-commit hook in .githooks runs this; run it by hand if the hook is off.
Prints the files it changed; exits 0 either way.
"""
import hashlib
import re
from pathlib import Path

DOCS = Path(__file__).resolve().parent.parent / "docs"
INDEX = DOCS / "index.html"
REF = re.compile(r'((?:href|src)=")([\w./-]+\.(?:css|js))(?:\?v=[0-9a-f]*)?(")')


def stamp(m: re.Match) -> str:
    path = DOCS / m.group(2)
    if not path.is_file():
        return m.group(0)
    digest = hashlib.sha256(path.read_bytes()).hexdigest()[:8]
    return f"{m.group(1)}{m.group(2)}?v={digest}{m.group(3)}"


def main() -> None:
    old = INDEX.read_text()
    new = REF.sub(stamp, old)
    if new != old:
        INDEX.write_text(new)
        print(f"stamped {INDEX.relative_to(DOCS.parent)}")


if __name__ == "__main__":
    main()
