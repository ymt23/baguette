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
  const IMPORTANT_ROLES = ['AXImage', 'AXCell', 'AXTable', 'AXCollection', 'AXGroup'];

  function CodexReviewMode(opts) {
    this.udid = opts.udid;
    this.screenArea = opts.screenArea;
    this.getDeviceSize = opts.getDeviceSize || (() => ({ w: 0, h: 0 }));
    this.panel = opts.panel || null;
    this.onStatus = opts.onStatus || (() => {});
    this.onSelect = opts.onSelect || (() => {});
    this.snapshot = null;
    this.nodes = [];
    this.coverage = null;
    this.selected = null;
    this.enabled = false;
    this.root = null;
    this.image = null;
    this.overlay = null;
    this.comments = [];
    this.editingCommentId = null;
    this.manualTargets = [];
    this.drawing = false;
    this.drawStart = null;
    this.drawPreview = null;
    this.inlineComposerTargetId = null;
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
    this.coverage = null;
    this.selected = null;
    this.comments = [];
    this.editingCommentId = null;
    this.manualTargets = [];
    this.drawing = false;
    this.drawStart = null;
    this.drawPreview = null;
    this.inlineComposerTargetId = null;
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

  CodexReviewMode.prototype.hasReviewState = function () {
    return this.comments.length > 0 || this.manualTargets.length > 0;
  };

  CodexReviewMode.prototype.commentCount = function () {
    return this.comments.length;
  };

  CodexReviewMode.prototype.manualTargetCount = function () {
    return this.manualTargets.length;
  };

  CodexReviewMode.prototype._buildRoot = function () {
    if (this.root) this.root.remove();
    const root = document.createElement('div');
    root.className = 'codex-review-root';
    root.setAttribute('translate', 'no');
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
    this._wireManualDrawing(overlay);

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
    this.coverage = coverageFor(this.nodes, visible);
    for (const entry of visible) {
      this.overlay.appendChild(this._elementForAXEntry(entry, screen));
    }
    for (const target of this.manualTargets) {
      this.overlay.appendChild(this._elementForManualTarget(target, screen));
    }
    this._refreshOverlayCommentState();
  };

  CodexReviewMode.prototype._elementForAXEntry = function (entry, screen) {
    const el = document.createElement('div');
    const n = entry.node;
    const f = n.frame;
    const target = nodePayload(n, axIdFor(entry), entry.path);
    el.className = 'codex-review-node';
    this._applyTargetMetadata(el, target, tooltipFor(n));
    el.style.cssText =
      baseTargetStyle(f, screen, 10 + entry.path.length) +
      'border:1px solid rgba(37,99,235,0.62);background:rgba(37,99,235,0.045);';
    el.addEventListener('mouseenter', () => el.classList.add('hover'));
    el.addEventListener('mouseleave', () => el.classList.remove('hover'));
    el.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (this.drawing) return;
      this._selectTarget(target, el);
    });
    el.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter' && e.key !== ' ') return;
      e.preventDefault();
      this._selectTarget(target, el);
    });
    return el;
  };

  CodexReviewMode.prototype._elementForManualTarget = function (target, screen) {
    const el = document.createElement('div');
    el.className = 'codex-review-node manual-rect';
    this._applyTargetMetadata(el, target, target.label || 'Manual rectangle');
    el.style.cssText =
      baseTargetStyle(target.frame, screen, 2000) +
      'border:1.5px dashed rgba(234,88,12,0.95);background:rgba(234,88,12,0.10);';
    el.addEventListener('mouseenter', () => el.classList.add('hover'));
    el.addEventListener('mouseleave', () => el.classList.remove('hover'));
    el.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (this.drawing) return;
      this._selectTarget(target, el);
    });
    el.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter' && e.key !== ' ') return;
      e.preventDefault();
      this._selectTarget(target, el);
    });
    return el;
  };

  CodexReviewMode.prototype._applyTargetMetadata = function (el, target, title) {
    el.dataset.targetType = target.type;
    el.dataset.targetId = target.targetId;
    el.dataset.axId = target.axId || '';
    el.dataset.role = target.role || '';
    el.dataset.label = target.label || '';
    el.dataset.frame = frameString(target.frame);
    el.dataset.treePath = target.treePath || '';
    el.title = title || targetLabel(target);
    el.setAttribute('role', 'button');
    el.setAttribute('tabindex', '0');
    el.setAttribute('aria-roledescription', 'Baguette review target');
    el.setAttribute('aria-label', ariaLabelForTarget(target));
  };

  CodexReviewMode.prototype._selectTarget = function (target, el) {
    if (this.overlay) {
      this.overlay.querySelectorAll('.codex-review-node.selected')
        .forEach((node) => node.classList.remove('selected'));
    }
    if (el) el.classList.add('selected');
    this.selected = { target };
    this._renderPanel();
    this._renderInlineControls();
    this.onSelect(target.type === 'ax-node' ? target : null);
  };

  CodexReviewMode.prototype._selectByTarget = function (target) {
    if (!target || !this.overlay) return;
    const el = Array.from(this.overlay.querySelectorAll('.codex-review-node')).find((node) => {
      return node.dataset.targetId === target.targetId;
    });
    if (!el) return;
    this._selectTarget(target, el);
  };

  CodexReviewMode.prototype._renderPanel = function () {
    if (!this.panel) return;
    const selected = this.selected && this.selected.target;
    const editing = this._editingComment();
    const draft = editing ? editing.note : '';
    const selectedComments = selected ? this._commentsForTarget(targetKey(selected)) : [];
    const selectedCount = selectedComments.length;
    const canCopySelected = selected && selectedCount > 0;
    const manualSelected = selected && selected.type === 'manual-rect';

    this.panel.setAttribute('data-open', 'true');
    this.panel.setAttribute('translate', 'no');
    this.panel.classList.add('review-drawer');
    this.panel.innerHTML =
      '<div class="ax-host-head">' +
        '<span>Review comments</span>' +
        '<button class="ax-host-close" data-role="close" aria-label="Dismiss">×</button>' +
      '</div>' +
      '<div class="codex-review-drawer-body">' +
        '<section class="codex-review-section">' +
          '<div class="codex-review-section-title">Selected target</div>' +
          (selected ? this._targetDetailsHTML(selected) :
            '<div class="codex-review-empty">Select an overlay target to add comments.</div>') +
          (manualSelected ? '<button class="btn btn-danger" data-act="delete-target">Delete rectangle</button>' : '') +
        '</section>' +
        '<section class="codex-review-section">' +
          '<div class="codex-review-section-title">' + (editing ? 'Edit comment' : 'Add comment') + '</div>' +
          '<textarea class="codex-review-note" data-role="note" rows="4" ' +
            inputSuppressionAttrs() + ' ' +
            'placeholder="Write a review comment for the selected part."' +
            (selected ? '' : ' disabled') + '>' + escapeHTML(draft) + '</textarea>' +
          '<div class="codex-review-edit-actions">' +
            '<button class="btn btn-primary" data-act="save-comment" ' + (selected ? '' : 'disabled') + '>' +
              (editing ? 'Save comment' : 'Add comment') +
            '</button>' +
            (editing ? '<button class="btn" data-act="cancel-edit">Cancel</button>' : '') +
          '</div>' +
        '</section>' +
        '<section class="codex-review-section">' +
          '<div class="codex-review-section-title">Comments for selected target (' + selectedCount + ')</div>' +
          this._commentsListHTML(selectedComments, 'No comments for this target yet.') +
        '</section>' +
        '<section class="codex-review-section">' +
          '<div class="codex-review-section-title">Draw review area</div>' +
          '<div class="codex-review-actions codex-review-actions-inline">' +
            '<button class="btn" data-act="draw-rect">' + (this.drawing ? 'Cancel drawing' : 'Draw rectangle') + '</button>' +
          '</div>' +
          '<div class="codex-review-empty">' +
            (this.drawing ? 'Drag on the snapshot to create a manual review area.' : 'Use this for images, cells, spacing, and views missing from AX.') +
          '</div>' +
        '</section>' +
        '<section class="codex-review-section">' +
          '<div class="codex-review-section-title">All comments (' + this.comments.length + ')</div>' +
          this._commentsListHTML(this.comments, 'No comments yet.') +
        '</section>' +
        '<section class="codex-review-section codex-review-actions">' +
          '<button class="btn" data-act="copy-json" ' + (selected ? '' : 'disabled') + '>Copy JSON</button>' +
          '<button class="btn" data-act="copy-selected" ' + (canCopySelected ? '' : 'disabled') + '>Copy selected annotations</button>' +
          '<button class="btn btn-primary" data-act="copy-all" ' + (this.comments.length ? '' : 'disabled') + '>Copy all annotations</button>' +
        '</section>' +
        this._coverageHTML() +
        '<div class="codex-review-status" data-role="status"></div>' +
      '</div>';

    this.panel.querySelector('[data-role="close"]').addEventListener('click', () => {
      this._clearPanel();
    });
    this.panel.querySelector('[data-act="draw-rect"]').addEventListener('click', () => {
      this._toggleDrawing();
    });
    const deleteTarget = this.panel.querySelector('[data-act="delete-target"]');
    if (deleteTarget) {
      deleteTarget.addEventListener('click', () => {
        this._deleteSelectedManualTarget();
      });
    }
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

  CodexReviewMode.prototype._coverageHTML = function () {
    if (!this.coverage) return '';
    const rows = IMPORTANT_ROLES.map((role) => {
      const count = this.coverage.roles[role] || 0;
      const missing = count === 0 && role !== 'AXGroup';
      return '<div class="' + (missing ? 'is-missing' : '') + '">' +
        '<span>' + escapeHTML(role) + '</span><strong>' + count + '</strong>' +
      '</div>';
    }).join('');
    return '<details class="codex-review-section codex-review-coverage">' +
      '<summary>' +
        '<span>Diagnostics</span>' +
        '<strong>' + this.coverage.overlay + '/' + this.coverage.total + ' overlay targets</strong>' +
      '</summary>' +
      '<div class="codex-review-coverage-body">' +
        '<div class="codex-review-coverage-summary">' +
          '<div><span>Total</span><strong>' + this.coverage.total + '</strong></div>' +
          '<div><span>Overlay</span><strong>' + this.coverage.overlay + '</strong></div>' +
        '</div>' +
        '<div class="codex-review-coverage-roles">' + rows + '</div>' +
        '<div class="codex-review-empty">Images, cells, or views with count 0 are not exposed by the iOS accessibility tree.</div>' +
      '</div>' +
    '</details>';
  };

  CodexReviewMode.prototype._targetDetailsHTML = function (target) {
    return '<div class="codex-review-details">' +
      row('type', target.type) +
      row('role', target.role) +
      row('label', target.label) +
      row('id', target.axId || target.targetId) +
      row('frame', frameString(target.frame)) +
      (target.treePath ? row('path', target.treePath) : '') +
    '</div>';
  };

  CodexReviewMode.prototype._toggleDrawing = function () {
    this.drawing = !this.drawing;
    this.drawStart = null;
    this.inlineComposerTargetId = null;
    if (this.drawPreview) this.drawPreview.remove();
    this.drawPreview = null;
    this._clearInlineControls();
    if (this.overlay) this.overlay.classList.toggle('is-drawing', this.drawing);
    this._renderPanel();
  };

  CodexReviewMode.prototype._wireManualDrawing = function (overlay) {
    overlay.addEventListener('mousedown', (e) => {
      if (!this.drawing) return;
      e.preventDefault();
      e.stopPropagation();
      this.drawStart = this._eventPoint(e);
      this.drawPreview = document.createElement('div');
      this.drawPreview.className = 'codex-review-draw-preview';
      this.drawPreview.style.cssText = 'position:absolute;box-sizing:border-box;z-index:3000;pointer-events:none;';
      overlay.appendChild(this.drawPreview);
      this._updateDrawPreview(this.drawStart, this.drawStart);
    }, true);
    overlay.addEventListener('mousemove', (e) => {
      if (!this.drawing || !this.drawStart || !this.drawPreview) return;
      e.preventDefault();
      this._updateDrawPreview(this.drawStart, this._eventPoint(e));
    }, true);
    overlay.addEventListener('mouseup', (e) => {
      if (!this.drawing || !this.drawStart) return;
      e.preventDefault();
      e.stopPropagation();
      const frame = normalizeFrame(this.drawStart, this._eventPoint(e));
      if (this.drawPreview) this.drawPreview.remove();
      this.drawPreview = null;
      this.drawStart = null;
      this.drawing = false;
      overlay.classList.remove('is-drawing');
      if (frame.width < 4 || frame.height < 4) {
        this._renderPanel();
        return;
      }
      const target = manualTarget(frame);
      this.manualTargets.push(target);
      const el = this._elementForManualTarget(target, this._screenSize());
      overlay.appendChild(el);
      this._selectTarget(target, el);
    }, true);
  };

  CodexReviewMode.prototype._eventPoint = function (e) {
    const r = this.overlay.getBoundingClientRect();
    const screen = this._screenSize();
    const x = clamp(((e.clientX - r.left) / r.width) * screen.w, 0, screen.w);
    const y = clamp(((e.clientY - r.top) / r.height) * screen.h, 0, screen.h);
    return { x, y };
  };

  CodexReviewMode.prototype._updateDrawPreview = function (a, b) {
    if (!this.drawPreview) return;
    const frame = normalizeFrame(a, b);
    const screen = this._screenSize();
    this.drawPreview.style.left = `${(frame.x / screen.w) * 100}%`;
    this.drawPreview.style.top = `${(frame.y / screen.h) * 100}%`;
    this.drawPreview.style.width = `${(frame.width / screen.w) * 100}%`;
    this.drawPreview.style.height = `${(frame.height / screen.h) * 100}%`;
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
        target: this.selected.target,
        type: COMMENT_TYPE,
        note: trimmed,
        createdAt: now,
        updatedAt: now,
      });
    }
    this.inlineComposerTargetId = null;
    this._refreshOverlayCommentState();
    this._renderPanel();
    this._renderInlineControls();
  };

  CodexReviewMode.prototype._saveInlineComment = function (note) {
    if (!this.selected) return;
    const trimmed = String(note || '').trim();
    if (!trimmed) {
      this._setInlineStatus('Comment is empty');
      return;
    }
    const now = new Date().toISOString();
    this.comments.push({
      id: makeCommentId(),
      target: this.selected.target,
      type: COMMENT_TYPE,
      note: trimmed,
      createdAt: now,
      updatedAt: now,
    });
    this.inlineComposerTargetId = null;
    this._refreshOverlayCommentState();
    this._renderPanel();
    this._renderInlineControls();
  };

  CodexReviewMode.prototype._deleteComment = function (id) {
    this.comments = this.comments.filter((comment) => comment.id !== id);
    if (this.editingCommentId === id) this.editingCommentId = null;
    this._refreshOverlayCommentState();
    this._renderPanel();
    this._renderInlineControls();
  };

  CodexReviewMode.prototype._deleteSelectedManualTarget = function () {
    if (!this.selected || !this.selected.target || this.selected.target.type !== 'manual-rect') return;
    const target = this.selected.target;
    const key = targetKey(target);
    const count = this._commentsForTarget(key).length;
    if (count > 0) {
      const ok = window.confirm(
        `Delete this rectangle and ${count} comment${count === 1 ? '' : 's'}?`
      );
      if (!ok) return;
    }
    this.manualTargets = this.manualTargets.filter((item) => targetKey(item) !== key);
    this.comments = this.comments.filter((comment) => targetKey(comment.target) !== key);
    this.selected = null;
    this.editingCommentId = null;
    this.inlineComposerTargetId = null;
    const el = this.overlay && this.overlay.querySelector('[data-target-id="' + cssEscape(target.targetId) + '"]');
    if (el) el.remove();
    this._clearInlineControls();
    this._refreshOverlayCommentState();
    this._renderPanel();
    this.onSelect(null);
  };

  CodexReviewMode.prototype._renderInlineControls = function () {
    this._clearInlineControls();
    if (!this.overlay || !this.selected || this.drawing) return;
    const target = this.selected.target;
    const frame = target && target.frame;
    const screen = this._screenSize();
    if (!frame || !screen.w || !screen.h) return;
    const placement = inlinePlacement(frame, screen);

    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'codex-review-inline-add';
    button.setAttribute('aria-label', 'Add comment to selected target');
    button.title = 'Add comment';
    button.innerHTML =
      '<svg viewBox="0 0 24 24" aria-hidden="true">' +
        '<path d="M5 5.5h14a2 2 0 0 1 2 2v7.2a2 2 0 0 1-2 2H11.8L7.2 20v-3.3H5a2 2 0 0 1-2-2V7.5a2 2 0 0 1 2-2Z"/>' +
        '<path d="M12 8.5v5"/>' +
        '<path d="M9.5 11h5"/>' +
      '</svg>';
    button.style.left = `${(placement.button.x / screen.w) * 100}%`;
    button.style.top = `${(placement.button.y / screen.h) * 100}%`;
    button.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      const key = targetKey(target);
      this.inlineComposerTargetId = this.inlineComposerTargetId === key ? null : key;
      this._renderInlineControls();
    });
    this.overlay.appendChild(button);

    if (this.inlineComposerTargetId !== targetKey(target)) return;
    const popover = document.createElement('div');
    popover.className = 'codex-review-inline-popover';
    popover.setAttribute('translate', 'no');
    popover.style.left = `${(placement.popover.x / screen.w) * 100}%`;
    popover.style.top = `${(placement.popover.y / screen.h) * 100}%`;
    popover.innerHTML =
      '<textarea class="codex-review-inline-note" data-role="inline-note" rows="2" ' +
        inputSuppressionAttrs() + ' ' +
        'placeholder="Leave a comment"></textarea>' +
      '<div class="codex-review-inline-actions">' +
        '<span class="codex-review-inline-status" data-role="inline-status"></span>' +
        '<button type="button" class="btn" data-act="inline-cancel">Cancel</button>' +
        '<button type="button" class="btn btn-primary" data-act="inline-save">Add Comment</button>' +
      '</div>';
    popover.addEventListener('click', (event) => event.stopPropagation());
    popover.addEventListener('mousedown', (event) => event.stopPropagation());
    popover.querySelector('[data-act="inline-cancel"]').addEventListener('click', () => {
      this.inlineComposerTargetId = null;
      this._renderInlineControls();
    });
    const textarea = popover.querySelector('[data-role="inline-note"]');
    popover.querySelector('[data-act="inline-save"]').addEventListener('click', () => {
      this._saveInlineComment(textarea ? textarea.value : '');
    });
    this.overlay.appendChild(popover);
    if (textarea) textarea.focus();
  };

  CodexReviewMode.prototype._clearInlineControls = function () {
    if (!this.overlay) return;
    this.overlay.querySelectorAll('.codex-review-inline-add, .codex-review-inline-popover')
      .forEach((el) => el.remove());
  };

  CodexReviewMode.prototype._commentsListHTML = function (comments, emptyText) {
    const list = comments || this.comments;
    if (!list.length) {
      return '<div class="codex-review-empty">' + escapeHTML(emptyText || 'No comments yet.') + '</div>';
    }
    const groups = annotationGroups(list);
    return '<div class="codex-review-comment-list">' + groups.map((group) => {
      const target = group.target;
      return '<article class="codex-review-comment-group">' +
        '<button class="codex-review-target-link" data-act="select-comment" data-id="' +
          escapeHTML(group.comments[0].id) + '">' +
          '<span>' + escapeHTML(targetLabel(target)) + '</span>' +
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
        targetId: el.dataset.targetId,
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
      selectedNode: this.selected.target,
      tool: { name: TOOL_NAME, version: TOOL_VERSION },
    };
  };

  CodexReviewMode.prototype._selectedAnnotationsPayload = function () {
    if (!this.selected) return null;
    const key = targetKey(this.selected.target);
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
    this.panel.removeAttribute('translate');
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

  CodexReviewMode.prototype._setInlineStatus = function (message) {
    const status = this.overlay && this.overlay.querySelector('[data-role="inline-status"]');
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
    const treePath = treePathString(path);
    return {
      type: 'ax-node',
      targetId: `${axId}|${treePath}`,
      axId,
      role: node.role || null,
      label: node.label || node.title || null,
      value: node.value || null,
      frame: node.frame || null,
      treePath,
    };
  }

  function manualTarget(frame) {
    const id = `manual-rect-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
    return {
      type: 'manual-rect',
      targetId: id,
      axId: null,
      role: 'ManualRectangle',
      label: 'Manual rectangle',
      value: null,
      frame,
      treePath: null,
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

  function coverageFor(all, visible) {
    const roles = {};
    for (const entry of all) {
      const role = entry.node && entry.node.role || 'AXUnknown';
      roles[role] = (roles[role] || 0) + 1;
    }
    return { total: all.length, overlay: visible.length, roles };
  }

  function baseTargetStyle(frame, screen, zIndex) {
    return 'position:absolute;box-sizing:border-box;cursor:crosshair;pointer-events:auto;' +
      `left:${(frame.x / screen.w) * 100}%;top:${(frame.y / screen.h) * 100}%;` +
      `width:${(frame.width / screen.w) * 100}%;height:${(frame.height / screen.h) * 100}%;` +
      `z-index:${zIndex};`;
  }

  function targetKey(target) {
    return target.targetId || `${target.axId || ''}|${target.treePath || ''}`;
  }

  function targetLabel(target) {
    return target.label || target.role || target.axId || target.targetId || 'Target';
  }

  function ariaLabelForTarget(target) {
    return [
      'Review target',
      target.type,
      target.role,
      target.label || target.axId || target.targetId,
      frameString(target.frame),
    ].filter(Boolean).join(', ');
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

  function normalizeFrame(a, b) {
    const x1 = Math.min(a.x, b.x);
    const y1 = Math.min(a.y, b.y);
    const x2 = Math.max(a.x, b.x);
    const y2 = Math.max(a.y, b.y);
    return { x: x1, y: y1, width: x2 - x1, height: y2 - y1 };
  }

  function inlinePlacement(frame, screen) {
    const buttonSize = 24;
    const gap = 7;
    const popoverWidth = Math.min(250, Math.max(190, screen.w - 24));
    const popoverHeight = 98;
    const preferRight = frame.x + frame.width + gap + popoverWidth <= screen.w - 8;
    const buttonX = preferRight
      ? frame.x + frame.width + gap
      : Math.max(8, frame.x - buttonSize - gap);
    const buttonY = clamp(frame.y + frame.height / 2 - buttonSize / 2, 8, screen.h - buttonSize - 8);
    const popoverX = preferRight
      ? frame.x + frame.width + gap
      : Math.max(8, frame.x - popoverWidth - gap);
    const popoverY = clamp(buttonY + buttonSize + 6, 8, screen.h - popoverHeight - 8);
    return {
      button: { x: buttonX, y: buttonY },
      popover: { x: popoverX, y: popoverY },
    };
  }

  function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
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

  function inputSuppressionAttrs() {
    return 'translate="no" spellcheck="false" autocomplete="off" autocorrect="off" autocapitalize="off"';
  }

  function tooltipFor(n) {
    return [n.role, n.label || n.title || n.identifier].filter(Boolean).join(' ');
  }

  function escapeHTML(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    })[c]);
  }

  function cssEscape(s) {
    if (window.CSS && typeof window.CSS.escape === 'function') {
      return window.CSS.escape(String(s));
    }
    return String(s).replace(/["\\]/g, '\\$&');
  }

  window.CodexReviewMode = CodexReviewMode;
})();
