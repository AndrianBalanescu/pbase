// base/pb_hooks/lib/openapi.js — LIVE OpenAPI 3.1 spec generator.
//
// ── WHY ─────────────────────────────────────────────────────────────────────
// A hand-written openapi.json drifts the moment a field or route changes. This
// module builds the spec from ground truth at request time:
//   • collections/fields  → read from the running app (`$app.findAllCollections()`)
//   • custom routes       → read from base/pb_hooks/lib/api.js (the same table that
//                           registers the handlers, so docs and behaviour cannot
//                           disagree)
//
// ── THE ONE NON-OBVIOUS TECHNIQUE ───────────────────────────────────────────
// Read a collection's canonical JSON with:
//
//     JSON.parse(toString(collection.marshalJSON()))
//
// `marshalJSON()` returns a **byte array** (Go []byte); the global `toString()`
// decodes it to a string. Do NOT read field metadata off the live object —
// `field.type` and `field.columnType` are **bound Go methods**, not strings
// (`typeof f.type === "function"`; call `f.type()`), and they are not
// JSON-serializable, so putting them in a response body makes `e.json()` emit a
// TRUNCATED payload. `marshalJSON()` has the flat, safe shape.
//
// ⚠️ Goja, not Node: no `fs`/`fetch`. Everything is derived from `$app`.
//
// This module is STATELESS — pure functions of the app + a route table.

// ── schema helpers ──────────────────────────────────────────────────────────

/** `posts` → `Posts` (a valid OpenAPI component key). */
function componentName(collectionName) {
  const parts = String(collectionName).split(/[^a-zA-Z0-9]+/).filter(Boolean)
  let out = ""
  for (var i = 0; i < parts.length; i++) {
    out += parts[i].charAt(0).toUpperCase() + parts[i].slice(1)
  }
  return (out || "Collection").replace(/^[^a-zA-Z_]/, "_$&")
}

/** Canonical, serializable JSON for one collection. */
function collectionJSON(c) {
  return JSON.parse(toString(c.marshalJSON()))
}

/** OpenAPI schema for a single field. */
function fieldSchema(f, refFor) {
  switch (f.type) {
    case "text": {
      const s = { type: "string" }
      if (f.min) s.minLength = f.min
      if (f.max) s.maxLength = f.max
      if (f.pattern) s.pattern = f.pattern
      return s
    }
    case "editor":
      return { type: "string", description: "HTML" }
    case "email":
      return { type: "string", format: "email" }
    case "url":
      return { type: "string", format: "uri" }
    case "password":
      return { type: "string", format: "password", writeOnly: true }
    case "bool":
      return { type: "boolean" }
    case "number": {
      const s = { type: "number" }
      if (typeof f.min === "number" && f.min !== 0) s.minimum = f.min
      if (typeof f.max === "number" && f.max !== 0) s.maximum = f.max
      return s
    }
    case "date":
      return { type: "string", format: "date-time", description: "YYYY-MM-DD HH:MM:SS.sssZ" }
    case "autodate":
      return { type: "string", format: "date-time", readOnly: true }
    case "select": {
      const values = f.values || []
      if (f.maxSelect === 1) return { type: "string", enum: values }
      return { type: "array", items: { type: "string", enum: values } }
    }
    case "file": {
      // A filename (or array of names) as returned by the record; uploads are
      // multipart/form-data against the same endpoint.
      const one = !f.maxSelect || f.maxSelect === 1
      const s = { type: "string", description: "uploaded file name" }
      return one ? s : { type: "array", items: s }
    }
    case "relation": {
      const ref = refFor[f.collectionId] || "?"
      const one = f.maxSelect === 1
      return one
        ? { type: "string", description: "id of " + ref }
        : { type: "array", items: { type: "string" }, description: "ids of " + ref }
    }
    case "geoPoint":
      return { type: "object", properties: { lon: { type: "number" }, lat: { type: "number" } } }
    case "json":
    default:
      return {} // any JSON value
  }
}

/** The record object schema for one collection. */
function recordSchema(cj, refFor) {
  const props = {}
  const required = []

  for (var i = 0; i < cj.fields.length; i++) {
    const f = cj.fields[i]
    props[f.name] = fieldSchema(f, refFor)
    // Only user-authored required fields go in `required`: autodate/system
    // fields are server-managed and must never be demanded from the client.
    if (f.required && !f.system && f.type !== "autodate") required.push(f.name)
  }

  // Response-only envelope fields every PocketBase record carries. These exist
  // on the wire but are not part of the collection's field list.
  props.collectionId = { type: "string", readOnly: true }
  props.collectionName = { type: "string", readOnly: true }
  props.expand = { type: "object", additionalProperties: true, readOnly: true }

  const schema = { type: "object", properties: props }
  if (required.length) schema.required = required
  return schema
}

/** `{ items, page, perPage, totalItems, totalPages }`. */
function listSchema(ref) {
  return {
    type: "object",
    properties: {
      page: { type: "integer" },
      perPage: { type: "integer" },
      totalItems: { type: "integer", description: "-1 when ?skipTotal=1" },
      totalPages: { type: "integer", description: "-1 when ?skipTotal=1" },
      items: { type: "array", items: { $ref: ref } },
    },
  }
}

// ── security from API rules ─────────────────────────────────────────────────

/**
 * Translate a collection rule into OpenAPI `security` + a human note.
 *   null     → superuser-only
 *   ""       → public (rule disabled)
 *   "expr"   → any caller, but rows are filtered by the rule
 */
function ruleInfo(rule) {
  if (rule === null || rule === undefined) {
    return { security: [], note: "**Superuser only** (`rule = null`).", public: false, superuser: true }
  }
  if (rule === "") {
    return { security: [], note: "**Public** — rule disabled (`\"\"`).", public: true, superuser: false }
  }
  return {
    security: [{ bearerAuth: [] }, {}], // token optional: guests get the filtered subset
    note: "Allowed for any caller; rows filtered by `" + rule + "`.",
    public: false,
    superuser: false,
  }
}

function errorResponses() {
  return {
    400: { description: "Validation / bad request" },
    403: { description: "Forbidden" },
    404: { description: "Not found (also returned when a rule hides the record)" },
  }
}

// ── the generator ───────────────────────────────────────────────────────────

/**
 * @param {object} app       the `$app` instance
 * @param {Array}  routes    the route table from lib/api.js
 * @param {object} opts      { title, version, serverUrl }
 * @returns {object} a complete OpenAPI 3.1 document
 */
function buildSpec(app, routes, opts) {
  opts = opts || {}

  const components = {}
  const paths = {}
  const tags = [{ name: "App", description: "Custom routes, registered in pb_hooks" }]
  const summaries = [] // for the app's live schema view

  // ── 1. collections → components + records paths ──────────────────────────
  const collections = app.findAllCollections()
  const refFor = {}

  // Pass 1: name each component so relation fields can reference each other.
  for (var i = 0; i < collections.length; i++) {
    const c = collections[i]
    if (String(c.name).charAt(0) === "_") continue // system collections: not public API
    refFor[c.id] = componentName(c.name)
  }

  const authRefs = [] // auth collections get extra endpoints

  for (var i = 0; i < collections.length; i++) {
    const c = collections[i]
    const name = c.name
    if (String(name).charAt(0) === "_") continue

    const cj = collectionJSON(c)
    const component = refFor[c.id]
    const ref = "#/components/schemas/" + component

    components[component] = recordSchema(cj, refFor)

    const isView = c.type === "view"
    if (isView) tags.push({ name, description: "View collection — read-only (SQL-backed)" })
    else if (c.type === "auth") tags.push({ name, description: "Auth collection — adds sign-in endpoints" })
    else tags.push({ name, description: "Base collection" })

    const list = ruleInfo(cj.listRule)
    const view = ruleInfo(cj.viewRule)
    const create = ruleInfo(cj.createRule)
    const update = ruleInfo(cj.updateRule)
    const del = ruleInfo(cj.deleteRule)

    summaries.push({
      name: name,
      type: c.type,
      fields: cj.fields.map(function (f) {
        return {
          name: f.name,
          type: f.type,
          required: !!f.required,
          system: !!f.system,
          unique: !!(f.primaryKey && f.name !== "id"),
        }
      }),
      indexes: cj.indexes || [],
      rules: {
        list: cj.listRule, view: cj.viewRule, create: cj.createRule,
        update: cj.updateRule, delete: cj.deleteRule,
      },
      exposure: {
        list: list.public ? "public" : list.superuser ? "superuser" : "filtered",
        view: view.public ? "public" : view.superuser ? "superuser" : "filtered",
        create: create.public ? "public" : create.superuser ? "superuser" : "filtered",
        update: update.public ? "public" : update.superuser ? "superuser" : "filtered",
        delete: del.public ? "public" : del.superuser ? "superuser" : "filtered",
      },
    })

    // /api/collections/{name}/records — list + create
    const base = "/api/collections/" + name + "/records"
    const item = base + "/{id}"

    const listOp = {
      tags: [name],
      summary: "List " + name,
      description: list.note + "\n\nUses PocketBase **filters** — see `/llms-full.txt` §4.",
      operationId: "list_" + name,
      security: list.security,
      parameters: [
        { name: "page", in: "query", schema: { type: "integer", default: 1 } },
        { name: "perPage", in: "query", schema: { type: "integer", default: 30, maximum: 1000 } },
        { name: "sort", in: "query", schema: { type: "string" }, description: "e.g. `-created,title`" },
        { name: "filter", in: "query", schema: { type: "string" }, description: "e.g. `status = \"published\"`" },
        { name: "expand", in: "query", schema: { type: "string" }, description: "e.g. `author`" },
        { name: "fields", in: "query", schema: { type: "string" } },
        { name: "skipTotal", in: "query", schema: { type: "integer", enum: [0, 1] } },
      ],
      responses: {
        200: { description: "Paginated list", content: { "application/json": { schema: listSchema(ref) } } },
        ...errorResponses(),
      },
    }

    const writeBody = {
      required: true,
      content: { "application/json": { schema: { $ref: ref } } },
    }

    paths[base] = { get: listOp }

    if (!isView) {
      paths[base].post = {
        tags: [name],
        summary: "Create " + name,
        description: create.note,
        operationId: "create_" + name,
        security: create.security,
        requestBody: writeBody,
        responses: {
          200: { description: "Created record", content: { "application/json": { schema: { $ref: ref } } } },
          ...errorResponses(),
        },
      }
    }

    paths[item] = {
      get: {
        tags: [name],
        summary: "View " + name + " record",
        description: view.note,
        operationId: "view_" + name,
        security: view.security,
        parameters: [
          { name: "id", in: "path", required: true, schema: { type: "string" } },
          { name: "expand", in: "query", schema: { type: "string" } },
          { name: "fields", in: "query", schema: { type: "string" } },
        ],
        responses: {
          200: { description: "The record", content: { "application/json": { schema: { $ref: ref } } } },
          ...errorResponses(),
        },
      },
    }

    if (!isView) {
      paths[item].patch = {
        tags: [name],
        summary: "Update " + name + " record",
        description: update.note,
        operationId: "update_" + name,
        security: update.security,
        parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
        requestBody: writeBody,
        responses: {
          200: { description: "Updated record", content: { "application/json": { schema: { $ref: ref } } } },
          ...errorResponses(),
        },
      }
      paths[item].delete = {
        tags: [name],
        summary: "Delete " + name + " record",
        description: del.note,
        operationId: "delete_" + name,
        security: del.security,
        parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
        responses: { 204: { description: "Deleted" }, ...errorResponses() },
      }
    }

    if (c.type === "auth") authRefs.push({ name: name, ref: ref })
  }

  // ── 2. auth-collection sign-in endpoints ─────────────────────────────────
  const authTokenSchema = {
    type: "object",
    properties: { token: { type: "string" }, record: { type: "object", additionalProperties: true } },
  }

  for (var i = 0; i < authRefs.length; i++) {
    const a = authRefs[i]
    paths["/api/collections/" + a.name + "/auth-with-password"] = {
      post: {
        tags: [a.name],
        summary: "Sign in with email + password",
        operationId: "authWithPassword_" + a.name,
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["identity", "password"],
                properties: { identity: { type: "string" }, password: { type: "string", format: "password" } },
              },
            },
          },
        },
        responses: {
          200: { description: "Auth token + record", content: { "application/json": { schema: authTokenSchema } } },
          400: { description: "Invalid credentials" },
        },
      },
    }
    paths["/api/collections/" + a.name + "/auth-refresh"] = {
      post: {
        tags: [a.name],
        summary: "Refresh an auth token",
        operationId: "authRefresh_" + a.name,
        security: [{ bearerAuth: [] }],
        responses: {
          200: { description: "New token + record", content: { "application/json": { schema: authTokenSchema } } },
          401: { description: "Missing/invalid token" },
        },
      },
    }
  }

  // ── 3. custom routes (from the shared table) ─────────────────────────────
  for (var i = 0; i < routes.length; i++) {
    const r = routes[i]
    if (r.openapi === false) continue

    if (!paths[r.path]) paths[r.path] = {}
    const op = {
      tags: r.tags || ["App"],
      summary: r.summary || r.path,
      operationId: r.operationId || (r.method.toLowerCase() + "_" + r.path.replace(/[^a-zA-Z0-9]+/g, "_")),
    }
    if (r.description) op.description = r.description
    if (r.auth) op.security = [{ bearerAuth: [] }]
    if (r.params) op.parameters = r.params
    if (r.requestBody) op.requestBody = r.requestBody
    op.responses = r.responses || { 200: { description: "OK" } }

    paths[r.path][r.method.toLowerCase()] = op
  }

  // ── 4. assemble ──────────────────────────────────────────────────────────
  const doc = {
    openapi: "3.1.0",
    info: {
      title: opts.title || (app.settings().meta.appName + " API"),
      version: opts.version || "0.1.0",
      description:
        "Generated live from the running app — collections, fields, rules and routes.\n\n" +
        "**Collections** are derived from `$app.findAllCollections()`; **custom routes** come from " +
        "`base/pb_hooks/lib/api.js`, the same table that registers them, so this spec cannot drift.\n\n" +
        "Every PocketBase record collection also supports realtime (`GET /api/realtime`) and batching " +
        "(`POST /api/batch`, record ops only). See `/llms-full.txt`.",
    },
    servers: [{ url: opts.serverUrl || "http://127.0.0.1:8090", description: "This instance" }],
    tags: tags,
    paths: paths,
    components: {
      schemas: components,
      securitySchemes: {
        bearerAuth: {
          type: "http",
          scheme: "bearer",
          description: "PocketBase auth token. The `Bearer ` prefix is optional.",
        },
      },
    },
  }

  return { spec: doc, summaries: summaries }
}

module.exports = {
  buildSpec: buildSpec,
}
