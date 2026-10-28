import base64
import hashlib
import re
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "dist" / "lineup-card.html"


def build() -> str:
    subprocess.run([sys.executable, str(ROOT / "scripts" / "build_offline.py")], check=True, cwd=ROOT)
    return OUT.read_text(encoding="utf-8")


def test_one_file_with_a_csp_that_blocks_the_network():
    html = build()
    csp = re.search(r'<meta http-equiv="Content-Security-Policy" content="([^"]+)"', html)
    assert csp, "CSP meta missing"
    assert html.index("Content-Security-Policy") < html.index("<style"), "CSP must come before any content"
    policy = csp.group(1)
    assert "default-src 'none'" in policy
    assert "connect-src data:" in policy
    assert "http" not in policy


def test_nothing_is_loaded_from_anywhere():
    html = build()
    html = re.sub(r'<script id="vendor-html-to-image">.*?</script>', "", html, flags=re.S)   # third-party source text
    assert not re.search(r'<(script|link|img|iframe)[^>]+(src|href)=', html), "external tag"
    assert not re.search(r'url\(\s*(?!["\']?(?:data:|#))', html), "url() that is not data: or #id"
    styles = "".join(re.findall(r"<style[^>]*>(.*?)</style>", html, re.S))
    assert not re.search(r'url\(\s*(?!["\']?(?:data:|#))', styles, re.I), "CSS url() in any case"
    assert not re.search(r'^\s*(import|export)\s', html, re.M), "unbundled module syntax"
    assert "fonts.googleapis" not in html and "jsdelivr" not in html


def test_contains_the_app_and_the_sample_but_not_the_board():
    html = build()
    for marker in ('id="tpl-load"', 'id="tpl-review"', 'id="tpl-card"', "Fictional Triple-A Club", "buildDays", "trendSvg"):
        assert marker in html, marker
    assert 'id="board-svg"' not in html
    assert len(html.encode("utf-8")) < 3_000_000


def test_screen_stylesheets_keep_their_ids_and_order():
    html = build()
    head = html[: html.index("</head>")]
    ids = re.findall(r'<style(?: id="([^"]*)")?>', head)
    assert ids == ["", "", "css-card", "css-review", ""], ids     # fonts, theme, card, review, offline


def test_templates_are_filled_so_the_dev_fetch_never_runs():
    html = build()
    for tpl in ("tpl-review", "tpl-card"):
        body = re.search(rf'<template id="{tpl}">(.*?)</template>', html, re.S)
        assert body and body.group(1).strip(), tpl
        assert "<script" not in body.group(1)
    assert "data-from=" not in html


def test_licenses_travel_inside_the_file():
    html = build()
    block = re.search(r'<script type="text/plain" id="licenses">(.*?)</script>', html, re.S)
    assert block, "licenses block missing"
    text = block.group(1)
    assert "</script" not in text.lower()
    for need in ("html-to-image", "SIL OPEN FONT LICENSE", "Copyright (c) 2026 Ryan", "Permission is hereby granted"):
        assert need in text, need
    assert text.count("Permission is hereby granted") >= 2, "both MIT texts"


def test_scripts_are_allowed_by_hash_not_unsafe_inline():
    html = build()
    policy = re.search(r'<meta http-equiv="Content-Security-Policy" content="([^"]+)"', html).group(1)
    script_src = re.search(r"script-src ([^;]+)", policy).group(1).split()
    assert "'unsafe-inline'" not in script_src
    assert "'unsafe-eval'" not in policy
    # Executed scripts: no type, or type="module". the text/plain block is data.
    bodies = [m.group(2) for m in re.finditer(r"<script(\s[^>]*)?>(.*?)</script>", html, re.S)
              if not re.search(r'type="(?!module")', m.group(1) or "")]
    assert len(bodies) == 2, len(bodies)
    want = sorted(f"'sha256-{base64.b64encode(hashlib.sha256(b.encode()).digest()).decode()}'" for b in bodies)
    assert sorted(script_src) == want
