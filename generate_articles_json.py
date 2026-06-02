#!/usr/bin/env python3
"""
BeyondGR Project — Article Registry Scraper
===========================================
Scans the articles/ directory and writes assets/articles.json — the single
source of truth that generate_research_previews.py reads to build the homepage
"Core Research Areas" preview cards.

WHY THIS EXISTS
---------------
The article list used to be a hand-maintained `RESEARCH_ARTICLES` array (first
in js/app.js §16-A, then inlined in generate_research_previews.py). Keeping it
in sync with the actual files in articles/ was manual and error-prone. This
script derives the registry directly from the directory instead, so adding or
renaming an article file is all it takes — just re-run this, then re-run
generate_research_previews.py.

PER-ARTICLE FIELDS
------------------
For every articles/*.html file it emits one object:
    id    — the file name without its .html extension       (e.g. "orbiting-hotspots")
    file  — path relative to the site root, forward-slashed (e.g. "articles/orbiting-hotspots.html")
    title — text of the <h2 class="art-title"> element
            (falls back to a humanized id + a warning if absent)
    icon  — always "blackhole" (the registry default; edit articles.json by
            hand afterwards to assign "wormhole" / "lensing" where wanted)

ORDERING
--------
Entries are sorted alphabetically by file name for a deterministic result.
generate_research_previews.py renders them in array order, so if you want a
specific running order (the old list was "newest-first"), just reorder the
objects in the generated articles.json by hand — re-running this scraper will
re-sort, so do the reordering as a final step, or keep order in version control.

USAGE
-----
    python3 generate_articles_json.py \
        --articles-dir articles \
        --root         . \
        --out          assets/articles.json

Re-running overwrites assets/articles.json wholesale (idempotent for a fixed
set of files).
"""

import argparse
import json
import sys
from html.parser import HTMLParser
from pathlib import Path


# -----------------------------------------------------------------------------
# CONFIG
# -----------------------------------------------------------------------------

# Default icon for every scraped article. The three valid keys understood by
# generate_research_previews.py are: "blackhole" | "wormhole" | "lensing".
DEFAULT_ICON = "blackhole"

# CSS class on the heading whose text becomes the `title` field.
TITLE_CLASS = "art-title"


# -----------------------------------------------------------------------------
# TITLE EXTRACTION
# -----------------------------------------------------------------------------

class _ArtTitleExtractor(HTMLParser):
    """Capture the textContent of the first <h2 class="art-title"> element.

    Collects character data while inside the target heading (including text
    from any nested inline tags, matching DOM textContent). Stops recording at
    the heading's closing tag; the first match wins.
    """

    def __init__(self):
        super().__init__(convert_charrefs=True)
        self._capturing = False
        self._depth = 0          # nesting depth inside the target <h2>
        self._buf = []
        self.title = None        # first captured title (None until found)

    @staticmethod
    def _is_art_title(tag, attrs):
        if tag != "h2":
            return False
        for name, val in attrs:
            if name == "class" and val and TITLE_CLASS in val.split():
                return True
        return False

    def handle_starttag(self, tag, attrs):
        if self.title is not None:
            return  # already found the first one — ignore the rest
        if self._capturing:
            if tag == "h2":
                self._depth += 1
        elif self._is_art_title(tag, attrs):
            self._capturing = True
            self._depth = 1
            self._buf = []

    def handle_endtag(self, tag):
        if not self._capturing or tag != "h2":
            return
        self._depth -= 1
        if self._depth == 0:
            self.title = " ".join("".join(self._buf).split())  # collapse whitespace
            self._capturing = False

    def handle_data(self, data):
        if self._capturing:
            self._buf.append(data)


def extract_title(html_string: str):
    """Return the <h2 class="art-title"> text, or None if there isn't one."""
    parser = _ArtTitleExtractor()
    parser.feed(html_string)
    parser.close()
    return parser.title or None


def humanize(stem: str) -> str:
    """Turn a file stem into a readable fallback title.

    'black-holes-dark-matter' → 'Black Holes Dark Matter'
    """
    words = stem.replace("_", "-").split("-")
    return " ".join(w.capitalize() for w in words if w)


# -----------------------------------------------------------------------------
# ENTRY POINT
# -----------------------------------------------------------------------------

def main() -> None:
    parser = argparse.ArgumentParser(
        description="Scrape articles/*.html into assets/articles.json."
    )
    parser.add_argument("--articles-dir", default="articles",
                        help="Directory holding the article HTML files "
                             "(default: articles)")
    parser.add_argument("--root", default=".",
                        help="Site root the `file` paths are made relative to "
                             "(default: current directory)")
    parser.add_argument("--out", default="assets/articles.json",
                        help="Output JSON path (default: assets/articles.json)")
    args = parser.parse_args()

    articles_dir = Path(args.articles_dir)
    root = Path(args.root)
    out_path = Path(args.out)

    if not articles_dir.is_dir():
        sys.exit(f"ERROR: articles directory not found: {articles_dir}")

    # Deterministic order: sort by file name.
    html_files = sorted(articles_dir.glob("*.html"), key=lambda p: p.name)
    if not html_files:
        sys.exit(f"ERROR: no *.html files found in {articles_dir}")

    registry = []
    missing_titles = []
    for path in html_files:
        markup = path.read_text(encoding="utf-8")

        title = extract_title(markup)
        if not title:
            title = humanize(path.stem)
            missing_titles.append(path.name)

        # `file` is the path relative to the site root, using forward slashes.
        try:
            rel = path.resolve().relative_to(root.resolve())
        except ValueError:
            # Path isn't under root — fall back to the path as given.
            rel = path
        file_field = rel.as_posix()

        registry.append({
            "id":    path.stem,
            "file":  file_field,
            "title": title,
            "icon":  DEFAULT_ICON,
        })

    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text(
        json.dumps(registry, indent=2, ensure_ascii=False) + "\n",
        encoding="utf-8",
    )

    # ── Operator feedback ─────────────────────────────────────────────────────
    print(f"OK  Wrote {out_path}")
    print(f"    {len(registry)} article(s) scraped from {articles_dir}/")
    for entry in registry:
        print(f"      - {entry['id']:<26} title=\"{entry['title']}\"")
    if missing_titles:
        print(f"    {len(missing_titles)} file(s) had no <h2 class=\"{TITLE_CLASS}\"> "
              f"— used a humanized filename: {', '.join(missing_titles)}",
              file=sys.stderr)


if __name__ == "__main__":
    main()
