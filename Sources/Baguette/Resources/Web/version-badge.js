// version-badge.js — tiny persistent version label for the browser UI.
(function () {
  'use strict';

  const BADGE_ID = 'baguetteVersionBadge';
  const DEFAULT_TEXT = 'Baguette · CX';
  let currentText = DEFAULT_TEXT;
  let currentTitle = DEFAULT_TEXT;
  let refreshAttempts = 0;

  function mount(text, title) {
    currentText = text || currentText || DEFAULT_TEXT;
    currentTitle = title || currentTitle || currentText;
    let badge = document.getElementById(BADGE_ID);
    if (!badge) {
      badge = document.createElement('div');
      badge.id = BADGE_ID;
      badge.setAttribute('aria-label', 'Baguette version');
      badge.style.cssText = [
        'position:fixed',
        'top:10px',
        'right:12px',
        'z-index:80',
        'pointer-events:none',
        'padding:3px 7px',
        'border-radius:999px',
        'background:rgba(255,255,255,0.62)',
        'border:1px solid rgba(15,23,42,0.08)',
        'box-shadow:0 4px 16px rgba(15,23,42,0.08)',
        'backdrop-filter:blur(12px) saturate(1.25)',
        '-webkit-backdrop-filter:blur(12px) saturate(1.25)',
        'color:rgba(29,29,31,0.62)',
        'font:600 10.5px/1.2 ui-monospace,SFMono-Regular,Menlo,Consolas,monospace',
        'letter-spacing:0',
        'white-space:nowrap',
        'user-select:none',
      ].join(';');
      document.body.appendChild(badge);
    }
    badge.textContent = currentText;
    badge.title = currentTitle;
    applyTheme();
  }

  function applyTheme() {
    const badge = document.getElementById(BADGE_ID);
    if (!badge) return;
    const theme = currentTheme();
    if (theme === 'dark') {
      badge.style.background = 'rgba(20,20,24,0.68)';
      badge.style.borderColor = 'rgba(255,255,255,0.12)';
      badge.style.boxShadow = '0 4px 16px rgba(0,0,0,0.28)';
      badge.style.color = 'rgba(245,245,247,0.72)';
    } else {
      badge.style.background = 'rgba(255,255,255,0.66)';
      badge.style.borderColor = 'rgba(15,23,42,0.08)';
      badge.style.boxShadow = '0 4px 16px rgba(15,23,42,0.08)';
      badge.style.color = 'rgba(29,29,31,0.62)';
    }
  }

  function currentTheme() {
    const native = document.getElementById('simNativeView');
    const pinned = native && native.getAttribute('data-theme');
    if (pinned === 'light' || pinned === 'dark') return pinned;
    return window.matchMedia && window.matchMedia('(prefers-color-scheme: light)').matches
      ? 'light'
      : 'dark';
  }

  async function refresh() {
    mount(currentText || DEFAULT_TEXT, currentTitle || DEFAULT_TEXT);
    try {
      const response = await fetch(`/review/status.json?t=${Date.now()}`, { cache: 'no-store' });
      if (!response.ok) throw new Error(`status ${response.status}`);
      const status = await response.json();
      const base = status.baguette && status.baguette.version;
      const cx = (status.cxReview && status.cxReview.version) ||
        (status.plugin && status.plugin.version);
      const api = (status.cxReview && status.cxReview.reviewApiVersion) ||
        (status.baguette && status.baguette.reviewApiVersion);
      const payload = (status.cxReview && status.cxReview.annotationPayloadVersion) ||
        (status.baguette && status.baguette.annotationPayloadVersion);
      const plugin = status.plugin && status.plugin.version;
      const mcp = status.plugin && status.plugin.mcpVersion;
      const template = status.plugin && status.plugin.templateVersion;
      if (!base && !cx) throw new Error('missing version fields');
      mount(
        `Baguette ${base || '?'} · CX ${cx || '?'}`,
        [
          `Baguette ${base || '?'}`,
          `CX Review ${cx || '?'}`,
          `Review API ${api || '?'}`,
          `Annotation Payload ${payload || '?'}`,
          `Plugin ${plugin || '?'}`,
          `MCP ${mcp || '?'}`,
          `Template ${template || '?'}`,
        ].join('\n')
      );
    } catch (_) {
      // Keep the fallback badge visible; version lookup is non-critical.
      refreshAttempts += 1;
      if (refreshAttempts <= 6) {
        window.setTimeout(refresh, refreshAttempts * 750);
      }
    }
  }

  function boot() {
    refresh();
    window.setTimeout(refresh, 250);
    window.setTimeout(refresh, 1500);
    installObserver();
    if (window.matchMedia) {
      const media = window.matchMedia('(prefers-color-scheme: light)');
      const listener = () => applyTheme();
      if (media.addEventListener) media.addEventListener('change', listener);
      else if (media.addListener) media.addListener(listener);
    }
  }

  function installObserver() {
    if (!window.MutationObserver) return;
    const observer = new MutationObserver((mutations) => {
      let shouldMount = !document.getElementById(BADGE_ID);
      let shouldTheme = false;
      for (const mutation of mutations) {
        if (mutation.type === 'attributes' && mutation.attributeName === 'data-theme') {
          shouldTheme = true;
        }
      }
      if (shouldMount) mount(currentText, currentTitle);
      if (shouldTheme) applyTheme();
    });
    observer.observe(document.documentElement, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['data-theme'],
    });
  }

  window.BaguetteVersionBadge = {
    refresh,
    refreshTheme: applyTheme,
    mount: () => mount(currentText, currentTitle),
  };

  function exposeLegacyGlobal() {
    window.__baguetteRefreshVersionBadge = window.BaguetteVersionBadge.refresh;
  }

  exposeLegacyGlobal();

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot, { once: true });
  } else {
    boot();
  }
})();
