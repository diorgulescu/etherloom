// Etherloom pre-paint theme bootstrap (externalized so the CSP can keep `script-src 'self'`).
(function () {
  try {
    var pref = window.localStorage.getItem("etherloom:theme-preference");
    var sysDark =
      !window.matchMedia ||
      window.matchMedia("(prefers-color-scheme: dark)").matches;
    var isDark =
      pref === "light" ? false : pref === "system" ? sysDark : true;
    var root = document.documentElement;
    if (isDark) {
      root.classList.add("dark");
      root.style.backgroundColor = "#0D1321";
      root.style.colorScheme = "dark";
    } else {
      root.classList.remove("dark");
      root.style.backgroundColor = "#F8FAFC";
      root.style.colorScheme = "light";
    }
  } catch (_) {}
})();
