// version-badge.js — tiny persistent version label for the browser UI.
(function () {
  'use strict';

  const BADGE_ID = 'baguetteVersionBadge';
  const DEFAULT_TEXT = 'Baguette · CX';

  function mount(text, title) {
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
    badge.textContent = text || DEFAULT_TEXT;
    badge.title = title || badge.textContent;
  }

  async function refresh() {
    mount(DEFAULT_TEXT);
    try {
      const response = await fetch('/review/status.json', { cache: 'no-store' });
      if (!response.ok) return;
      const status = await response.json();
      const base = status.baguette && status.baguette.version;
      const cx = status.cxReview && status.cxReview.version;
      const api = status.cxReview && status.cxReview.reviewApiVersion;
      const payload = status.cxReview && status.cxReview.annotationPayloadVersion;
      const plugin = status.plugin && status.plugin.version;
      const mcp = status.plugin && status.plugin.mcpVersion;
      const template = status.plugin && status.plugin.templateVersion;
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
    }
  }

  function boot() {
    refresh();
    window.setTimeout(refresh, 250);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot, { once: true });
  } else {
    boot();
  }
})();
