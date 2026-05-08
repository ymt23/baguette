// codex-review-mode.js — fixed snapshot + synthetic DOM overlay for
// Codex-oriented UI/UX review. This is intentionally separate from
// sim-ax-inspector.js: the inspector is a live-stream canvas overlay,
// while Review Mode creates real DOM targets with data-* metadata.
(function () {
  'use strict';

  const TOOL_NAME = 'baguette-codex-review-mode';
  const TOOL_VERSION = '1';
  const COMMENT_TYPE = 'design-comment';
  const SNAPSHOT_TIMEOUT_MS = 10000;

  function CodexReviewMode(opts) {
    this.udid = opts.udid;
    this.screenArea = opts.screenArea;
    this.getDeviceSize = opts.getDeviceSize || (() => ({ w: 0, h: 0 }));
    this.panel = opts.panel || null;
    this.onStatus = opts.onStatus || (() => {});
    this.onSelect = opts.onSelect || (() => {});
    this.snapshot = null;
    this.nodes = [];
    this.selected = null;
    this.enabled = false;
    this.root = null;
    this.image = null;
    this.overlay = null;
    this.comments = [];
    this.editingCommentId = null;
  }

  CodexReviewMode.prototype.enable = async function () {
    if (this.enabled) return true;
    this.enabled = true;
    this.onStatus('Review snapshot...');
    this._buildRoot();
    this._renderPanel();
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), SNAPSHOT_TIMEOUT_MS);
    try {
      const r = await fetch(
        `/simulators/${encodeURIComponent(this.udid)}/review-snapshot.json?t=${Date.now()}`,
        { cache: 'no-store', signal: controller.signal }
      );
      if (!r.ok) {
        const text = await r.text().catch(() => '');
        throw new Error(text || `snapshot failed (${r.status})`);
      }
      this.snapshot = await r.json();
      this._renderSnapshot();
      this._renderOverlay();
      this._renderPanel();
      this.onStatus('Review Mode');
      return true;
    } catch (err) {
      if (err && err.name === 'AbortError') {
        err = new Error('Review snapshot timed out');
      }
      this._renderError(err);
      this.onStatus('Review failed');
      return false;
    } finally {
      window.clearTimeout(timeout);
    }
  };

  CodexReviewMode.prototype.disable = function () {
    this.enabled = false;
    this.snapshot = null;
    this.nodes = [];
    this.selected = null;
    this.comments = [];
    this.editingCommentId = null;
    if (this.root && this.root.parentNode) this.root.parentNode.removeChild(this.root);
    this.root = null;
    this.image = null;
    this.overlay = null;
    this._clearPanel();
    this.onSelect(null);
    this.onStatus('');
  };

  CodexReviewMode.prototype.isEnabled = function () {
    return this.enabled;
  };

  CodexReviewMode.prototype.hasComments = function () {
    return this.comments.length > 0;
  };

  CodexReviewMode.prototype.commentCount = function () {
    return this.comments.length;
  };

  CodexReviewMode.prototype._buildRoot = function () {
    if (this.root) this.root.remove();
    const root = document.createElement('div');
    root.className = 'codex-review-root';
    root.style.cssText =
      'position:absolute;inset:0;z-index:8;overflow:hidden;background:transparent;';

    const img = document.createElement('img');
    img.className = 'codex-review-screenshot';
    img.alt = 'Review snapshot';
    img.draggable = false;
    img.style.cssText =
      'position:absolute;inset:0;width:100%;height:100%;object-fit:fill;z-index:1;display:none;';

    const overlay = document.createElement('div');
    overlay.className = 'codex-review-overlay';
    overlay.style.cssText =
      'position:absolute;inset:0;z-index:2;pointer-events:auto;';

    root.appendChild(img);
    root.appendChild(overlay);
    this.screenArea.appendChild(root);
    this.root = root;
    this.image = img;
    this.overlay = overlay;
  };

  CodexReviewMode.prototype._renderSnapshot = function () {
    const dataUrl = this.snapshot &&
      this.snapshot.screenshot &&
      this.snapshot.screenshot.dataUrl;
    if (!this.image) return;
    this.image.src = dataUrl || '';
    this.image.style.display = dataUrl ? 'block' : 'none';
  };

  CodexReviewMode.prototype._renderOverlay = function () {
    if (!this.overlay || !this.snapshot || !this.snapshot.axTree) return;
    this.overlay.innerHTML = '';
    this.nodes = flattenAXTree(this.snapshot.axTree);
    const screen = this._screenSize();
    const visible = this.nodes.filter((entry) => isRenderable(entry.node, screen));
    for (const entry of visible) {
      const el = document.createElement('div');
      const n = entry.node;
      const f = n.frame;
      const axId = axIdFor(entry);
      el.className = 'codex-review-node';
      el.dataset.axId = axId;
      el.dataset.role = n.role || '';
      el.dataset.label = n.label || n.title || '';
      el.dataset.frame = frameString(f);
      el.dataset.treePath = treePathString(entry.path);
      el.title = tooltipFor(n);
      el.style.cssText =
        'position:absolute;box-sizing:border-box;border:1px solid rgba(37,99,235,0.62);' +
        'background:rgba(37,99,235,0.045);cursor:crosshair;pointer-events:auto;' +
        `left:${(f.x / screen.w) * 100}%;top:${(f.y / screen.h) * 100}%;` +
        `width:${(f.width / screen.w) * 100}%;height:${(f.height / screen.h) * 100}%;` +
        `z-index:${10 + entry.path.length};`;
      el.addEventListener('mouseenter', () => el.classList.add('hover'));
      el.addEventListener('mouseleave', () => el.classList.remove('hover'));
      el.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        this._select(entry, el);
      });
      this.overlay.appendChild(el);
    }
    this._refreshOverlayCommentState();
  };

  CodexReviewMode.prototype._select = function (entry, el) {
    if (this.overlay) {
      this.overlay.querySelectorAll('.codex-review-node.selected')
        .forEach((node) => node.classList.remove('selected'));
    }
    el.classList.add('selected');
    this.selected = {
      entry,
      axId: axIdFor(entry),
    };
    this._renderPanel();
    this.onSelect(entry.node);
  };

  CodexReviewMode.prototype._selectByTarget = function (target) {
    if (!target || !this.overlay) return;
    const match = this.nodes.find((entry) => {
      const axId = axIdFor(entry);
      return axId === target.axId && treePathString(entry.path) === target.treePath;
    });
    if (!match) return;
    const el = Array.from(this.overlay.querySelectorAll('.codex-review-node')).find((node) => {
      return node.dataset.axId === target.axId && node.dataset.treePath === target.treePath;
    });
    if (!el) return;
    this._select(match, el);
  };

  CodexReviewMode.prototype._renderPanel = function () {
    if (!this.panel) return;
    const selected = this.selected;
    const node = selected && selected.entry && selected.entry.node;
    const frame = node && node.frame || {};
    const editing = this._editingComment();
    const draft = editing ? editing.note : '';
    const selectedCount = selected ? this._commentsForTarget(selectedTargetKey(selected)).length : 0;
    const canCopySelected = selected && selectedCount > 0;

    this.panel.setAttribute('data-open', 'true');
    this.panel.classList.add('review-drawer');
    this.panel.innerHTML =
      '<div class="ax-host-head">' +
        '<span>Review comments</span>' +
        '<button class="ax-host-close" data-role="close" aria-label="Dismiss">×</button>' +
      '</div>' +
      '<div class="codex-review-drawer-body">' +
        '<section class="codex-review-section">' +
          '<div class="codex-review-section-title">Target</div>' +
          (node
            ? '<div class="codex-review-details">' +
                row('role', node.role) +
                row('label', node.label || node.title) +
                row('id', selected.axId) +
                row('frame', frameString(frame)) +
              '</div>'
            : '<div class="codex-review-empty">Select an overlay target to add comments.</div>') +
        '</section>' +
        '<section class="codex-review-section">' +
          '<div class="codex-review-section-title">' + (editing ? 'Edit comment' : 'Add comment') + '</div>' +
          '<textarea class="codex-review-note" data-role="note" rows="4" ' +
            'placeholder="Write a review comment for the selected part."' +
            (node ? '' : ' disabled') + '>' + escapeHTML(draft) + '</textarea>' +
          '<div class="codex-review-edit-actions">' +
            '<button class="btn btn-primary" data-act="save-comment" ' + (node ? '' : 'disabled') + '>' +
              (editing ? 'Save comment' : 'Add comment') +
            '</button>' +
            (editing ? '<button class="btn" data-act="cancel-edit">Cancel</button>' : '') +
          '</div>' +
        '</section>' +
        '<section class="codex-review-section">' +
          '<div class="codex-review-section-title">Comments (' + this.comments.length + ')</div>' +
          this._commentsListHTML() +
        '</section>' +
        '<section class="codex-review-section codex-review-actions">' +
          '<button class="btn" data-act="copy-json" ' + (selected ? '' : 'disabled') + '>Copy JSON</button>' +
          '<button class="btn" data-act="copy-selected" ' + (canCopySelected ? '' : 'disabled') + '>Copy selected annotations</button>' +
          '<button class="btn btn-primary" data-act="copy-all" ' + (this.comments.length ? '' : 'disabled') + '>Copy all annotations</button>' +
        '</section>' +
        '<div class="codex-review-status" data-role="status"></div>' +
      '</div>';

    this.panel.querySelector('[data-role="close"]').addEventListener('click', () => {
      this._clearPanel();
    });
    const note = this.panel.querySelector('[data-role="note"]');
    const save = this.panel.querySelector('[data-act="save-comment"]');
    if (save) {
      save.addEventListener('click', () => {
        this._saveComment(note ? note.value : '');
      });
    }
    const cancel = this.panel.querySelector('[data-act="cancel-edit"]');
    if (cancel) {
      cancel.addEventListener('click', () => {
        this.editingCommentId = null;
        this._renderPanel();
      });
    }
    this.panel.querySelectorAll('[data-act="select-comment"]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const comment = this._commentById(btn.dataset.id);
        if (comment) this._selectByTarget(comment.target);
      });
    });
    this.panel.querySelectorAll('[data-act="edit-comment"]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const comment = this._commentById(btn.dataset.id);
        if (!comment) return;
        this.editingCommentId = comment.id;
        this._selectByTarget(comment.target);
        this._renderPanel();
        const textarea = this.panel && this.panel.querySelector('[data-role="note"]');
        if (textarea) textarea.focus();
      });
    });
    this.panel.querySelectorAll('[data-act="delete-comment"]').forEach((btn) => {
      btn.addEventListener('click', () => {
        this._deleteComment(btn.dataset.id);
      });
    });
    this.panel.querySelector('[data-act="copy-json"]').addEventListener('click', () => {
      this._copy(JSON.stringify(this._selectionPayload(), null, 2));
    });
    this.panel.querySelector('[data-act="copy-selected"]').addEventListener('click', () => {
      this._copy(JSON.stringify(this._selectedAnnotationsPayload(), null, 2));
    });
    this.panel.querySelector('[data-act="copy-all"]').addEventListener('click', () => {
      this._copy(JSON.stringify(this._allAnnotationsPayload(), null, 2));
    });
  };

  CodexReviewMode.prototype._saveComment = function (note) {
    if (!this.selected) return;
    const trimmed = String(note || '').trim();
    if (!trimmed) {
      this._setStatus('Comment is empty');
      return;
    }
    const now = new Date().toISOString();
    const editing = this._editingComment();
    if (editing) {
      editing.note = trimmed;
      editing.updatedAt = now;
      this.editingCommentId = null;
    } else {
      this.comments.push({
        id: makeCommentId(),
        target: nodePayload(this.selected.entry.node, this.selected.axId, this.selected.entry.path),
        type: COMMENT_TYPE,
        note: trimmed,
        createdAt: now,
        updatedAt: now,
      });
    }
    this._refreshOverlayCommentState();
    this._renderPanel();
  };

  CodexReviewMode.prototype._deleteComment = function (id) {
    this.comments = this.comments.filter((comment) => comment.id !== id);
    if (this.editingCommentId === id) this.editingCommentId = null;
    this._refreshOverlayCommentState();
    this._renderPanel();
  };

  CodexReviewMode.prototype._commentsListHTML = function () {
    if (!this.comments.length) {
      return '<div class="codex-review-empty">No comments yet.</div>';
    }
    const groups = annotationGroups(this.comments);
    return '<div class="codex-review-comment-list">' + groups.map((group) => {
      const target = group.target;
      return '<article class="codex-review-comment-group">' +
        '<button class="codex-review-target-link" data-act="select-comment" data-id="' +
          escapeHTML(group.comments[0].id) + '">' +
          '<span>' + escapeHTML(target.label || target.role || target.axId || 'Target') + '</span>' +
          '<strong>' + group.comments.length + '</strong>' +
        '</button>' +
        group.comments.map((comment) => (
          '<div class="codex-review-comment" data-comment-id="' + escapeHTML(comment.id) + '">' +
            '<p>' + escapeHTML(comment.note) + '</p>' +
            '<div class="codex-review-comment-actions">' +
              '<button class="btn" data-act="edit-comment" data-id="' + escapeHTML(comment.id) + '">Edit</button>' +
              '<button class="btn" data-act="delete-comment" data-id="' + escapeHTML(comment.id) + '">Delete</button>' +
            '</div>' +
          '</div>'
        )).join('') +
      '</article>';
    }).join('') + '</div>';
  };

  CodexReviewMode.prototype._refreshOverlayCommentState = function () {
    if (!this.overlay) return;
    const counts = new Map();
    for (const comment of this.comments) {
      const key = targetKey(comment.target);
      counts.set(key, (counts.get(key) || 0) + 1);
    }
    this.overlay.querySelectorAll('.codex-review-node').forEach((el) => {
      const key = targetKey({
        axId: el.dataset.axId,
        treePath: el.dataset.treePath,
      });
      const count = counts.get(key) || 0;
      el.classList.toggle('has-comments', count > 0);
      if (count > 0) el.dataset.commentCount = String(count);
      else delete el.dataset.commentCount;
    });
  };

  CodexReviewMode.prototype._selectionPayload = function () {
    if (!this.selected) return null;
    return {
      snapshot: this._snapshotMeta(),
      selectedNode: nodePayload(this.selected.entry.node, this.selected.axId, this.selected.entry.path),
      tool: { name: TOOL_NAME, version: TOOL_VERSION },
    };
  };

  CodexReviewMode.prototype._selectedAnnotationsPayload = function () {
    if (!this.selected) return null;
    const key = selectedTargetKey(this.selected);
    return this._annotationsPayload(this.comments.filter((comment) => targetKey(comment.target) === key));
  };

  CodexReviewMode.prototype._allAnnotationsPayload = function () {
    return this._annotationsPayload(this.comments);
  };

  CodexReviewMode.prototype._annotationsPayload = function (comments) {
    return {
      snapshot: this._snapshotMeta(),
      annotations: annotationGroups(comments),
      source: {
        confidence: 'unmapped',
      },
      tool: { name: TOOL_NAME, version: TOOL_VERSION },
    };
  };

  CodexReviewMode.prototype._snapshotMeta = function () {
    const s = this.snapshot || {};
    return {
      snapshotId: s.snapshotId || null,
      createdAt: s.createdAt || null,
      device: s.device || null,
      screen: s.screen || null,
    };
  };

  CodexReviewMode.prototype._copy = async function (text) {
    try {
      await navigator.clipboard.writeText(text);
      this._setStatus('Copied');
    } catch (err) {
      this._setStatus('Clipboard failed');
    }
  };

  CodexReviewMode.prototype._renderError = function (err) {
    if (!this.root) this._buildRoot();
    if (!this.overlay) return;
    this.overlay.innerHTML =
      '<div class="codex-review-error">' +
        '<strong>Review snapshot failed</strong>' +
        '<span>' + escapeHTML(err && err.message ? err.message : String(err)) + '</span>' +
      '</div>';
  };

  CodexReviewMode.prototype._clearPanel = function () {
    if (!this.panel) return;
    this.panel.removeAttribute('data-open');
    this.panel.classList.remove('review-drawer');
    this.panel.innerHTML = '';
  };

  CodexReviewMode.prototype._screenSize = function () {
    const screen = this.snapshot && this.snapshot.screen;
    if (screen && screen.width && screen.height) {
      return { w: Number(screen.width), h: Number(screen.height) };
    }
    return this.getDeviceSize() || { w: 0, h: 0 };
  };

  CodexReviewMode.prototype._setStatus = function (message) {
    const status = this.panel && this.panel.querySelector('[data-role="status"]');
    if (status) status.textContent = message || '';
  };

  CodexReviewMode.prototype._editingComment = function () {
    if (!this.editingCommentId) return null;
    return this._commentById(this.editingCommentId);
  };

  CodexReviewMode.prototype._commentById = function (id) {
    return this.comments.find((comment) => comment.id === id) || null;
  };

  CodexReviewMode.prototype._commentsForTarget = function (key) {
    return this.comments.filter((comment) => targetKey(comment.target) === key);
  };

  function flattenAXTree(root) {
    const out = [];
    const walk = (node, path) => {
      if (!node) return;
      out.push({ node, path });
      const kids = node.children || [];
      for (let i = 0; i < kids.length; i++) walk(kids[i], path.concat(i));
    };
    walk(root, [0]);
    return out;
  }

  function isRenderable(node, screen) {
    const f = node && node.frame;
    if (!f || node.hidden === true || !screen.w || !screen.h) return false;
    if (f.width <= 0 || f.height <= 0) return false;
    if (f.x + f.width <= 0 || f.y + f.height <= 0) return false;
    if (f.x >= screen.w || f.y >= screen.h) return false;
    return true;
  }

  function nodePayload(node, axId, path) {
    return {
      axId,
      role: node.role || null,
      label: node.label || node.title || null,
      value: node.value || null,
      frame: node.frame || null,
      treePath: treePathString(path),
    };
  }

  function annotationGroups(comments) {
    const map = new Map();
    for (const comment of comments) {
      const key = targetKey(comment.target);
      if (!map.has(key)) {
        map.set(key, {
          target: comment.target,
          comments: [],
        });
      }
      map.get(key).comments.push({
        id: comment.id,
        type: comment.type || COMMENT_TYPE,
        note: comment.note,
        createdAt: comment.createdAt,
        updatedAt: comment.updatedAt,
      });
    }
    return Array.from(map.values());
  }

  function selectedTargetKey(selected) {
    return targetKey({
      axId: selected.axId,
      treePath: treePathString(selected.entry.path),
    });
  }

  function targetKey(target) {
    return `${target.axId || ''}|${target.treePath || ''}`;
  }

  function axIdFor(entry) {
    return entry.node.identifier || `ax-path-${entry.path.join('-')}`;
  }

  function treePathString(path) {
    return Array.isArray(path) ? path.join('.') : String(path || '');
  }

  function makeCommentId() {
    const suffix = Math.random().toString(36).slice(2, 8);
    return `comment-${Date.now().toString(36)}-${suffix}`;
  }

  function frameString(f) {
    if (!f) return '';
    return `${num(f.x)},${num(f.y)} ${num(f.width)}x${num(f.height)}`;
  }

  function num(v) {
    const n = Number(v || 0);
    return Number.isInteger(n) ? String(n) : n.toFixed(2);
  }

  function row(k, v) {
    if (v == null || v === '') return '';
    return '<div><span>' + escapeHTML(k) + '</span>' + escapeHTML(v) + '</div>';
  }

  function tooltipFor(n) {
    return [n.role, n.label || n.title || n.identifier].filter(Boolean).join(' ');
  }

  function escapeHTML(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    })[c]);
  }

  window.CodexReviewMode = CodexReviewMode;
})();
