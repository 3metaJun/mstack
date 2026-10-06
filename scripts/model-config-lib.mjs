import { existsSync, readFileSync } from "node:fs";
import { decodeText } from "./text-decode.mjs";

export const DEFAULT_ROLES = [
  "implementer",
  "reviewer",
  "judge",
  "explorer",
  "synthesizer",
  "candidate",
  "operator",
];

// Hosts wrap harnesses and choose a provider instance per delegation, so they
// are override layers, not entries in profiles/harnesses.json.
export const HOST_KEYS = ["t3code"];

// Lowest to highest. Entries accept only these effort values.
export const EFFORT_LADDER = ["low", "medium", "high", "xhigh", "max"];

// Same rule as T3's provider instance id (PROVIDER_SLUG_PATTERN, at most 64 characters).
const PROVIDER_ID = /^[a-zA-Z][a-zA-Z0-9_-]{0,63}$/;
const PROVIDER_ID_RULE = "provider must be a provider instance id: a letter followed by letters, digits, `_` or `-`, at most 64 characters";
// Names that would reach inherited object members if used as a key.
const RESERVED_KEYS = ["__proto__", "constructor", "prototype"];

export function isProviderId(provider) {
  return typeof provider === "string" && PROVIDER_ID.test(provider);
}

// Assigns an own data property, so a key such as "__proto__" can never hit the inherited setter.
export function setOwn(target, key, value) {
  Object.defineProperty(target, key, { value, enumerable: true, writable: true, configurable: true });
  return target;
}

const ALIASES = ["auto", "inherit-parent"];
const ENTRY_FIELDS = ["provider", "model", "effort"];
const EFFORT_SUFFIX = new RegExp(`^(.*\\S) \\((${EFFORT_LADDER.join("|")})\\)$`);

export function readModelConfig(path) {
  if (!existsSync(path)) return { roles: Object.fromEntries(DEFAULT_ROLES.map((role) => [role, "inherit-parent"])), overrides: {} };
  return JSON.parse(decodeText(readFileSync(path)));
}

export function isValidModel(model) {
  return typeof model === "string" && model.trim() === model && model.length > 0 && !model.includes("\0");
}

export function isAlias(entry) {
  return ALIASES.includes(entry);
}

// Normalizes one role entry to { provider?, model, effort? }. Outside a host
// layer every string is one opaque model name and objects are rejected, so
// existing Harness configurations keep their exact meaning. In host scope a
// trailing ` (<effort>)` is read as the effort and `<provider>/<model>` splits
// at the first slash. Returns { error } when the entry is malformed.
export function parseRoleEntry(entry, { host = false } = {}) {
  if (!host) {
    if (typeof entry === "string") {
      return isValidModel(entry) ? { model: entry } : { error: "must be a non-empty string without surrounding whitespace or NUL characters" };
    }
    return { error: "must be a model string; provider and effort entries are only supported under overrides.t3code" };
  }
  if (typeof entry === "string") {
    if (!isValidModel(entry)) return { error: "must be a non-empty string without surrounding whitespace or NUL characters" };
    if (isAlias(entry)) return { model: entry };
    const suffix = EFFORT_SUFFIX.exec(entry);
    if (!suffix && /\s\([^()]*\)$/.test(entry)) {
      return { error: `effort must be one of ${EFFORT_LADDER.join(", ")}` };
    }
    const body = suffix ? suffix[1] : entry;
    const effort = suffix ? { effort: suffix[2] } : {};
    const slash = body.indexOf("/");
    if (slash <= 0 || slash === body.length - 1) return { error: "must be <provider>/<model> with an optional (<effort>) suffix" };
    const provider = body.slice(0, slash);
    if (!isProviderId(provider)) return { error: PROVIDER_ID_RULE };
    return { provider, model: body.slice(slash + 1), ...effort };
  }
  if (!entry || typeof entry !== "object" || Array.isArray(entry)) return { error: "must be a model string or an object with provider, model and effort" };
  const unknown = Object.keys(entry).filter((field) => !ENTRY_FIELDS.includes(field));
  if (unknown.length) return { error: `has unknown field ${unknown.join(", ")}` };
  if (!isValidModel(entry.model) || isAlias(entry.model)) {
    return { error: "model must be a concrete model name; write inherit-parent or auto as a plain string" };
  }
  if (entry.provider === undefined) return { error: "provider is required for a host entry" };
  if (!isProviderId(entry.provider)) return { error: PROVIDER_ID_RULE };
  if (entry.effort !== undefined && !EFFORT_LADDER.includes(entry.effort)) {
    return { error: `effort must be one of ${EFFORT_LADDER.join(", ")}` };
  }
  return {
    provider: entry.provider,
    model: entry.model,
    ...(entry.effort === undefined ? {} : { effort: entry.effort }),
  };
}

// Canonical text of a parsed entry, used to detect duplicate panel members.
export function entryKey({ provider, model, effort }) {
  return `${provider === undefined ? "" : `${provider}/`}${model}${effort === undefined ? "" : ` (${effort})`}`;
}

function validateRoleValue(role, value, path, errors, host) {
  const entries = role === "reviewer" && Array.isArray(value) ? value : [value];
  const keys = [];
  let valid = true;
  for (const entry of entries) {
    const parsed = parseRoleEntry(entry, { host });
    if (parsed.error) {
      valid = false;
      errors.push(`${path} ${parsed.error}`);
    } else keys.push(entryKey(parsed));
  }
  if (role === "reviewer" && Array.isArray(value)) {
    if (!value.length || !valid || new Set(keys).size !== keys.length) {
      errors.push(`${path} must be a non-empty list of unique model entries without surrounding whitespace or NUL characters`);
    }
  }
}

export function validateModelConfig(config, harnesses) {
  const errors = [];
  if (!config || typeof config !== "object" || Array.isArray(config)) {
    errors.push("configuration must be an object");
    return errors;
  }
  const scopes = [...harnesses, ...HOST_KEYS];
  if (!config.roles || typeof config.roles !== "object" || Array.isArray(config.roles)) {
    errors.push("roles must be an object");
  } else {
    for (const [role, model] of Object.entries(config.roles)) {
      if (!role.trim()) errors.push("role names must not be empty");
      if (RESERVED_KEYS.includes(role)) errors.push(`roles.${role} uses a reserved name`);
      validateRoleValue(role, model, `roles.${role || "<empty>"}`, errors, false);
    }
  }
  if (config.overrides !== undefined && (!config.overrides || typeof config.overrides !== "object" || Array.isArray(config.overrides))) {
    errors.push("overrides must be an object");
  }
  for (const [scope, overrides] of Object.entries(config.overrides ?? {})) {
    if (!scopes.includes(scope)) errors.push(`overrides.${scope} names an unsupported harness`);
    if (!overrides || typeof overrides !== "object" || Array.isArray(overrides)) {
      errors.push(`overrides.${scope} must be an object`);
      continue;
    }
    for (const [role, model] of Object.entries(overrides)) {
      if (RESERVED_KEYS.includes(role)) errors.push(`overrides.${scope}.${role} uses a reserved name`);
      if (!Object.hasOwn(config.roles ?? {}, role)) errors.push(`overrides.${scope}.${role} has no role default`);
      validateRoleValue(role, model, `overrides.${scope}.${role}`, errors, HOST_KEYS.includes(scope));
    }
  }
  if (config.sessionHook !== undefined && typeof config.sessionHook !== "boolean") {
    errors.push("sessionHook must be true or false");
  }
  if (config.budgets !== undefined) {
    if (!config.budgets || typeof config.budgets !== "object" || Array.isArray(config.budgets)) {
      errors.push("budgets must be an object keyed by Harness");
    } else for (const [scope, budget] of Object.entries(config.budgets)) {
      if (!scopes.includes(scope)) errors.push(`budgets.${scope} names an unsupported harness`);
      if (!["unlimited", "large", "medium", "small"].includes(budget)) errors.push(`budgets.${scope} must be unlimited, large, medium, or small`);
    }
  }
  return errors;
}

export function resolveModels(config, harness) {
  // Read own properties only, so a role or harness name never resolves to an inherited member.
  const scope = Object.hasOwn(config.overrides ?? {}, harness) ? config.overrides[harness] : {};
  return Object.fromEntries(
    Object.entries(config.roles ?? {}).map(([role, model]) => [role, Object.hasOwn(scope, role) ? scope[role] : model]),
  );
}

export function resolveRoleModel(config, harness, role) {
  const models = resolveModels(config, harness);
  if (!Object.hasOwn(models, role)) throw new Error(`Unknown model role: ${role}`);
  return models[role];
}
