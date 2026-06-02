#!/usr/bin/env python3
"""
BeyondGR Project — Static Chrome Baker
======================================
Inserts the shared partials/header.html + partials/footer.html directly
into every page IN PLACE, replacing the old htmx runtime fetch. For each page it:

    1. substitutes the {{ base }} path token with the relative path back to the
       site root (so links work at any directory depth), and
    2. reproduces app.js setActiveNav() at build time — stamps `is-active` +
       aria-current="page" on the .nav-links__link / .drawer-link whose
       data-nav matches the current page.

MARKER REGIONS (idempotent)
---------------------------
Each target page must contain an empty header + footer region:

    <!-- @@HEADER@@ --><!-- @@/HEADER@@ -->
    ...
    <!-- @@FOOTER@@ --><!-- @@/FOOTER@@ -->

The generator replaces only the text BETWEEN the markers and leaves the markers
in place, so it is safe to re-run after editing a partial. Pages missing both
markers are skipped with a notice (never created or clobbered).

BASE TOKEN
----------
    root page  (index.html, members.html, ...)      {{ base }} -> ""
    research/<article>.html       (1 levels deep)   {{ base }} -> "../"

ACTIVE PAGE RESOLUTION  (mirrors app.js resolveActivePage(), corrected for depth)
---------------------------------------------------------------------------------
    root page                 -> its own filename   (members.html, ...)
    research/<article>.html   -> "research.html"    (so the Research item lights)

USAGE
-----
    python3 generate_pages/include_header_footer.py            # root auto-detected
    python3 generate_pages/include_header_footer.py --root .   # explicit project root

Re-run whenever a partial changes.
"""

import argparse
import re
import sys
from pathlib import Path


# -----------------------------------------------------------------------------
# CONFIG
# -----------------------------------------------------------------------------

HEADER_PARTIAL = "partials/header.html"
FOOTER_PARTIAL = "partials/footer.html"

# (begin, end) marker pair per region. Markers are kept; only the inside swaps.
MARKERS = {
    "header": ("<!-- @@HEADER@@ -->", "<!-- @@/HEADER@@ -->"),
    "footer": ("<!-- @@FOOTER@@ -->", "<!-- @@/FOOTER@@ -->"),
}

# Top-level directory -> nav key used for active-marking of nested pages.
SECTION_NAV = {"research": "research.html"}

# Only links carrying one of these classes are eligible for active-marking,
# matching the app.js setActiveNav() selector ('.nav-links__link, .drawer-link').
ACTIVE_LINK_CLASSES = ("nav-links__link", "drawer-link")

# Glob patterns (relative to root) for the pages to process.
PAGE_GLOBS = (
    "*.html",                  # root pages: index/members/research/publications/contacts
    "research/*.html",         # per-article pages, 1 level deep
)


# -----------------------------------------------------------------------------
# RENDER HELPERS
# -----------------------------------------------------------------------------

def strip_leading_comment(text: str) -> str:
    """Drop a partial's leading <!-- authoring comment --> so it is not baked
    into every page. Only the first top-of-file comment block is removed."""
    return re.sub(r"^\s*<!--.*?-->\s*", "", text, count=1, flags=re.DOTALL)


def compute_base(rel_path: Path) -> str:
    """Relative prefix back to the site root, e.g. '' or '../'.

    Derived purely from how deep the page sits: one '../' per ancestor dir.
        index.html                      -> ''      (0 dirs deep)
        research/orbiting.html          -> '../'   (1 dirs deep)
    """
    depth = len(rel_path.parts) - 1      # number of directories above the file
    return "../" * depth


def resolve_active(rel_path: Path) -> str:
    """Active nav key for a page (mirrors resolveActivePage(), depth-corrected).

    Root page -> its filename. Page under a known section dir -> that section's
    nav key (research/<...> -> 'research.html'). Otherwise its own filename.
    """
    parts = rel_path.parts
    if len(parts) == 1:
        return parts[0]
    return SECTION_NAV.get(parts[0], parts[-1])


def render_base(text: str, base: str) -> str:
    """Replace every {{ base }} token (any inner whitespace) with `base`."""
    return re.sub(r"\{\{\s*base\s*\}\}", base, text)


def mark_active(header_html: str, active_key: str) -> str:
    """Build-time equivalent of app.js setActiveNav().

    For each <a>/<button> opening tag that (a) carries data-nav="<active_key>"
    and (b) has a .nav-links__link or .drawer-link class, inject `is-active`
    into its class list and add aria-current="page". All other links are left
    untouched (the template ships them un-marked).
    """
    needle = f'data-nav="{active_key}"'
    tag_re = re.compile(r"<(?:a|button)\b[^>]*?>", re.DOTALL)

    def repl(match: re.Match) -> str:
        tag = match.group(0)
        if needle not in tag:
            return tag
        if not any(cls in tag for cls in ACTIVE_LINK_CLASSES):
            return tag

        # 1) add is-active to the existing class="" attribute
        tag = re.sub(
            r'class="([^"]*)"',
            lambda c: f'class="{c.group(1)} is-active"',
            tag,
            count=1,
        )
        # 2) add aria-current="page" if it isn't there already
        if "aria-current" not in tag:
            tag = tag[:-1].rstrip() + ' aria-current="page">'
        return tag

    return tag_re.sub(repl, header_html)


def replace_region(markup: str, region: str, payload: str) -> tuple[str, bool]:
    """Swap the content between a region's begin/end markers (markers kept).

    Returns (new_markup, did_replace). did_replace is False when the begin
    marker is absent (page opts out of that region). Exits if begin is found
    but the matching end marker is missing (malformed page).
    """
    begin, end = MARKERS[region]
    b = markup.find(begin)
    if b == -1:
        return markup, False

    e = markup.find(end, b + len(begin))
    if e == -1:
        sys.exit(f"ERROR: '{begin}' has no matching '{end}'.")

    before = markup[: b + len(begin)]
    after = markup[e:]
    return f"{before}\n{payload}\n{after}", True


# -----------------------------------------------------------------------------
# DISCOVERY
# -----------------------------------------------------------------------------

def discover_pages(root: Path) -> list[Path]:
    """All candidate pages under root, de-duplicated and sorted."""
    seen, pages = set(), []
    for pattern in PAGE_GLOBS:
        for path in sorted(root.glob(pattern)):
            if path.is_file() and path not in seen:
                seen.add(path)
                pages.append(path)
    return pages


# -----------------------------------------------------------------------------
# ENTRY POINT
# -----------------------------------------------------------------------------

def main() -> None:
    parser = argparse.ArgumentParser(
        description="Insert header/footer partials into pages in place."
    )
    parser.add_argument(
        "--root",
        default=str(Path(__file__).resolve().parent.parent),
        help="Project root (default: the parent of generate_pages/).",
    )
    args = parser.parse_args()
    root = Path(args.root).resolve()

    # Load + clean the partials once.
    try:
        header_tpl = strip_leading_comment(
            (root / HEADER_PARTIAL).read_text(encoding="utf-8")
        )
        footer_tpl = strip_leading_comment(
            (root / FOOTER_PARTIAL).read_text(encoding="utf-8")
        )
    except FileNotFoundError as exc:
        sys.exit(f"ERROR: missing partial - {exc.filename}")

    pages = discover_pages(root)
    if not pages:
        sys.exit(f"ERROR: no pages found under {root}")

    baked = skipped = 0
    for page in pages:
        rel = page.relative_to(root)
        markup = page.read_text(encoding="utf-8")

        # Opt-in: a page must carry at least one marker to be touched.
        if MARKERS["header"][0] not in markup and MARKERS["footer"][0] not in markup:
            print(f"SKIP  {rel}  (no @@HEADER@@/@@FOOTER@@ markers)")
            skipped += 1
            continue

        base = compute_base(rel)
        active = resolve_active(rel)

        header_html = mark_active(render_base(header_tpl, base), active)
        footer_html = render_base(footer_tpl, base)

        markup, did_header = replace_region(markup, "header", header_html)
        markup, did_footer = replace_region(markup, "footer", footer_html)

        page.write_text(markup, encoding="utf-8")
        baked += 1
        regions = "+".join(
            r for r, ok in (("header", did_header), ("footer", did_footer)) if ok
        )
        print(f"OK    {str(rel):<38} base='{base or '.'}'  active={active}  [{regions}]")

    print(f"\nDone. {baked} page(s) updated, {skipped} skipped.")


if __name__ == "__main__":
    main()
