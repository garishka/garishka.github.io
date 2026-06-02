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
 *  §7  Global Chrome Init — initGlobalChrome() (static chrome)
 *  §8  Homepage — Publications Preview Strip
 *  §9  Homepage — Collaboration Form
 *  §10 Contacts  — Map Activation
 *  §11 Publications Page — Full Table + Sort Engine
 *  §13 Contacts Page — Contact Form Validation
 *  §14 Entry Point — DOMContentLoaded
 *
 * Code rules: ES6+, const/let only, classList-based DOM manipulation.
 */

'use strict';


/* =============================================================================
   §1 — CONSTANTS & CONFIGURATION
   ============================================================================= */

/* Navigation markup now lives in partials/header.html (baked into each page at
   build time by generate_pages/bake_partials.py).
   The old NAV_ITEMS registry and the GlobalTemplates string factories that
   built the header/nav/drawer in JS have been removed. */

const THEME_KEY         = 'astro-theme';            // localStorage key
const DARK_THEME        = 'dark';
const LIGHT_THEME       = 'light';
const SCROLL_THRESHOLD  = 50;                        // px before nav shrinks
const PUBLICATIONS_JSON = 'assets/publications.json'; // shared with §11 (publications page)


/* =============================================================================
   §2 — (removed) PATH RESOLUTION
   resolveActivePage() backed the old runtime active-nav marking. Active-nav
   marking (.is-active + aria-current="page") is now applied at build time by
   generate_pages/bake_partials.py, so no runtime page resolution is needed.
   ============================================================================= */


/* =============================================================================
   §3 — THEME UTILITIES
   The initial theme is stamped on <html> BEFORE first paint by the inline <head>
   bootstrap script (js/theme-init.js), so there is zero flash. The toggle button
   is wired via onclick="toggleTheme()" in the baked header (partials/header.html)
   — there is no JS "bind" step. The sun/moon icon swap is pure CSS, driven by the
   [data-theme] attribute (see css/style.css).
   ============================================================================= */

/**
 * toggleTheme()
 * Flips <html data-theme> between light/dark, persists to localStorage, and
 * refreshes the toggle button's aria-label. Called from the header's
 * onclick handler.
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
   The header / nav / mobile-drawer markup is now the static partial
   partials/header.html, baked into each page at build time by
   generate_pages/bake_partials.py. No HTML is built in JavaScript any more.
   ============================================================================= */


/* =============================================================================
   §5 — MOBILE DRAWER
   The drawer is opened/closed through onclick handlers declared in the baked
   header (partials/header.html):
       .btn-hamburger     → toggleDrawer()
       .nav-overlay       → closeDrawer()
       .drawer-close-btn  → closeDrawer()
       .drawer-link       → closeDrawer()   (collapse after a tap)
   These functions are declared at top level (global) so the inline onclick
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

/**
 * toggleResearchSubmenu(toggleBtn)
 * Mobile drawer accordion: expands/collapses the Research sub-menu.
 * Called from the toggle button's onclick in partials/header.html.
 * Flips aria-expanded (CSS rotates the arrow) and toggles the [hidden]
 * attribute on the sub-list referenced by aria-controls.
 * @param {HTMLElement} toggleBtn - the .drawer-submenu-toggle button (passed as `this`)
 */
function toggleResearchSubmenu(toggleBtn) {
  if (!toggleBtn) return;
  const isExpanded = toggleBtn.getAttribute('aria-expanded') === 'true';
  toggleBtn.setAttribute('aria-expanded', String(!isExpanded));

  const submenu = document.getElementById(toggleBtn.getAttribute('aria-controls'));
  if (submenu) submenu.hidden = isExpanded;   // was expanded → now hide, and vice-versa
}


/* =============================================================================
   §6 — EVENT BINDING (document-level + page init)
   Header click handlers are inline onclick attributes in the baked header
   (partials/header.html). What remains here are listeners that are NOT tied to
   a single header node: a global ESC key handler and the sticky-nav scroll
   behaviour.
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
 * The header is baked into the page, so .site-nav exists at DOMContentLoaded.
 * Guards against a missing nav and against re-querying on every scroll.
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
   §7 — GLOBAL CHROME INIT (static chrome)
   The header/nav/drawer are baked into every page at build time by
   generate_pages/bake_partials.py — there is no runtime injection and no
   htmx:afterSwap event. Active-nav marking (.is-active + aria-current="page")
   is also applied at build time, so it is no longer done here. What remains is
   wiring the behaviour that depends on those (now statically present) nodes.
   ============================================================================= */

/**
 * initGlobalChrome()
 * Wires the baked-in chrome on DOMContentLoaded:
 *   1. bindEscapeKey()      — ESC closes the mobile drawer (document-level)
 *   2. syncThemeButton()    — theme toggle aria-label matches the current theme
 *   3. initScrollBehavior() — sticky-nav .is-scrolled watcher
 * Every target node is already in the DOM (baked in), so all three run safely
 * and immediately — no swap event to wait for.
 */
function initGlobalChrome() {
  bindEscapeKey();
  syncThemeButton();
  initScrollBehavior();
}

/* =============================================================================
   §8 — (removed) HOMEPAGE: PUBLICATIONS PREVIEW STRIP
   The homepage "Recent Publications" strip is now generated as static HTML at
   build time by generate_publications_preview.py and baked directly into
   #publications-preview in index.html — so it renders with JS disabled,
   blocked, or broken (the same approach used for the members roster and the
   research previews).

   Removed from this file:
     buildPubItem()              → ported to build_pub_item()
     loadPublicationsPreview()   (entry point; its §14 call is gone too)
     PUB_PREVIEW_COUNT constant  → ported to PUB_PREVIEW_COUNT in the script

   NOTE: the interactive, sortable full table on publications.html is still
   rendered at runtime by initPublicationsPage() (§11) — its sorting is the
   point, so it stays in JS (cf. the interactive research page §15).
   ============================================================================= */


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
    console.error('[BeyondGR] initPublicationsPage fetch failed:', err);
    showState('error');
    if (countEl) countEl.textContent = '—';
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

  // Wire the baked-in chrome: ESC-to-close, theme-button aria-label sync, and
  // the sticky-nav scroll watcher. The header is static (baked at build time by
  // generate_pages/bake_partials.py), so all of its nodes already exist here.
  initGlobalChrome();

  // Page-specific initializers — each self-selects via its own guard
  initCollabForm();          // index.html       → #collab-form
  // Homepage research previews + publications strip are now static HTML,
  // baked in by generate_research_previews.py / generate_publications_preview.py
  initContactMap();          // contacts.html    → .map-wrapper
  initPublicationsPage();    // publications.html → #pub-list-body
  bindContactForm();         // contacts.html    → #contact-form

});

/* =============================================================================
   §15 — (removed) RESEARCH PAGE: DYNAMIC ARTICLE LOADER
   research.html no longer fetches/sorts/filters article snippets at runtime.
   It now shows a static grid of .feature-card previews (baked in by
   generate_research_previews.py into #research-grid), each linking to a
   per-article page at research/<id>.html.

   Removed from this file (all were self-contained to this section):
     §15.1 _researchState module state
     §15.2 showArticleState()       §15.2b renderArticleMath()  (KaTeX typeset)
     §15.3 loadArticle()            §15.4  sortSidebarArticles()
     §15.5 filterSidebarArticles()  §15.6  updateActiveNavBtn()
     §15.7 updateArticleCount()     §15.8  initResearchPage()  (+ its §14 call)
   ============================================================================= */


/* =============================================================================
   §16 — (removed) HOMEPAGE: RESEARCH ARTICLE PREVIEWS
   The "Core Research Areas" preview cards are now generated as static HTML at
   build time by generate_research_previews.py and baked directly into
   #research-previews-track in index.html — so they render with JS disabled,
   blocked, or broken (the same approach used for the members roster).

   Removed from this file:
     §16-A RESEARCH_ARTICLES registry + FEATURE_CARD_DESC_MAX_HEIGHT
     §16-B getResearchCardIcon()
     §16-C extractArticleSummary()      → ported to extract_article_summary()
     §16-D truncateToFit()              ┐ runtime pixel-measurement truncation;
     §16-F applyCardTruncations()       │ no static equivalent — CSS now clamps
     §16-G initResearchPreviewResize()  ┘ via --feature-card-desc-max-height
     §16-E buildResearchPreviewCard()   → ported to build_research_preview_card()
     §16-H loadHomeResearchPreviews()   (entry point; its §14 call is gone too)
   ============================================================================= */
