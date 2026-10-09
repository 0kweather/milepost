"""Stamp every local file reference with a version so browsers never mix old
and new files after a deploy (GitHub Pages lets them cache for 10 minutes).

Source files use "?v=dev"; the deploy workflow runs this with the commit SHA:

    python3 scripts/stamp.py <version>
"""
import pathlib, re, sys

version = re.sub(r"[^\w.-]", "", sys.argv[1])[:12]
root = pathlib.Path(__file__).resolve().parent.parent
for path in [root / "index.html", *sorted((root / "js").glob("*.js"))]:
    text = path.read_text()
    stamped = text.replace("?v=dev", f"?v={version}")
    if stamped != text:
        path.write_text(stamped)
        print(f"stamped {path.relative_to(root)}")
