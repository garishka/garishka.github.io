#!/usr/bin/env python3
"""
BeyondGR Project - Static Research-Preview Generator
====================================================
Reads the research article HTML files and injects the "Core Research Areas"
preview cards directly into index.html, removing the runtime dependency on
JS for rendering them.

ARTICLE REGISTRY
----------------
The list of articles is NOT hard-coded here. It is read from a JSON file
(default assets/articles.json) produced by generate_articles_json.py, which
scrapes the articles/ directory. Each entry carries: id, file, title, icon.
Pipeline:
    1. generate_articles_json.py      # articles/ -> assets/articles.json
    2. generate_research_previews.py  # articles.json -> index.html

USAGE
-----
    # Homepage "Core Research Areas" section (links to per-article pages research/<id>.html):
    python3 generate_research_previews.py \
        --data     assets/articles.json \
        --template index.html \
        --out      index.html

    # Research page index grid (links to per-article pages research/<id>.html):
    python3 generate_research_previews.py \
        --template  research.html \
        --out       research.html \
        --container research-grid \
        --link-href "research/{id}.html"

Re-run after editing any article file or articles.json.
"""

import argparse
import html
import json
import re
import sys
import textwrap
from pathlib import Path
from html.parser import HTMLParser


# -----------------------------------------------------------------------------
# CONFIG
# -----------------------------------------------------------------------------

ARTICLES_JSON = "assets/articles.json"

# ICON_SVGS - verbatim port of getResearchCardIcon()'s `icons` object.
# Each value is the same inline SVG the runtime cards used, so the visual style
# is identical. Indented to sit one level (2 spaces) inside <article>.
ICON_SVGS = {
    "blackhole": """\
  <svg class="feature-card__icon" viewBox="0 0 44 44"
      xmlns="http://www.w3.org/2000/svg" aria-hidden="true" focusable="false">
    <circle cx="22" cy="22" r="8"  fill="currentColor" opacity="0.15"/>
    <circle cx="22" cy="22" r="5"  fill="currentColor"/>
    <ellipse cx="22" cy="22" rx="19" ry="6"
             fill="none" stroke="currentColor" stroke-width="1.5" opacity="0.5"/>
    <ellipse cx="22" cy="22" rx="14" ry="4"
             fill="none" stroke="currentColor" stroke-width="1.2" opacity="0.7"/>
  </svg>""",

    "wormhole": """\
  <svg class="feature-card__icon" viewBox="0 0 44 44"
      xmlns="http://www.w3.org/2000/svg" aria-hidden="true" focusable="false">
    <ellipse cx="12" cy="22" rx="8" ry="12"
             fill="none" stroke="currentColor" stroke-width="1.8"/>
    <ellipse cx="32" cy="22" rx="8" ry="12"
             fill="none" stroke="currentColor" stroke-width="1.8"/>
    <line x1="12" y1="10" x2="32" y2="10"
          stroke="currentColor" stroke-width="1.4" stroke-dasharray="3 2"/>
    <line x1="12" y1="34" x2="32" y2="34"
          stroke="currentColor" stroke-width="1.4" stroke-dasharray="3 2"/>
    <circle cx="12" cy="22" r="3" fill="currentColor"/>
    <circle cx="32" cy="22" r="3" fill="currentColor"/>
  </svg>""",

    "lensing": """\
  <svg class="feature-card__icon" viewBox="0 0 44 44"
      xmlns="http://www.w3.org/2000/svg" aria-hidden="true" focusable="false">
    <circle cx="22" cy="22" r="4" fill="currentColor"/>
    <path d="M4 8 Q 22 4 40 22 Q 22 40 4 36"
          fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>
    <path d="M4 8 L8 8 M4 8 L4 12"
          stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
    <path d="M4 36 L8 36 M4 36 L4 32"
          stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
  </svg>""",
}

# Indentation applied to each generated <article> so it nests cleanly inside
# the <div id="research-previews-track"> in index.html.
CARD_INDENT = " " * 10


# -----------------------------------------------------------------------------
# HELPERS
# -----------------------------------------------------------------------------

def esc(value) -> str:
    """HTML-escape a value for safe use in text nodes AND attributes."""
    return html.escape("" if value is None else str(value), quote=True)


def get_research_card_icon(icon_key: str) -> str:
    """Return the SVG markup for a research-domain icon."""
    return ICON_SVGS.get(icon_key, ICON_SVGS["blackhole"])


# -----------------------------------------------------------------------------
# SUMMARY EXTRACTION
# -----------------------------------------------------------------------------

class _ParagraphTextExtractor:
    """Collect the textContent of <p> elements, scoped to .art-body / .art-section.

    Stdlib equivalent of the JS DOMParser + querySelectorAll('.art-body p,
    .art-section p') step. It records two lists:
      * scoped — <p> text that lives inside an .art-body / .art-section ancestor
      * every  — <p> text anywhere in the document (the JS fallback selector)
    extract_article_summary() prefers `scoped`, falling back to `every`, exactly
    matching the `candidates.length ? candidates : doc.querySelectorAll('p')`
    logic in the original.
    """

    def __init__(self):
        outer = self

        class _Parser(HTMLParser):
            def __init__(self):
                super().__init__(convert_charrefs=True)
                self.art_depth = 0      # >0 ⇒ inside an .art-body/.art-section
                self.p_depth = 0        # >0 ⇒ inside a <p>
                self._buf = []          # chars of the current <p>
                self._in_art_stack = [] # tracks which open tags opened an art scope

            @staticmethod
            def _has_art_class(attrs):
                for name, val in attrs:
                    if name == "class" and val:
                        classes = val.split()
                        if "art-body" in classes or "art-section" in classes:
                            return True
                return False

            def handle_starttag(self, tag, attrs):
                opened_art = self._has_art_class(attrs)
                self._in_art_stack.append(opened_art)
                if opened_art:
                    self.art_depth += 1
                if tag == "p":
                    self.p_depth += 1

            def handle_startendtag(self, tag, attrs):
                # Self-closing tag (e.g. <br/>): no scope change, no text.
                pass

            def handle_endtag(self, tag):
                if tag == "p" and self.p_depth > 0:
                    self.p_depth -= 1
                    if self.p_depth == 0:
                        text = "".join(self._buf).strip()
                        self._buf = []
                        outer.every.append(text)
                        if self.art_depth > 0:
                            outer.scoped.append(text)
                if self._in_art_stack:
                    opened_art = self._in_art_stack.pop()
                    if opened_art and self.art_depth > 0:
                        self.art_depth -= 1

            def handle_data(self, data):
                if self.p_depth > 0:
                    self._buf.append(data)

        self.scoped = []
        self.every = []
        self._parser = _Parser()

    def feed(self, markup: str):
        self._parser.feed(markup)
        self._parser.close()


def extract_article_summary(html_string: str) -> str:
    """Extract the first 3 prose sentences of an article as LaTeX-free text.

    Pipeline:
      1. Parse HTML, collect <p> text (prefer .art-body/.art-section, else any <p>)
      2. Keep paragraphs longer than 30 chars, join with spaces
      3. Strip \\cite{...}, $$...$$, $...$, residual \\command{...}, bare braces
      4. Collapse whitespace, split on sentence boundaries, take the first 3
    """
    extractor = _ParagraphTextExtractor()
    extractor.feed(html_string)

    paragraphs = extractor.scoped if extractor.scoped else extractor.every

    # Concatenate paragraphs long enough to be genuine prose (> 30 chars).
    raw_text = " ".join(p for p in (t.strip() for t in paragraphs) if len(p) > 30)

    # ── LaTeX / markup strip pipeline (mirrors the JS .replace() chain) ───────
    clean = re.sub(r"\\cite\{[^}]*\}", "", raw_text)   # 1. citations
    clean = re.sub(r"\$\$[\s\S]*?\$\$", "", clean)     # 2. display math
    clean = re.sub(r"\$[^$\n]+?\$", "", clean)         # 3. inline math
    clean = re.sub(r"\\[a-zA-Z]+(?:\{[^}]*\})?", "", clean)  # 4. \command{...}
    clean = re.sub(r"[{}]", "", clean)                 # 5. residual braces
    clean = re.sub(r"\s+", " ", clean).strip()         # 6. collapse whitespace

    # ── Sentence extraction ───────────────────────────────────────────────────
    # Split only on [.!?] + whitespace + uppercase letter, so abbreviations and
    # equation-final periods (e.g. "Eq. (3)", "6M.") do not split.
    sentences = re.split(r"(?<=[.!?])\s+(?=[A-Z])", clean)

    return " ".join(sentences[:3]).strip()


# -----------------------------------------------------------------------------
# CARD BUILDER
# -----------------------------------------------------------------------------

def build_research_preview_card(article: dict, summary: str,
                                link_href: str, link_aria: str) -> str:
    """Return one <article class="feature-card"> as an HTML string.

    `link_href` / `link_aria` are the already-resolved destination and label for
    the "Read More" link, so the same card can point at the Research index
    (homepage strip) or at a per-article page (research index grid).
    """
    title = article.get("title", "")
    out = []

    out.append('<article class="feature-card" role="listitem">')

    # Icon (multi-line SVG already indented one level inside the article).
    out.append(get_research_card_icon(article.get("icon", "blackhole")))

    # Title.
    out.append(f'  <h3 class="feature-card__title">{esc(title)}</h3>')

    # Description
    # data-article-id is preserved from the runtime markup for parity/debugging.
    out.append(
        f'  <p class="feature-card__desc" data-article-id="{esc(article.get("id"))}">'
        f"{esc(summary)}</p>"
    )

    # "Read More" link (destination depends on the page being generated).
    out.append(
        f'  <a href="{esc(link_href)}"\n'
        f'     class="feature-card__link"\n'
        f'     aria-label="{esc(link_aria)}">\n'
        f"    Read More\n"
        f'    <svg width="14" height="14" viewBox="0 0 24 24" fill="none"\n'
        f'         stroke="currentColor" stroke-width="2.5" stroke-linecap="round"\n'
        f'         aria-hidden="true" focusable="false">\n'
        f'      <line x1="5" y1="12" x2="19" y2="12"/>\n'
        f'      <polyline points="12 5 19 12 12 19"/>\n'
        f"    </svg>\n"
        f"  </a>"
    )

    out.append("</article>")
    return "\n".join(out)


# -----------------------------------------------------------------------------
# HTML INJECTION  — touch only the preview track; leave everything else
# (header, hero, publications strip, footer) byte-for-byte intact.
# -----------------------------------------------------------------------------

def inject_cards(markup: str, cards_html: str, container_id: str) -> str:
    """Replace the body of the target container <div id="container_id"> with cards.

    Matches the (multi-line) opening <div id="..."> tag, drops any stray `hidden`
    attribute, then balances <div>/</div> from the opening tag to find the
    matching close so it works whether the container currently holds the
    placeholder comment (first run) or previously injected cards (on re-run).
    """
    open_match = re.search(
        rf'<div\b[^>]*?\bid="{re.escape(container_id)}"[^>]*?>', markup, re.DOTALL
    )
    if not open_match:
        sys.exit(
            f'ERROR: could not find <div id="{container_id}"> in template.'
        )

    open_tag = open_match.group()
    # Remove a standalone `hidden` boolean attribute if present.
    cleaned_open = re.sub(r"\s*\bhidden\b", "", open_tag)

    # Balance <div>/</div> from just after the opening tag to find its closer.
    token_re = re.compile(r"<div\b|</div>", re.IGNORECASE)
    depth = 1
    close_end = None
    for tok in token_re.finditer(markup, open_match.end()):
        if tok.group().startswith("</"):
            depth -= 1
            if depth == 0:
                close_end = tok.end()
                break
        else:
            depth += 1
    if close_end is None:
        sys.exit(f'ERROR: #{container_id} <div> has no matching </div>.')

    before = markup[: open_match.start()]
    after = markup[close_end:]

    indented = textwrap.indent(cards_html, CARD_INDENT)
    new_block = f"{cleaned_open}\n{indented}\n        </div>"
    return before + new_block + after


# -----------------------------------------------------------------------------
# ENTRY POINT
# -----------------------------------------------------------------------------

def main() -> None:
    parser = argparse.ArgumentParser(
        description="Inject research preview cards from the article HTML files "
                    "into a page's card container (index.html or research.html)."
    )
    parser.add_argument("--data", default=ARTICLES_JSON,
                        help=f"Path to the article registry JSON produced by "
                             f"generate_articles_json.py (default: {ARTICLES_JSON})")
    parser.add_argument("--template", default="index.html",
                        help="Path to the page template (default: index.html)")
    parser.add_argument("--out", default="index.html",
                        help="Output path (default is in-place: index.html)")
    parser.add_argument("--root", default=None,
                        help="Base directory for resolving article `file` paths "
                             "(default: the template's directory).")
    parser.add_argument("--container", default="research-previews-track",
                        help="id of the <div> whose contents are replaced "
                             "(default: research-previews-track - the homepage strip; "
                             "use 'research-grid' for the research page).")
    parser.add_argument("--link-href", default="research.html",
                        help="Destination for each card's 'Read More' link. May "
                             "contain '{id}', filled with the article id - e.g. "
                             "'research/{id}.html' for per-article pages "
                             "(default: research.html).")
    parser.add_argument("--link-aria", default=None,
                        help="aria-label template for the link; may contain "
                             "'{title}'. Defaults to a phrasing chosen from "
                             "--link-href (index vs per-article page).")
    args = parser.parse_args()

    data_path = Path(args.data)
    template_path = Path(args.template)
    out_path = Path(args.out)
    root = Path(args.root) if args.root else template_path.parent

    # Default aria phrasing depends on whether the link is per-article ({id}).
    if args.link_aria is not None:
        aria_tmpl = args.link_aria
    elif "{id}" in args.link_href:
        aria_tmpl = "Read the full article: {title}"
    else:
        aria_tmpl = "Read more about {title} on the Research page"

    if not template_path.is_file():
        sys.exit(f"ERROR: template not found: {template_path}")

    # Load the scraped registry (assets/articles.json)
    try:
        articles = json.loads(data_path.read_text(encoding="utf-8"))
    except FileNotFoundError:
        sys.exit(f"ERROR: registry not found: {data_path} "
                 f"(run generate_articles_json.py first).")
    except json.JSONDecodeError as exc:
        sys.exit(f"ERROR: {data_path} is not valid JSON — {exc}")

    if not isinstance(articles, list) or not articles:
        sys.exit(f"ERROR: {data_path} must be a non-empty JSON array of articles.")

    # Build cards (tolerate per-article failure, like Promise.allSettled)
    cards = []
    skipped = []
    for article in articles:
        article_id = article.get("id") or article.get("file") or "(unknown)"
        if not article.get("file"):
            print(f"WARN  skipping '{article_id}' — registry entry has no 'file'.",
                  file=sys.stderr)
            skipped.append(article_id)
            continue

        article_path = root / article["file"]
        try:
            article_html = article_path.read_text(encoding="utf-8")
        except FileNotFoundError:
            print(f"WARN  skipping '{article_id}' — file not found: {article_path}",
                  file=sys.stderr)
            skipped.append(article_id)
            continue

        # Default a missing/blank icon to 'blackhole' (get_research_card_icon
        # also falls back, but normalizing here keeps the operator log honest).
        article.setdefault("icon", "blackhole")
        if not article["icon"]:
            article["icon"] = "blackhole"

        summary = extract_article_summary(article_html)
        if not summary:
            print(f"WARN  '{article_id}' produced an empty summary "
                  f"(no prose paragraphs > 30 chars?)", file=sys.stderr)

        # Resolve this card's link destination + label.
        link_href = args.link_href.format(id=article_id)
        link_aria = aria_tmpl.format(title=article.get("title", ""))
        cards.append(
            (article, build_research_preview_card(article, summary,
                                                  link_href, link_aria))
        )

    if not cards:
        sys.exit("ERROR: no preview cards could be generated — nothing written.")

    cards_html = "\n\n".join(card_html for _, card_html in cards)

    # ── Inject into the template ──────────────────────────────────────────────
    markup = template_path.read_text(encoding="utf-8")
    markup = inject_cards(markup, cards_html, args.container)
    out_path.write_text(markup, encoding="utf-8")

    # ── Operator feedback ─────────────────────────────────────────────────────
    print(f"OK  Generated {out_path}")
    print(f"    {len(cards)} research preview card(s) baked into "
          f"#{args.container}")
    for article, _ in cards:
        print(f"      - {(article.get('id') or article['file']):<26} "
              f"icon={article.get('icon', 'blackhole')}")
    if skipped:
        print(f"    {len(skipped)} article(s) skipped: {', '.join(skipped)}")


if __name__ == "__main__":
    main()
