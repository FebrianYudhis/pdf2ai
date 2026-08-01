const baseUrl = window.location.origin;

for (const element of document.querySelectorAll("[data-api-base]")) {
  element.textContent = baseUrl;
}

for (const element of document.querySelectorAll("[data-code]")) {
  element.textContent = element.textContent.replaceAll("{{BASE_URL}}", baseUrl);
}

function showToast(message) {
  const region = document.querySelector("#toast-region");
  const toast = document.createElement("div");
  toast.className = "toast";
  toast.textContent = message;
  region.append(toast);
  window.setTimeout(() => toast.remove(), 2200);
}

async function copyText(button, text) {
  const originalLabel = button.textContent;
  try {
    await navigator.clipboard.writeText(text);
    button.textContent = "Tersalin";
    showToast("Disalin ke clipboard.");
  } catch {
    button.textContent = "Gagal";
    showToast("Clipboard tidak tersedia. Salin teks secara manual.");
  }
  window.setTimeout(() => {
    button.textContent = originalLabel;
  }, 1600);
}

for (const button of document.querySelectorAll("[data-copy]")) {
  button.addEventListener("click", () => {
    const target = document.querySelector(button.dataset.copy);
    if (target) {
      copyText(button, target.textContent.trim());
    }
  });
}

const copyBaseButton = document.querySelector("[data-copy-base]");
copyBaseButton?.addEventListener("click", () => {
  copyText(copyBaseButton, baseUrl);
});

const navigationLinks = [...document.querySelectorAll(".docs-sidebar a")];
const linkedSections = navigationLinks
  .map((link) => document.querySelector(link.hash))
  .filter(Boolean);

if ("IntersectionObserver" in window) {
  const observer = new IntersectionObserver(
    (entries) => {
      const visible = entries
        .filter((entry) => entry.isIntersecting)
        .sort((left, right) => right.intersectionRatio - left.intersectionRatio)[0];
      if (!visible) return;

      for (const link of navigationLinks) {
        link.classList.toggle("active", link.hash === `#${visible.target.id}`);
      }
    },
    { rootMargin: "-18% 0px -70%", threshold: [0, 0.2, 0.6] },
  );

  for (const section of linkedSections) {
    observer.observe(section);
  }
}
