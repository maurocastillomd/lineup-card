"""The offline bundler refuses code it cannot bundle correctly, instead of guessing."""

import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "scripts"))
import build_offline  # noqa: E402


def test_export_const_and_function_are_bundled():
    body, names = build_offline.strip_exports("x.js", 'export const a = (p, q = 1) => p + q;\n'
                                              'export async function b() {}\nexport class C {}\n'
                                              'export const D = {\n  k: 1,\n  j: 2,\n};\n'
                                              'export const s = "a, b = 2";\n')
    assert names == ["a", "b", "C", "D", "s"]
    assert "export" not in body


def test_export_let_is_refused():
    with pytest.raises(SystemExit, match="export let"):
        build_offline.strip_exports("x.js", "export let n = 1;\n")


def test_several_bindings_in_one_export_are_refused():
    with pytest.raises(SystemExit, match="one name per export"):
        build_offline.strip_exports("x.js", "export const a = 1, b = 2;\n")
    with pytest.raises(SystemExit, match="one name per export"):
        build_offline.strip_exports("x.js", "export const a = f(1, 2), b = [3, 4];\n")


def test_css_url_check_ignores_case(tmp_path):
    sheet = tmp_path / "x.css"
    sheet.write_text('a { background: URL("https://example.com/x.png"); }\n')
    with pytest.raises(SystemExit, match="url"):
        build_offline.css(sheet)
    sheet.write_text('a { background: Url(data:image/png;base64,AAAA); }\n')
    assert "Url(data:" in build_offline.css(sheet)
