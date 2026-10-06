/* ohno.js v4.6 — zero-dependency behaviors for ohno components.
   Classless-first; declarative via data-attributes; API: window.OHNO.
   Contract: llm.txt. Overlays ride native <dialog> + [popover].

   Micro-helpers (short local aliases; minifier keeps 1-char names):
   d=document, E=el creator: E(tag, cls, attrs?, parent?) — attrs {k:v},
   key with $ prefix sets property, else attribute; on=addEventListener;
   D=custom event dispatcher (bubbles); de=closest delegated target. */
(function () {
  "use strict";

  /* ---------- micro-helpers ---------------------------------------- */
  const d = document,
    // E("div","toast",{"role":"status","$hidden":true},where) → element
    E = (t, c, a, p) => {
      const e = d.createElement(t);
      if (c) e.className = c;
      if (a)
        for (const k in a)
          k[0] === "$" ? (e[k.slice(1)] = a[k]) : a[k] == null || e.setAttribute(k, a[k]);
      if (p) p.append(e);
      return e;
    },
    on = (el, ev, fn, o) => el.addEventListener(ev, fn, o),
    // dispatch bubbling CustomEvent
    D = (el, type, detail) =>
      el.dispatchEvent(new CustomEvent(type, { bubbles: true, detail }));

  const $ = (sel, root) => (root || d).querySelector(sel);
  const $$ = (sel, root) => Array.from((root || d).querySelectorAll(sel));

  /* ---------- theme / palette / contrast ---------------------------- *
   * [data-theme] [data-palette] [data-contrast] on <html>
   * persisted to localStorage; fires "ohno:themechange".
   * one writer: put(attr, save, val) */
  const ROOT = d.documentElement,
    /* Theme = structural identity. Neutral is the unadorned base; dark/light
       are Faces only and never appear as structural theme choices. */
    THEMES = ["neutral", "glass", "neu", "term", "oled"],
    THEME_LABELS = { neutral: "Neutral", glass: "Glass", neu: "Neu", term: "Terminal", oled: "OLED" },
    PALETTES = ["indigo", "ember", "forest", "mono"],
    CONTRASTS = ["low", "med", "high"],
    DENSITIES = ["dense", "regular", "large"],
    store = (k, v) => {
      try { v == null ? localStorage.removeItem(k) : localStorage.setItem(k, v); } catch (_) {}
    },
    read = (k) => {
      try { return localStorage.getItem(k); } catch (_) { return null; }
    },
    emitTheme = () =>
      D(d, "ohno:themechange", {
        theme: ROOT.getAttribute("data-theme") || "neutral",
        palette: ROOT.getAttribute("data-palette") || "indigo",
        contrast: ROOT.getAttribute("data-contrast") || "med",
        density: ROOT.getAttribute("data-density") || "regular",
      });

  const theme = {
    get: () => ROOT.getAttribute("data-theme") || "neutral",
    set(name) {
      if (!THEMES.includes(name)) return;
      ROOT.setAttribute("data-theme", name);
      store("ohno-theme", name);
      emitTheme();
    },
    /* Light/dark is now purely a Face (data-look), not a theme. `toggle`
       flips the face; there is no separate "light" theme anymore. */
    toggle() { this.setLook(this.getLook() === "dark" ? "light" : "dark"); },
    /* look = the light/dark face of ANY theme (data-look).
       neu is a light-identity theme; everything else defaults to the dark face. */
    getLook() {
      const look = ROOT.getAttribute("data-look");
      if (look === "light" || look === "dark") return look;
      // no explicit look → the theme's built-in identity
      return this.get() === "neu" ? "light" : "dark";
    },
    setLook(name) {
      if (name !== "light" && name !== "dark") return;
      if (name === this.getLook()) {
        ROOT.removeAttribute("data-look"); // matches the theme's own identity
        store("ohno-look", "");
        emitTheme();
        return;
      }
      ROOT.setAttribute("data-look", name);
      store("ohno-look", name);
      emitTheme();
    },
    toggleLook() { this.setLook(this.getLook() === "light" ? "dark" : "light"); },
    getPalette: () => ROOT.getAttribute("data-palette") || "indigo",
    setPalette(name) {
      // builtin palettes + app-defined ones (custom [data-palette] token pairs
      // are part of the contract — see llm.txt "Add a new palette").
      // Guard only against injection-shaped values, not against the builtin list.
      if (!/^[a-z][a-z0-9-]*$/i.test(name)) return;
      ROOT.setAttribute("data-palette", name);
      store("ohno-palette", name);
      emitTheme();
    },
    getContrast: () => ROOT.getAttribute("data-contrast") || "med",
    setContrast(name) {
      if (!CONTRASTS.includes(name)) return;
      name === "med" ? ROOT.removeAttribute("data-contrast") : ROOT.setAttribute("data-contrast", name);
      store("ohno-contrast", name);
      emitTheme();
    },
    getDensity: () => ROOT.getAttribute("data-density") || "regular",
    setDensity(name) {
      if (!DENSITIES.includes(name)) return;
      name === "regular" ? ROOT.removeAttribute("data-density") : ROOT.setAttribute("data-density", name);
      store("ohno-density", name);
      emitTheme();
    },
    init() {
      let t = read("ohno-theme");
      if (t && !THEMES.includes(t)) t = null;
      if (t) ROOT.setAttribute("data-theme", t);
      // a persisted/OS "light" preference now maps to the light FACE on the
      // dark-neutral base — there is no "light" theme to switch to.
      if (matchMedia && matchMedia("(prefers-color-scheme: light)").matches) {
        if (!ROOT.getAttribute("data-look")) ROOT.setAttribute("data-look", "light");
      }
      if ((t = read("ohno-look"))) {
        if (t === "light" || t === "dark") ROOT.setAttribute("data-look", t);
      }
      if ((t = read("ohno-palette"))) ROOT.setAttribute("data-palette", t);
      if ((t = read("ohno-contrast"))) {
        if (t === "med") ROOT.removeAttribute("data-contrast");
        else if (CONTRASTS.includes(t)) ROOT.setAttribute("data-contrast", t);
      }
      if ((t = read("ohno-density")) && DENSITIES.includes(t)) {
        t === "regular" ? ROOT.removeAttribute("data-density") : ROOT.setAttribute("data-density", t);
      }
    },
  };
  theme.init();

  /* ---------- dialogs (modals + palette) ---------------------------- *
   * <dialog>.showModal() owns focus trap, Esc, scroll lock.
   * Legacy v3 wrapper selectors still resolve to the inner <dialog>. */
  let activeModal = null; // last dialog opened via OHNO.openModal

  function showDialog(dlg) {
    if (!dlg || dlg.open) return;
    dlg.classList.remove("is-closing");
    if (typeof dlg.showModal !== "function") {
      dlg.setAttribute("open", "");
      return;
    }
    dlg.showModal(); // top layer, Esc, focus trap, scroll lock
    D(dlg, "ohno:open");
    const target = $("[autofocus]", dlg) || $("input,textarea,select,button:not([disabled])", dlg);
    (target || dlg).focus({ preventScroll: true });
  }

  function hideDialog(dlg) {
    if (!dlg || !dlg.open) return;
    if (activeModal === dlg) activeModal = null;
    dlg.classList.add("is-closing"); // keep exit animation alive while display flips
    // strip is-closing after the exit transition settles; close() fires too
    // early and would snap the fade. Timeout covers reduced-motion/hidden tabs.
    on(dlg, "transitionend", (e) => {
      if (e.target === dlg && e.propertyName === "opacity") dlg.classList.remove("is-closing");
    }, { once: true });
    setTimeout(() => dlg.classList.remove("is-closing"), 350);
    dlg.close();
  }

  /* ---------- dropdowns [data-dropdown] ------------------------------ */
  function initDropdowns(root) {
    $$("[data-dropdown]", root).forEach((wrap) => {
      const trigger = $(".btn, [data-trigger]", wrap),
        menu = $(".menu", wrap);
      if (!trigger || !menu || wrap._ohnoClose) return;

      const open = () => {
        closeAllMenus(wrap);
        wrap.classList.add("is-open");
        menu.classList.add("is-open");
        (menu.querySelector(".menu-item:not(.is-disabled)") || menu).focus?.();
      };
      const close = () => {
        wrap.classList.remove("is-open");
        menu.classList.remove("is-open");
      };
      wrap._ohnoClose = close;

      on(trigger, "click", (e) => {
        e.stopPropagation();
        wrap.classList.contains("is-open") ? close() : open();
      });
      on(wrap, "keydown", (e) => {
        const items = $$(".menu-item:not(.is-disabled)", menu);
        if (!items.length) return;
        const idx = items.indexOf(d.activeElement);
        if (e.key === "ArrowDown") { e.preventDefault(); items[Math.min(idx + 1, items.length - 1)]?.focus(); }
        else if (e.key === "ArrowUp") { e.preventDefault(); items[Math.max(idx - 1, 0)]?.focus(); }
        else if (e.key === "Escape") { close(); trigger.focus(); }
      });
      on(menu, "click", (e) => {
        const item = e.target.closest(".menu-item");
        if (!item || item.classList.contains("is-disabled")) return;
        if (item.tagName !== "A") e.preventDefault();
        close();
      });
    });
  }

  // delegated document click: close open dropdowns when clicking outside
  const closeAllMenus = (except) =>
    $$("[data-dropdown].is-open").forEach((w) => { if (w !== except) w._ohnoClose?.(); });

  on(d, "click", (e) => {
    if (!e.target.closest("[data-dropdown]")) closeAllMenus();
  });

  /* ---------- selects [data-select] & classless <select> ------------ *
   * Hidden <select> + trigger button + listbox panel; search built in.
   * Emits "ohno:change" (detail.value / detail.values) + native change. */
  function initSelects(root) {
    $$("select[data-select], select.select, select:not([data-native]):not(.native-select)", root).forEach((sel) => {
      if (sel._ohnoSelect) return;
      sel._ohnoSelect = true;
      const multi = sel.hasAttribute("data-multiple");
      if (multi) {
        sel.multiple = true; // browser must keep >1 selected option
        // re-apply selectedness from `selected` content attributes (parser drop)
        $$("option[selected]", sel).forEach((o) => { o.selected = true; });
      }
      sel.hidden = true;

      const rootEl = E("div", "select", null, null);
      if (sel.getAttribute("style")) {
        rootEl.setAttribute("style", sel.getAttribute("style"));
      }
      if (sel.className) {
        sel.classList.forEach((cls) => {
          if (cls !== "select" && cls !== "input") rootEl.classList.add(cls);
        });
      }
      sel.insertAdjacentElement("afterend", rootEl);
      const btn = E("button", "select-trigger", { type: "button", "aria-haspopup": "listbox", "aria-expanded": "false" }, rootEl),
        chips = E("div", "row", { $hidden: true }, btn),
        label = E("span", "select-label", null, btn),
        panel = E("div", "select-panel", null, rootEl),
        search = E("input", "select-search", { type: "text", $placeholder: "Search…", "aria-label": (sel.dataset.placeholder || "Search options") }, panel),
        list = E("div", "select-list", { role: "listbox" }, panel);

      if (sel.disabled) {
        btn.disabled = true;
        rootEl.classList.add("is-disabled");
      }
      if (sel.getAttribute("aria-label")) {
        btn.setAttribute("aria-label", sel.getAttribute("aria-label"));
      }
      if (sel.getAttribute("aria-labelledby")) {
        btn.setAttribute("aria-labelledby", sel.getAttribute("aria-labelledby"));
      }
      if (sel.getAttribute("title")) {
        btn.setAttribute("title", sel.getAttribute("title"));
      }
      if (sel.id) {
        btn.id = `${sel.id}-trigger`;
        const escapedId = typeof CSS !== "undefined" && CSS.escape ? CSS.escape(sel.id) : sel.id.replace(/["\\]/g, "\\$&");
        const lbl = d.querySelector(`label[for="${escapedId}"]`);
        if (lbl) {
          btn.setAttribute("aria-labelledby", `${lbl.id || (lbl.id = `${sel.id}-label`)} ${btn.id}`);
          on(lbl, "click", (e) => {
            e.preventDefault();
            btn.focus();
            if (!open) openPanel();
          });
        }
      }

      let opts = [];
      function buildOpts() {
        opts = $$("option", sel).filter((o) => !o.hidden).map((o) => ({
          el: o, value: o.value, text: o.textContent.trim(),
          disabled: o.disabled,
          group: o.parentElement.tagName === "OPTGROUP" ? o.parentElement.label : null,
        }));
      }
      buildOpts();

      let open = false, activeIdx = -1;
      const visible = () => opts.filter((o) => !o.disabled && o.elOption && !o.elOption.hidden);

      function sync() {
        const chosen = opts.filter((o) => o.el.selected && !o.disabled);
        if (multi) {
          chips.hidden = chosen.length === 0;
          chips.innerHTML = "";
          for (const o of chosen) {
            const c = E("span", "chip", null, chips);
            E("span", null, { $textContent: o.text }, c);
            const x = E("button", "chip-remove", { type: "button", $textContent: "×", "aria-label": "Remove " + o.text }, c);
            on(x, "click", (e) => {
              e.stopPropagation();
              o.el.selected = false;
              sync();
              syncMarks();
              const ev = new Event("change", { bubbles: true });
              ev._ohnoInternal = true;
              sel.dispatchEvent(ev);
            });
          }
          label.hidden = chosen.length > 0;
          D(sel, "ohno:change", { values: chosen.map((o) => o.value) });
        } else {
          const o = chosen[0];
          chips.hidden = true;
          label.textContent = o ? o.text : (sel.dataset.placeholder || "");
          label.classList.toggle("is-placeholder", !o);
          rootEl.classList.toggle("is-placeholder", !o);
          D(sel, "ohno:change", { value: o ? o.value : null });
        }
      }

      function buildList() {
        list.innerHTML = "";
        let lastGroup = null;
        for (const o of opts) {
          if (o.group && o.group !== lastGroup) {
            E("div", "menu-header", { $textContent: o.group }, list);
            lastGroup = o.group;
          }
          const el = E("div", "select-option" + (o.disabled ? " is-disabled" : ""),
            { role: "option", $textContent: o.text }, list);
          if (o.el.selected) el.classList.add("is-selected");
          if (!o.disabled) on(el, "click", () => choose(o));
          o.elOption = el;
        }
        syncMarks();
      }

      const syncMarks = () => opts.forEach((o) => o.elOption && o.elOption.classList.toggle("is-selected", !!o.el.selected));

      function mark() {
        const vis = visible();
        vis.forEach((o, i) => o.elOption && o.elOption.classList.toggle("is-active", i === activeIdx));
        const el = vis[activeIdx] && vis[activeIdx].elOption;
        if (el) el.scrollIntoView({ block: "nearest" });
      }

      function openPanel() {
        if (open || sel.disabled || btn.disabled) return;
        open = true;
        rootEl.classList.add("is-open");
        btn.setAttribute("aria-expanded", "true");
        search.hidden = opts.length <= 8; // search only when it earns its place
        search.value = "";
        filter("");
        buildList();
        // Drop-up flip + clamp: open upward when the nearest clipping container
        // leaves too little room below the trigger, and clamp the list height
        // to the space actually available in the chosen direction (contract:
        // no open panel may have obscured options). Measured once now and once
        // after the open transition settles, since mid-animation geometry can
        // differ from the settled state.
        const list = panel.querySelector(".select-list");
        const applyClamp = () => {
          const lH = panel.offsetHeight, tR = btn.getBoundingClientRect();
          let cB = innerHeight, cT = 0;
          for (let p = rootEl.parentElement; p; p = p.parentElement) {
            if (p === ROOT || p === d.body) break;
            if (/(auto|scroll|hidden|clip)/.test(getComputedStyle(p).overflowY)) {
              const cr = p.getBoundingClientRect();
              cB = cr.bottom; cT = cr.top;
              break;
            }
          }
          const need = Math.min(lH + 8, 320); // panel height + gap, like CSS max-height
          rootEl.classList.toggle("select--up", tR.bottom + need > cB && tR.top - need >= cT);
          const roomDown = Math.max(0, cB - tR.bottom - 8),
            roomUp = Math.max(0, tR.top - cT - 8);
          const avail = rootEl.classList.contains("select--up") ? roomUp : roomDown;
          list.style.maxHeight = Math.min(lH, avail) > 60 ? Math.round(Math.min(lH, avail)) + "px" : "";
        };
        if (list) {
          applyClamp();
          requestAnimationFrame(() => {
            if (open) requestAnimationFrame(applyClamp);
          });
        }
        const chosenIdx = visible().findIndex((o) => o.el.selected);
        activeIdx = chosenIdx >= 0 ? chosenIdx : 0;
        mark();
        if (!search.hidden) setTimeout(() => search.focus(), 10);
        else btn.focus();
      }

      function closePanel(refocus = true) {
        if (!open) return;
        open = false;
        rootEl.classList.remove("is-open");
        btn.setAttribute("aria-expanded", "false");
        activeIdx = -1;
        opts.forEach((o) => o.elOption && o.elOption.classList.remove("is-active"));
        if (refocus) btn.focus();
      }

      function filter(q) {
        q = (q || "").toLowerCase().trim();
        let any = false;
        opts.forEach((o) => {
          const hit = q === "" || o.text.toLowerCase().includes(q);
          if (o.elOption) o.elOption.hidden = !hit;
          if (hit) any = true;
        });
        list.querySelector(".select-empty")?.remove();
        if (!any) E("div", "select-empty", { $textContent: "No matches" }, list);
      }

      function choose(o) {
        if (multi) o.el.selected = !o.el.selected;
        else {
          opts.forEach((x) => (x.el.selected = false));
          o.el.selected = true;
        }
        sync();
        syncMarks();
        const ev = new Event("change", { bubbles: true });
        ev._ohnoInternal = true;
        sel.dispatchEvent(ev);
        if (!multi) closePanel();
      }

      on(btn, "click", () => (open ? closePanel() : openPanel()));
      on(search, "input", () => {
        filter(search.value);
        const vis = visible();
        activeIdx = vis.length ? 0 : -1;
        mark();
      });
      on(rootEl, "keydown", (e) => {
        if (e.key === "ArrowDown" || e.key === "ArrowUp") {
          e.preventDefault();
          if (!open) return openPanel();
          const vis = visible();
          if (!vis.length) return;
          activeIdx = e.key === "ArrowDown"
            ? Math.min(activeIdx + 1, vis.length - 1)
            : Math.max(activeIdx - 1, 0);
          mark();
        } else if (e.key === "Enter") {
          if (open && activeIdx >= 0) { e.preventDefault(); choose(visible()[activeIdx]); }
        } else if (e.key === "Escape") {
          if (open) { e.preventDefault(); e.stopPropagation(); closePanel(); }
        } else if (e.key === "Backspace" && multi && open && search.value === "") {
          const chosen = opts.filter((o) => o.el.selected && !o.disabled),
            last = chosen[chosen.length - 1];
          if (last) { last.el.selected = false; sync(); buildList(); }
        }
      });
      on(rootEl, "focusout", (e) => {
        // Tab out of the open panel must not leave it stranded open
        if (open && !(e.relatedTarget && rootEl.contains(e.relatedTarget))) closePanel(false);
      });

      function rebuild() {
        buildOpts();
        buildList();
        sync();
      }

      // Bidirectional sync: notify custom UI when native select value is changed
      on(sel, "change", (e) => {
        if (!e._ohnoInternal) {
          sync();
          syncMarks();
        }
      });
      if (sel.form) {
        on(sel.form, "reset", () => setTimeout(() => {
          sync();
          syncMarks();
        }, 0));
      }

      // Intercept .value and .selectedIndex so direct assignments reflect in UI
      try {
        const selProto = HTMLSelectElement.prototype;
        const valDesc = Object.getOwnPropertyDescriptor(selProto, "value");
        if (valDesc && valDesc.set) {
          Object.defineProperty(sel, "value", {
            set(v) {
              valDesc.set.call(this, v);
              sync();
              syncMarks();
            },
            get() {
              return valDesc.get.call(this);
            },
            configurable: true,
          });
        }
        const idxDesc = Object.getOwnPropertyDescriptor(selProto, "selectedIndex");
        if (idxDesc && idxDesc.set) {
          Object.defineProperty(sel, "selectedIndex", {
            set(i) {
              idxDesc.set.call(this, i);
              sync();
              syncMarks();
            },
            get() {
              return idxDesc.get.call(this);
            },
            configurable: true,
          });
        }
        const disDesc = Object.getOwnPropertyDescriptor(selProto, "disabled");
        if (disDesc && disDesc.set) {
          Object.defineProperty(sel, "disabled", {
            set(d) {
              disDesc.set.call(this, d);
              btn.disabled = !!d;
              rootEl.classList.toggle("is-disabled", !!d);
            },
            get() {
              return disDesc.get.call(this);
            },
            configurable: true,
          });
        }
      } catch (_) {}

      // Observe dynamic changes to option children and disabled attribute
      if (typeof MutationObserver !== "undefined") {
        const mo = new MutationObserver(() => {
          btn.disabled = !!sel.disabled;
          rootEl.classList.toggle("is-disabled", !!sel.disabled);
          rebuild();
        });
        mo.observe(sel, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ["disabled"] });
      }

      rootEl._ohnoClose = closePanel;
      sel._ohnoSync = rebuild;
      sel._ohnoRoot = rootEl;

      buildList();
      sync();
    });
  }

  // one delegated document click closes every open select (O(1) listeners,
  // bound once at module level; safe across repeated OHNO.init scans)
  on(d, "click", (e) => {
    $$(".select.is-open").forEach((w) => {
      if (!w.contains(e.target)) w._ohnoClose?.();
    });
  });

  /* ---------- code blocks <pre><code> -------------------------------- */
  function initCopyBlocks(root) {
    $$("pre.code, pre:has(> code)", root).forEach((pre) => {
      const code = $("code", pre);
      if (!code || pre._ohnoCode) return;
      pre._ohnoCode = true;
      const copy = E("button", "code-copy", { type: "button", $textContent: "Copy" }),
        lang = E("span", "code-lang", { $textContent: pre.dataset.lang || "code" });
      on(copy, "click", () => {
        navigator.clipboard.writeText(code.textContent).then(() => {
          copy.textContent = "Copied ✓";
          setTimeout(() => (copy.textContent = "Copy"), 1400);
        });
      });
      const bar = E("div", "code-bar", null, null);
      bar.append(lang, copy);
      pre.prepend(bar);
    });
  }

  /* ---------- tooltips [data-tip] ------------------------------------ */
  let tooltipsBound = false;
  function initTooltips() {
    if (tooltipsBound) return; // document-level listeners: bind once per page
    tooltipsBound = true;
    let tip = null, anchor = null, placeRaf = 0;

    const position = (el) => {
      const r = el.getBoundingClientRect(),
        t = tip.getBoundingClientRect();
      let pos = el.dataset.pos || "top";
      let x = 0, y = 0;

      if (pos === "right") {
        x = r.right + 8;
        y = r.top + (r.height - t.height) / 2;
        if (x + t.width + 8 > innerWidth) { x = r.left - t.width - 8; pos = "left"; }
      } else if (pos === "left") {
        x = r.left - t.width - 8;
        y = r.top + (r.height - t.height) / 2;
        if (x < 8) { x = r.right + 8; pos = "right"; }
      } else {
        if (pos === "top" && r.top - t.height - 8 < 0) pos = "bottom"; // auto-flip
        if (pos === "bottom" && r.bottom + t.height + 8 > innerHeight) pos = "top";
        x = r.left + (r.width - t.width) / 2;
        y = pos === "bottom" ? r.bottom + 8 : r.top - t.height - 8;
      }

      // Safe viewport boundary clamping
      x = Math.max(8, Math.min(x, innerWidth - t.width - 8));
      y = Math.max(8, Math.min(y, innerHeight - t.height - 8));

      tip.dataset.pos = pos;
      tip.style.left = Math.round(x) + "px";
      tip.style.top = Math.round(y) + "px";
      cancelAnimationFrame(placeRaf);
      placeRaf = requestAnimationFrame(() => {
        tip.classList.add("is-visible");
        if (anchor && tip.matches(":popover-open")) position(anchor);
      });
    };

    const show = (el) => {
      // A popover must share the top layer with its anchor: while a modal
      // <dialog> is open, a body-level tooltip cannot showPopover(). Create
      // the tooltip inside the open dialog when the anchor lives there.
      const host = el.closest("dialog") || d.body;
      if (!tip || tip.parentElement !== host) {
        if (tip) tip.remove();
        host.appendChild((tip = E("div", "tooltip", { role: "tooltip" })));
        if (typeof tip.showPopover === "function") {
          try { tip.popover = "manual"; } catch (_) {}
        }
      }
      tip.textContent = el.dataset.tip;
      anchor = el;
      if (typeof tip.showPopover === "function" && tip.popover === "manual" && !tip.matches(":popover-open")) {
        try { tip.showPopover(); } catch (_) {}
      }
      position(el);
    };

    const hide = () => {
      if (!tip) return;
      cancelAnimationFrame(placeRaf); // a late show-rAF would re-add is-visible
      tip.classList.remove("is-visible");
      if (typeof tip.hidePopover === "function" && tip.popover === "manual" && tip.matches(":popover-open")) {
        try { tip.hidePopover(); } catch (_) {}
      }
      anchor = null;
    };

    const getTipTarget = (target) => {
      if (!target || !target.closest) return null;
      const el = target.closest("[data-tip], [data-gf-tooltip], [title]");
      if (!el) return null;
      if (!el.dataset.tip && el.getAttribute("title")) {
        el.dataset.tip = el.getAttribute("title");
        el.removeAttribute("title");
      } else if (!el.dataset.tip && el.getAttribute("data-gf-tooltip")) {
        el.dataset.tip = el.getAttribute("data-gf-tooltip");
      }
      return el.dataset.tip ? el : null;
    };

    on(d, "pointerover", (e) => {
      const el = getTipTarget(e.target);
      if (el && el !== anchor) show(el);
    });
    on(d, "pointerout", (e) => {
      const el = getTipTarget(e.target);
      // don't hide when moving between children of the same anchor
      if (el && !(e.relatedTarget && el.contains(e.relatedTarget))) hide();
    });
    // keyboard a11y: show only for keyboard-driven focus
    on(d, "focusin", (e) => {
      const el = getTipTarget(e.target);
      if (el && el.matches(":focus-visible")) show(el);
    });
    on(d, "focusout", (e) => {
      const el = getTipTarget(e.target);
      if (el && !(e.relatedTarget && el.contains(e.relatedTarget))) hide();
    });
    // glue open tooltip to anchor on viewport changes; hide on scroll
    on(window, "resize", () => {
      if (anchor && tip && tip.matches(":popover-open")) {
        if (!anchor.isConnected) hide();
        else position(anchor);
      }
    });
    // dismiss on click/pointerdown, keyboard esc, scroll, or window blur
    on(d, "click", hide);
    on(d, "pointerdown", (e) => {
      const el = getTipTarget(e.target);
      if (el) hide();
    });
    on(window, "keydown", (e) => { if (e.key === "Escape") hide(); });
    on(window, "blur", hide);
    on(d, "scroll", hide, true);
  }

  /* ---------- modals & dialogs --------------------------------------- *
   * Triggers [data-modal-open="#id"] / [data-modal-close]; backdrop
   * click closes (::backdrop clicks report the <dialog> itself). */
  function initModals(root) {
    $$("[data-modal-open]", root).forEach((btn) => {
      if (btn._ohnoOpen) return;
      btn._ohnoOpen = true;
      on(btn, "click", () => openModal(btn.dataset.modalOpen));
    });
    $$("[data-modal-close]", root).forEach((btn) => {
      if (btn._ohnoClose) return;
      btn._ohnoClose = true;
      on(btn, "click", () => closeModal(btn.closest("dialog")));
    });
    $$("dialog.modal, dialog.palette", root).forEach((dlg) => {
      if (dlg._ohnoDismiss) return;
      dlg._ohnoDismiss = true;
      on(dlg, "click", (e) => { if (e.target === dlg) closeModal(dlg); });
    });
  }

  function openModal(selector, opts) {
    const dlg = resolveDialog(selector);
    if (!dlg) return;
    // llm.txt contract: openModal(sel, { title }) — accessible title via
    // aria-label; an <h2 class=dialog-title> is injected when the dialog lacks one.
    const title = opts && opts.title;
    if (title) {
      dlg.setAttribute("aria-label", title);
      if (!$(".dialog-title", dlg)) {
        const h = E("h2", "dialog-title", { $textContent: title }, dlg);
        h.id = "ohno-title-" + (dlg.id || Math.random().toString(36).slice(2, 8));
        dlg.setAttribute("aria-labelledby", h.id);
      }
    }
    activeModal = dlg;
    showDialog(dlg);
  }

  function closeModal(selector) {
    // llm.txt: closes the current modal when called with no argument.
    const dlg = selector ? resolveDialog(selector) : activeModal;
    if (dlg) hideDialog(dlg);
  }

  /* "#id" | <dialog> | legacy .modal-backdrop / .palette-backdrop */
  function resolveDialog(sel) {
    if (typeof sel === "string") sel = $(sel);
    if (!sel) return null;
    if (sel.tagName === "DIALOG") return sel;
    return $("dialog", sel) || null; // legacy wrapper: open dialog inside
  }

  /* ---------- command palette (⌘K) ------------------------------------ */
  function initPalette() {
    const palette = $("dialog.palette") || $(".palette-backdrop > .palette");
    if (!palette || palette._ohnoPalette) return;
    if (palette.hasAttribute("data-palette-managed")) return;
    palette._ohnoPalette = true;
    const input = $(".palette-input", palette),
      list = $(".palette-list", palette);
    if (!input || !list) return;

    const open = () => { input.value = ""; filter(""); showDialog(palette); };
    const close = () => hideDialog(palette);
    palette._ohnoOpenPalette = open; // hook reused by the notch search button

    const items = $$(".palette-item", list).map((el) => {
      el._ohnoText = el.textContent.toLowerCase();
      return el;
    }), // cache once; stable list
      empty = $(".palette-empty", palette);

    function filter(q) {
      q = q.toLowerCase().trim();
      let lastSec = null, secHas = false;
      const vis = [];
      for (const item of items) {
        const hit = q === "" || item._ohnoText.includes(q);
        item.classList.toggle("is-hidden", !hit);
        if (hit) vis.push(item);
        // section header hides when its first following item is hidden
        const sec = item.previousElementSibling;
        if (sec && sec.classList.contains("palette-section")) {
          if (lastSec !== sec) { if (lastSec) lastSec.classList.toggle("is-hidden", !secHas); lastSec = sec; secHas = false; }
          if (hit) secHas = true;
        }
      }
      if (lastSec) lastSec.classList.toggle("is-hidden", !secHas);
      vis.forEach((v, i) => v.classList.toggle("is-selected", i === 0));
      if (empty) empty.hidden = vis.length > 0;
    }

    function move(dir) {
      const vis = items.filter((v) => !v.classList.contains("is-hidden"));
      if (!vis.length) return;
      const idx = vis.indexOf(list.querySelector(".palette-item.is-selected"));
      const next = Math.min(Math.max(idx + dir, 0), vis.length - 1);
      vis.forEach((v) => v.classList.remove("is-selected"));
      vis[next].classList.add("is-selected");
      vis[next].scrollIntoView({ block: "nearest" });
    }

    on(input, "input", () => filter(input.value));
    on(input, "keydown", (e) => {
      if (e.key === "ArrowDown") { e.preventDefault(); move(1); }
      else if (e.key === "ArrowUp") { e.preventDefault(); move(-1); }
      else if (e.key === "Enter") {
        const sel = list.querySelector(".palette-item.is-selected:not(.is-hidden)");
        if (sel) sel.click();
      }
    });
    on(list, "click", (e) => {
      const item = e.target.closest(".palette-item");
      if (!item) return;
      const action = item.dataset.action;
      if (action === "theme") { theme.toggle(); close(); }
      else if (action === "palette") { theme.setPalette(item.dataset.value); close(); }
      else if ($("a[href]", item)) close();
    });
    on(d, "keydown", (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        palette.open ? close() : open();
      }
    });
  }

  /* ---------- popovers [popover] --------------------------------------- *
   * Native light-dismiss + Esc. JS only syncs position from the trigger
   * rect — the top layer's containing block is the viewport. */
  function initPopovers(root) {
    const placeFor = (pop, clamp) => {
      const trigger = $(`[popovertarget="${pop.id}"]`, d);
      if (!trigger) return;
      const r = trigger.getBoundingClientRect(),
        pos = trigger.dataset.pos || pop.dataset.pos || "bottom",
        m = 6,
        w = Math.min(pop.offsetWidth || 260, 320);
      let left = clamp ? Math.min(Math.max(m, r.left), Math.max(m, innerWidth - w - m)) : r.left;
      let top;
      if (pos === "bottom") top = r.bottom + m;
      else top = r.top - (pop.offsetHeight || 160) - m;
      if (clamp) top = Math.max(m, Math.min(top, innerHeight - (pop.offsetHeight || 160) - m));
      pop.style.left = Math.round(left) + "px";
      pop.style.top = Math.round(top) + "px";
      pop.dataset.pos = pos;
    };

    $$(".popover[popover]", root).forEach((pop) => {
      if (pop._ohnoPop) return;
      pop._ohnoPop = true;
      if (!($(`[popovertarget="${pop.id}"]`, d))) return;

      on(pop, "toggle", (e) => {
        if (e.newState === "open") {
          // Place synchronously: layout is already computed by the time the
          // toggle event fires, so geometry reads are valid. The rAF pass
          // re-checks after fonts/transitions settle (harmless double-place).
          placeFor(pop, true);
          requestAnimationFrame(() => placeFor(pop, true));
        }
      });
    });
    // one delegated capture listener re-anchors every open popover (O(1) listeners);
    // a popover that has never been placed has no dataset.pos yet — skip it.
    // Unclamped here: the popover follows its trigger exactly and leaves the
    // viewport with it, instead of being pinned to the edge as an orphan box.
    on(d, "scroll", () => {
      $$(".popover[popover]:popover-open", d).forEach((pop) => {
        if (pop.dataset.pos) placeFor(pop);
      });
    }, { passive: true, capture: true });
  }

  /* ---------- toasts — OHNO.toast(message, type?, opts?) --------------- */
  let toastBox = null;

  const toast = (message, type = "info", opts = {}) => {
    if (!toastBox) toastBox = E("div", "toast-container", null, d.body);
    const icons = { success: "✓", error: "✕", warning: "!", info: "i" },
      el = E("div", `toast toast-${type}`, { role: "status" }, toastBox);
    E("span", "toast-icon", { $textContent: icons[type] || icons.info }, el);
    E("span", "grow", { $textContent: message }, el); // never interpolate caller text as HTML (XSS)
    const close = E("span", "toast-close", { $textContent: "✕" }, el);
    const remove = () => {
      el.classList.add("is-hiding");
      setTimeout(() => el.remove(), 160);
    };
    on(close, "click", remove);
    if (opts.duration !== 0) setTimeout(remove, opts.duration || 3500);
    return el;
  };

  /* ---------- notch (<html data-notch>) ---------------------------------- *
   * Opt-in top-center quick bar: home link · appearance popover (theme,
   * palette, contrast, density) · ⌘K search (opens the command palette).
   * Extensible: <template data-notch-items> is cloned into the bar, and
   * OHNO.notch.add({label, icon, href | action}) appends at runtime. */
  function initNotch() {
    if (!ROOT.hasAttribute("data-notch") || ROOT._ohnoNotch) return;
    ROOT._ohnoNotch = true;

    const nav = E("nav", "ohno-notch", { "aria-label": "Quick controls" }, d.body);
    const home = E("a", null, { href: ROOT.getAttribute("data-notch-home") || "/", "aria-label": "Home" }, nav);
    home.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 10.5 12 3l9 7.5"/><path d="M5 9.5V21h14V9.5"/></svg>';
    E("span", "notch-sep", null, nav);

    // Appearance popover in a sibling wrap: the pill's backdrop-filter would
    // otherwise become the containing block for the popover's position:fixed
    // and break initPopovers placement (see .notch-pop-wrap in components.css).
    const wrap = E("div", "notch-pop-wrap", null, d.body),
      pop = E("div", "popover ohno-notch-pop", { id: "ohno-notch-pop", popover: "auto" }, wrap),
      col = E("div", "col", { style: "gap:10px" }, pop);
    E("div", "title", { style: "font-size:13px" }, col).textContent = "Appearance";
    const rowTheme = E("div", "row", { style: "gap:6px" }, col);
    THEMES.forEach((th) =>
      (E("button", "btn btn-sm", { type: "button", "data-action": "theme-set", "data-value": th }, rowTheme)).textContent =
        THEME_LABELS[th] || th);
    E("div", "caption", { style: "margin:8px 0 6px" }, col).textContent = "Accent";
    const rowPal = E("div", "row", { style: "gap:6px" }, col);
    PALETTES.forEach((p) =>
      E("button", "swatch", { type: "button", "data-action": "palette", "data-set-palette": p, "data-value": p, "aria-label": p, "data-tip": p }, rowPal));
    E("div", "caption", { style: "margin:8px 0 6px" }, col).textContent = "Contrast";
    const rowCon = E("div", "row", { style: "gap:6px" }, col);
    CONTRASTS.forEach((c) =>
      (E("button", "btn btn-sm", { type: "button", "data-action": "contrast", "data-value": c }, rowCon)).textContent = c[0].toUpperCase() + c.slice(1));
    E("div", "caption", { style: "margin:8px 0 6px" }, col).textContent = "Density";
    const rowDen = E("div", "row", { style: "gap:6px" }, col);
    DENSITIES.forEach((dn) =>
      (E("button", "btn btn-sm", { type: "button", "data-action": "density", "data-value": dn }, rowDen)).textContent = dn[0].toUpperCase() + dn.slice(1));

    const themeBtn = E("button", "notch-btn", { type: "button", popovertarget: "ohno-notch-pop", "data-pos": "bottom", "aria-label": "Appearance", "aria-haspopup": "menu" }, nav);
    themeBtn.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 3a9 9 0 0 1 0 18z" fill="currentColor" stroke="none"/></svg>';

    // Search — opens the command palette when the page ships one.
    if ($("dialog.palette") || $(".palette-backdrop > .palette")) {
      E("span", "notch-sep", null, nav);
      const searchBtn = E("button", "notch-btn", { type: "button", "data-action": "notch-search", "aria-label": "Search — command palette" }, nav);
      searchBtn.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>';
      on(searchBtn, "click", () => {
        const p = $("dialog.palette") || $(".palette-backdrop > .palette");
        if (p) p._ohnoOpenPalette ? p._ohnoOpenPalette() : openModal(p);
      });
    }

    // Author-declared extra items (kept & styled by .ohno-notch rules)
    const tpl = $("template[data-notch-items]");
    if (tpl) nav.append(tpl.content.cloneNode(true));

    // Mirror live theme state onto the popover controls (is-active/is-selected)
    const sync = () => {
      $$("[data-action]", pop).forEach((b) => {
        const cur = b.dataset.action === "palette" ? theme.getPalette()
          : b.dataset.action === "contrast" ? theme.getContrast()
          : b.dataset.action === "density" ? theme.getDensity()
          : b.dataset.action === "theme-set" ? theme.get() : null;
        if (cur) b.classList.toggle("is-active", b.dataset.value === cur);
      });
    };
    sync();
    on(d, "ohno:themechange", sync);
    on(pop, "click", () => pop.hidePopover()); // menu closes after any pick

    OHNO.notch = {
      el: nav,
      add(item) {
        if (!item) return null;
        const label = item.label || item.title || "",
          el = item.href
            ? E("a", "notch-btn", { href: item.href, "aria-label": label }, nav)
            : E("button", "notch-btn", { type: "button", "aria-label": label }, nav);
        if (item.title) el.setAttribute("data-tip", item.title);
        if (item.icon) el.innerHTML = item.icon; // trusted app-provided markup
        else if (item.label) el.textContent = item.label;
        if (typeof item.action === "string") el.setAttribute("data-action", item.action);
        if (typeof item.action === "function") on(el, "click", (e) => item.action(e, el));
        return el;
      },
    };
  }

  /* ---------- tabs [data-tabs] ------------------------------------------ */
  function initTabs(root) {
    $$("[data-tabs]", root).forEach((group) => {
      if (group._ohnoTabs) return;
      group._ohnoTabs = true;
      const tabs = $$(".tab", group);
      tabs.forEach((tab) => on(tab, "click", () => {
        tabs.forEach((t) => t.classList.remove("is-active"));
        tab.classList.add("is-active");
        const scopeVal = group.dataset.tabsScope,
          scope = scopeVal ? ($(scopeVal) || d) : group.parentElement;
        $$("[data-panel]", scope).forEach((p) => {
          p.hidden = p.dataset.panel !== tab.dataset.tab;
        });
        D(group, "ohno:change", { tab: tab.dataset.tab });
      }));
    });
  }

  /* ---------- sidebar / mobile drawer ------------------------------------ *
   * Desktop [data-sidebar-toggle="#id"] toggles .is-collapsed.
   * Mobile [data-drawer="#id"] toggles .is-open + .mobile-backdrop.is-open;
   * closes on scrim click, nav navigation, Esc, or resize ≥768px. */
  function initSidebar() {
    $$("[data-sidebar-toggle]").forEach((btn) => {
      if (btn._ohnoToggle) return;
      btn._ohnoToggle = true;
      on(btn, "click", () => {
        const sb = $(btn.dataset.sidebarToggle || ".sidebar");
        if (sb) sb.classList.toggle("is-collapsed");
      });
    });

    // Multiple drawers are supported. Point a trigger at one with
    // data-drawer="#sidebar-id"; a bare data-drawer keeps the original
    // first-sidebar behavior. A drawer or trigger may opt into a matching
    // scrim with data-drawer-backdrop="#scrim-id".
    const syncLock = () => ROOT.classList.toggle("drawer-lock", !!$(".sidebar.is-open"));
    $$("[data-drawer]").forEach((btn) => {
      if (btn._ohnoDrawerTrigger) return;
      const drawer = $(btn.dataset.drawer || ".sidebar");
      if (!drawer) return;
      const backdrop = $(btn.dataset.drawerBackdrop || drawer.dataset.drawerBackdrop || ".mobile-backdrop");
      btn._ohnoDrawerTrigger = true;

      const setDrawer = (state) => {
        drawer.classList.toggle("is-open", state);
        drawer.classList.toggle("is-collapsed", false);
        if (backdrop) backdrop.classList.toggle("is-open", state);
        syncLock();
      };
      on(btn, "click", () => setDrawer(!drawer.classList.contains("is-open")));

      // Bind shared per-drawer lifecycle once. Multiple triggers may target it.
      if (drawer._ohnoDrawer) return;
      drawer._ohnoDrawer = true;
      if (backdrop) on(backdrop, "click", () => setDrawer(false));
      on(d, "keydown", (e) => {
        if (e.key === "Escape" && drawer.classList.contains("is-open")) setDrawer(false);
      });
      on(drawer, "click", (e) => {
        if (e.target.closest(".nav-item")) setDrawer(false); // nav closes drawer
      });
      on(window, "resize", () => {
        if (innerWidth >= 768 && drawer.classList.contains("is-open")) setDrawer(false);
      });
    });
  }

  /* ---------- tables: sort th[data-sort] + [data-table-filter] ------------ */
  function initTables(root) {
    $$("table", root).forEach((table) => {
      if (table._ohnoTable) return;
      table._ohnoTable = true;
      const tbody = $("tbody", table);
      if (!tbody) return;

      $$("th[data-sort]", table).forEach((th) => {
        th.setAttribute("data-dir", "desc");
        on(th, "click", () => {
          const col = Array.from(th.parentElement.children).indexOf(th),
            asc = th.getAttribute("data-dir") === "asc";
          $$("th[data-sort]", table).forEach((h) => {
            h.classList.remove("is-sorted");
            if (h !== th) h.setAttribute("data-dir", "desc");
          });
          th.classList.add("is-sorted");
          th.setAttribute("data-dir", asc ? "desc" : "asc");
          const rows = $$("tbody tr", table).filter((r) => !r.classList.contains("table-empty-row"));
          rows.sort((a, b) => {
            const av = (a.children[col]?.dataset.sortValue ?? a.children[col]?.textContent ?? "").trim(),
              bv = (b.children[col]?.dataset.sortValue ?? b.children[col]?.textContent ?? "").trim(),
              an = parseFloat(av), bn = parseFloat(bv),
              cmp = (!isNaN(an) && !isNaN(bn)) ? an - bn : av.localeCompare(bv);
            return asc ? -cmp : cmp;
          });
          rows.forEach((r) => tbody.append(r));
          const emptyRow = $(".table-empty-row", table);
          if (emptyRow) tbody.append(emptyRow); // keep hidden "no results" row last
        });
      });
    });

    $$("[data-table-filter]", root).forEach((input) => {
      if (input._ohnoFilter) return;
      input._ohnoFilter = true;
      const table = $(input.dataset.tableFilter);
      if (!table) return;
      // Row list + text are cached: per-keystroke cost is a cheap includes()
      // over a prebuilt array (no querySelectorAll in the hot path). The list
      // is rebuilt lazily when rows are added/removed (_ohnoLen guard).
      let rows = null;
      const getRows = () =>
        $$("tbody tr", table).filter((r) => !r.classList.contains("table-empty-row"));
      on(input, "input", () => {
        const q = input.value.toLowerCase().trim();
        if (!rows || rows.some((r) => r._ohnoLen !== r.childNodes.length)) rows = getRows();
        let any = false;
        rows.forEach((r) => {
          if (r._ohnoText === undefined || r._ohnoLen !== r.childNodes.length) {
            r._ohnoText = r.textContent.toLowerCase();
            r._ohnoLen = r.childNodes.length;
          }
          const hit = !q || r._ohnoText.includes(q);
          r.hidden = !hit;
          if (hit) any = true;
        });
        const empty = $(".table-empty-row", table);
        if (empty) empty.hidden = any;
      });
    });
  }

  /* ---------- loading state ------------------------------------------------ */
  function loading(el, onState) {
    if (!el) return;
    el.classList.toggle("is-loading", onState);
    onState ? el.setAttribute("aria-busy", "true") : el.removeAttribute("aria-busy");
    if (el.tagName === "BUTTON") el.disabled = !!onState;
  }

  /* ---------- declarative actions [data-action] ---------------------- *
   * Framework-level actions wired via one delegated click listener:
   *   data-action="theme-toggle"            → OHNO.theme.toggle() (face flip)
   *   data-action="theme-set" data-value="term" → OHNO.theme.set()
   *   data-action="look-set" data-value="light" → OHNO.theme.setLook()
   *   data-action="palette" data-value="ember"   → OHNO.theme.setPalette()
   *   data-action="contrast" data-value="high"   → OHNO.theme.setContrast()
   *   data-action="density" data-value="dense"   → OHNO.theme.setDensity()
   *   data-action="toast" data-toast="msg" data-type="success" → OHNO.toast()
   * Custom app actions (data-action="custom-name") are untouched and can
   * be wired by app code. */
  function initActions() {
    on(d, "click", (e) => {
      const el = e.target.closest("[data-action]");
      if (!el) return;
      const val = el.dataset.value;
      switch (el.dataset.action) {
        case "theme-toggle": theme.toggle(); break;
        case "theme-set": if (val) theme.set(val); break;
        case "look-set": if (val) theme.setLook(val); break;
        case "palette": if (val) theme.setPalette(val); break;
        case "contrast": if (val) theme.setContrast(val); break;
        case "density": if (val) theme.setDensity(val); break;
        case "toast":
          toast(
            el.dataset.toast || el.getAttribute("aria-label") || "Done",
            el.dataset.type || "info"
          );
          break;
      }
    });
  }

  /* ---------- fonts (opt-in, no network) ------------------------------ *
   * The kit never loads fonts. You add the Google Fonts <link>, we wire
   * the tokens. OHNO.fonts.set({ ui, mono }) sets --o-font / --o-mono,
   * persists, fires "ohno:themechange". OHNO.fonts.reset() restores
   * whatever the active theme defines. */
  const FONT_KEY = "ohno-font";
  const fonts = {
    set(map) {
      if (!map || (!map.ui && !map.mono)) return false;
      const cur = this.get();
      const next = { ui: map.ui || cur.ui, mono: map.mono || cur.mono };
      if (next.ui) ROOT.style.setProperty("--o-font", next.ui);
      else ROOT.style.removeProperty("--o-font");
      if (next.mono) ROOT.style.setProperty("--o-mono", next.mono);
      else ROOT.style.removeProperty("--o-mono");
      try { localStorage.setItem(FONT_KEY, JSON.stringify(next)); } catch (_) {}
      emitTheme();
      return true;
    },
    reset() {
      ROOT.style.removeProperty("--o-font");
      ROOT.style.removeProperty("--o-mono");
      try { localStorage.removeItem(FONT_KEY); } catch (_) {}
      emitTheme();
    },
    get() {
      try { return JSON.parse(localStorage.getItem(FONT_KEY)) || {}; }
      catch (_) { return {}; }
    },
  };

  /* ---------- init & public API --------------------------------------------- */
  function init(root) {
    const r = root || d;
    initDropdowns(r);
    initSelects(r);
    initModals(r);
    initPalette();
    initNotch();
    initPopovers(r);
    initTabs(r);
    initSidebar();
    initCopyBlocks(r);
    initTooltips();
    initTables(r);
    initActions();
    const f = fonts.get();
    if (f.ui || f.mono) fonts.set(f); // restore persisted font choices
  }

  /* OHNO.scan(root) = progressive re-scan for SPA/htmx swaps; document-level
     things (palette keybind, theme, tooltip wiring) stay single-init.
     Idempotent via _ohno* guards on instances + delegated document listeners. */
  const OHNO = { toast, theme, fonts, openModal, closeModal, loading, notch: null, init: init, scan: init };

  if (d.readyState === "loading") on(d, "DOMContentLoaded", () => init());
  else init();

  window.OHNO = OHNO;
})();
