(() => {
  const themes = new Set(["sunset", "ember", "forest", "sakura", "ocean", "paper"]);
  let saved = "";
  try {
    saved = localStorage.getItem("cs-theme") || "";
  } catch {}
  const theme = themes.has(saved) ? saved : "sunset";
  document.documentElement.dataset.theme = theme;
  const scheme = document.querySelector('meta[name="color-scheme"]');
  if (scheme) scheme.content = theme === "paper" ? "light" : "dark";
})();
