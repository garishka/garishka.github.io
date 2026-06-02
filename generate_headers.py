#!/usr/bin/env python3
"""
generate_headers.py — BeyondGR Project
==============================================================================
Inline the shared site header (partials/header.html) into every page at BUILD
TIME, instead of fetching it at runtime with htmx.

WHY
    A runtime-fetched partial is injected into the DOM of whatever page pulled
    it, so its *relative* links resolve against THAT page's URL. A page in
    articles/ therefore turned "index.html" into "articles/index.html". A
    single shared partial cannot use page-relative links and serve pages that
    live at different directory depths.

WHAT THIS DOES
    For each page listed in PAGES it:
      1. Reads partials/header.html (the single source of truth).
      2. Rewrites every RELATIVE href/src by prefixing the correct number of
         "../" for that page's depth (root pages get no prefix). External,
         root-relative, in-page (#...), mailto:/tel: links are left untouched.
      3. Marks the active nav item: adds aria-current="page" and ACTIVE_CLASS
         to every <a>/<button> whose data-nav equals the page's active key
         (so the desktop link AND its mobile-drawer counterpart both light up).
      4. Injects the result into the page, replacing either the original
         #global-header-target htmx <div> (first run) or a previously generated
         block (re-runs). Idempotent — safe to run on every build.

USAGE
    python3 generate_headers.py            # build all pages in PAGES
    Edit the PAGES dict below to add a page or change its active nav key.
==============================================================================
"""

from __future__ import annotations

import re
import textwrap
from pathlib import Path

# ─────────────────────────────────────────────────────────────────────────────
# CONFIG
# ─────────────────────────────────────────────────────────────────────────────

# Project root = the folder this script lives in (NEW_WEBSITE/).
SITE_ROOT = Path(__file__).resolve().parent

# The single source-of-truth header partial.
HEADER_PARTIAL = SITE_ROOT / "partials" / "header.html"

# Pages to build → which nav item to mark active.
#   key   : page path RELATIVE to the project root (drives the ../ depth)
#   value : the data-nav key to highlight, or None for pages absent from the nav
#
# Article pages highlight "Research", since they live under that section.
PAGES: dict[str, str | None] = {
    "index.html":                            "index.html",
    "members.html":                          "members.html",
    "research.html":                         "research.html",
    "publications.html":                     "publications.html",
    "contacts.html":                         "contacts.html",
    "articles/black-holes-dark-matter.html": "research.html",
    "articles/linear-polarization-dm.html":  "research.html",
    "articles/orbiting-hotspots.html":       "research.html",
    "articles/polarized-ring.html":          "research.html",
}

# Class appended to the active nav element(s). aria-current="page" is ALSO set,
# so your CSS can target either `.is-active` or `[aria-current="page"]`.
ACTIVE_CLASS = "is-active"

# URL prefixes that must NOT be touched by the depth-rewriter.
_ABSOLUTE_PREFIXES = ("http://", "https://", "//", "/", "#", "mailto:", "tel:",
                      "javascript:", "data:")

# ─────────────────────────────────────────────────────────────────────────────
# REGEXES (module-level: compiled once)
# ─────────────────────────────────────────────────────────────────────────────

# Matches the block we replace, in priority order:
#   1. an already-generated header block (re-runs), or
#   2. the original htmx target div (first run).
# Leading horizontal whitespace is consumed so indentation never accumulates.
_HEADER_BLOCK_RE = re.compile(
    r'[ \t]*(?:'
    r'<!-- BEGIN GENERATED HEADER.*?<!-- END GENERATED HEADER -->'
    r'|'
    r'<div id="global-header-target".*?</div>'
    r')',
    re.DOTALL,
)

# A relative href/src attribute (value captured in `val`).
_ATTR_RE = re.compile(r'(?P<attr>href|src)=(?P<q>")(?P<val>[^"]*)"')

# A leading authoring comment in the partial (stripped before inlining).
_LEADING_COMMENT_RE = re.compile(r'^\s*<!--.*?-->\s*', re.DOTALL)


# ─────────────────────────────────────────────────────────────────────────────
# HELPERS
# ─────────────────────────────────────────────────────────────────────────────

def _depth_prefix(page_rel: str) -> str:
    """'../' repeated once per directory level below the project root.

    index.html                      -> ''        (depth 0)
    articles/x.html                 -> '../'      (depth 1)
    research/research-article-1/... -> '../../'   (depth 2)
    """
    depth = len(Path(page_rel).parent.parts)
    return "../" * depth


def _rewrite_paths(html: str, prefix: str) -> str:
    """Prefix every relative href/src with `prefix`; leave absolute ones alone."""
    if not prefix:                       # depth 0 → nothing to do
        return html

    def repl(m: re.Match) -> str:
        val = m.group("val")
        if not val or val.startswith(_ABSOLUTE_PREFIXES):
            return m.group(0)            # external / root-relative / anchor → keep
        return f'{m.group("attr")}={m.group("q")}{prefix}{val}{m.group("q")}'

    return _ATTR_RE.sub(repl, html)


def _add_class(open_tag: str, cls: str) -> str:
    """Return `open_tag` with `cls` added to its class attribute (idempotent)."""
    m = re.search(r'class="([^"]*)"', open_tag)
    if not m:                            # no class attr → add one after the tag name
        return re.sub(r'^(<\w+)', rf'\1 class="{cls}"', open_tag, count=1)
    classes = m.group(1).split()
    if cls not in classes:
        classes.append(cls)
    return f'{open_tag[:m.start()]}class="{" ".join(classes)}"{open_tag[m.end():]}'


def _mark_active(html: str, active_key: str) -> str:
    """Flag every <a>/<button> whose data-nav == active_key as the current page.

    Matches the WHOLE opening tag (which may span several lines — [^>] also
    matches newlines, so multi-line tags like the drawer toggle are handled).
    """
    tag_re = re.compile(
        r'<(?:a|button)\b[^>]*\bdata-nav="' + re.escape(active_key) + r'"[^>]*>'
    )

    def repl(m: re.Match) -> str:
        tag = m.group(0)
        if 'aria-current' not in tag:                     # don't double-add
            tag = f'{tag[:-1].rstrip()} aria-current="page">'
        return _add_class(tag, ACTIVE_CLASS)

    return tag_re.sub(repl, html)


def build_header(page_rel: str, active_key: str | None) -> str:
    """Produce the finished header HTML for one page (depth-fixed + active-marked)."""
    raw = HEADER_PARTIAL.read_text(encoding="utf-8")
    raw = _LEADING_COMMENT_RE.sub("", raw, count=1)       # drop the htmx note
    raw = _rewrite_paths(raw, _depth_prefix(page_rel))
    if active_key:
        raw = _mark_active(raw, active_key)
    return raw.strip()


def _wrap_block(fragment: str) -> str:
    """Wrap the header in marker comments + the #global-header-target div.

    The div id is kept so any app.js code that scopes to it still works; the
    htmx attributes are intentionally gone. Indentation matches the 2-space
    page context.
    """
    body = textwrap.indent(fragment, "    ")             # 4-space nest under the div
    return (
        "  <!-- BEGIN GENERATED HEADER (generate_headers.py) — do not edit by hand -->\n"
        '  <div id="global-header-target">\n'
        f"{body}\n"
        "  </div>\n"
        "  <!-- END GENERATED HEADER -->"
    )


def inject(page_rel: str, active_key: str | None) -> bool:
    """Inject the generated header into one page. Returns True on success."""
    path = SITE_ROOT / page_rel
    if not path.is_file():
        print(f"  ✗ skip (not found): {page_rel}")
        return False

    text = path.read_text(encoding="utf-8")
    block = _wrap_block(build_header(page_rel, active_key))

    # lambda avoids re.sub interpreting backslashes in the header as group refs
    new_text, n = _HEADER_BLOCK_RE.subn(lambda _m: block, text, count=1)
    if n == 0:
        print(f"  ✗ no header target found in {page_rel} "
              f"(expected #global-header-target or a generated block)")
        return False

    path.write_text(new_text, encoding="utf-8")
    print(f"  ✓ {page_rel:<42} active={active_key}")
    return True


def main() -> None:
    if not HEADER_PARTIAL.is_file():
        raise SystemExit(f"Header partial missing: {HEADER_PARTIAL}")
    print(f"Injecting header into {len(PAGES)} page(s)…")
    ok = sum(inject(p, a) for p, a in PAGES.items())
    print(f"Done — {ok}/{len(PAGES)} page(s) updated.")


if __name__ == "__main__":
    main()
