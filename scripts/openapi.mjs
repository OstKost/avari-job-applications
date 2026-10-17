import { writeFile } from "node:fs/promises";
const s = { type: "string" },
  integer = { type: "integer" },
  date = { type: "string", format: "date" },
  stamp = { type: "string", format: "date-time" };
const ref = (name) => ({ $ref: "#/components/schemas/" + name });
const array = (items) => ({ type: "array", items });
const object = (properties, required = Object.keys(properties)) => ({
  type: "object",
  properties,
  required,
  additionalProperties: false,
});
const enumeration = (...values) => ({ type: "string", enum: values });
const schemas = {
  User: object({
    id: s,
    email: { type: "string", format: "email" },
    status: enumeration("pending", "active", "blocked"),
    timezone: s,
    createdAt: stamp,
  }),
  Session: object({
    id: s,
    kind: enumeration("web", "extension"),
    name: s,
    createdAt: stamp,
    expiresAt: stamp,
  }),
  Salary: object({
    min: { type: ["number", "null"], minimum: 0 },
    max: { type: ["number", "null"], minimum: 0 },
    currency: s,
    period: s,
    tax: s,
  }),
  Application: object({
    groups: array(s),
    tags: array(s),
    id: s,
    company: s,
    position: s,
    url: s,
    hhId: s,
    savedDate: date,
    appliedDate: s,
    stage: s,
    state: s,
    outcome: s,
    salary: ref("Salary"),
    location: s,
    workFormat: s,
    recruiter: s,
    companyLogo: s,
    favorite: { type: "boolean" },
    externalStatus: s,
    custom: {
      type: "object",
      additionalProperties: { type: ["string", "number", "boolean", "null"] },
    },
    version: integer,
    createdAt: stamp,
    updatedAt: stamp,
  }),
  Task: object({
    id: s,
    applicationId: s,
    title: s,
    kind: enumeration("task", "interview"),
    date,
    time: s,
    state: enumeration("open", "done"),
    version: integer,
    createdAt: stamp,
  }),
  CalendarSubscription: object({ url: s }),
  ExtensionDownload: object({ url: s }),
  Note: object({
    id: s,
    applicationId: s,
    text: s,
    createdAt: stamp,
    version: integer,
  }),
  Field: object({
    id: s,
    name: s,
    type: enumeration("text", "number", "date", "flag", "select"),
    options: array(s),
    role: s,
  }),
  HistoryEvent: object({
    id: s,
    applicationId: s,
    kind: s,
    source: s,
    changes: {
      type: "object",
      additionalProperties: object({ before: {}, after: {} }),
    },
    createdAt: stamp,
  }),
  Proposal: object({
    id: s,
    applicationId: s,
    observationId: s,
    status: enumeration("pending", "applied", "dismissed"),
    detectedStatus: s,
    url: s,
    current: ref("Application"),
    changes: { type: "object", additionalProperties: {} },
    createdAt: stamp,
    source: s,
  }),
  Detail: object({
    application: ref("Application"),
    notes: array(ref("Note")),
    events: array(ref("HistoryEvent")),
    tasks: array(ref("Task")),
    proposals: array(ref("Proposal")),
  }),
  Observation: object(
    {
      hhId: s,
      vacancyUrl: s,
      status: s,
      url: s,
      candidate: ref("Application"),
    },
    ["status", "url"],
  ),
  Error: object({ error: s, current: {} }, ["error"]),
  Calendar: object({
    today: date,
    end: date,
    tasks: array(ref("Task")),
    overdue: array(ref("Task")),
  }),
  Login: object(
    { email: s, password: s, kind: enumeration("web", "extension"), name: s },
    ["email", "password"],
  ),
  LoginResult: object(
    { user: ref("User"), session: ref("Session"), token: s, csrf: s },
    ["user", "session"],
  ),
  Register: object(
    {
      email: s,
      password: { type: "string", minLength: 10, maxLength: 256 },
      timezone: s,
    },
    ["email", "password"],
  ),
  PasswordChange: object(
    {
      currentPassword: s,
      newPassword: { type: "string", minLength: 10, maxLength: 256 },
    },
    ["currentPassword", "newPassword"],
  ),
  PasswordRecovery: object(
    {
      email: s,
      password: { type: "string", minLength: 10, maxLength: 256 },
    },
    ["email", "password"],
  ),
  Resolve: object(
    {
      action: enumeration("apply", "dismiss"),
      version: integer,
      changes: { type: "object", additionalProperties: {} },
    },
    ["action"],
  ),
  FieldUpdate: object(
    { fields: array(ref("Field")), confirmDelete: { type: "boolean" } },
    ["fields"],
  ),
  Success: object({ ok: { type: "boolean" } }),
  ResumeVersion: object({
    id: s,
    resumeId: s,
    versionNumber: integer,
    filename: s,
    format: s,
    size: integer,
    checksum: s,
    createdAt: stamp,
  }),
  Resume: object({
    id: s,
    title: s,
    createdAt: stamp,
    updatedAt: stamp,
    versions: array(ref("ResumeVersion")),
  }),
  ResumeUpdate: object({
    title: s,
  }),
};
schemas.Application.properties.lastActivityAt = stamp;
schemas.Application.properties.stale = { type: "boolean" };
schemas.Proposal.properties.kind = enumeration("create");
schemas.Application.required = schemas.Application.required.filter(
  (field) => field !== "companyLogo",
);
const input = (name) => ({
  ...structuredClone(schemas[name]),
  required:
    name === "Application"
      ? ["company", "position"]
      : name === "Task"
        ? ["title", "date"]
        : ["applicationId", "text"],
});
schemas.ApplicationInput = input("Application");
schemas.TaskInput = input("Task");
// Older stored tasks have no modification timestamp.
schemas.Task.properties.updatedAt = stamp;
schemas.TaskInput.properties.updatedAt = stamp;
schemas.NoteInput = input("Note");
schemas.TableSettings = object({
  group: enumeration("", "stage", "state", "group", "priority"),
  cards: { type: "boolean" },
  statistics: { type: "boolean" },
});
schemas.JournalSettings = object(
  {
    timezone: s,
    theme: enumeration("dark", "light"),
    table: ref("TableSettings"),
  },
  ["timezone"],
);
schemas.Journal = object({
  format: enumeration("avari-journal"),
  version: { type: "integer", enum: [1] },
  exportedAt: stamp,
  settings: ref("JournalSettings"),
  applications: array(ref("Application")),
  fields: array(ref("Field")),
  tasks: array(ref("Task")),
  notes: array(ref("Note")),
  events: array(ref("HistoryEvent")),
  origins: { type: "object", additionalProperties: s },
});
schemas.ImportRequest = object(
  {
    journal: ref("Journal"),
    fieldMapping: { type: "object", additionalProperties: s },
    applySettings: { type: "boolean" },
    revision: s,
  },
  ["journal", "fieldMapping", "applySettings"],
);
schemas.FieldConflict = object({
  field: ref("Field"),
  candidates: array(ref("Field")),
});
schemas.ImportReport = object({
  ready: { type: "boolean" },
  revision: s,
  newApplications: integer,
  matchedApplications: integer,
  newTasks: integer,
  newNotes: integer,
  newEvents: integer,
  unchanged: integer,
  conflicts: array(s),
  fieldConflicts: array(ref("FieldConflict")),
});
schemas.LocalSettings = object({ autostart: { type: "boolean" } });
schemas.LocalStatus = object(
  {
    personal: { type: "boolean" },
    setupNeeded: { type: "boolean" },
    launcher: { type: "boolean" },
    origin: s,
    checks: array(s),
  },
  ["personal", "setupNeeded", "launcher"],
);
schemas.LocalSetup = object({ email: s, password: s, timezone: s, token: s });
const paths = {};
const operation = (
  path,
  method,
  summary,
  response,
  body,
  publicRoute = false,
  status = "200",
) => {
  const id = path.includes("{id}")
    ? [{ name: "id", in: "path", required: true, schema: s }]
    : [];
  paths[path] ??= {};
  paths[path][method] = {
    summary,
    operationId: method + "_" + path.replace(/[^a-zA-Z0-9]/g, "_"),
    security: publicRoute ? [] : [{ cookieAuth: [] }, { extensionToken: [] }],
    parameters: [
      ...id,
      ...(["post", "put", "delete"].includes(method)
        ? [
            {
              name: "X-CSRF-Token",
              in: "header",
              description: "Required for website cookie sessions.",
              schema: s,
            },
            ...(path === "/applications" ||
            path === "/tasks" ||
            path === "/notes"
              ? [{ name: "Idempotency-Key", in: "header", schema: s }]
              : []),
          ]
        : []),
    ],
    ...(body
      ? {
          requestBody: {
            required: true,
            content: { "application/json": { schema: ref(body) } },
          },
        }
      : {}),
    responses: {
      [status]: {
        description: "Success",
        content: {
          "application/json": {
            schema: typeof response === "string" ? ref(response) : response,
          },
        },
      },
      ...[400, 401, 403, 404, 409, 429, 500]
        .map((code) => ({
          [code]: {
            description:
              code === 409
                ? "Concurrent edit or confirmation required"
                : "Error",
            content: { "application/json": { schema: ref("Error") } },
          },
        }))
        .reduce((a, b) => ({ ...a, ...b }), {}),
    },
  };
};
operation(
  "/auth/register",
  "post",
  "Register a pending account",
  "User",
  "Register",
  true,
  "201",
);
operation(
  "/auth/login",
  "post",
  "Create a separate website or extension session",
  "LoginResult",
  "Login",
  true,
);
operation(
  "/auth/recovery",
  "post",
  "Request password recovery via administrator approval",
  object({ ok: { type: "boolean" }, message: s }),
  "PasswordRecovery",
  true,
);
operation(
  "/journal/export",
  "get",
  "Export the authenticated user's complete journal",
  "Journal",
);
operation(
  "/journal/import/preview",
  "post",
  "Preview a merge without writing; resolve field mappings first",
  "ImportReport",
  "ImportRequest",
);
operation(
  "/journal/import",
  "post",
  "Atomically merge using the preview revision; existing records win",
  "ImportReport",
  "ImportRequest",
);
operation(
  "/local/status",
  "get",
  "Discover personal mode and first-run readiness",
  "LocalStatus",
  undefined,
  true,
);
operation(
  "/local/setup",
  "post",
  "Create the sole owner using the launcher's one-time secret",
  "User",
  "LocalSetup",
  true,
  "201",
);
operation(
  "/local/settings",
  "get",
  "Read native autostart state (personal web session only)",
  "LocalSettings",
);
operation(
  "/local/settings",
  "put",
  "Enable or disable native autostart (personal web session only)",
  "LocalSettings",
  "LocalSettings",
);
operation("/auth/logout", "post", "Revoke current session", "Success");
operation(
  "/auth/password",
  "post",
  "Change password for authenticated user",
  "Success",
  "PasswordChange",
);
operation("/me", "get", "Account, including pending/blocked status", "User");
schemas.Timezone = object({ timezone: s });
operation("/me", "put", "Set calendar timezone", "User", "Timezone");
operation("/sessions", "get", "List own sessions", array(ref("Session")));
operation("/sessions/{id}", "delete", "Revoke own session", "Success");
operation(
  "/applications",
  "get",
  "List own applications (up to 1000)",
  array(ref("Application")),
);
operation(
  "/applications",
  "post",
  "Create or return existing supported vacancy",
  "Application",
  "ApplicationInput",
);
operation(
  "/applications/{id}",
  "get",
  "Application with history, notes, tasks and pending proposals",
  "Detail",
);
operation(
  "/applications/{id}",
  "put",
  "Update using current version",
  "Application",
  "Application",
);
operation("/tasks", "get", "List own tasks", array(ref("Task")));
operation("/tasks", "post", "Create task or interview", "Task", "TaskInput");
operation("/tasks/{id}", "put", "Update using current version", "Task", "Task");
operation("/notes", "post", "Add a note", "Note", "NoteInput");
operation(
  "/notes/{id}",
  "put",
  "Edit a note using its current version",
  "Note",
  "Note",
);
operation("/fields", "get", "List own custom fields", array(ref("Field")));
operation(
  "/fields",
  "put",
  "Replace definitions, up to five fields",
  array(ref("Field")),
  "FieldUpdate",
);
operation(
  "/proposals",
  "get",
  "List pending proposals",
  array(ref("Proposal")),
);
operation(
  "/proposals/{id}",
  "post",
  "Apply, edit-and-apply or dismiss a proposal",
  "Proposal",
  "Resolve",
);
operation(
  "/observations",
  "post",
  "Record observation from an extension session",
  object({ proposal: { anyOf: [ref("Proposal"), { type: "null" }] } }),
  "Observation",
);
operation(
  "/calendar",
  "get",
  "Today plus six days, and overdue tasks",
  "Calendar",
);
for (const [method, summary] of [
  ["get", "Get own subscription URL, empty when disabled"],
  ["post", "Enable own calendar subscription, retaining an existing URL"],
  ["put", "Rotate own calendar subscription URL, invalidating the old URL"],
  ["delete", "Disable own calendar subscription"],
]) {
  operation("/calendar/subscription", method, summary, "CalendarSubscription");
}
operation(
  "/calendar/feed/{token}.ics",
  "get",
  "Read live calendar using a secret read-only token",
  s,
  undefined,
  true,
);
const feedOperation = paths["/calendar/feed/{token}.ics"].get;
feedOperation.parameters = [
  {
    name: "token",
    in: "path",
    required: true,
    schema: { type: "string", pattern: "^[0-9a-f]{64}$" },
  },
  { name: "If-None-Match", in: "header", schema: s },
];
feedOperation.responses["200"].content = { "text/calendar": { schema: s } };
feedOperation.responses["200"].headers = { ETag: { schema: s } };
feedOperation.responses["304"] = {
  description: "Calendar has not changed (If-None-Match)",
};
operation(
  "/extension/download",
  "get",
  "Get personal extension download URL",
  "ExtensionDownload",
);
operation(
  "/extension/download",
  "post",
  "Generate new personal extension download URL",
  "ExtensionDownload",
);
operation(
  "/extension/download/{token}/avari-extension.zip",
  "get",
  "Download personal extension zip using a secret token",
  s,
  undefined,
  true,
);
const downloadOperation =
  paths["/extension/download/{token}/avari-extension.zip"].get;
downloadOperation.parameters = [
  {
    name: "token",
    in: "path",
    required: true,
    schema: { type: "string", pattern: "^[0-9a-f]{64}$" },
  },
  { name: "If-None-Match", in: "header", schema: s },
];
downloadOperation.responses["200"].content = {
  "application/zip": { schema: s },
};
downloadOperation.responses["200"].headers = { ETag: { schema: s } };
downloadOperation.responses["304"] = {
  description: "Archive has not changed (If-None-Match)",
};
operation("/resumes", "get", "List own logical resumes with versions", array(ref("Resume")));
operation("/resumes", "post", "Upload a new logical resume with version 1", "Resume", undefined, false, "201");
paths["/resumes"].post.requestBody = {
  required: true,
  content: {
    "multipart/form-data": {
      schema: {
        type: "object",
        properties: {
          file: { type: "string", format: "binary" },
          title: s,
        },
        required: ["file"],
      },
    },
  },
};
operation("/resumes/{id}", "put", "Rename a logical resume", "Resume", "ResumeUpdate");
operation("/resumes/{id}", "delete", "Delete a logical resume and all its versions", "Success");
operation("/resumes/{id}/versions", "post", "Upload a new version to an existing resume", "ResumeVersion", undefined, false, "201");
paths["/resumes/{id}/versions"].post.requestBody = {
  required: true,
  content: {
    "multipart/form-data": {
      schema: {
        type: "object",
        properties: {
          file: { type: "string", format: "binary" },
        },
        required: ["file"],
      },
    },
  },
};
paths["/resumes/{id}/versions/{versionId}"] ??= {};
paths["/resumes/{id}/versions/{versionId}"].delete = {
  summary: "Delete a specific resume version (removes resume if last version)",
  operationId: "delete__resumes__id__versions__versionId_",
  security: [{ cookieAuth: [] }, { extensionToken: [] }],
  parameters: [
    { name: "id", in: "path", required: true, schema: s },
    { name: "versionId", in: "path", required: true, schema: s },
    {
      name: "X-CSRF-Token",
      in: "header",
      description: "Required for website cookie sessions.",
      schema: s,
    },
  ],
  responses: {
    "200": {
      description: "Success",
      content: { "application/json": { schema: ref("Success") } },
    },
    ...[400, 401, 403, 404, 409, 429, 500]
      .map((code) => ({
        [code]: {
          description: "Error",
          content: { "application/json": { schema: ref("Error") } },
        },
      }))
      .reduce((a, b) => ({ ...a, ...b }), {}),
  },
};
paths["/resumes/{id}/versions/{versionId}/download"] ??= {};
paths["/resumes/{id}/versions/{versionId}/download"].get = {
  summary: "Download a specific resume version file",
  operationId: "get__resumes__id__versions__versionId__download",
  security: [{ cookieAuth: [] }, { extensionToken: [] }],
  parameters: [
    { name: "id", in: "path", required: true, schema: s },
    { name: "versionId", in: "path", required: true, schema: s },
  ],
  responses: {
    "200": {
      description: "File download",
      content: {
        "application/octet-stream": { schema: { type: "string", format: "binary" } },
      },
    },
    ...[400, 401, 403, 404, 500]
      .map((code) => ({
        [code]: {
          description: "Error",
          content: { "application/json": { schema: ref("Error") } },
        },
      }))
      .reduce((a, b) => ({ ...a, ...b }), {}),
  },
};
const spec = {
  openapi: "3.1.0",
  info: {
    title: "Avari.Jobs API",
    version: "1.1.0",
    description:
      "Website mutations require a CSRF header with the avari_csrf cookie value. Extension sessions use Bearer tokens. Only /me and /auth/logout are accessible to pending/blocked accounts. The calendar feed uses a separate secret read-only token and is only available for active accounts. Changes require user confirmation. There is no administrative HTTP API.",
  },
  servers: [{ url: "/api/v1" }],
  paths,
  components: {
    schemas,
    securitySchemes: {
      cookieAuth: { type: "apiKey", in: "cookie", name: "avari_session" },
      extensionToken: { type: "http", scheme: "bearer" },
    },
  },
};
await writeFile(
  new URL("../docs/openapi.json", import.meta.url),
  JSON.stringify(spec, null, 2) + "\n",
);
