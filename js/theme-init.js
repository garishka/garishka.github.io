/**
 * BeyondGR Project — js/theme-init.js
 * ===================================================================
 * Theme bootstrap. Load as a SYNCHRONOUS script in <head> (NO defer,
 * NO async), before the stylesheets, on EVERY page:
 *
 *     <script src="js/theme-init.js"></script>
 */
(function () {
  'use strict';
  var THEME_KEY = 'astro-theme';
  try {
    var t = localStorage.getItem(THEME_KEY);
    if (t !== 'light' && t !== 'dark') {
      t = (window.matchMedia &&
           window.matchMedia('(prefers-color-scheme: dark)').matches)
          ? 'dark' : 'light';
    }
    document.documentElement.setAttribute('data-theme', t);
  } catch (e) {
    // localStorage blocked (private mode / disabled cookies) → safe default
    document.documentElement.setAttribute('data-theme', 'light');
  }
})();
