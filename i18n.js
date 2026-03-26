// Shared i18n helper — loaded before page-specific JS in popup.html and report.html
function applyI18n() {
  document.querySelectorAll("[data-i18n]").forEach((el) => {
    const msg = chrome.i18n.getMessage(el.getAttribute("data-i18n"));
    if (msg) el.textContent = msg;
  });
  document.querySelectorAll("[data-i18n-placeholder]").forEach((el) => {
    const msg = chrome.i18n.getMessage(el.getAttribute("data-i18n-placeholder"));
    if (msg) el.placeholder = msg;
  });
  const titleKey = document.documentElement.getAttribute("data-i18n-title");
  if (titleKey) {
    const msg = chrome.i18n.getMessage(titleKey);
    if (msg) document.title = msg;
  }
  // Set promo link href from i18n
  const promoLink = document.getElementById("promo-link");
  if (promoLink) {
    const url = chrome.i18n.getMessage("promoUrl");
    if (url) promoLink.href = url;
  }
}

// Shorthand
function msg(key, substitutions) {
  return chrome.i18n.getMessage(key, substitutions) || key;
}

document.addEventListener("DOMContentLoaded", applyI18n);
