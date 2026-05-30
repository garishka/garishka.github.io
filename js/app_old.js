/**
 * BeyondGR Project — js/app.js
 * ====================================
 * Single source of truth for ALL interactive behaviour.
 *
 * Sections
 * --------
 *  §1  Constants & Configuration
 *  §2  Path Resolution
 *  §3  Theme Utilities
 *  §4  Global Templates (header / nav / drawer / footer factories)
 *  §5  Mobile Drawer State
 *  §6  Event Binding
 *  §7  Global Chrome Init — setActiveNav() / initGlobalChrome() (htmx lifecycle)
 *  §8  Homepage — Publications Preview Strip
 *  §9  Homepage — Collaboration Form
 *  §10 Contacts  — Map Activation
 *  §11 Publications Page — Full Table + Sort Engine
 *  §12 Members Page — Card Grid
 *  §13 Contacts Page — Contact Form Validation
 *  §14 Entry Point — DOMContentLoaded
 *
 * Code rules: ES6+, const/let only, classList-based DOM manipulation.
 */

'use strict';


/* =============================================================================
   §1 — CONSTANTS & CONFIGURATION
   ============================================================================= */

/* Navigation markup now lives in partials/header.html (fetched via htmx).
   The old NAV_ITEMS registry and the GlobalTemplates string factories that
   built the header/nav/drawer in JS have been removed. */

const THEME_KEY         = 'astro-theme';            // localStorage key
const DARK_THEME        = 'dark';
const LIGHT_THEME       = 'light';
const SCROLL_THRESHOLD  = 50;                        // px before nav shrinks
const PUBLICATIONS_JSON = 'assets/publications.json';
const PUB_PREVIEW_COUNT = 3;                         // entries shown on homepage


/* =============================================================================
   §2 — PATH RESOLUTION
   ============================================================================= */

/**
 * resolveActivePage()
 * Extracts the HTML filename from window.location.pathname.
 * Falls back to "index.html" for bare-root "/" paths.
 * @returns {string}  e.g. "publications.html"
 */
function resolveActivePage() {
  const segments = window.location.pathname.split('/').filter(Boolean);
  const filename = segments[segments.length - 1] || 'index.html';
  return filename.includes('.html') ? filename : 'index.html';
}


/* =============================================================================
   §3 — THEME UTILITIES (htmx era)
   resolveInitialTheme() now lives in the inline <head> bootstrap script of each
   page, so the theme is stamped on <html> BEFORE first paint (zero flash).
   The toggle button is wired declaratively via hx-on:click="toggleTheme()" in
   partials/header.html — there is no JS "bind" step. The sun/moon icon swap is
   pure CSS, driven by the [data-theme] attribute (see css/style.css).
   ============================================================================= */

/**
 * toggleTheme()
 * Flips <html data-theme> between light/dark, persists to localStorage, and
 * refreshes the toggle button's aria-label. Called from the header's
 * hx-on:click handler.
 */
function toggleTheme() {
  const isDark = document.documentElement.getAttribute('data-theme') === DARK_THEME;
  const next   = isDark ? LIGHT_THEME : DARK_THEME;
  document.documentElement.setAttribute('data-theme', next);
  try { localStorage.setItem(THEME_KEY, next); } catch (e) { /* storage blocked */ }
  syncThemeButton();
}

/**
 * syncThemeButton()
 * Keeps the toggle button's aria-label in sync with the current theme.
 * (The visible icon is handled entirely in CSS, so no innerHTML work here.)
 * Convention: light → "Switch to dark mode"; dark → "Switch to light mode".
 */
function syncThemeButton() {
  const btn = document.querySelector('.btn-theme-toggle');
  if (!btn) return;
  const isDark = document.documentElement.getAttribute('data-theme') === DARK_THEME;
  btn.setAttribute('aria-label', isDark ? 'Switch to light mode' : 'Switch to dark mode');
}


/* =============================================================================
   §4 — (removed) GLOBAL TEMPLATES
   The header / nav / mobile-drawer markup is now the static fragment
   partials/header.html, fetched and swapped into #global-header-target by htmx
   (hx-get + hx-trigger="load"). No HTML is built in JavaScript any more.
   ============================================================================= */


/* =============================================================================
   §5 — MOBILE DRAWER (htmx-driven)
   The drawer is opened/closed through htmx hx-on:click handlers declared in
   partials/header.html:
       .btn-hamburger     → toggleDrawer()
       .nav-overlay       → closeDrawer()
       .drawer-close-btn  → closeDrawer()
       .drawer-link       → closeDrawer()   (collapse after a tap)
   These functions are declared at top level (global) so the inline hx-on
   handlers can reach them. They only toggle existing stylesheet classes.
   ============================================================================= */

/**
 * setDrawer(open)
 * Single source of truth for drawer state. Toggles the CSS classes the
 * stylesheet already expects (.is-open on the drawer + hamburger, .is-visible
 * on the overlay) and keeps ARIA + focus correct.
 * @param {boolean} open  true → open, false → close
 */
function setDrawer(open) {
  const drawer    = document.getElementById('mobile-nav-drawer');
  const overlay   = document.getElementById('nav-overlay');
  const hamburger = document.querySelector('.btn-hamburger');
  if (!drawer || !overlay || !hamburger) return;

  drawer.classList.toggle('is-open', open);
  overlay.classList.toggle('is-visible', open);
  // CSS hamburger animation targets .btn-hamburger.is-open
  hamburger.classList.toggle('is-open', open);

  hamburger.setAttribute('aria-expanded', String(open));
  hamburger.setAttribute('aria-label', open ? 'Close navigation menu' : 'Open navigation menu');
  drawer.setAttribute('aria-hidden',  String(!open));
  overlay.setAttribute('aria-hidden', String(!open));

  // Move focus into / out of the drawer for keyboard + screen-reader users
  if (open) drawer.querySelector('button, a')?.focus();
  else      hamburger.focus();
}

/** toggleDrawer() — flip the drawer open/closed (hamburger handler). */
function toggleDrawer() {
  const drawer = document.getElementById('mobile-nav-drawer');
  setDrawer(!drawer?.classList.contains('is-open'));
}

/** closeDrawer() — force the drawer closed (overlay / close-btn / link handler). */
function closeDrawer() {
  setDrawer(false);
}


/* =============================================================================
   §6 — EVENT BINDING (document-level + post-swap)
   Header click handlers are now declarative (hx-on in partials/header.html).
   What remains here are listeners that are NOT tied to a single header node:
   a global ESC key handler and the sticky-nav scroll behaviour.
   ============================================================================= */

/**
 * bindEscapeKey()
 * Global ESC listener — closes the drawer when open (WCAG 2.1 SC 2.1.2).
 * Attached to document once; safe before the header exists.
 */
function bindEscapeKey() {
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' &&
        document.getElementById('mobile-nav-drawer')?.classList.contains('is-open')) {
      closeDrawer();
    }
  });
}

/**
 * initScrollBehavior()
 * Passive scroll listener: adds/removes .is-scrolled on the sticky <nav>.
 * Must run AFTER the htmx header swap, because .site-nav does not exist until
 * then. Guards against a missing nav and against re-querying on every scroll.
 */
function initScrollBehavior() {
  const nav = document.querySelector('.site-nav');
  if (!nav) return;

  let wasScrolled = false;
  window.addEventListener('scroll', () => {
    const isNowScrolled = window.scrollY > SCROLL_THRESHOLD;
    if (isNowScrolled !== wasScrolled) {
      nav.classList.toggle('is-scrolled', isNowScrolled);
      wasScrolled = isNowScrolled;
    }
  }, { passive: true });
}


/* =============================================================================
   §7 — GLOBAL CHROME INIT (htmx lifecycle)
   There is no JS header injection any more. setActiveNav() marks the link for
   the current page; together with the scroll + theme-label sync it runs on the
   htmx:afterSwap event — i.e. the moment the fetched header lands in the DOM.
   ============================================================================= */

/**
 * setActiveNav()
 * Stamps .is-active + aria-current="page" on the desktop and drawer links whose
 * data-nav token matches the current page. Reuses the existing CSS selectors
 * (.nav-links__link.is-active / .drawer-link.is-active) — no markup duplication.
 */
function setActiveNav() {
  const active = resolveActivePage();
  document.querySelectorAll('.nav-links__link, .drawer-link').forEach((link) => {
    const isActive = link.getAttribute('data-nav') === active;
    link.classList.toggle('is-active', isActive);
    if (isActive) link.setAttribute('aria-current', 'page');
    else          link.removeAttribute('aria-current');
  });
}

/**
 * initGlobalChrome()
 * Registers the htmx lifecycle hook + the document-level ESC handler.
 * When htmx finishes swapping the header into #global-header-target, we:
 *   1. mark the active nav link (setActiveNav)
 *   2. sync the theme button aria-label (syncThemeButton)
 *   3. start the sticky-nav scroll watcher (initScrollBehavior)
 */
function initGlobalChrome() {
  bindEscapeKey();

  document.body.addEventListener('htmx:afterSwap', (event) => {
    // Only react to the header target — ignore any other future htmx swaps.
    if (event.target && event.target.id === 'global-header-target') {
      setActiveNav();
      syncThemeButton();
      initScrollBehavior();
    }
  });
}

/* =============================================================================
   §8 — HOMEPAGE: PUBLICATIONS PREVIEW STRIP
   Target: <div id="publications-preview">  (index.html only)
   Renders the PUB_PREVIEW_COUNT most recent entries as compact article cards.
   ============================================================================= */

/**
 * buildPubItem()
 * Constructs a single preview <article> element from a publication object.
 * Uses DOM API (not innerHTML) for cleaner, safer node construction.
 *
 * Link resolution priority (matches pub.links[] array from publications.json):
 *   1. First entry whose name is "Journal"  → publisher DOI (preferred)
 *   2. First entry whose name is "arXiv"    → preprint fallback
 *   3. First entry in the array             → last-resort fallback
 *   4. No links array / empty array         → button is omitted entirely
 *
 * @param {Object} pub - A publication object from publications.json
 * @returns {HTMLElement}
 */
const buildPubItem = (pub) => {
  const article = document.createElement('article');
  article.className = 'pub-item';

  const infoCol = document.createElement('div');
  infoCol.className = 'pub-item__info';

  const title = document.createElement('p');
  title.className = 'pub-item__title';
  title.textContent = pub.title;

  const authors = document.createElement('p');
  authors.className = 'pub-item__authors';
  authors.textContent = pub.authors.trim().replace(/\s*;\s*/g, '; ');

  const meta = document.createElement('div');
  meta.className = 'pub-item__meta';

  const year = document.createElement('span');
  year.className = 'pub-item__year';
  year.textContent = pub.year;
  meta.appendChild(year);

  if (pub.publisher) {
    const journal = document.createElement('span');
    journal.className = 'pub-item__journal';
    journal.textContent = pub.publisher;
    meta.appendChild(journal);
  }

  infoCol.append(title, authors, meta);

  const linkCol = document.createElement('div');
  linkCol.className = 'pub-item__link-col';

  /* ------------------------------------------------------------------
     Resolve the single best link to display from the pub.links[] array.
     Priority: Journal (publisher DOI) → arXiv preprint → first available.
     ------------------------------------------------------------------ */
  const links = Array.isArray(pub.links) ? pub.links : [];
  const resolvedLink =
    links.find(l => l.name === 'Journal') ||   // 1. prefer publisher DOI
    links.find(l => l.name === 'arXiv')   ||   // 2. fall back to arXiv
    links[0]                               ||   // 3. whatever is first
    null;                                       // 4. nothing available

  if (resolvedLink) {
    const linkBtn = document.createElement('a');
    linkBtn.className = 'btn-pub-link';
    linkBtn.href      = resolvedLink.url;
    linkBtn.target    = '_blank';
    linkBtn.rel       = 'noopener noreferrer';
    linkBtn.setAttribute('aria-label', `Read "${pub.title}" on ${resolvedLink.name}`);
    linkBtn.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="12" height="12"
        viewBox="0 0 24 24" fill="none" stroke="currentColor"
        stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"
        aria-hidden="true" focusable="false">
      <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>
      <polyline points="15 3 21 3 21 9"/>
      <line x1="10" y1="14" x2="21" y2="3"/>
    </svg>${resolvedLink.name}`;
    linkCol.appendChild(linkBtn);
  }

  article.append(infoCol, linkCol);
  return article;
};

/**
 * loadPublicationsPreview()
 * Fetches the JSON and populates the homepage preview strip.
 * On fetch failure, hides the whole section rather than showing a broken UI.
 */
const loadPublicationsPreview = async () => {
  const container = document.getElementById('publications-preview');
  if (!container) return;

  try {
    const response = await fetch(PUBLICATIONS_JSON);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);

    const publications = await response.json();
    const fragment = document.createDocumentFragment();

    publications.slice(0, PUB_PREVIEW_COUNT).forEach((pub) => {
      fragment.appendChild(buildPubItem(pub));
    });

    container.appendChild(fragment);

  } catch (err) {
    console.error('[ARP] loadPublicationsPreview failed:', err);
    const section = document.getElementById('publications-preview-section');
    if (section) section.hidden = true;
  }
};


/* =============================================================================
   §9 — HOMEPAGE: COLLABORATION ENQUIRY FORM
   Target: <form id="collab-form">  (index.html only)
   ============================================================================= */

/**
 * validateField()
 * Adds/removes .has-error on the group wrapper.
 * @param {HTMLElement} group   .form-group wrapper
 * @param {HTMLElement} input   The input or textarea
 * @param {Function}    testFn  Returns true when the value is INVALID
 * @returns {boolean}  true = valid
 */
const validateField = (group, input, testFn) => {
  const isInvalid = testFn(input.value.trim());
  group.classList.toggle('has-error', isInvalid);
  return !isInvalid;
};

/**
 * isValidEmail()
 * Lightweight RFC 5322-ish check — catches obvious non-emails without false positives.
 * @param {string} value
 * @returns {boolean}
 */
const isValidEmail = (value) => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(value);

/**
 * initCollabForm()
 * Wires the homepage collaboration form with validation + success feedback.
 */
const initCollabForm = () => {
  const form = document.getElementById('collab-form');
  if (!form) return;

  const successMsg = document.getElementById('form-success');

  form.addEventListener('submit', (e) => {
    e.preventDefault();

    const nameGroup  = form.querySelector('[data-group="name"]');
    const nameInput  = form.querySelector('#collab-name');
    const emailGroup = form.querySelector('[data-group="email"]');
    const emailInput = form.querySelector('#collab-email');
    const msgGroup   = form.querySelector('[data-group="message"]');
    const msgInput   = form.querySelector('#collab-message');

    const nameValid  = validateField(nameGroup,  nameInput,  (v) => v.length < 2);
    const emailValid = validateField(emailGroup, emailInput, (v) => !isValidEmail(v));
    const msgValid   = validateField(msgGroup,   msgInput,   (v) => v.length < 10);

    if (nameValid && emailValid && msgValid) {
      form.reset();
      if (successMsg) {
        successMsg.classList.add('is-visible');
        setTimeout(() => successMsg.classList.remove('is-visible'), 6000);
      }
    } else {
      form.querySelector('.has-error input, .has-error textarea')?.focus();
    }
  });

  // Clear error styling as user corrects a field
  form.querySelectorAll('input, textarea').forEach((input) => {
    input.addEventListener('input', () => {
      input.closest('.form-group')?.classList.remove('has-error');
    });
  });
};


/* =============================================================================
   §10 — CONTACTS: MAP ACTIVATION
   Target: <div class="map-wrapper">  (contacts.html only)

   Problem: iframe embeds capture pointer events and trap scroll.
   Solution: opt-in activation model — pointer-events: none by default;
   user clicks to enable, mouseleave or outside-click to disable.
   ============================================================================= */

const initContactMap = () => {
  const mapWrapper = document.querySelector('.map-wrapper');
  if (!mapWrapper) return;

  const mapPrompt = mapWrapper.querySelector('.map-overlay__prompt');
  let mapIsActive = false;

  const activateMap = () => {
    if (mapIsActive) return;
    mapIsActive = true;
    mapWrapper.classList.add('is-active');
    mapWrapper.setAttribute('aria-label', 'Interactive map — scroll or drag to navigate');
  };

  const deactivateMap = () => {
    if (!mapIsActive) return;
    mapIsActive = false;
    mapWrapper.classList.remove('is-active');
    mapWrapper.setAttribute('aria-label', 'Interactive map — click to enable zoom and pan');
  };

  // Click inside → activate (stopPropagation prevents immediate document-click deactivation)
  mapWrapper.addEventListener('click', (e) => { e.stopPropagation(); activateMap(); });

  // Click anywhere outside → deactivate
  document.addEventListener('click', deactivateMap);

  // Mouse leaves the wrapper → deactivate (desktop)
  mapWrapper.addEventListener('mouseleave', deactivateMap);

  // ESC key → deactivate and return focus
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && mapIsActive) { deactivateMap(); mapWrapper.focus(); }
  });

  // Adapt overlay prompt text for touch devices
  if (mapPrompt && window.matchMedia('(pointer: coarse)').matches) {
    const promptText = mapPrompt.querySelector('span');
    if (promptText) promptText.textContent = 'Tap map to interact';
  }

  // Add tabindex via JS so non-JS environments don't expose a no-op focusable element
  mapWrapper.setAttribute('tabindex', '0');
};


/* =============================================================================
   §11 — PUBLICATIONS PAGE: FULL TABLE + SORT ENGINE
   Target: <tbody id="pub-list-body">  (publications.html only)

   Features:
   - Async fetch with loading / error / empty state management
   - Sort by year (newest first) or title (alphabetical)
   - DocumentFragment-based batch DOM injection (single reflow per render)
   - Per-link type colouring via data-link-type attribute
   ============================================================================= */

const initPublicationsPage = async () => {
  const tbody    = document.getElementById('pub-list-body');
  const stateEl  = document.getElementById('pub-state');
  const loadingEl = document.getElementById('pub-loading');
  const countEl  = document.getElementById('pub-count');
  const sortBtns = document.querySelectorAll('.btn-sort');

  if (!tbody) return; // not on the publications page

  let currentSort    = 'year';
  let publicationsData = [];

  /* ---- showState(type) -------------------------------------------------- */
  const showState = (type) => {
    if (!stateEl) return;

    stateEl.querySelector('.pub-state__error')?.remove();
    stateEl.querySelector('.pub-state__empty')?.remove();

    if (!type) {
      stateEl.classList.remove('is-visible');
      if (loadingEl) loadingEl.style.display = 'none';
      return;
    }

    stateEl.classList.add('is-visible');

    if (type === 'loading') {
      if (loadingEl) loadingEl.style.display = 'flex';
    }
    if (type === 'error') {
      if (loadingEl) loadingEl.style.display = 'none';
      const errEl = document.createElement('p');
      errEl.className = 'pub-state__error';
      errEl.innerHTML = `<i class="fa-solid fa-triangle-exclamation" aria-hidden="true"></i>
        Failed to load publications. Please try refreshing the page.`;
      stateEl.appendChild(errEl);
    }
    if (type === 'empty') {
      if (loadingEl) loadingEl.style.display = 'none';
      const emptyEl = document.createElement('p');
      emptyEl.className = 'pub-state__empty';
      emptyEl.textContent = 'No publications found.';
      stateEl.appendChild(emptyEl);
    }
  };

  /* ---- sortPublications(data, mode) ------------------------------------- */
  const sortPublications = (data, mode) => [...data].sort((a, b) => {
    if (mode === 'year') {
      if (b.year !== a.year) return b.year - a.year;
      return a.title.localeCompare(b.title);
    }
    if (mode === 'title') return a.title.localeCompare(b.title, undefined, { sensitivity: 'base' });
    return 0;
  });

  /* ---- getLinkType(name) ------------------------------------------------ */
  const getLinkType = (name) => {
    const n = name.toLowerCase();
    if (n.includes('arxiv'))                        return 'arxiv';
    if (n.includes('journal') || n.includes('doi')) return 'journal';
    return 'default';
  };

  /* ---- buildPubRow(pub) ------------------------------------------------- */
  const buildPubRow = (pub) => {
    const row = document.createElement('tr');
    row.className = 'pub-row';
    if (pub.id) row.setAttribute('data-id', pub.id);

    // Support both the original multi-link format (pub.links[]) and
    // the simple single-link format from the project's publications.json
    // (pub.link + pub.linkText). Both are handled gracefully.
    let linksHTML = '';
    if (Array.isArray(pub.links) && pub.links.length) {
      linksHTML = pub.links.map(link => {
        const lt = getLinkType(link.name);
        return `<a class="pub-link" href="${link.url}" target="_blank"
                   rel="noopener noreferrer" data-link-type="${lt}"
                   aria-label="Read '${pub.title}' on ${link.name} (opens in new tab)">
                  <i class="fa-solid ${link.icon || 'fa-external-link'}" aria-hidden="true"></i>
                  ${link.name}
                </a>`;
      }).join('');
    } else if (pub.link) {
      const lt = getLinkType(pub.linkText || '');
      linksHTML = `<a class="pub-link" href="${pub.link}" target="_blank"
                      rel="noopener noreferrer" data-link-type="${lt}"
                      aria-label="Read '${pub.title}' on ${pub.linkText}">
                     <i class="fa-solid ${lt === 'arxiv' ? 'fa-file-lines' : 'fa-book-open'}" aria-hidden="true"></i>
                     ${pub.linkText}
                   </a>`;
    }

    // Publisher: use pub.publisher if present, else derive from journal field
    const publisherText = pub.publisher || (pub.journal ? pub.journal : 'arXiv Preprint');

    row.innerHTML = `
      <td class="pub-cell pub-cell--title">
        <span class="mobile-label" aria-hidden="true">Title</span>
        <p class="pub-title">${pub.title}</p>
      </td>
      <td class="pub-cell pub-cell--authors">
        <span class="mobile-label" aria-hidden="true">Authors</span>
        <p class="pub-authors">${pub.authors}</p>
      </td>
      <td class="pub-cell pub-cell--year">
        <span class="mobile-label" aria-hidden="true">Year</span>
        <span class="pub-year">${pub.year}</span>
      </td>
      <td class="pub-cell pub-cell--publisher">
        <span class="mobile-label" aria-hidden="true">Publisher</span>
        <span class="pub-publisher">${publisherText}</span>
      </td>
      <td class="pub-cell pub-cell--links">
        <span class="mobile-label" aria-hidden="true">Links</span>
        <div class="links-cluster">${linksHTML}</div>
      </td>`;

    return row;
  };

  /* ---- renderPublications(data) ----------------------------------------- */
  const renderPublications = (data) => {
    const sorted   = sortPublications(data, currentSort);
    const fragment = document.createDocumentFragment();
    sorted.forEach(pub => fragment.appendChild(buildPubRow(pub)));

    tbody.innerHTML = '';
    tbody.appendChild(fragment);

    if (countEl) {
      const n = sorted.length;
      countEl.textContent = `${n} publication${n !== 1 ? 's' : ''}`;
    }

    showState(sorted.length === 0 ? 'empty' : null);
  };

  /* ---- Sort button listeners -------------------------------------------- */
  sortBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      const mode = btn.getAttribute('data-sort');
      if (mode === currentSort) return;

      currentSort = mode;
      sortBtns.forEach(b => {
        const active = b.getAttribute('data-sort') === currentSort;
        b.classList.toggle('is-active', active);
        b.setAttribute('aria-pressed', String(active));
      });

      renderPublications(publicationsData);
    });
  });

  /* ---- Async data fetch -------------------------------------------------- */
  showState('loading');

  try {
    const response = await fetch(PUBLICATIONS_JSON);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    publicationsData = await response.json();
    renderPublications(publicationsData);
  } catch (err) {
    console.error('[ARP] initPublicationsPage fetch failed:', err);
    showState('error');
    if (countEl) countEl.textContent = '—';
  }
};

/* =============================================================================
   §12 — MEMBERS PAGE: HORIZONTAL ROW-CARD ENGINE
   Target:  <section class="members-grid"> (members.html only)
   State:   <div class="members-state" id="members-state">

   Data flow:
     loadMembers()
       1. fetch('assets/members.json')
       2. Sort by member.tier ascending → academic hierarchy order:
            tier 1 → Group Leaders / Professors
            tier 2 → Postdoctoral Researchers
            tier 3 → PhD Candidates / Site Administrators
       3. For each member call buildMemberCard(member) → <article>
       4. Append all <article>s to .members-grid via DocumentFragment (one reflow)
       5. Show/hide .members-state feedback region as appropriate

   Required JSON shape (assets/members.json):
     [
       {
         "id":       "nedkova-petya",          // slug identifier
         "tier":     1,                         // 1=Leader, 2=Postdoc, 3=PhD
         "name":     "Petya Nedkova",
         "title":    "Associate Professor",
         "email":    "pnedkova@phys.uni-sofia.bg",
         "focus":    "Gravitational Lensing, Black Hole Thermodynamics",
         "photo":    "assets/members/nedkova.jpg",  // optional — omit for placeholder
         "profiles": [                              // optional — omit or [] if none
           { "name": "InspireHEP", "url": "https://inspirehep.net/authors/..." },
           { "name": "ORCID",      "url": "https://orcid.org/..."              }
         ]
       }
     ]

   Backward-compat: if `focus` is absent, the engine falls back to joining the
   legacy `interests` string array so older JSON files keep working without edits.
   ============================================================================= */

const MEMBERS_JSON = 'assets/members.json';


/**
 * showMembersState()
 * Controls visibility of the .members-state feedback region and the grid itself.
 *
 * @param {"loading"|"error"|"empty"|null} mode
 *   "loading" → spinner visible, grid hidden
 *   "error"   → error message visible, grid hidden
 *   "empty"   → empty notice visible, grid hidden
 *   null      → all state hidden, grid revealed
 */
function showMembersState(mode) {
  const stateEl   = document.getElementById('members-state');
  const gridEl    = document.querySelector('.members-grid');
  const loadingEl = document.getElementById('members-loading');
  const errorEl   = document.getElementById('members-error');
  const emptyEl   = document.getElementById('members-empty');

  if (!stateEl) return;

  // Reset all child states first; then reveal only the one matching `mode`
  [loadingEl, errorEl, emptyEl].forEach(el => el?.classList.remove('is-visible'));

  if (mode === null) {
    // Data is ready — hide state region, remove `hidden` to reveal the grid
    stateEl.classList.remove('is-visible');
    if (gridEl) gridEl.removeAttribute('hidden');
  } else {
    // Keep grid hidden while a state (loading/error/empty) is active
    stateEl.classList.add('is-visible');
    if (gridEl) gridEl.setAttribute('hidden', '');

    const targetEl = { loading: loadingEl, error: errorEl, empty: emptyEl }[mode];
    targetEl?.classList.add('is-visible');
  }
}


/**
 * buildMemberCard()
 * Constructs a full <article class="member-card"> for one member entry.
 *
 * DOM structure produced (matches §47–§51 in css/style.css):
 *
 *   <article class="member-card" data-member-id="{id}">
 *
 *     <!-- LEFT: fixed-width portrait column -->
 *     <div class="member-card__photo-col">
 *       <img class="member-photo" …/>          ← when photo path is supplied
 *       <div class="member-photo-placeholder">  ← fallback when no photo / load error
 *         <span class="material-icons">person</span>
 *       </div>
 *     </div>
 *
 *     <!-- RIGHT: all text details, flex-grow:1 -->
 *     <div class="member-card__info-col">
 *
 *       <header class="member-card__header">
 *         <h3 class="member-name">{name}</h3>
 *         <p  class="member-title">{title}</p>
 *       </header>
 *
 *       <dl class="member-details">
 *         <div class="member-detail">
 *           <dt class="member-detail__label">Email</dt>
 *           <dd class="member-detail__value"><a href="mailto:{email}">{email}</a></dd>
 *         </div>
 *         <div class="member-detail">
 *           <dt class="member-detail__label">Research Focus</dt>
 *           <dd class="member-detail__value">{focus}</dd>
 *         </div>
 *       </dl>
 *
 *       <!-- Only rendered when member.profiles is a non-empty array -->
 *       <div class="member-profiles">
 *         <span class="member-profiles__label">Profiles:</span>
 *         <ul class="member-profiles__list" role="list">
 *           <li><a class="member-profile-link" href="{url}">{name}</a></li>
 *           …
 *         </ul>
 *       </div>
 *
 *     </div>
 *   </article>
 *
 * All text is written out in full — no icon-only communication anywhere.
 * All DOM operations use createElement / textContent / appendChild;
 * no innerHTML string injection for user-sourced data (XSS hygiene).
 *
 * @param {Object} member  — One entry from members.json
 * @returns {HTMLElement}  — A ready-to-append <article> node
 */
function buildMemberCard(member) {

  /* ── Root article ──────────────────────────────────────────────────────── */
  const article = document.createElement('article');
  article.classList.add('member-card');
  if (member.id) article.dataset.memberId = member.id;


  /* ── LEFT: Photo column ────────────────────────────────────────────────── */
  const photoCol = document.createElement('div');
  photoCol.classList.add('member-card__photo-col');

  // Helper: builds the placeholder <div> used when no photo is available
  // or when an <img> fires its onerror handler.
  const buildPlaceholder = () => {
    const ph = document.createElement('div');
    ph.classList.add('member-photo-placeholder');
    ph.setAttribute('role', 'img');
    ph.setAttribute('aria-label', `Profile photo placeholder for ${member.name}`);
    ph.innerHTML = '<span class="material-icons" aria-hidden="true">person</span>';
    return ph;
  };

  if (member.photo) {
    const img = document.createElement('img');
    img.classList.add('member-photo');
    img.src     = member.photo;
    img.alt     = `Portrait photograph of ${member.name}`;
    img.loading = 'lazy';
    // On broken image: remove the <img> and swap in the placeholder <div>.
    // Uses replaceChild so no inline style or innerHTML is needed.
    img.addEventListener('error', () => {
      photoCol.replaceChild(buildPlaceholder(), img);
    });
    photoCol.appendChild(img);
  } else {
    photoCol.appendChild(buildPlaceholder());
  }


  /* ── RIGHT: Info column ────────────────────────────────────────────────── */
  const infoCol = document.createElement('div');
  infoCol.classList.add('member-card__info-col');


  /* ── Card header: Name + academic title ──────────────────────────────── */
  const cardHeader = document.createElement('header');
  cardHeader.classList.add('member-card__header');

  const nameEl = document.createElement('h3');
  nameEl.classList.add('member-name');
  nameEl.textContent = member.name;

  const titleEl = document.createElement('p');
  titleEl.classList.add('member-title');
  titleEl.textContent = member.title ?? '';

  cardHeader.append(nameEl, titleEl);


  /* ── Details list: Email + Research Focus (explicit text labels) ─────── */
  const detailsList = document.createElement('dl');
  detailsList.classList.add('member-details');

  /**
   * makeDetailRow()
   * Constructs one .member-detail <div> with a <dt> label and a <dd> value.
   * `value` can be a plain string (textContent) or a pre-built Element (e.g. <a>).
   * @param {string}          labelText
   * @param {string|Element}  value
   * @returns {HTMLElement}
   */
  const makeDetailRow = (labelText, value) => {
    const row = document.createElement('div');
    row.classList.add('member-detail');

    const dt = document.createElement('dt');
    dt.classList.add('member-detail__label');
    dt.textContent = labelText;

    const dd = document.createElement('dd');
    dd.classList.add('member-detail__value');

    if (typeof value === 'string') {
      dd.textContent = value;
    } else {
      dd.appendChild(value);
    }

    row.append(dt, dd);
    return row;
  };

  // Email — always rendered as a clickable mailto: anchor with the full address
  // written as visible link text; never hidden behind an icon.
  if (member.email) {
    const emailLink = document.createElement('a');
    emailLink.href        = `mailto:${member.email}`;
    emailLink.textContent = member.email;
    emailLink.setAttribute('aria-label', `Send email to ${member.name}`);
    detailsList.appendChild(makeDetailRow('Email', emailLink));
  }

  // Research focus — prefers the new `focus` string field; falls back to
  // joining the legacy `interests` array for backward-compatibility.
  const focusText = member.focus
    ?? (Array.isArray(member.interests) ? member.interests.join(', ') : null);

  if (focusText) {
    detailsList.appendChild(makeDetailRow('Research Focus', focusText));
  }


  /* ── External profiles row (named pill links) ────────────────────────── */
  // Rendered only when member.profiles is a non-empty array.
  // Each entry produces a pill-shaped <a> button with the service name
  // written in full — e.g. "InspireHEP", "ORCID", "Google Scholar", "GitHub".
  // No icon-only buttons; names are always readable without hover tooltips.
  let profilesBlock = null;

  if (Array.isArray(member.profiles) && member.profiles.length > 0) {
    profilesBlock = document.createElement('div');
    profilesBlock.classList.add('member-profiles');
    profilesBlock.setAttribute('aria-label', `External profile links for ${member.name}`);

    const profilesLabel = document.createElement('span');
    profilesLabel.classList.add('member-profiles__label');
    profilesLabel.textContent = 'Profiles:';

    const profilesList = document.createElement('ul');
    profilesList.classList.add('member-profiles__list');
    profilesList.setAttribute('role', 'list');

    // One <li> pill-link per profiles[] entry
    member.profiles.forEach(({ name: pName, url: pUrl }) => {
      const li = document.createElement('li');
      const a  = document.createElement('a');
      a.classList.add('member-profile-link');
      a.href        = pUrl;
      a.target      = '_blank';
      a.rel         = 'noopener noreferrer';
      a.textContent = pName;
      a.setAttribute('aria-label',
        `${pName} profile of ${member.name} — opens in new tab`);
      li.appendChild(a);
      profilesList.appendChild(li);
    });

    profilesBlock.append(profilesLabel, profilesList);
  }


  /* ── Assemble info column ─────────────────────────────────────────────── */
  infoCol.append(cardHeader, detailsList);
  if (profilesBlock) infoCol.appendChild(profilesBlock);

  /* ── Assemble final card ──────────────────────────────────────────────── */
  article.append(photoCol, infoCol);
  return article;
}


/**
 * loadMembers()
 * Async orchestrator for the members page.
 * Guards with an early return when .members-grid is absent so this function
 * can be called unconditionally from the DOMContentLoaded entry point (§14).
 *
 * Hierarchy sorting: members[] is shallow-copied and sorted ascending by `tier`
 * before rendering, so the manual academic order (Leaders → Postdocs → PhDs)
 * is always respected regardless of JSON array order.
 * Members without a `tier` field sort last (Infinity fallback).
 */
const loadMembers = async () => {
  const grid = document.querySelector('.members-grid');
  if (!grid) return; // Not the members page — exit silently

  showMembersState('loading');

  try {
    const response = await fetch(MEMBERS_JSON);
    if (!response.ok) {
      throw new Error(`HTTP ${response.status} — could not load members data.`);
    }

    const members = await response.json();

    if (!Array.isArray(members) || members.length === 0) {
      showMembersState('empty');
      return;
    }

    // Sort ascending by tier (1 → 2 → 3). Stable sort preserves original
    // ordering among members that share the same tier value.
    const sorted = [...members].sort(
      (a, b) => (a.tier ?? Infinity) - (b.tier ?? Infinity)
    );

    // Build all cards; insert via DocumentFragment for a single DOM reflow
    const fragment = document.createDocumentFragment();
    sorted.forEach(member => fragment.appendChild(buildMemberCard(member)));

    grid.innerHTML = '';   // Clear any server-side fallback content
    grid.appendChild(fragment);

    // Cards are in place — reveal grid, hide state region
    showMembersState(null);

  } catch (err) {
    console.error('[ARP] loadMembers fetch failed:', err);
    showMembersState('error');
  }
};

/* =============================================================================
   §13 — CONTACTS PAGE: CONTACT FORM VALIDATION
   Target: <form id="contact-form">  (contacts.html only)
   Note: This is a DIFFERENT form from the homepage #collab-form (§9).
   ============================================================================= */

/**
 * validateContactForm()
 * Validates #contact-form fields using the browser Constraint Validation API.
 * Error messages are written into [data-error-for="fieldId"] spans.
 * @param {HTMLFormElement} form
 * @returns {boolean}
 */
function validateContactForm(form) {
  let isValid = true;

  const setFieldError = (field, message) => {
    const errorEl = form.querySelector(`[data-error-for="${field.id}"]`);
    if (!errorEl) return;
    if (message) {
      errorEl.textContent = message;
      errorEl.classList.add('is-visible');
      field.setAttribute('aria-invalid', 'true');
      isValid = false;
    } else {
      errorEl.textContent = '';
      errorEl.classList.remove('is-visible');
      field.removeAttribute('aria-invalid');
    }
  };

  const nameField  = form.querySelector('#contact-name');
  const emailField = form.querySelector('#contact-email');
  const msgField   = form.querySelector('#contact-message');

  if (nameField)  setFieldError(nameField,  nameField.value.trim() === '' ? 'Please enter your name.' : null);
  if (emailField) setFieldError(emailField, !emailField.validity.valid  ? 'Please enter a valid email address.' : null);
  if (msgField) {
    const len = msgField.value.trim().length;
    setFieldError(msgField, len < 20 ? `Your message must be at least 20 characters (${len}/20 so far).` : null);
  }

  return isValid;
}

/**
 * bindContactForm()
 * Attaches submit and blur listeners to #contact-form.
 */
function bindContactForm() {
  const form = document.getElementById('contact-form');
  if (!form) return;

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    if (validateContactForm(form)) {
      const confirmation = document.getElementById('form-confirmation');
      if (confirmation) {
        confirmation.textContent = 'Thank you for your message! We will be in touch shortly.';
        confirmation.classList.add('is-visible');
      }
      form.reset();
    }
  });

  // Validate on blur so users get feedback as they move between fields
  form.querySelectorAll('input, textarea').forEach((field) => {
    field.addEventListener('blur', () => validateContactForm(form));
  });
}


/* =============================================================================
   §14 — ENTRY POINT
   DOMContentLoaded fires as soon as the HTML is parsed — before images and
   stylesheets finish loading — giving the fastest possible chrome render.
   Each page-specific function guards itself with an early return when its
   target container is absent, so all calls are unconditional here.
   ============================================================================= */

document.addEventListener('DOMContentLoaded', () => {

  // Register the htmx:afterSwap hook + ESC handler. The header itself is fetched
  // and rendered by htmx (partials/header.html); setActiveNav() then runs the
  // moment that swap completes. Registered here so the listener exists before
  // the async header fetch resolves.
  initGlobalChrome();

  // Page-specific initializers — each self-selects via its own guard
  loadPublicationsPreview(); // index.html       → #publications-preview
  initCollabForm();          // index.html       → #collab-form
  loadHomeResearchPreviews(); // index.html → #research-previews-track
  initContactMap();          // contacts.html    → .map-wrapper
  initPublicationsPage();    // publications.html → #pub-list-body
  loadMembers();             // members.html      → #members-grid
  bindContactForm();         // contacts.html    → #contact-form
  initResearchPage();

});

/* =============================================================================
   §15 — RESEARCH PAGE: DYNAMIC ARTICLE LOADER
   ─────────────────────────────────────────────────────────────────────────────
   Target page: research.html
   Guard:       initResearchPage() returns immediately when .research-sidebar
                is absent, so this entire section can be required unconditionally
                from the DOMContentLoaded entry point (§14) without side-effects.

   Public entry point:  initResearchPage()

   Internal helpers (not exported):
     showArticleState(state)          — manage welcome/loading/error panel visibility
     loadArticle(filePath, retryFn)   — fetch snippet, inject into #article-viewer
     sortSidebarArticles(order)       — re-order .sidebar-nav__item by data-date
     filterSidebarArticles(query)     — show/hide items by data-title substring match
     updateActiveNavBtn(activeBtn)    — set aria-pressed + .is-active on nav buttons
     updateArticleCount()             — populate #research-article-count text node

   Data model:
     Each sidebar <li.sidebar-nav__item> carries:
       data-file  {string}  Relative path of the HTML snippet to fetch
                            e.g. "articles/black-holes-accretion.html"
       data-date  {string}  ISO 8601 date (YYYY-MM-DD) — used by sort engine
       data-title {string}  Plain-text title — used by live search filter
   ============================================================================= */


/* ---------------------------------------------------------------------------
   §15.1 — MODULE STATE
   A tiny closure-level object that holds the last-loaded file path so the
   Retry button can re-attempt the same fetch without re-reading the DOM.
   --------------------------------------------------------------------------- */
const _researchState = {
  lastFilePath: null,   // {string|null} — populated on every loadArticle() call
};


/* ---------------------------------------------------------------------------
   §15.2 — showArticleState(state)
   Manages visibility of the three child panels inside #article-state and
   toggles the article viewer itself.

   @param {'welcome'|'loading'|'error'|null} state
     'welcome' → show welcome prompt, hide viewer
     'loading' → show spinner,        hide viewer
     'error'   → show error panel,    hide viewer
     null      → hide all panels,     SHOW viewer  (article successfully loaded)
   --------------------------------------------------------------------------- */
function showArticleState(state) {
  const stateWrap = document.getElementById('article-state');
  const welcomeEl = document.getElementById('article-welcome');
  const loadingEl = document.getElementById('article-loading');
  const errorEl   = document.getElementById('article-error');
  const viewerEl  = document.getElementById('article-viewer');

  // Guard — these elements are only present on research.html
  if (!stateWrap || !viewerEl) return;

  // Reset all three child panels to hidden first
  [welcomeEl, loadingEl, errorEl].forEach(el => {
    if (el) {
      el.classList.add('is-hidden');
      el.setAttribute('aria-hidden', 'true');
    }
  });

  if (state === null) {
    // ── Content loaded: hide the state wrapper, reveal the viewer ──────────
    stateWrap.classList.add('is-hidden');
    viewerEl.classList.remove('is-hidden');
    viewerEl.removeAttribute('aria-hidden');
  } else {
    // ── State panel visible: hide the viewer, reveal the correct child ──────
    stateWrap.classList.remove('is-hidden');
    viewerEl.classList.add('is-hidden');
    viewerEl.setAttribute('aria-hidden', 'true');

    // Map the state string to its corresponding DOM element
    const targetEl =
        state === 'welcome' ? welcomeEl
      : state === 'loading' ? loadingEl
      : errorEl;   // 'error'

    if (targetEl) {
      targetEl.classList.remove('is-hidden');
      targetEl.removeAttribute('aria-hidden');
    }
  }
}


/* ---------------------------------------------------------------------------
   §15.3 — loadArticle(filePath)
   Fetches an HTML snippet and injects it into #article-viewer.
   After injection, renderArticleMath() is called to typeset any LaTeX
   delimiters that the snippet contains.
   --------------------------------------------------------------------------- */
const loadArticle = async (filePath) => {
  _researchState.lastFilePath = filePath;
  showArticleState('loading');

  try {
    const response = await fetch(filePath);
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: could not load "${filePath}".`);
    }

    const html = await response.text();
    const viewer = document.getElementById('article-viewer');
    if (!viewer) return;

    viewer.innerHTML = html;

    // ── KaTeX render pass ─────────────────────────────────────────────────
    // Must run AFTER innerHTML is set so the new nodes exist in the DOM.
    // Wrapped in a guard so the page degrades gracefully if the KaTeX CDN
    // scripts have not loaded yet (e.g. offline / CDN outage).
    renderArticleMath(viewer);

    showArticleState(null);
    viewer.scrollIntoView({ behavior: 'smooth', block: 'start' });

  } catch (err) {
    console.error('[ARP] loadArticle failed:', err);
    const errorMsg = document.getElementById('article-error-msg');
    if (errorMsg) {
      errorMsg.textContent =
        `Could not retrieve "${filePath}". ` +
        `Check that the file exists in /articles/ and your dev server is running. ` +
        `Original error: ${err.message}`;
    }
    showArticleState('error');
  }
};


/* ---------------------------------------------------------------------------
   §15.2b — renderArticleMath(container)
   Calls the KaTeX Auto-Render extension on a given DOM node.
   Scans only inside `container` (never the whole document) for performance.

   Delimiter map (matches both common LaTeX conventions):
     Block   $$...$$   and   \[...\]
     Inline  $...$     and   \(...\)

   throwOnError: false — malformed LaTeX prints a red error token in-place
   instead of throwing and aborting the entire render pass.

   @param {HTMLElement} container — the element whose subtree to scan
   --------------------------------------------------------------------------- */
function renderArticleMath(container) {
  // Guard: renderMathInElement is injected by the KaTeX auto-render CDN script.
  // If that script has not executed yet (CDN failure, slow network), exit cleanly.
  if (typeof renderMathInElement !== 'function') {
    console.warn('[ARP] KaTeX auto-render not available — math will not be typeset.');
    return;
  }

  renderMathInElement(container, {
    // Delimiter pairs in priority order — block before inline to avoid
    // the inline $ scanner swallowing the opening $$ of a block equation.
    delimiters: [
      { left: '$$',  right: '$$',  display: true  },   // Block  $$...$$
      { left: '\\[', right: '\\]', display: true  },   // Block  \[...\]
      { left: '$',   right: '$',   display: false },   // Inline $...$
      { left: '\\(', right: '\\)', display: false },   // Inline \(...\)
    ],

    // Ignore content inside these tags — code blocks and raw text nodes
    // should never be treated as LaTeX source.
    ignoredTags: ['script', 'noscript', 'style', 'textarea', 'pre', 'code'],

    // Print a visible error token instead of crashing the render pass
    throwOnError: false,
  });
}

/* ---------------------------------------------------------------------------
   §15.4 — sortSidebarArticles(order)
   Re-orders all .sidebar-nav__item elements within #sidebar-nav-list
   chronologically by their data-date attribute (ISO 8601 strings).

   Uses a stable Array.sort() backed by Date.getTime() so items with
   identical dates preserve their original DOM order relative to each other.

   The re-ordered items are re-inserted via a DocumentFragment for a single
   layout reflow rather than N individual DOM mutations.

   @param {'asc'|'desc'} order
     'desc' → newest first (default on page load)
     'asc'  → oldest first
   --------------------------------------------------------------------------- */
function sortSidebarArticles(order) {
  const list = document.getElementById('sidebar-nav-list');
  if (!list) return;

  // Snapshot current items into a regular array for sorting
  const items = Array.from(list.querySelectorAll('.sidebar-nav__item'));

  // Stable chronological sort.
  // Fallback '1970-01-01' ensures items with missing data-date are grouped
  // at the "oldest" end rather than producing NaN comparisons.
  items.sort((a, b) => {
    const dateA = new Date(a.dataset.date || '1970-01-01').getTime();
    const dateB = new Date(b.dataset.date || '1970-01-01').getTime();
    return order === 'asc' ? dateA - dateB : dateB - dateA;
  });

  // Re-insert all sorted nodes in one DOM operation via DocumentFragment
  const fragment = document.createDocumentFragment();
  items.forEach(item => fragment.appendChild(item));
  list.appendChild(fragment);
}


/* ---------------------------------------------------------------------------
   §15.5 — filterSidebarArticles(query)
   Live search: hides .sidebar-nav__item elements whose data-title attribute
   does not contain the normalised query string (case-insensitive, leading/
   trailing whitespace trimmed).

   Toggling the .is-filtered-out CSS class (display:none) instead of removing
   nodes preserves all data-* attributes and event listeners on filtered items,
   so they reappear instantly when the query is cleared.

   @param {string} query — raw value of the search input field
   --------------------------------------------------------------------------- */
function filterSidebarArticles(query) {
  const list      = document.getElementById('sidebar-nav-list');
  const noResults = document.getElementById('sidebar-no-results');
  if (!list) return;

  // Normalise the query: strip leading/trailing whitespace, lowercase
  const term = query.trim().toLowerCase();

  const items = list.querySelectorAll('.sidebar-nav__item');
  let visibleCount = 0;

  items.forEach(item => {
    // data-title is the plain-text title set as an attribute on each <li>
    const title   = (item.dataset.title || '').toLowerCase();
    const matches = term === '' || title.includes(term);

    // Toggle visibility via CSS class — never via inline style per code rules
    item.classList.toggle('is-filtered-out', !matches);
    if (matches) visibleCount++;
  });

  // Show / hide the "no articles match" notice based on visible count
  if (noResults) {
    noResults.classList.toggle('is-hidden', visibleCount > 0);
  }
}


/* ---------------------------------------------------------------------------
   §15.6 — updateActiveNavBtn(activeBtn)
   Sets the .is-active CSS class and aria-pressed="true" on the button that
   triggered the last article load, resetting all sibling buttons first.

   This keeps both the visual indicator (left gold bar) and the accessibility
   state in sync without querying the DOM on every subsequent render.

   @param {HTMLElement} activeBtn — the .sidebar-nav__btn that was clicked
   --------------------------------------------------------------------------- */
function updateActiveNavBtn(activeBtn) {
  const list = document.getElementById('sidebar-nav-list');
  if (!list) return;

  list.querySelectorAll('.sidebar-nav__btn').forEach(btn => {
    const isActive = btn === activeBtn;
    btn.classList.toggle('is-active', isActive);
    // aria-pressed conveys toggle state to screen-reader users
    btn.setAttribute('aria-pressed', String(isActive));
  });
}


/* ---------------------------------------------------------------------------
   §15.7 — updateArticleCount()
   Reads the total count of .sidebar-nav__item elements (including filtered-
   out items) and writes a human-readable count string into #research-article-count.

   Called once on init; call again if items are ever added/removed dynamically.
   --------------------------------------------------------------------------- */
function updateArticleCount() {
  const counter = document.getElementById('research-article-count');
  const list    = document.getElementById('sidebar-nav-list');
  if (!counter || !list) return;

  const total = list.querySelectorAll('.sidebar-nav__item').length;
  counter.textContent = `${total} article${total !== 1 ? 's' : ''}`;
}


/* ---------------------------------------------------------------------------
   §15.8 — initResearchPage()
   Main orchestrator for research.html. Binds all event listeners and runs
   the initial UI setup sequence.

   Guard: returns silently when .research-sidebar is absent so this function
   can be called unconditionally from the DOMContentLoaded entry point.
   --------------------------------------------------------------------------- */
function initResearchPage() {

  // ── Guard — only run on research.html ─────────────────────────────────────
  const sidebar = document.querySelector('.research-sidebar');
  if (!sidebar) return;

  // ── Element references ─────────────────────────────────────────────────────
  const sortBtn     = document.getElementById('btn-research-sort');
  const sortIcon    = document.getElementById('sort-icon');
  const searchInput = document.getElementById('sidebar-search-input');
  const clearBtn    = document.getElementById('sidebar-search-clear');
  const navList     = document.getElementById('sidebar-nav-list');
  const retryBtn    = document.getElementById('btn-article-retry');

  // ── Initial UI state ───────────────────────────────────────────────────────
  updateArticleCount();              // Populate "5 articles" counter
  sortSidebarArticles('desc');       // Default order: newest first
  showArticleState('welcome');       // Show the "select an article" prompt


  // ── SORT TOGGLE ────────────────────────────────────────────────────────────
  // Reads the current direction from data-order, flips it, persists it back,
  // updates the directional chevron icon, and re-sorts the list.
  if (sortBtn) {
    sortBtn.addEventListener('click', () => {
      const current = sortBtn.dataset.order || 'desc';
      const next    = current === 'desc' ? 'asc' : 'desc';

      // Persist the new direction so subsequent clicks read the correct state
      sortBtn.dataset.order = next;

      // Swap the directional arrow icon (FontAwesome classes)
      if (sortIcon) {
        // fa-arrow-down-short-wide = "newest first" (↓ wide)
        // fa-arrow-up-wide-short   = "oldest first"  (↑ wide)
        sortIcon.className = next === 'desc'
          ? 'fa-solid fa-arrow-down-short-wide'
          : 'fa-solid fa-arrow-up-wide-short';
      }

      // Keep the button's aria-label in sync with the new direction
      sortBtn.setAttribute(
        'aria-label',
        next === 'desc'
          ? 'Sort articles by date, newest first'
          : 'Sort articles by date, oldest first'
      );

      sortSidebarArticles(next);
    });
  }


  // ── LIVE SEARCH INPUT ──────────────────────────────────────────────────────
  // Fires on every keystroke via 'input' event for immediate feedback.
  // 'input' fires on both keyboard entry and cut/paste operations.
  if (searchInput) {
    searchInput.addEventListener('input', () => {
      const query = searchInput.value;
      filterSidebarArticles(query);

      // Show the clear (×) button only when the field has content
      if (clearBtn) {
        clearBtn.classList.toggle('is-hidden', query.length === 0);
      }
    });

    // Keyboard shortcut: Escape clears the field and returns focus
    searchInput.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        searchInput.value = '';
        filterSidebarArticles('');
        if (clearBtn) clearBtn.classList.add('is-hidden');
        // Blur after clearing — user likely wants to navigate away
        searchInput.blur();
      }
    });
  }


  // ── CLEAR BUTTON ──────────────────────────────────────────────────────────
  // Resets the search field, re-shows all items, returns focus to the input
  // so keyboard users can immediately begin typing a new query.
  if (clearBtn) {
    clearBtn.addEventListener('click', () => {
      if (searchInput) {
        searchInput.value = '';
        filterSidebarArticles('');
        searchInput.focus();
      }
      clearBtn.classList.add('is-hidden');
    });
  }


  // ── ARTICLE NAV: EVENT DELEGATION ─────────────────────────────────────────
  // Attaches a single click listener to the <ol> container rather than one
  // per <button>. This handles dynamically added items and is more performant
  // with large article lists.
  if (navList) {
    navList.addEventListener('click', (e) => {
      // Walk the event path upwards to find the .sidebar-nav__btn ancestor.
      // e.target may be the inner .sidebar-nav__title <span> or .sidebar-nav__date.
      const btn = e.target.closest('.sidebar-nav__btn');
      if (!btn) return;

      // Retrieve the snippet file path from the parent <li>'s data-file attribute
      const item     = btn.closest('.sidebar-nav__item');
      const filePath = item?.dataset.file;

      if (!filePath) {
        // Authoring error: data-file attribute is missing on a sidebar item
        console.warn('[ARP] Sidebar item is missing a data-file attribute:', item);
        return;
      }

      // Mark this button as the active selection (visual + a11y state)
      updateActiveNavBtn(btn);

      // Kick off the async article fetch → inject → reveal sequence
      loadArticle(filePath);
    });
  }


  // ── RETRY BUTTON ──────────────────────────────────────────────────────────
  // Shown inside the error state panel. Re-uses _researchState.lastFilePath
  // so no DOM reads are needed here — the failed path is already cached.
  if (retryBtn) {
    retryBtn.addEventListener('click', () => {
      if (_researchState.lastFilePath) {
        loadArticle(_researchState.lastFilePath);
      }
    });
  }

} // end initResearchPage()


/* =============================================================================
   §16 — HOMEPAGE: DYNAMIC RESEARCH ARTICLE PREVIEWS
   ─────────────────────────────────────────────────────────────────────────────
   Target page : index.html
   Guard       : loadHomeResearchPreviews() returns immediately when
                 #research-previews-track is absent, so it is safe to call
                 unconditionally from the DOMContentLoaded entry point.

   Pipeline:
     1. Fetch all article HTML files in parallel (Promise.allSettled)
     2. extractArticleSummary()    — parse HTML → strip LaTeX → first 3 sentences
     3. buildResearchPreviewCard() — construct .feature-card DOM node
     4. applyCardTruncations()     — measure rendered width → binary-search truncation
        └─ truncateToFit()         — off-screen probe element → word-boundary slice
     5. renderResearchPage()       — apply pagination / scroll / mobile visibility
     6. initResearchPreviewPagination() — prev/next handlers + resize observer

   Responsive pagination behaviour:
     Desktop  (≥ 1024px) : 3-column CSS Grid; JS paginates with prev / next buttons
     Tablet   (768–1023px): horizontal overflow-x scroll-snap; 2 cards visible; CSS only
     Mobile   (< 768px)  : single-column stack; JS shows only MOBILE_MAX_CARDS (3);
                            "View All Research" link replaces pagination buttons
   ============================================================================= */


/* -----------------------------------------------------------------------------
   §16-A  REGISTRY & CONSTANTS
   ----------------------------------------------------------------------------- */

/**
 * RESEARCH_ARTICLES
 * Single source of truth for all research articles on the site.
 * Mirrors the <li data-file data-date data-title> sidebar entries in research.html.
 * Maintain newest-first order so mobile's top-3 slice is always the most recent.
 *
 * icon: 'blackhole' | 'wormhole' | 'lensing'  — selects the inline SVG variant
 *       returned by getResearchCardIcon().
 */
const RESEARCH_ARTICLES = [
  {
    id:    'orbiting-hotspots',
    file:  'articles/orbiting-hotspots.html',
    date:  '2025-01-08',
    title: 'Orbiting Hotspots',
    icon:  'blackhole',
  },
  {
    id:    'linear-polarization-dm',
    file:  'articles/linear-polarization-dm.html',
    date:  '2024-09-22',
    title: 'Linear Polarization for Black Holes with a Dark Matter Halo',
    icon:  'lensing',
  },
  {
    id:    'polarized-ring',
    file:  'articles/polarized-ring.html',
    date:  '2024-07-15',
    title: 'Polarized Image of an Equatorial Emitting Ring',
    icon:  'wormhole',
  },
  {
    id:    'black-holes-dark-matter',
    file:  'articles/black-holes-dark-matter.html',
    date:  '2024-03-10',
    title: 'Black Holes Surrounded by a Dark Matter Halo',
    icon:  'blackhole',
  },
];

/** Max rendered height (px) of the .feature-card__desc element.
 *  Must match --feature-card-desc-max-height in style.css. */
const FEATURE_CARD_DESC_MAX_HEIGHT = 108;   // ≈ 6 × 18 px line-height

/** Cards shown per page on desktop (≥ 1024 px). */
const CARDS_PER_PAGE_DESKTOP = 3;

/** Maximum cards rendered in the mobile single-column stack. */
const MOBILE_MAX_CARDS = 3;

/**
 * researchPreviewState
 * Module-scoped pagination state — avoids polluting the global scope.
 */
const researchPreviewState = {
  currentPage : 0,
  totalPages  : 1,
  allCards    : [],   // populated by loadHomeResearchPreviews after fetch
};


/* -----------------------------------------------------------------------------
   §16-B  ICON FACTORY
   ----------------------------------------------------------------------------- */

/**
 * getResearchCardIcon(iconKey)
 * Returns an SVG markup string for the given research domain icon.
 * The three variants reuse the same inline SVGs as the original static cards
 * so visual style is identical.
 *
 * @param  {'blackhole'|'wormhole'|'lensing'} iconKey
 * @returns {string} Raw SVG markup (safe to set via innerHTML on a known container)
 */
const getResearchCardIcon = (iconKey) => {
  const icons = {

    blackhole: `<svg class="feature-card__icon" viewBox="0 0 44 44"
        xmlns="http://www.w3.org/2000/svg" aria-hidden="true" focusable="false">
      <circle cx="22" cy="22" r="8"  fill="currentColor" opacity="0.15"/>
      <circle cx="22" cy="22" r="5"  fill="currentColor"/>
      <ellipse cx="22" cy="22" rx="19" ry="6"
               fill="none" stroke="currentColor" stroke-width="1.5" opacity="0.5"/>
      <ellipse cx="22" cy="22" rx="14" ry="4"
               fill="none" stroke="currentColor" stroke-width="1.2" opacity="0.7"/>
    </svg>`,

    wormhole: `<svg class="feature-card__icon" viewBox="0 0 44 44"
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
    </svg>`,

    lensing: `<svg class="feature-card__icon" viewBox="0 0 44 44"
        xmlns="http://www.w3.org/2000/svg" aria-hidden="true" focusable="false">
      <circle cx="22" cy="22" r="4" fill="currentColor"/>
      <path d="M4 8 Q 22 4 40 22 Q 22 40 4 36"
            fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>
      <path d="M4 8 L8 8 M4 8 L4 12"
            stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
      <path d="M4 36 L8 36 M4 36 L4 32"
            stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
    </svg>`,
  };

  // Fall back to blackhole if an unknown key is passed
  return icons[iconKey] ?? icons.blackhole;
};


/* -----------------------------------------------------------------------------
   §16-C  TEXT EXTRACTION UTILITY
   ----------------------------------------------------------------------------- */

/**
 * extractArticleSummary(htmlString)
 * Parses a fetched article HTML snippet and extracts the first 3 prose sentences
 * as clean, LaTeX-free plain text.
 *
 * Processing pipeline:
 *   1. DOMParser — sandboxed parse, no scripts executed
 *   2. querySelector('.art-body p, .art-section p') — only prose paragraphs
 *   3. Strip \cite{…}, $$…$$, $…$, and remaining \command{…} LaTeX constructs
 *   4. Collapse whitespace → split on [.!?] + space + uppercase → first 3 items
 *
 * Sentence-boundary heuristic: only splits on [.!?] immediately followed by
 * whitespace then an uppercase letter. This intentionally avoids breaking on
 * "Eq. (3)", "Fig. 2", "e.g.", decimal numbers, and unit strings like "6M".
 *
 * @param  {string} htmlString  Raw HTML text returned by fetch()
 * @returns {string}            Plain-text summary of ≤ 3 sentences
 */
const extractArticleSummary = (htmlString) => {
  const parser = new DOMParser();
  const doc    = parser.parseFromString(htmlString, 'text/html');

  // Prefer structured art-body paragraphs; fall back to any <p> in the document
  const candidates = doc.querySelectorAll('.art-body p, .art-section p');
  const paragraphs = candidates.length ? candidates : doc.querySelectorAll('p');

  // Concatenate text from paragraphs long enough to be genuine prose (> 30 chars)
  const rawText = Array.from(paragraphs)
    .map(p => p.textContent.trim())
    .filter(t => t.length > 30)
    .join(' ');

  // ── LaTeX / markup strip pipeline ─────────────────────────────────────────

  // 1. Remove \cite{Narayan:2021, Gelles:2021} — bibliography citations
  let clean = rawText.replace(/\\cite\{[^}]*\}/g, '');

  // 2. Remove display-math blocks: $$ ... $$ (multiline, non-greedy)
  clean = clean.replace(/\$\$[\s\S]*?\$\$/g, '');

  // 3. Remove inline math: $...$ (single-line, non-greedy)
  clean = clean.replace(/\$[^$\n]+?\$/g, '');

  // 4. Remove remaining LaTeX commands: \command or \command{optional arg}
  clean = clean.replace(/\\[a-zA-Z]+(?:\{[^}]*\})?/g, '');

  // 5. Strip any residual bare curly braces left by LaTeX stripping
  clean = clean.replace(/[{}]/g, '');

  // 6. Collapse newlines and multiple spaces into a single space
  clean = clean.replace(/\s+/g, ' ').trim();

  // ── Sentence extraction ────────────────────────────────────────────────────
  // Lookbehind for [.!?]; lookahead for uppercase letter — avoids splitting
  // abbreviations and equations that end with a period.
  const sentences = clean.split(/(?<=[.!?])\s+(?=[A-Z])/);

  return sentences.slice(0, 3).join(' ').trim();
};


/* -----------------------------------------------------------------------------
   §16-D  TRUNCATION ENGINE
   ----------------------------------------------------------------------------- */

/**
 * truncateToFit(text, maxHeight, referenceStyles)
 * Determines whether `text` overflows `maxHeight` when rendered with
 * `referenceStyles`, using a hidden off-screen probe element for measurement.
 * If it overflows, performs a binary search over word count to find the longest
 * word-complete prefix that fits when followed by " [...]".
 *
 * Binary search complexity: O(log n) where n = number of words.
 * The probe element is removed from the DOM immediately after measurement.
 *
 * @param  {string} text
 * @param  {number} maxHeight            - Pixel ceiling for rendered height
 * @param  {{ width: number,
 *            fontFamily: string,
 *            fontSize: string,
 *            lineHeight: string }} referenceStyles
 * @returns {{ body: string, truncated: boolean }}
 *   body      — text content BEFORE the "[...]" marker (or full text if no truncation)
 *   truncated — true if the marker should be appended by the caller
 */
const truncateToFit = (text, maxHeight, referenceStyles) => {

  // Build a visually-hidden probe that perfectly mimics the card description's
  // rendered geometry. position:absolute + visibility:hidden keeps it out of
  // the visual flow while still triggering full layout (scrollHeight is accurate).
  const probe = document.createElement('p');
  probe.setAttribute('aria-hidden', 'true');
  Object.assign(probe.style, {
    position   : 'absolute',
    top        : '-9999px',
    left       : '-9999px',
    visibility : 'hidden',
    pointerEvents: 'none',
    width      : `${referenceStyles.width}px`,
    fontFamily : referenceStyles.fontFamily,
    fontSize   : referenceStyles.fontSize,
    lineHeight : referenceStyles.lineHeight,
    margin     : '0',
    padding    : '0',
    whiteSpace : 'normal',
    wordBreak  : 'break-word',
  });
  document.body.appendChild(probe);

  // Fast-path: full text already fits — skip binary search
  probe.textContent = text;
  if (probe.scrollHeight <= maxHeight) {
    document.body.removeChild(probe);
    return { body: text, truncated: false };
  }

  // Binary search: find the highest word index whose prefix + " [...]" still fits.
  // We include the marker in every measurement so the final visible result
  // never overflows — even accounting for the marker's own width.
  const words = text.split(' ');
  let lo = 0, hi = words.length - 1, best = 0;

  while (lo <= hi) {
    const mid = Math.floor((lo + hi) / 2);
    probe.textContent = words.slice(0, mid + 1).join(' ') + ' [...]';

    if (probe.scrollHeight <= maxHeight) {
      best = mid;     // this prefix fits — try to fit more words
      lo   = mid + 1;
    } else {
      hi = mid - 1;   // too long — try fewer words
    }
  }

  document.body.removeChild(probe);

  // Return body WITHOUT "[...]" so the caller can wrap the marker in a styled <span>
  return {
    body      : words.slice(0, best + 1).join(' '),
    truncated : true,
  };
};


/* -----------------------------------------------------------------------------
   §16-E  CARD BUILDER
   ----------------------------------------------------------------------------- */

/**
 * buildResearchPreviewCard(article, summary)
 * Constructs a single .feature-card <article> element from a registry entry
 * and its extracted summary string. Stores the full summary in data-full-summary
 * so applyCardTruncations() can measure and truncate after layout.
 *
 * @param  {{ id, file, date, title, icon }} article
 * @param  {string} summary  Plain-text summary from extractArticleSummary()
 * @returns {HTMLElement}
 */
const buildResearchPreviewCard = (article, summary) => {
  const card = document.createElement('article');
  card.className = 'feature-card';
  card.setAttribute('role', 'listitem');

  // Store the full summary text; applyCardTruncations() reads this after layout
  card.dataset.fullSummary = summary;

  // Format date as "Jan 2025"
  const dateObj   = new Date(article.date + 'T00:00:00');
  const dateLabel = dateObj.toLocaleDateString('en-GB', { month: 'short', year: 'numeric' });

  card.innerHTML = `
    ${getResearchCardIcon(article.icon)}

    <p class="feature-card__date">${dateLabel}</p>
    <h3 class="feature-card__title">${article.title}</h3>

    <p class="feature-card__desc" data-article-id="${article.id}">
      <!-- Filled by applyCardTruncations() once layout is complete -->
    </p>

    <a href="research.html"
       class="feature-card__link"
       aria-label="Read more about ${article.title} on the Research page">
      Read More
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none"
           stroke="currentColor" stroke-width="2.5" stroke-linecap="round"
           aria-hidden="true" focusable="false">
        <line x1="5" y1="12" x2="19" y2="12"/>
        <polyline points="12 5 19 12 12 19"/>
      </svg>
    </a>
  `;

  return card;
};


/* -----------------------------------------------------------------------------
   §16-F  TRUNCATION APPLICATION
   ----------------------------------------------------------------------------- */

/**
 * applyCardTruncations(track)
 * Iterates every .feature-card__desc inside `track`, reads the card's actual
 * rendered width and computed font properties, then applies truncateToFit().
 *
 * If the summary overflows:
 *   - The body text is inserted as a plain text node
 *   - A <span class="feature-card__truncation-marker">[...]</span> is appended
 *     (styled navy-blue by default; transitions to amber on card hover via CSS)
 *   - The full untruncated text is stored in `title` for screen readers/tooltips
 *
 * If the summary fits:
 *   - textContent is set directly; no marker is added
 *
 * Must be called AFTER the track is in the DOM and has a non-zero clientWidth.
 * Invoked from inside requestAnimationFrame() in loadHomeResearchPreviews().
 *
 * @param {HTMLElement} track - The #research-previews-track container
 */
const applyCardTruncations = (track) => {
  const descEls = track.querySelectorAll('.feature-card__desc');

  descEls.forEach((descEl) => {
    const card     = descEl.closest('.feature-card');
    const fullText = card?.dataset?.fullSummary ?? '';
    if (!fullText) return;

    // Read layout geometry from the live rendered element
    const cs = getComputedStyle(descEl);
    const referenceStyles = {
      width      : descEl.clientWidth,
      fontFamily : cs.fontFamily,
      fontSize   : cs.fontSize,
      lineHeight : cs.lineHeight,
    };

    const { body, truncated } = truncateToFit(
      fullText,
      FEATURE_CARD_DESC_MAX_HEIGHT,
      referenceStyles
    );

    if (truncated) {
      // Clear the placeholder comment, inject text + styled marker
      descEl.textContent = '';
      descEl.appendChild(document.createTextNode(body + '\u00A0')); // non-breaking space before marker

      const marker = document.createElement('span');
      marker.className   = 'feature-card__truncation-marker';
      marker.textContent = '[...]';
      // aria-hidden: the full text is accessible via the title attribute below
      marker.setAttribute('aria-hidden', 'true');
      descEl.appendChild(marker);

      // Expose full text to assistive technologies and browser tooltip
      descEl.setAttribute('title', fullText);
    } else {
      descEl.textContent = body;
    }
  });
};


/* -----------------------------------------------------------------------------
   §16-G  PAGINATION & RESPONSIVE STATE MANAGEMENT
   ----------------------------------------------------------------------------- */

/**
 * isDesktop() — viewport ≥ 1024 px (3-col paginated grid)
 * @returns {boolean}
 */
const isDesktop = () => window.innerWidth >= 1024;

/**
 * isMobile() — viewport < 768 px (single-column stack, max 3 cards)
 * @returns {boolean}
 */
const isMobile = () => window.innerWidth < 768;

/**
 * renderResearchPage(page)
 * Core rendering function for the research preview section. Behaviour differs
 * by viewport mode:
 *
 *   Desktop  : hides all cards not belonging to the requested page via
 *              .is-page-hidden; shows prev/next pagination nav.
 *   Tablet   : clears all .is-page-hidden (CSS handles horizontal scroll);
 *              hides JS pagination nav.
 *   Mobile   : shows only the first MOBILE_MAX_CARDS cards (newest-first
 *              because RESEARCH_ARTICLES is ordered newest-first); shows the
 *              "View All Research" link.
 *
 * @param {number} page - 0-indexed page number to display on desktop
 */
/**
 * renderResearchPage(page)
 * Applies the correct card-visibility and pagination state for the current
 * viewport mode. The "View All Articles" link is permanently visible and
 * requires no JS toggling.
 *
 *   Desktop  (≥1024px): paginate cards in groups of CARDS_PER_PAGE_DESKTOP;
 *                        show the pagination <nav> when totalPages > 1.
 *   Tablet   (768–1023px): reveal all cards (CSS scroll-snap handles layout);
 *                           pagination <nav> stays hidden (CSS also enforces this).
 *   Mobile   (<768px):  show only the first MOBILE_MAX_CARDS cards;
 *                        pagination <nav> hidden.
 *
 * @param {number} page - 0-indexed page number (desktop only)
 */
const renderResearchPage = (page) => {
  const { allCards } = researchPreviewState;
  const pagination   = document.getElementById('research-previews-pagination');
  const prevBtn      = document.getElementById('btn-rp-prev');
  const nextBtn      = document.getElementById('btn-rp-next');
  const indicator    = document.getElementById('rp-page-indicator');

  // ── Mobile: vertical stack, limit to MOBILE_MAX_CARDS ──────────────────
  if (isMobile()) {
    allCards.forEach((card, i) => {
      card.classList.toggle('is-page-hidden', i >= MOBILE_MAX_CARDS);
    });
    if (pagination) pagination.hidden = true;
    return;
  }

  // ── Tablet: all cards visible, CSS scroll-snap takes over ───────────────
  if (!isDesktop()) {
    allCards.forEach(card => card.classList.remove('is-page-hidden'));
    if (pagination) pagination.hidden = true;
    return;
  }

  // ── Desktop: paginate by CARDS_PER_PAGE_DESKTOP ─────────────────────────
  const totalPages = Math.ceil(allCards.length / CARDS_PER_PAGE_DESKTOP);
  const safePage   = Math.max(0, Math.min(page, totalPages - 1));
  const start      = safePage * CARDS_PER_PAGE_DESKTOP;
  const end        = start + CARDS_PER_PAGE_DESKTOP;

  allCards.forEach((card, i) => {
    card.classList.toggle('is-page-hidden', i < start || i >= end);
  });

  researchPreviewState.currentPage = safePage;
  researchPreviewState.totalPages  = totalPages;

  // Pagination nav: only show when there is actually more than one page
  if (pagination) pagination.hidden = (totalPages <= 1);

  if (prevBtn)   prevBtn.disabled   = (safePage === 0);
  if (nextBtn)   nextBtn.disabled   = (safePage >= totalPages - 1);
  if (indicator) indicator.textContent = `${safePage + 1} / ${totalPages}`;
};

/**
 * initResearchPreviewPagination(track)
 * Attaches click handlers to the prev/next buttons and registers a debounced
 * resize listener that re-evaluates the layout mode and re-applies truncations
 * whenever the viewport changes (resize, orientation change).
 *
 * @param {HTMLElement} track - The #research-previews-track container
 */
const initResearchPreviewPagination = (track) => {
  const prevBtn = document.getElementById('btn-rp-prev');
  const nextBtn = document.getElementById('btn-rp-next');

  if (prevBtn) {
    prevBtn.addEventListener('click', () => {
      if (researchPreviewState.currentPage > 0) {
        renderResearchPage(researchPreviewState.currentPage - 1);
      }
    });
  }

  if (nextBtn) {
    nextBtn.addEventListener('click', () => {
      const { currentPage, totalPages } = researchPreviewState;
      if (currentPage < totalPages - 1) {
        renderResearchPage(currentPage + 1);
      }
    });
  }

  // Debounced resize handler: re-render layout mode and re-measure truncations
  // after any viewport change (200 ms debounce avoids thrashing during drag-resize)
  let resizeDebounce = null;
  window.addEventListener('resize', () => {
    clearTimeout(resizeDebounce);
    resizeDebounce = setTimeout(() => {
      // Re-apply truncations because card clientWidth changes with viewport
      applyCardTruncations(track);
      // Re-render pagination for the potentially new layout mode
      renderResearchPage(researchPreviewState.currentPage);
    }, 200);
  });
};


/* -----------------------------------------------------------------------------
   §16-H  MAIN ENTRY POINT
   ----------------------------------------------------------------------------- */

/**
 * loadHomeResearchPreviews()
 * Async entry point for the home page research preview section.
 * Returns immediately (no-op) when #research-previews-track is absent.
 *
 * Full pipeline:
 *   1. Fetch all RESEARCH_ARTICLES HTML files in parallel (Promise.allSettled)
 *      — allSettled ensures partial failure never blocks the whole section
 *   2. For each fulfilled result: extractArticleSummary() → buildResearchPreviewCard()
 *   3. Append all cards to the DOM via a DocumentFragment (single reflow)
 *   4. requestAnimationFrame → applyCardTruncations() (post-layout measurement)
 *   5. initResearchPreviewPagination() → attach event listeners
 *   6. renderResearchPage(0) → apply initial viewport-appropriate state
 */
const loadHomeResearchPreviews = async () => {
  const track = document.getElementById('research-previews-track');
  if (!track) return;   // guard: not on the home page

  // ── 1. Parallel fetch ──────────────────────────────────────────────────────
  const fetchResults = await Promise.allSettled(
    RESEARCH_ARTICLES.map(async (article) => {
      const res = await fetch(article.file);
      if (!res.ok) throw new Error(`HTTP ${res.status} — ${article.file}`);
      const html = await res.text();
      return { article, html };
    })
  );

  // ── 2. Extract summaries + build cards ────────────────────────────────────
  const fragment   = document.createDocumentFragment();
  const builtCards = [];

  fetchResults.forEach((result) => {
    if (result.status === 'rejected') {
      // Log the failure but continue rendering all successfully fetched cards
      console.warn('[ARP] loadHomeResearchPreviews: fetch failed —', result.reason);
      return;
    }

    const { article, html } = result.value;
    const summary = extractArticleSummary(html);
    const card    = buildResearchPreviewCard(article, summary);

    builtCards.push(card);
    fragment.appendChild(card);
  });

  // ── 3. Single-reflow DOM insertion ────────────────────────────────────────
  track.appendChild(fragment);
  researchPreviewState.allCards = builtCards;

  // ── 4–6. Post-layout: truncate → paginate → render ────────────────────────
  // requestAnimationFrame guarantees the browser has completed a layout pass
  // so clientWidth and getComputedStyle() return accurate rendered values.
  requestAnimationFrame(() => {
    applyCardTruncations(track);
    initResearchPreviewPagination(track);
    renderResearchPage(0);
  });
};

