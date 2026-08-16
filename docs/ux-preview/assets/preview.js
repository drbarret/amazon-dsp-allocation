// JS mínimo do protótipo: gaveta mobile, menu de usuário e seletor de marca.
(function () {
  // Gaveta mobile
  var burger = document.querySelector("[data-hamburger]");
  var drawer = document.querySelector("[data-drawer]");
  var overlay = document.querySelector("[data-drawer-overlay]");
  var closeBtn = document.querySelector("[data-drawer-close]");

  function setDrawer(open) {
    if (!drawer || !overlay || !burger) return;
    drawer.classList.toggle("open", open);
    overlay.classList.toggle("open", open);
    burger.setAttribute("aria-expanded", open ? "true" : "false");
    drawer.setAttribute("aria-hidden", open ? "false" : "true");
  }
  if (burger) burger.addEventListener("click", function () { setDrawer(true); });
  if (closeBtn) closeBtn.addEventListener("click", function () { setDrawer(false); });
  if (overlay) overlay.addEventListener("click", function () { setDrawer(false); });
  if (drawer) {
    drawer.querySelectorAll("a").forEach(function (a) {
      a.addEventListener("click", function () { setDrawer(false); });
    });
  }
  document.addEventListener("keydown", function (e) {
    if (e.key === "Escape") setDrawer(false);
  });

  // Menu de usuário
  var userBtn = document.querySelector("[data-user-btn]");
  var userDrop = document.querySelector("[data-user-dropdown]");
  if (userBtn && userDrop) {
    userBtn.addEventListener("click", function (e) {
      e.stopPropagation();
      var open = userDrop.classList.toggle("open");
      userBtn.setAttribute("aria-expanded", open ? "true" : "false");
    });
    document.addEventListener("click", function (e) {
      if (!userDrop.contains(e.target) && e.target !== userBtn) {
        userDrop.classList.remove("open");
        userBtn.setAttribute("aria-expanded", "false");
      }
    });
  }

  // Seletor de marca (colapsável) — troca UMA variável CSS.
  var switcher = document.querySelector("[data-brand-switcher]");
  if (switcher) {
    var toggle = switcher.querySelector(".bs-toggle");
    if (toggle) {
      toggle.addEventListener("click", function () {
        switcher.classList.toggle("open");
      });
    }
    switcher.querySelectorAll("button[data-brand]").forEach(function (btn) {
      btn.addEventListener("click", function () {
        var value = btn.getAttribute("data-brand");
        if (value === "amber") {
          document.documentElement.removeAttribute("data-brand");
        } else {
          document.documentElement.setAttribute("data-brand", value);
        }
        switcher.querySelectorAll("button[data-brand]").forEach(function (b) {
          b.classList.toggle("active", b === btn);
        });
      });
    });
  }
})();
