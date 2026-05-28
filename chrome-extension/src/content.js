(() => {
  if (window.__GROK_DESKTOP_AGENT_CONTENT__) return;
  window.__GROK_DESKTOP_AGENT_CONTENT__ = true;

  const rootHost = document.createElement("div");
  rootHost.id = "grok-desktop-agent-root";
  rootHost.setAttribute("aria-hidden", "true");
  document.documentElement.appendChild(rootHost);

  const root = rootHost.attachShadow({ mode: "open" });
  root.innerHTML = `
    <style>
      :host {
        all: initial;
      }

      .gd-shell {
        color: #15202f;
        font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      }

      /* Full-viewport border that lights up while the agent is controlling. */
      .gd-frame {
        position: fixed;
        inset: 0;
        pointer-events: none;
        z-index: 2147483640;
        border: 0 solid transparent;
        transition: border-width 220ms ease, border-color 220ms ease,
                    box-shadow 220ms ease;
      }
      .gd-frame.controlling {
        border-width: 4px;
        border-color: rgba(247, 144, 9, 0.85);
        box-shadow: inset 0 0 0 1px rgba(247, 144, 9, 0.35),
                    inset 0 0 80px rgba(247, 144, 9, 0.18);
        animation: gd-frame-pulse 2.6s ease-in-out infinite;
      }
      @keyframes gd-frame-pulse {
        0%, 100% { border-color: rgba(247, 144, 9, 0.85); }
        50%      { border-color: rgba(247, 144, 9, 0.55); }
      }

      /* Badge cluster top-right. */
      .gd-cluster {
        position: fixed;
        right: 18px;
        top: 18px;
        z-index: 2147483647;
        display: grid;
        gap: 8px;
        justify-items: end;
        pointer-events: none;
      }
      .gd-badge {
        align-items: center;
        backdrop-filter: blur(18px);
        background: rgba(255, 255, 255, 0.92);
        border: 1px solid rgba(32, 47, 66, 0.14);
        border-radius: 14px;
        box-shadow: 0 18px 50px rgba(20, 32, 48, 0.20);
        display: flex;
        gap: 10px;
        min-height: 40px;
        opacity: 0;
        padding: 8px 10px 8px 9px;
        transform: translateY(-8px) scale(0.96);
        transition: opacity 180ms ease, transform 180ms ease;
        pointer-events: auto;
        max-width: 340px;
      }
      .gd-badge.visible {
        opacity: 1;
        transform: translateY(0) scale(1);
      }
      .gd-badge.controlling {
        background: rgba(255, 247, 232, 0.97);
        border-color: rgba(247, 144, 9, 0.45);
        box-shadow: 0 18px 50px rgba(247, 144, 9, 0.28);
      }
      .gd-badge.controlling .gd-mark {
        background: #d97706;
        animation: gd-mark-pulse 1.4s ease-in-out infinite;
      }
      @keyframes gd-mark-pulse {
        0%, 100% { transform: scale(1); }
        50%      { transform: scale(1.08); }
      }

      .gd-mark {
        align-items: center;
        background: #2f7d7e;
        border-radius: 999px;
        color: #ffffff;
        display: flex;
        flex-shrink: 0;
        font-size: 11px;
        font-weight: 900;
        height: 26px;
        justify-content: center;
        letter-spacing: 0;
        width: 26px;
      }

      .gd-meta {
        display: grid;
        gap: 1px;
        line-height: 1.15;
        min-width: 0;
      }
      .gd-title {
        color: #142033;
        font-size: 12px;
        font-weight: 800;
      }
      .gd-status {
        color: #667085;
        font-size: 10px;
        font-weight: 650;
      }
      .gd-action {
        color: #142033;
        font-size: 11px;
        font-weight: 600;
        margin-top: 2px;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        max-width: 220px;
      }
      .gd-action:empty { display: none; }
      .gd-action.busy::before {
        content: "● ";
        color: #d97706;
        animation: gd-dot-fade 1.2s ease-in-out infinite;
      }
      @keyframes gd-dot-fade {
        0%, 100% { opacity: 0.35; }
        50%      { opacity: 1; }
      }

      .gd-actions {
        align-items: center;
        display: flex;
        flex-shrink: 0;
        gap: 4px;
        margin-left: 4px;
      }
      .gd-btn {
        background: rgba(20, 32, 51, 0.06);
        border: 1px solid rgba(20, 32, 51, 0.10);
        border-radius: 8px;
        color: #142033;
        cursor: pointer;
        font-family: inherit;
        font-size: 11px;
        font-weight: 700;
        padding: 4px 8px;
      }
      .gd-btn:hover { background: rgba(20, 32, 51, 0.12); }
      .gd-btn.danger {
        background: rgba(220, 38, 38, 0.10);
        border-color: rgba(220, 38, 38, 0.25);
        color: #b91c1c;
      }
      .gd-btn.danger:hover { background: rgba(220, 38, 38, 0.20); }

      /* Recent actions log, expanded under the badge. */
      .gd-log {
        backdrop-filter: blur(18px);
        background: rgba(255, 255, 255, 0.95);
        border: 1px solid rgba(32, 47, 66, 0.14);
        border-radius: 12px;
        box-shadow: 0 18px 50px rgba(20, 32, 48, 0.18);
        display: none;
        font-size: 11px;
        max-height: 260px;
        max-width: 340px;
        min-width: 220px;
        overflow-y: auto;
        padding: 8px 4px;
        pointer-events: auto;
      }
      .gd-log.open { display: block; }
      .gd-log-row {
        align-items: flex-start;
        color: #344054;
        display: grid;
        gap: 2px;
        grid-template-columns: auto 1fr;
        padding: 4px 8px;
      }
      .gd-log-row + .gd-log-row {
        border-top: 1px solid rgba(0,0,0,0.04);
      }
      .gd-log-icon {
        color: #2f7d7e;
        font-weight: 800;
      }
      .gd-log-row.danger .gd-log-icon { color: #b91c1c; }
      .gd-log-row.warn .gd-log-icon { color: #d97706; }
      .gd-log-text {
        color: #142033;
        line-height: 1.3;
      }
      .gd-log-time {
        color: #98a2b3;
        font-size: 10px;
        grid-column: 2;
      }
      .gd-log-empty {
        color: #98a2b3;
        padding: 8px 10px;
        text-align: center;
      }

      /* Agent fake cursor (kept from earlier, unchanged behavior). */
      .gd-cursor {
        filter: drop-shadow(0 12px 22px rgba(17, 24, 39, 0.24));
        left: 0;
        opacity: 0;
        pointer-events: none;
        position: fixed;
        top: 0;
        transform: translate3d(120px, 120px, 0);
        transition: opacity 120ms ease, transform 260ms cubic-bezier(.2,.8,.2,1);
        z-index: 2147483646;
      }
      .gd-trail {
        background: rgba(47, 125, 126, 0.18);
        border: 1px solid rgba(47, 125, 126, 0.22);
        border-radius: 999px;
        height: 28px;
        left: -11px;
        opacity: 0;
        position: absolute;
        top: -9px;
        transform: scale(0.8);
        transition: opacity 160ms ease, transform 240ms ease;
        width: 28px;
      }
      .gd-cursor.visible { opacity: 1; }
      .gd-cursor.visible .gd-trail {
        opacity: 1;
        transform: scale(1);
      }
      .gd-pointer {
        background: linear-gradient(145deg, #35a0a1, #162033);
        clip-path: polygon(0 0, 0 28px, 9px 21px, 15px 34px, 22px 31px, 16px 18px, 29px 18px);
        height: 34px;
        position: relative;
        width: 30px;
      }
      .gd-cursor-label {
        background: #162033;
        border: 1px solid rgba(255,255,255,0.1);
        border-radius: 999px;
        color: #ffffff;
        font-size: 11px;
        font-weight: 750;
        left: 24px;
        padding: 5px 8px;
        position: absolute;
        top: 18px;
        white-space: nowrap;
      }
    </style>
    <div class="gd-shell">
      <div class="gd-frame" part="frame"></div>
      <div class="gd-cluster">
        <div class="gd-badge" part="badge">
          <div class="gd-mark">G</div>
          <div class="gd-meta">
            <div class="gd-title">Grok Desktop</div>
            <div class="gd-status">watching</div>
            <div class="gd-action"></div>
          </div>
          <div class="gd-actions">
            <button class="gd-btn gd-log-toggle" type="button" title="Recent actions">≡</button>
            <button class="gd-btn danger gd-cancel" type="button" title="Cancel current agent action">Stop</button>
          </div>
        </div>
        <div class="gd-log" part="log">
          <div class="gd-log-empty">No agent actions yet.</div>
        </div>
      </div>
      <div class="gd-cursor" part="cursor">
        <div class="gd-trail"></div>
        <div class="gd-pointer"></div>
        <div class="gd-cursor-label">Agent</div>
      </div>
    </div>
  `;

  const badge = root.querySelector(".gd-badge");
  const status = root.querySelector(".gd-status");
  const actionEl = root.querySelector(".gd-action");
  const frame = root.querySelector(".gd-frame");
  const cursor = root.querySelector(".gd-cursor");
  const cursorLabel = root.querySelector(".gd-cursor-label");
  const logPanel = root.querySelector(".gd-log");
  const logToggleBtn = root.querySelector(".gd-log-toggle");
  const cancelBtn = root.querySelector(".gd-cancel");
  const defaultAgentConfig = {
    focusGuard: true,
    visibleMotion: true,
    controlledTabsOnly: true,
  };
  let agentConfig = { ...defaultAgentConfig };
  let cursorTimer = null;
  let cursorFrame = null;
  let cursorState = { x: 120, y: 120 };
  let actionIdleTimer = null;
  /** @type {{kind:'info'|'warn'|'danger', text:string, ts:number}[]} */
  let actionLog = [];
  const LOG_CAP = 50;

  function setTabState(tabState) {
    if (!tabState) {
      badge.classList.remove("visible");
      badge.classList.remove("controlling");
      frame.classList.remove("controlling");
      cursor.classList.remove("visible");
      return;
    }

    const isControlling = tabState.status === "controlling";
    status.textContent = isControlling ? "controlling" : "watching";
    badge.classList.toggle("controlling", isControlling);
    frame.classList.toggle("controlling", isControlling);
    badge.classList.add("visible");
  }

  function setAgentConfig(nextConfig = {}) {
    agentConfig = { ...agentConfig, ...nextConfig };
  }

  function setActionLabel(text, opts = {}) {
    const trimmed = String(text || "").trim();
    actionEl.textContent = trimmed;
    actionEl.classList.toggle("busy", Boolean(trimmed) && opts.busy !== false);
    clearTimeout(actionIdleTimer);
    if (trimmed && opts.idleAfterMs) {
      actionIdleTimer = setTimeout(() => {
        actionEl.textContent = "";
        actionEl.classList.remove("busy");
      }, opts.idleAfterMs);
    }
  }

  function pushAction(text, kind = "info") {
    const trimmed = String(text || "").trim();
    if (!trimmed) return;
    const entry = { kind, text: trimmed, ts: Date.now() };
    actionLog.push(entry);
    if (actionLog.length > LOG_CAP) actionLog.shift();
    renderLog();
  }

  function formatRelTime(ts) {
    const secs = Math.max(0, Math.round((Date.now() - ts) / 1000));
    if (secs < 5) return "just now";
    if (secs < 60) return `${secs}s ago`;
    const m = Math.round(secs / 60);
    return `${m}m ago`;
  }

  function renderLog() {
    if (!actionLog.length) {
      logPanel.innerHTML = '<div class="gd-log-empty">No agent actions yet.</div>';
      return;
    }
    const iconFor = (k) => (k === "danger" ? "⚠" : k === "warn" ? "•" : "→");
    // Newest first.
    const rows = actionLog
      .slice()
      .reverse()
      .map((row) => {
        const safe = row.text
          .replace(/&/g, "&amp;")
          .replace(/</g, "&lt;")
          .replace(/>/g, "&gt;");
        return `<div class="gd-log-row ${row.kind}">
          <div class="gd-log-icon">${iconFor(row.kind)}</div>
          <div class="gd-log-text">${safe}</div>
          <div class="gd-log-time">${formatRelTime(row.ts)}</div>
        </div>`;
      })
      .join("");
    logPanel.innerHTML = rows;
  }

  logToggleBtn.addEventListener("click", (e) => {
    e.preventDefault();
    e.stopPropagation();
    logPanel.classList.toggle("open");
    if (logPanel.classList.contains("open")) renderLog();
  });
  cancelBtn.addEventListener("click", (e) => {
    e.preventDefault();
    e.stopPropagation();
    pushAction("Cancel requested by user", "warn");
    setActionLabel("cancelling…", { idleAfterMs: 2000 });
    try {
      chrome.runtime.sendMessage({ type: "GROK_DESKTOP_AGENT_CANCEL" });
    } catch (err) {
      pushAction(`Cancel send failed: ${err && err.message ? err.message : err}`, "danger");
    }
  });

  function placeCursor(x, y) {
    cursorState = { x, y };
    cursor.style.transform = `translate3d(${x}px, ${y}px, 0)`;
  }

  function bezierPoint(t, start, cp1, cp2, end) {
    const inv = 1 - t;
    return (
      inv * inv * inv * start +
      3 * inv * inv * t * cp1 +
      3 * inv * t * t * cp2 +
      t * t * t * end
    );
  }

  function animateCursorTo(x, y, duration = 620) {
    cancelAnimationFrame(cursorFrame);

    const start = { ...cursorState };
    const distance = Math.hypot(x - start.x, y - start.y);
    const arc = Math.min(90, Math.max(24, distance * 0.18));
    const cp1 = {
      x: start.x + (x - start.x) * 0.28,
      y: start.y + (y - start.y) * 0.18 - arc,
    };
    const cp2 = {
      x: start.x + (x - start.x) * 0.74,
      y: start.y + (y - start.y) * 0.84 + arc * 0.36,
    };
    const startedAt = performance.now();

    function step(now) {
      const raw = Math.min(1, (now - startedAt) / duration);
      const eased = 1 - Math.pow(1 - raw, 3);
      const settle = Math.sin(raw * Math.PI * 3) * (1 - raw) * 1.8;
      placeCursor(
        bezierPoint(eased, start.x, cp1.x, cp2.x, x) + settle,
        bezierPoint(eased, start.y, cp1.y, cp2.y, y) - settle * 0.6,
      );

      if (raw < 1) {
        cursorFrame = requestAnimationFrame(step);
      }
    }

    cursorFrame = requestAnimationFrame(step);
  }

  function setCursor(payload = {}) {
    const x = Number.isFinite(payload.x) ? payload.x : 120;
    const y = Number.isFinite(payload.y) ? payload.y : 120;
    cursorLabel.textContent = payload.label || "Agent";
    if (agentConfig.visibleMotion && payload.animate !== false) {
      animateCursorTo(x, y, payload.motionMs || 620);
    } else {
      placeCursor(x, y);
    }
    cursor.classList.toggle("visible", payload.visible !== false);

    clearTimeout(cursorTimer);
    cursorTimer = setTimeout(() => cursor.classList.remove("visible"), payload.duration || 1800);
  }

  function cleanText(value, limit = 240) {
    return String(value || "")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, limit);
  }

  function focusedEditable() {
    const active = document.activeElement;
    if (!active || active === document.body || active === document.documentElement) return null;
    return active.closest?.("input, textarea, select, [contenteditable=''], [contenteditable='true'], [role='textbox']") || null;
  }

  function captureFocus() {
    const element = document.activeElement;
    if (!element || element === document.body || element === document.documentElement) return null;

    return {
      element,
      start: "selectionStart" in element ? element.selectionStart : null,
      end: "selectionEnd" in element ? element.selectionEnd : null,
    };
  }

  function restoreFocus(snapshot) {
    if (!snapshot?.element || !document.contains(snapshot.element)) return;
    snapshot.element.focus?.({ preventScroll: true });
    if (
      snapshot.start !== null &&
      snapshot.end !== null &&
      "setSelectionRange" in snapshot.element
    ) {
      snapshot.element.setSelectionRange(snapshot.start, snapshot.end);
    }
  }

  function setInputValue(payload = {}) {
    const element = document.querySelector(payload.selector || "");
    if (!element) return { ok: false, error: "selector not found" };

    if (payload.simulateTyping || payload.typoRate) {
      return {
        ok: false,
        error: "unsupported_unsafe_mode",
        detail: "Grok Desktop uses explicit, visible, user-authorized input updates and does not simulate typos.",
      };
    }

    const activeEditable = focusedEditable();
    if (agentConfig.focusGuard && activeEditable && !payload.allowFocused) {
      return {
        ok: false,
        error: "user_input_in_progress",
        detail: "Grok Desktop did not write because the user is currently focused in an editable field.",
      };
    }

    const focusSnapshot = captureFocus();
    if ("value" in element) {
      const valueSetter = Object.getOwnPropertyDescriptor(element.constructor.prototype, "value")?.set;
      if (valueSetter) {
        valueSetter.call(element, payload.value ?? "");
      } else {
        element.value = payload.value ?? "";
      }
      element.dispatchEvent(new Event("input", { bubbles: true }));
      element.dispatchEvent(new Event("change", { bubbles: true }));
      restoreFocus(focusSnapshot);
      return { ok: true };
    }

    element.textContent = payload.value ?? "";
    element.dispatchEvent(new Event("input", { bubbles: true }));
    restoreFocus(focusSnapshot);
    return { ok: true };
  }

  function domAction(payload = {}) {
    const element = document.querySelector(payload.selector || "");
    if (!element) return { ok: false, error: "selector not found" };

    if (agentConfig.focusGuard && focusedEditable() && !payload.allowFocusShift) {
      return {
        ok: false,
        error: "user_input_in_progress",
        detail: "Grok Desktop did not click because the user is currently focused in an editable field.",
      };
    }

    const focusSnapshot = captureFocus();
    if (payload.action === "click") {
      element.click();
      restoreFocus(focusSnapshot);
      return { ok: true };
    }

    return { ok: false, error: "unsupported action" };
  }

  function collectPageSnapshot() {
    const description =
      document.querySelector("meta[name='description']")?.getAttribute("content") || "";
    const canonical = document.querySelector("link[rel='canonical']")?.getAttribute("href") || "";
    const text = cleanText(document.body?.innerText || "", 4000);

    const headings = Array.from(document.querySelectorAll("h1, h2, h3"))
      .slice(0, 18)
      .map((node) => ({
        level: node.tagName.toLowerCase(),
        text: cleanText(node.textContent, 160),
      }))
      .filter((heading) => heading.text);

    const links = Array.from(document.querySelectorAll("a[href]"))
      .slice(0, 24)
      .map((node) => ({
        text: cleanText(node.textContent, 120),
        href: node.href,
      }))
      .filter((link) => link.href);

    const forms = Array.from(document.querySelectorAll("form"))
      .slice(0, 8)
      .map((form, index) => ({
        index,
        labels: Array.from(form.querySelectorAll("label"))
          .slice(0, 10)
          .map((label) => cleanText(label.textContent, 80))
          .filter(Boolean),
        fields: Array.from(form.querySelectorAll("input, textarea, select"))
          .slice(0, 16)
          .map((field) => ({
            tag: field.tagName.toLowerCase(),
            type: field.getAttribute("type") || "",
            name: field.getAttribute("name") || "",
            placeholder: field.getAttribute("placeholder") || "",
            ariaLabel: field.getAttribute("aria-label") || "",
          })),
      }));

    return {
      title: document.title,
      url: location.href,
      language: document.documentElement.lang || "",
      canonical,
      description: cleanText(description, 300),
      selectedText: cleanText(String(window.getSelection?.() || ""), 1000),
      headings,
      links,
      forms,
      textSample: text,
      viewport: {
        width: window.innerWidth,
        height: window.innerHeight,
        scrollX: window.scrollX,
        scrollY: window.scrollY,
      },
      updatedAt: Date.now(),
    };
  }

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message.type === "GROK_DESKTOP_PING") {
      sendResponse({ ok: true });
      return false;
    }

    if (message.type === "GROK_DESKTOP_SET_TAB_STATE") {
      setTabState(message.payload);
      sendResponse({ ok: true });
      return false;
    }

    if (message.type === "GROK_DESKTOP_SET_AGENT_CONFIG") {
      setAgentConfig(message.payload);
      sendResponse({ ok: true, config: agentConfig });
      return false;
    }

    if (message.type === "GROK_DESKTOP_AGENT_CURSOR") {
      setCursor(message.payload);
      sendResponse({ ok: true });
      return false;
    }

    if (message.type === "GROK_DESKTOP_AGENT_INPUT") {
      const result = setInputValue(message);
      const target = message.selector || "selector";
      const preview = String(message.value || "").slice(0, 40);
      if (result && result.ok) {
        pushAction(`Filled ${target}: ${preview}`, "info");
        setActionLabel(`filling ${target}`, { idleAfterMs: 1200 });
      } else if (result) {
        pushAction(`Input rejected on ${target}: ${result.error || "unknown"}`, "warn");
      }
      sendResponse(result);
      return false;
    }

    if (message.type === "GROK_DESKTOP_AGENT_DOM_ACTION") {
      const result = domAction(message);
      const target = message.selector || "selector";
      const action = message.action || "action";
      if (result && result.ok) {
        pushAction(`${action} on ${target}`, "info");
        setActionLabel(`${action} ${target}`, { idleAfterMs: 1200 });
      } else if (result) {
        pushAction(`${action} rejected on ${target}: ${result.error || "unknown"}`, "warn");
      }
      sendResponse(result);
      return false;
    }

    if (message.type === "GROK_DESKTOP_AGENT_SET_ACTION_LABEL") {
      setActionLabel(message.payload?.text, {
        busy: message.payload?.busy !== false,
        idleAfterMs: message.payload?.idleAfterMs,
      });
      sendResponse({ ok: true });
      return false;
    }

    if (message.type === "GROK_DESKTOP_AGENT_LOG_PUSH") {
      pushAction(message.payload?.text, message.payload?.kind || "info");
      sendResponse({ ok: true });
      return false;
    }

    if (message.type === "GROK_DESKTOP_AGENT_LOG_GET") {
      sendResponse({ ok: true, log: actionLog.slice() });
      return false;
    }

    if (message.type === "GROK_DESKTOP_COLLECT_PAGE_SNAPSHOT") {
      sendResponse(collectPageSnapshot());
      return false;
    }

    return false;
  });
})();
