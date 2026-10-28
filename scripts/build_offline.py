"""Bundle the offline edition into one file: dist/lineup-card.html.

Every script, stylesheet, font, html-to-image and the fictional sample go
inside the file. A Content-Security-Policy stops the
browser from loading or sending anything over the network.

The bundler is ours and handles only our own code style:
  import { a, b as c } from "./x.js";        (one or more lines, relative paths)
  export function / async function / const / class NAME
Anything else stops the build with a message. In particular:
  - "export let" is refused: the bundle copies each export once, at load,
    so a later reassignment would not be seen by importers.
  - "export const a = 1, b = 2" (several names in one export) is refused.
    The check reads only the export's first line, so a second name after a
    multi-line value is not caught; write one name per export.

Run: .venv/bin/python scripts/build_offline.py
"""

from __future__ import annotations

import base64
import hashlib
import re
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
WEB = ROOT / "web"
OUT = ROOT / "dist" / "lineup-card.html"
ENTRY = "js/offline.js"

# Scripts run only if their exact text matches a sha256 hash in the policy (the image
# library and the app). Styles keep 'unsafe-inline': the pages set inline style attributes.
CSP = ("default-src 'none'; script-src {hashes}; style-src 'unsafe-inline'; "
       "font-src data:; img-src data: blob:; connect-src data:; base-uri 'none'; form-action 'none'")


def sha256_source(text: str) -> str:
    return "'sha256-" + base64.b64encode(hashlib.sha256(text.encode("utf-8")).digest()).decode() + "'"

# Third-party licenses travel with the file: a short notice plus each full text,
# inlined as a non-executed <script type="text/plain" id="licenses"> block.
# package_club_edition.py copies the same files into dist/club-edition/licenses/.
LICENSE_FILES = (  # (name in the package, source)
    ("LICENSE-html-to-image.txt", WEB / "vendor" / "LICENSE-html-to-image.txt"),
    ("OFL.txt", WEB / "fonts" / "OFL.txt"),
    ("LICENSE-anatomy-kit.txt", WEB / "figures" / "board" / "vendor" / "LICENSE"),
)
NOTICE = """Lineup Card, Club Edition: third-party notices

- html-to-image 1.11.11 (MIT License, Copyright (c) 2017-2023 W.Y.): used by "Save as image".
- Fraunces, Hanken Grotesk and IBM Plex Mono fonts (SIL Open Font License 1.1): the fonts.
- Anatomy isometric drawing kit, iso-kit and lathe (MIT License, Copyright (c) 2026 Ryan):
  used at build time to draw figures for this project. No drawing from it is in this file.

The full license texts follow.
"""


def license_text() -> str:
    parts = [NOTICE]
    for name, path in LICENSE_FILES:
        parts.append(f"\n===== {name} =====\n\n{path.read_text(encoding='utf-8').strip()}\n")
    return "".join(parts)


IMPORT = re.compile(r'^import\s*\{([^}]*)\}\s*from\s*"(\.\.?/[^"]+)";?[ \t]*$', re.M)
EXPORT_DECL = re.compile(r'^export\s+(async\s+function|function|const|class)\s+([A-Za-z_$][\w$]*)', re.M)
EXPORT_LET = re.compile(r'^export\s+let\b', re.M)
EXPORT_CONST_LINE = re.compile(r'^export\s+const\s+[A-Za-z_$][\w$]*\s*=(.*)$', re.M)
LEFTOVER = re.compile(r'^\s*(import|export)\b', re.M)


def fail(msg: str) -> None:
    raise SystemExit(f"build_offline: {msg}")


def second_binding(rest: str) -> bool:
    """True when the rest of an export's first line has a top-level ", name =" (a second binding)."""
    depth, quote, i = 0, "", 0
    while i < len(rest):
        c = rest[i]
        if quote:
            if c == "\\":
                i += 1
            elif c == quote:
                quote = ""
        elif c in "'\"`":
            quote = c
        elif c in "([{":
            depth += 1
        elif c in ")]}":
            depth -= 1
        elif c == "," and depth == 0 and re.match(r",\s*[A-Za-z_$][\w$]*\s*=(?!=|>)", rest[i:]):
            return True
        elif c == "/" and rest[i:i + 2] == "//":
            return False
        i += 1
    return False


def strip_exports(key: str, body: str) -> tuple[str, list[str]]:
    """Turn 'export function/const/class NAME' into plain declarations; return the names."""
    if EXPORT_LET.search(body):
        fail(f"{key}: 'export let' is not supported (importers would not see later changes). Use export const.")
    for m in EXPORT_CONST_LINE.finditer(body):
        if second_binding(m.group(1)):
            fail(f"{key}: one name per export, please: {m.group(0).strip()!r}")
    names = [n for _, n in EXPORT_DECL.findall(body)]
    return EXPORT_DECL.sub(lambda m: f"{m.group(1)} {m.group(2)}", body), names


def module_path(base: Path, spec: str) -> Path:
    return (base.parent / spec).resolve()


def key_of(path: Path) -> str:
    return path.relative_to(WEB.resolve()).as_posix()


def bundle(entry: Path) -> str:
    order: list[Path] = []
    state: dict[Path, str] = {}

    def visit(path: Path) -> None:
        if state.get(path) == "done":
            return
        if state.get(path) == "busy":
            fail(f"import cycle at {key_of(path)}")
        if not path.is_file():
            fail(f"missing module {path}")
        state[path] = "busy"
        for _, spec in IMPORT.findall(path.read_text(encoding="utf-8")):
            visit(module_path(path, spec))
        state[path] = "done"
        order.append(path)

    visit(entry.resolve())
    parts = ["const __m = {};"]
    for path in order:
        src = path.read_text(encoding="utf-8")
        key = key_of(path)

        def imp(m: re.Match) -> str:
            dep = key_of(module_path(path, m.group(2)))
            names = []
            for n in m.group(1).split(","):
                n = " ".join(n.split())
                if not n:
                    continue
                if not re.fullmatch(r"[A-Za-z_$][\w$]*( as [A-Za-z_$][\w$]*)?", n):
                    fail(f"{key}: cannot bundle import name {n!r}")
                names.append(n.replace(" as ", ": "))
            return f'const {{ {", ".join(names)} }} = __m["{dep}"];'

        body = IMPORT.sub(imp, src)
        body, names = strip_exports(key, body)
        left = LEFTOVER.search(body)
        if left:
            line = body[left.start():].strip().splitlines()[0]
            fail(f"{key}: unsupported import/export form: {line!r}. "
                 "Use 'import { a } from \"./x.js\"' and 'export function/const/class NAME'.")
        exports = ", ".join(names)
        parts.append(f'__m["{key}"] = await (async () => {{\n{body}\nreturn {{ {exports} }};\n}})();')
    return "\n".join(parts)


def css(path: Path) -> str:
    text = path.read_text(encoding="utf-8")
    if "@import" in text:
        fail(f"{path.name}: @import is not supported; link each sheet from offline.html")

    def font(m: re.Match) -> str:
        data = base64.b64encode((path.parent / m.group(1)).read_bytes()).decode()
        return f'url("data:font/woff2;base64,{data}")'

    text = re.sub(r'url\("(\.\./fonts/[^"]+\.woff2)"\)', font, text)
    other = re.search(r'url\(\s*(?!["\']?(?:data:|#))', text, re.I)
    if other:
        fail(f"{path.name}: url() that would load a file: {text[other.start():other.start() + 60]!r}")
    return text


def safe_inline(name: str, text: str) -> str:
    """An inline <script> ends at the first </script; <!-- can confuse the parser too."""
    if re.search(r"</script|<!--", text, re.I):
        fail(f"{name} contains '</script' or '<!--' and cannot be inlined")
    return text


def replace_once(page: str, old: str, new: str) -> str:
    if page.count(old) != 1:
        fail(f"expected exactly one {old!r} in offline.html, found {page.count(old)}")
    return page.replace(old, new)


def main() -> None:
    subprocess.run([sys.executable, str(ROOT / "scripts" / "write_sample_module.py")], check=True, cwd=ROOT)
    page = (WEB / "offline.html").read_text(encoding="utf-8")

    # 1. Screen markup from the hosted pages (scripts removed), so it is never copied by hand.
    for tpl, src in (("tpl-review", "index.html"), ("tpl-card", "card.html")):
        found = re.search(r"<body>(.*)</body>", (WEB / src).read_text(encoding="utf-8"), re.S)
        if not found:
            fail(f"no <body> in {src}")
        body = re.sub(r"<script\b.*?</script>", "", found.group(1), flags=re.S | re.I).strip()
        page = replace_once(page, f'<template id="{tpl}" data-from="{src}"></template>',
                            f'<template id="{tpl}">\n{body}\n</template>')

    # 2. Each stylesheet link becomes a <style> in the same place, keeping its id.
    def style(m: re.Match) -> str:
        href, sheet_id = m.group(1), m.group(2)
        attr = f' id="{sheet_id}"' if sheet_id else ""
        return f"<style{attr}>\n{css(WEB / href)}\n</style>"

    page, n = re.subn(r'<link rel="stylesheet" href="(css/[^"]+)"(?: id="([^"]+)")?>', style, page)
    if n != 5:
        fail(f"expected 5 stylesheet links in offline.html, found {n}")
    page = re.sub(r"[ \t]*<!-- No CSP here:.*?-->\n", "", page)

    # 3. Scripts: the licenses (inert data), the image library, then the app.
    lib = safe_inline("html-to-image.js", (WEB / "vendor" / "html-to-image.js").read_text(encoding="utf-8"))
    app = safe_inline("app bundle", bundle(WEB / ENTRY))
    notices = safe_inline("license texts", license_text())
    lib_body, app_body = f"\n{lib}\n", f"\n{app}\n"
    scripts = (f'<script type="text/plain" id="licenses">\n{notices}</script>\n'
               f'<script id="vendor-html-to-image">{lib_body}</script>\n'
               f'<script type="module">{app_body}</script>')
    page = replace_once(page, '<script type="module" src="js/offline.js"></script>', scripts)

    # 4. The policy goes first in <head>, before anything it governs. Only the two
    #    executed scripts are hashed; the text/plain block never runs.
    policy = CSP.format(hashes=" ".join(sha256_source(b) for b in (lib_body, app_body)))
    page = replace_once(page, "<head>", f'<head>\n<meta http-equiv="Content-Security-Policy" content="{policy}">')

    OUT.parent.mkdir(exist_ok=True)
    OUT.write_text(page, encoding="utf-8")
    size = OUT.stat().st_size
    print(f"wrote {OUT.relative_to(ROOT)} ({size / 1024:.0f} KiB)")
    if size >= 3_000_000:
        fail(f"bundle is {size} bytes, over the 3 MB budget")


if __name__ == "__main__":
    main()
