#!/usr/bin/env python3
"""
BeyondGR Project — Static Members Page Generator
================================================
Reads members.json and bakes the member cards directly into members.html,
removing the runtime dependency on js/app.js for rendering the roster.

WHY THIS EXISTS
---------------
The cards used to be built at runtime by buildMemberCard() in js/app.js. On
some visitors' devices app.js fails to parse/run, so the cards never appear.
This script produces the SAME markup buildMemberCard() emits, but as plain
static HTML that lives in the document before any JavaScript runs — so the
roster is visible even with JS disabled, blocked, or broken.

PROFILE LINKS
-------------
buildMemberCard() expects each member to carry a `profiles: [{name, url}]`
array. The current members.json instead uses flat `arxiv` / `researchgate`
fields. To avoid dropping those links, this generator:
    1. uses an explicit `profiles` array if one is present, else
    2. synthesizes the pill-links from the known flat fields below
       (skipping any that are null / empty).
Extend PROFILE_FIELD_MAP to teach it new flat fields.

USAGE
-----
    python3 generate_members.py \
        --data     members.json \
        --template members.html \
        --out      members.html

Re-running is idempotent: the grid's contents are replaced wholesale each time,
so you can regenerate after every edit to members.json.
"""

import argparse
import html
import json
import re
import sys
import textwrap
from pathlib import Path


# -----------------------------------------------------------------------------
# CONFIG
# -----------------------------------------------------------------------------

# Flat JSON fields → human-readable profile label, in display order.
# Only fields with a truthy value (non-null, non-empty) produce a pill-link.
PROFILE_FIELD_MAP = [
    ("arxiv",        "arXiv"),
    ("researchgate", "ResearchGate"),
    ("inspirehep",   "InspireHEP"),
    ("orcid",        "ORCID"),
    ("scholar",      "Google Scholar"),
    ("github",       "GitHub"),
]

# Indentation applied to each generated <article> so it nests cleanly inside
# the <section class="members-grid"> in members.html.
CARD_INDENT = " " * 10


# -----------------------------------------------------------------------------
# HELPERS
# -----------------------------------------------------------------------------

def esc(value) -> str:
    """HTML-escape a value for safe use in text nodes AND attributes."""
    return html.escape("" if value is None else str(value), quote=True)


def collect_profiles(member: dict) -> list:
    """Resolve a member's external-profile links into a [{name, url}] list.

    Order of preference:
      1. An explicit `profiles` array (the schema buildMemberCard() documents).
      2. Synthesized from the flat fields in PROFILE_FIELD_MAP.
    Entries without a usable URL are skipped (this is how `researchgate: null`
    is dropped, matching the intent of the data).
    """
    explicit = member.get("profiles")
    if isinstance(explicit, list) and explicit:
        return [
            {"name": p.get("name", ""), "url": p.get("url", "")}
            for p in explicit
            if p.get("url")
        ]

    synthesized = []
    for field, label in PROFILE_FIELD_MAP:
        url = member.get(field)
        if url:  # truthy → skips None and ""
            synthesized.append({"name": label, "url": url})
    return synthesized


def resolve_focus(member: dict):
    """Research-focus text: prefer the `focus` string, else join `interests`.

    Reproduces buildMemberCard()'s backward-compatible fallback:
        member.focus ?? interests.join(', ')
    """
    focus = member.get("focus")
    if focus:
        return focus
    interests = member.get("interests")
    if isinstance(interests, list) and interests:
        return ", ".join(str(i) for i in interests)
    return None


# -----------------------------------------------------------------------------
# CARD BUILDER  — faithful mirror of buildMemberCard() (app.js §12)
# -----------------------------------------------------------------------------

def build_member_card(member: dict) -> str:
    """Return one <article class="member-card"> as an HTML string."""
    name = member.get("name", "")
    out = []

    # ── Root article (optional data-member-id, only when `id` is present) ─────
    data_attr = f' data-member-id="{esc(member["id"])}"' if member.get("id") else ""
    out.append(f'<article class="member-card"{data_attr}>')

    # ── LEFT: photo column (real <img>, or placeholder when no photo) ─────────
    out.append('  <div class="member-card__photo-col">')
    photo = member.get("photo")
    if photo:
        out.append(
            f'    <img class="member-photo" src="{esc(photo)}"'
            f' alt="Portrait photograph of {esc(name)}" loading="lazy" />'
        )
    else:
        out.append(
            f'    <div class="member-photo-placeholder" role="img"'
            f' aria-label="Profile photo placeholder for {esc(name)}">'
        )
        out.append('      <span class="material-icons" aria-hidden="true">person</span>')
        out.append("    </div>")
    out.append("  </div>")

    # ── RIGHT: info column ────────────────────────────────────────────────────
    out.append('  <div class="member-card__info-col">')

    # Header: name + academic title (title element is always present, per JS).
    out.append('    <header class="member-card__header">')
    out.append(f'      <h3 class="member-name">{esc(name)}</h3>')
    out.append(f'      <p class="member-title">{esc(member.get("title") or "")}</p>')
    out.append("    </header>")

    # Details list: Email + Research Focus (explicit text labels).
    out.append('    <dl class="member-details">')

    email = member.get("email")
    if email:
        out.append('      <div class="member-detail">')
        out.append('        <dt class="member-detail__label">Email</dt>')
        out.append(
            f'        <dd class="member-detail__value">'
            f'<a href="mailto:{esc(email)}" aria-label="Send email to {esc(name)}">'
            f"{esc(email)}</a></dd>"
        )
        out.append("      </div>")

    focus = resolve_focus(member)
    if focus:
        out.append('      <div class="member-detail">')
        out.append('        <dt class="member-detail__label">Focus</dt>')
        out.append(f'        <dd class="member-detail__value">{esc(focus)}</dd>')
        out.append("      </div>")

    out.append("    </dl>")

    # External profiles (rendered only when there is at least one link).
    profiles = collect_profiles(member)
    if profiles:
        out.append(
            f'    <div class="member-profiles"'
            f' aria-label="External profile links for {esc(name)}">'
        )
        out.append('      <ul class="member-profiles__list" role="list">')
        for prof in profiles:
            p_name, p_url = prof["name"], prof["url"]
            out.append(
                f'        <li><a class="member-profile-link" href="{esc(p_url)}"'
                f' target="_blank" rel="noopener noreferrer"'
                f' aria-label="{esc(p_name)} profile of {esc(name)}'
                f' — opens in new tab">{esc(p_name)}</a></li>'
            )
        out.append("      </ul>")
        out.append("    </div>")

    out.append("  </div>")   # /info-col
    out.append("</article>")
    return "\n".join(out)


# -----------------------------------------------------------------------------
# HTML INJECTION  — touch only the grid + state region; leave everything else
# (htmx header, hero, footer) byte-for-byte intact.
# -----------------------------------------------------------------------------

def find_element_span(markup: str, tag: str, el_id: str):
    """Return (start, end) char offsets of <tag id="el_id">…</tag>, balanced.

    Depth-counts opening/closing `tag` occurrences so nested same-tag elements
    are handled correctly. Returns None if the element is not found.
    """
    open_match = re.search(
        rf'<{tag}\b[^>]*?\bid="{re.escape(el_id)}"', markup, re.DOTALL
    )
    if not open_match:
        return None

    start = open_match.start()
    token_re = re.compile(rf"<{tag}\b|</{tag}>", re.IGNORECASE)
    depth = 0
    for tok in token_re.finditer(markup, start):
        if tok.group().startswith("</"):
            depth -= 1
            if depth == 0:
                return (start, tok.end())
        else:
            depth += 1
    return None


def inject_cards(markup: str, cards_html: str) -> str:
    """Replace the empty #members-grid body with the generated cards and drop
    the now-unnecessary `hidden` attribute that kept it invisible pre-JS."""
    open_match = re.search(
        r'<section\b[^>]*?\bid="members-grid"[^>]*?>', markup, re.DOTALL
    )
    if not open_match:
        sys.exit('ERROR: could not find <section id="members-grid"> in template.')

    open_tag = open_match.group()
    # Remove the standalone `hidden` boolean attribute (it lives on its own line).
    cleaned_open = re.sub(r"\s*\bhidden\b", "", open_tag)

    close_idx = markup.find("</section>", open_match.end())
    if close_idx == -1:
        sys.exit("ERROR: members-grid <section> has no closing </section>.")

    before = markup[: open_match.start()]
    after = markup[close_idx + len("</section>") :]

    indented = textwrap.indent(cards_html, CARD_INDENT)
    new_section = f"{cleaned_open}\n{indented}\n        </section>"
    return before + new_section + after


def remove_state_region(markup: str) -> str:
    """Delete the loading/error/empty #members-state region — meaningless once
    the cards are static — plus its trailing comment and excess blank lines."""
    span = find_element_span(markup, "div", "members-state")
    if not span:
        return markup  # already removed (idempotent re-run)

    start, end = span
    markup = markup[:start] + markup[end:]
    # Tidy a leftover "<!-- /members-state -->" marker and runs of blank lines.
    markup = re.sub(r"[ \t]*<!--\s*/members-state\s*-->[ \t]*\n?", "", markup)
    markup = re.sub(r"\n[ \t]*\n[ \t]*\n+", "\n\n", markup)
    return markup


# -----------------------------------------------------------------------------
# ENTRY POINT
# -----------------------------------------------------------------------------

def main() -> None:
    parser = argparse.ArgumentParser(
        description="Bake member cards from members.json into members.html."
    )
    parser.add_argument("--data", default="members.json",
                        help="Path to members.json (default: members.json)")
    parser.add_argument("--template", default="members.html",
                        help="Path to the members.html template (default: members.html)")
    parser.add_argument("--out", default="members.html",
                        help="Output path (default: members.html — in place, idempotent)")
    args = parser.parse_args()

    data_path = Path(args.data)
    template_path = Path(args.template)
    out_path = Path(args.out)

    # ── Load + validate JSON ──────────────────────────────────────────────────
    try:
        members = json.loads(data_path.read_text(encoding="utf-8"))
    except FileNotFoundError:
        sys.exit(f"ERROR: data file not found: {data_path}")
    except json.JSONDecodeError as exc:
        sys.exit(f"ERROR: {data_path} is not valid JSON — {exc}")

    if not isinstance(members, list) or not members:
        sys.exit(f"ERROR: {data_path} must be a non-empty JSON array of members.")

    # ── Build cards (JSON order is preserved — no `tier` field present) ───────
    cards_html = "\n\n".join(build_member_card(m) for m in members)

    # ── Inject into the template ──────────────────────────────────────────────
    markup = template_path.read_text(encoding="utf-8")
    markup = remove_state_region(markup)
    markup = inject_cards(markup, cards_html)

    out_path.write_text(markup, encoding="utf-8")

    # ── Operator feedback ─────────────────────────────────────────────────────
    print(f"OK  Generated {out_path}")
    print(f"    {len(members)} member card(s) baked into #members-grid")
    for m in members:
        n_links = len(collect_profiles(m))
        print(f"      - {m.get('name', '(unnamed)'):<22} {n_links} profile link(s)")


if __name__ == "__main__":
    main()
