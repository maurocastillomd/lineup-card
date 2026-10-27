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
    assert not re.search(r'^\s*(import|export)\s', html, re.M), "unbundled module syntax"
    assert "fonts.googleapis" not in html and "jsdelivr" not in html


def test_contains_the_app_the_sample_and_the_board():
    html = build()
    for marker in ('id="tpl-load"', 'id="tpl-review"', 'id="tpl-card"', 'id="board-svg"', "Fictional Triple-A Club", "buildDays"):
        assert marker in html, marker
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
