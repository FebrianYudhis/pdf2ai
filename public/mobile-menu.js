export function initializeMobileMenu(elements) {
  function setOpen(open) {
    elements.topbarActions?.classList.toggle("is-open", open);
    elements.mobileMenuButton?.classList.toggle("is-open", open);
    elements.mobileMenuButton?.setAttribute("aria-expanded", String(open));
    elements.mobileMenuButton?.setAttribute(
      "aria-label",
      open ? "Tutup menu navigasi" : "Buka menu navigasi",
    );
  }

  elements.mobileMenuButton?.addEventListener("click", () => {
    const isOpen =
      elements.mobileMenuButton.getAttribute("aria-expanded") === "true";
    setOpen(!isOpen);
  });

  elements.topbarActions?.addEventListener("click", (event) => {
    if (event.target.closest("a, button")) {
      setOpen(false);
    }
  });

  document.addEventListener("click", (event) => {
    if (
      elements.mobileMenuButton?.getAttribute("aria-expanded") === "true" &&
      !event.target.closest(".topbar-inner")
    ) {
      setOpen(false);
    }
  });

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      setOpen(false);
    }
  });

  window.addEventListener("resize", () => {
    if (window.innerWidth > 600) {
      setOpen(false);
    }
  });
}
