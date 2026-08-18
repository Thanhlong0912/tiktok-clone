/**
 * Applies the stored theme BEFORE the first paint.
 *
 * This used to be a useEffect, which necessarily runs after hydration -- so
 * every page load and every navigation painted the light palette first and then
 * snapped to dark. A blocking inline script in the document is the only thing
 * that runs early enough to avoid that.
 *
 * It also sets color-scheme, which is what tells the browser to render native
 * scrollbars, form controls and the address bar in the matching theme; without
 * it those stayed light on a dark page.
 *
 * Not a client component: it renders one <script> tag and has no interactivity,
 * so it stays out of the client bundle entirely.
 */

const THEME_SCRIPT = `
(function () {
  try {
    var stored = localStorage.getItem('theme');
    // No stored choice means the visitor has never picked one, so follow the
    // operating system rather than always defaulting to light.
    var isDark = stored === 'dark' ||
      (stored !== 'light' && window.matchMedia('(prefers-color-scheme: dark)').matches);
    var root = document.documentElement;
    root.classList.toggle('dark', isDark);
    root.style.colorScheme = isDark ? 'dark' : 'light';
  } catch (e) {
    // Storage can throw in private mode. Light is the safe fallback.
  }
})();
`

const ThemeInitializer = () => (
  <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
)

export default ThemeInitializer
