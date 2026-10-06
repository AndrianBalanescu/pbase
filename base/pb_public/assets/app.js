// baseStarter frontend — Vue 3 (global build) + PocketBase JS SDK + ohno.
// No bundler, no node_modules. Edit and refresh.
//
// ohno is a *classless-first* kit: markup gets most of its look for free, and
// ohno's runtime (delegated listeners) handles modals (`data-modal-open`),
// dropdowns, tabs, table sort/filter, and the ⌘K palette. Vue only owns data,
// binding and the few app-specific handlers.

const { createApp, ref, reactive, computed, onMounted, nextTick } = Vue;

// Read optional config through globalThis: a bare `PB_URL_OVERRIDE` reference
// throws ReferenceError when unset and would abort setup().
const baseUrl = globalThis.PB_URL_OVERRIDE || location.origin;

const app = createApp({
  setup() {
    const pb = new PocketBase(baseUrl);
    pb.autoCancellation(false); // don't abort concurrent reads in a reactive UI

    const appName = ref("baseStarter");
    const tab = ref("overview");
    const drawerOpen = ref(false);

    const posts = ref([]);
    const activity = ref([]);
    const stats = reactive({ posts: { total: 0, published: 0 }, users: 0, comments: 0 });
    const schema = ref([]);
    const routes = ref([]);

    const user = ref(pb.authStore.record);
    const loading = ref(true);
    const schemaLoading = ref(false);
    const busy = ref(false);
    const error = ref("");
    const live = ref(false); // realtime connection state

    const form = reactive({ identity: "demo@local.local", password: "demo12345678" });
    const newPost = reactive({ title: "", status: "published", body: "" });
    const current = ref(null);

    // ── helpers ────────────────────────────────────────────────────────────
    function timeAgo(value) {
      if (!value) return "";
      // PocketBase stores "YYYY-MM-DD HH:MM:SS.sssZ" (space, not "T").
      const t = new Date(String(value).replace(" ", "T")).getTime();
      if (isNaN(t)) return String(value);
      const s = Math.floor((Date.now() - t) / 1000);
      if (s < 60) return "just now";
      const m = Math.floor(s / 60);
      if (m < 60) return m + "m ago";
      const h = Math.floor(m / 60);
      if (h < 24) return h + "h ago";
      const d = Math.floor(h / 24);
      if (d < 30) return d + "d ago";
      return new Date(t).toISOString().slice(0, 10);
    }
    const badgeFor = (status) =>
      status === "published" ? "badge-success"
      : status === "archived" ? "badge-danger"
      : "badge-warning";
    const methodBadge = (m) =>
      m === "GET" ? "badge-info"
      : m === "POST" ? "badge-success"
      : m === "DELETE" ? "badge-danger"
      : "badge-warning";
    const ruleBadge = (exposure) =>
      exposure === "public" ? "badge-warning"
      : exposure === "superuser" ? "badge-danger"
      : "badge-success";

    async function toast(message, type) {
      if (window.OHNO) OHNO.toast(message, type || "info");
    }

    // ── data loading ───────────────────────────────────────────────────────
    async function loadPosts() {
      try {
        // No client-side filter: the collection's listRule already scopes what
        // this caller may see. ⚠️ `@request.*` in the `filter` param is
        // rejected with 403 for every non-superuser — let the rule do it.
        posts.value = await pb.collection("posts").getFullList({ sort: "-created" });
      } catch (err) {
        error.value = err?.message || String(err);
      }
    }

    async function loadStats() {
      try {
        const s = await (await fetch("/api/stats")).json();
        Object.assign(stats, s);
        stats.posts = s.posts || { total: 0, published: 0 };
      } catch (err) {
        error.value = err?.message || String(err);
      }
    }

    async function loadActivity() {
      try {
        const a = await (await fetch("/api/activity?limit=8")).json();
        activity.value = a.items || [];
      } catch (err) {
        error.value = err?.message || String(err);
      }
    }

    async function loadAll() {
      loading.value = true;
      error.value = "";
      await Promise.all([loadPosts(), loadStats(), loadActivity()]);
      loading.value = false;
    }

    async function loadSchema() {
      schemaLoading.value = true;
      try {
        const r = await fetch("/api/schema");
        if (!r.ok) throw new Error("GET /api/schema → " + r.status);
        const data = await r.json();
        appName.value = data.appName || appName.value;
        schema.value = data.collections || [];
      } catch (err) {
        error.value = err?.message || String(err);
      } finally {
        schemaLoading.value = false;
      }
      // New markup needs a re-scan only for components with internal state;
      // data-sort / data-table-filter are delegated, so tables work already.
      nextTick(() => window.OHNO && OHNO.scan(document.body));
    }

    async function loadRoutes() {
      try {
        const spec = await (await fetch("/openapi.json")).json();
        const paths = spec.paths || {};
        // Custom routes (documented in lib/api.js) — skip built-in collection paths.
        routes.value = Object.keys(paths)
          .filter((p) => !p.startsWith("/api/collections/"))
          .flatMap((p) => Object.keys(paths[p]).map((m) => ({ method: m.toUpperCase(), path: p })))
          .sort((a, b) => a.path.localeCompare(b.path));
      } catch (err) {
        error.value = err?.message || String(err);
      }
    }

    // Collection paths, derived from the live schema (drift-proof).
    const collectionRoutes = computed(() =>
      schema.value.flatMap((c) => [
        { method: "GET", path: "/api/collections/" + c.name + "/records" },
        { method: "POST", path: "/api/collections/" + c.name + "/records" },
        { method: "GET", path: "/api/collections/" + c.name + "/records/{id}" },
        { method: "PATCH", path: "/api/collections/" + c.name + "/records/{id}" },
        { method: "DELETE", path: "/api/collections/" + c.name + "/records/{id}" },
      ])
    );

    // ── auth ───────────────────────────────────────────────────────────────
    async function login() {
      busy.value = true;
      error.value = "";
      try {
        await pb.collection("users").authWithPassword(form.identity, form.password);
        user.value = pb.authStore.record;
        if (window.OHNO) OHNO.closeModal();
        toast("Signed in as " + (user.value.name || user.value.email), "success");
        await loadAll();
      } catch (err) {
        error.value = err?.message || String(err);
      } finally {
        busy.value = false;
      }
    }

    function logout() {
      pb.authStore.clear();
      user.value = null;
      toast("Signed out");
      loadAll();
    }

    // ── posts ──────────────────────────────────────────────────────────────
    function openNewPost() {
      newPost.title = "";
      newPost.status = "published";
      newPost.body = "";
      if (window.OHNO) OHNO.openModal("#post");
    }

    async function createPost() {
      busy.value = true;
      error.value = "";
      try {
        await pb.collection("posts").create({
          title: newPost.title,
          status: newPost.status,
          body: newPost.body,
          author: user.value?.id, // required relation
        });
        if (window.OHNO) OHNO.closeModal();
        toast("Post created", "success");
        await loadAll(); // realtime also fires, but this avoids a visible lag
      } catch (err) {
        error.value = err?.message || String(err);
      } finally {
        busy.value = false;
      }
    }

    function view(post) {
      current.value = post;
      if (window.OHNO) OHNO.openModal("#view");
    }

    // ── navigation & chrome ────────────────────────────────────────────────
    function go(next) {
      tab.value = next;
      drawerOpen.value = false;
      // Sync the ohno tab group so its `:is-active` styling follows the sidebar.
      nextTick(() => {
        document.querySelectorAll(".tabs .tab").forEach((t) => {
          t.classList.toggle("is-active", t.dataset.tab === next);
        });
        document.querySelectorAll("[data-panel]").forEach((p) => {
          p.hidden = p.dataset.panel !== next;
        });
      });
    }

    // ── realtime ───────────────────────────────────────────────────────────
    // Only base/auth collections emit realtime; a change anywhere refreshes the
    // dashboard. The connection state drives the status badge.
    function initRealtime() {
      pb.realtime.subscribe("PB_CONNECT", () => { live.value = true; });
      pb.realtime.onDisconnect = () => { live.value = false; };
      pb.collection("posts").subscribe("*", () => { loadAll(); }).catch(() => {});
      pb.collection("comments").subscribe("*", () => { loadAll(); }).catch(() => {});
    }

    onMounted(async () => {
      try {
        const health = await (await fetch("/healthz")).json();
        appName.value = health.service || appName.value;
      } catch (_) { /* non-fatal */ }
      await loadAll();
      await loadSchema();
      await loadRoutes();
      initRealtime();
    });

    return {
      baseUrl, appName, tab, drawerOpen,
      posts, activity, stats, schema, routes, collectionRoutes,
      user, loading, schemaLoading, busy, error, live,
      form, newPost, current,
      timeAgo, badgeFor, methodBadge, ruleBadge,
      loadAll, loadSchema, login, logout, openNewPost, createPost, view, go,
    };
  },
});

app.mount("#app");
