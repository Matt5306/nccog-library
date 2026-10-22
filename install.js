(function () {
  'use strict';

  var KEYS = { visits: 'nccog.install.visits', shown: 'nccog.install.bannerShown', dismissed: 'nccog.install.bannerDismissed' };
  var doc = document;
  var bannerEligible = false;

  function get(key) {
    try { return window.localStorage.getItem(key); } catch (e) { return null; }
  }
  function set(key, value) {
    try { window.localStorage.setItem(key, value); return true; } catch (e) { return false; }
  }
  function isStandalone() {
    try {
      return !!((window.matchMedia && window.matchMedia('(display-mode: standalone)').matches) || navigator.standalone === true);
    } catch (e) { return false; }
  }
  function detect() {
    var ua = navigator.userAgent || '';
    var ios = /iPhone|iPad|iPod/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
    return { ios: ios, android: /Android/.test(ua), standalone: isStandalone() };
  }
  function icon(kind, label) {
    var paths = {
      share: '<path d="M12 16V3m0 0-4 4m4-4 4 4M5 11v8h14v-8"/>',
      home: '<rect x="3" y="3" width="18" height="18" rx="3"/><path d="M12 7v10M7 12h10"/>',
      add: '<rect x="2" y="5" width="20" height="14" rx="3"/><path d="M12 8v8M8 12h8"/>',
      menu: '<circle cx="12" cy="5" r="1.3"/><circle cx="12" cy="12" r="1.3"/><circle cx="12" cy="19" r="1.3"/>',
      install: '<path d="M12 3v12m0 0-4-4m4 4 4-4M5 19h14"/><rect x="5" y="3" width="14" height="18" rx="2"/>'
    };
    return '<svg class="install-icon" viewBox="0 0 24 24" role="img" aria-label="' + label + '"><title>' + label + '</title>' + paths[kind] + '</svg>';
  }
  function step(number, iconName, label, html) {
    return '<li class="install-step"><span class="install-number" aria-hidden="true">' + number + '</span>' +
      icon(iconName, label) + '<span class="install-copy">' + html + '</span></li>';
  }
  function helpFor(device) {
    if (device.ios) {
      return {
        intro: 'You are using an iPhone or iPad. In Safari, follow these steps:',
        steps: step(1, 'share', 'Share button', 'Open this library in <b>Safari</b>, then tap <b>Share</b> — the square with an upward arrow. If it is hidden, tap <b>More (…)</b> first.') +
          step(2, 'home', 'Add to Home Screen button', 'Scroll down and tap <b>Add to Home Screen</b>.') +
          step(3, 'add', 'Add confirmation button', 'Leave <b>Open as Web App</b> on if shown, then tap <b>Add</b>. The library will appear on your home screen.')
      };
    }
    if (device.android) {
      return {
        intro: 'You are using an Android phone or tablet. In Chrome, follow these steps:',
        steps: step(1, 'menu', 'Chrome three-dot menu', 'Open this library in <b>Chrome</b>, then tap the <b>three-dot menu</b>.') +
          step(2, 'install', 'Install app menu option', 'Tap <b>Install app</b> or <b>Add to Home screen</b>. If you see <b>Install and create shortcut</b>, open it, then tap <b>Install</b>.') +
          step(3, 'home', 'Home screen confirmation', 'Confirm the choice. The library will appear on your home screen.')
      };
    }
    return {
      intro: 'Use the steps that match your phone:',
      steps: step(1, 'share', 'iPhone Share button', '<b>iPhone or iPad:</b> open the library in Safari, tap <b>Share</b>, then <b>Add to Home Screen</b>.') +
        step(2, 'menu', 'Android Chrome menu', '<b>Android:</b> open the library in Chrome, tap the <b>three-dot menu</b>, then <b>Install app</b> or <b>Add to Home screen</b>.')
    };
  }
  function renderHelp() {
    var steps = doc.getElementById('installSteps');
    var intro = doc.getElementById('installIntro');
    if (!steps || !intro) return;
    var copy = helpFor(detect());
    intro.textContent = copy.intro;
    steps.innerHTML = copy.steps;
  }
  function dismissBanner() {
    var banner = doc.getElementById('installBanner');
    if (banner) banner.classList.add('hidden');
    set(KEYS.dismissed, '1');
  }
  function showSecondVisitBanner() {
    var banner = doc.getElementById('installBanner');
    var copy = doc.getElementById('installBannerCopy');
    var device = detect();
    if (!banner || device.standalone || get(KEYS.dismissed) === '1' || get(KEYS.shown) === '1') return;
    var prior = parseInt(get(KEYS.visits) || '0', 10);
    if (isNaN(prior) || prior < 0) prior = 0;
    if (!set(KEYS.visits, String(prior + 1))) return;
    if (prior + 1 < 2) return;
    bannerEligible = true;
    showAfterEntry();
  }
  function showAfterEntry() {
    var banner = doc.getElementById('installBanner'), tabs = doc.getElementById('tabs');
    if (!bannerEligible || !banner || !tabs || tabs.classList.contains('hidden')) return;
    var copy = doc.getElementById('installBannerCopy'), device = detect();
    if (!set(KEYS.shown, '1')) return;
    if (copy) copy.textContent = device.ios ? 'Add it from Safari and open it like any other app.' : device.android ? 'Install it from Chrome and open it like any other app.' : 'Open Help for steps for your phone.';
    banner.classList.remove('hidden');
    bannerEligible = false;
  }
  function init() {
    renderHelp();
    var dismiss = doc.getElementById('installBannerDismiss');
    if (dismiss) dismiss.addEventListener('click', dismissBanner);
    showSecondVisitBanner();
  }

  window.InstallHelp = { detect: detect, isStandalone: isStandalone, render: renderHelp, dismissBanner: dismissBanner, appEntered: showAfterEntry, keys: KEYS };
  if (doc.readyState === 'loading') doc.addEventListener('DOMContentLoaded', init); else init();
}());
