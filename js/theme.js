/* Light/dark toggle. The inline script in <head> picks the starting theme (a saved
   choice, else the system setting) and sets <html data-theme>, so there's no flash.
   This wires up the button in the top bar. Same file in JoshWein/joshwein.github.io
   and JoshWein/blog; they share one origin, so the choice carries across both. */
(function () {
  var root = document.documentElement;
  var system = window.matchMedia("(prefers-color-scheme: dark)");
  var COLORS = { light: "#eef2f6", dark: "#12171d" }; /* --desk, for the browser chrome */

  function saved() {
    try {
      var t = localStorage.getItem("theme");
      return t === "light" || t === "dark" ? t : null;
    } catch (e) { return null; }
  }

  function apply(theme) {
    root.setAttribute("data-theme", theme);
    var metas = document.querySelectorAll('meta[name="theme-color"]');
    for (var i = 0; i < metas.length; i++) metas[i].setAttribute("content", COLORS[theme]);
    var buttons = document.querySelectorAll(".theme-toggle");
    for (var j = 0; j < buttons.length; j++) {
      buttons[j].setAttribute("aria-pressed", theme === "dark" ? "true" : "false");
      buttons[j].title = theme === "dark" ? "Switch to light mode" : "Switch to dark mode";
    }
  }

  function init() {
    var buttons = document.querySelectorAll(".theme-toggle");
    for (var i = 0; i < buttons.length; i++) {
      buttons[i].addEventListener("click", function () {
        var next = root.getAttribute("data-theme") === "dark" ? "light" : "dark";
        try { localStorage.setItem("theme", next); } catch (e) {}
        apply(next);
      });
    }
    apply(saved() || (system.matches ? "dark" : "light"));
  }

  /* With no saved choice, keep following the system setting as it changes. */
  var follow = function () { if (!saved()) apply(system.matches ? "dark" : "light"); };
  if (system.addEventListener) system.addEventListener("change", follow);
  else if (system.addListener) system.addListener(follow);

  /* Keep other open tabs in step. */
  window.addEventListener("storage", function (e) {
    if (e.key === "theme") apply(saved() || (system.matches ? "dark" : "light"));
  });

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
