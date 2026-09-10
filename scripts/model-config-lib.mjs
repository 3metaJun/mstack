import { existsSync, readFileSync } from "node:fs";

export const DEFAULT_ROLES = [
  "implementer",
  "reviewer",
  "judge",
  "explorer",
  "synthesizer",
  "candidate",
  "operator",
];

export function readModelConfig(path) {
  if (!existsSync(path)) return { roles: Object.fromEntries(DEFAULT_ROLES.map((role) => [role, "inherit-parent"])), overrides: {} };
  return JSON.parse(readFileSync(path, "utf8"));
}

export function validateModelConfig(config, harnesses) {
  const errors = [];
  if (!config || typeof config !== "object" || Array.isArray(config)) {
    errors.push("configuration must be an object");
    return errors;
  }
  if (!config.roles || typeof config.roles !== "object" || Array.isArray(config.roles)) {
    errors.push("roles must be an object");
  } else {
    for (const [role, model] of Object.entries(config.roles)) {
      if (!role || typeof model !== "string" || model.length === 0) {
        errors.push(`roles.${role || "<empty>"} must be a non-empty string`);
      }
    }
  }
  if (config.overrides !== undefined && (!config.overrides || typeof config.overrides !== "object" || Array.isArray(config.overrides))) {
    errors.push("overrides must be an object");
  }
  for (const [harness, overrides] of Object.entries(config.overrides ?? {})) {
    if (!harnesses.includes(harness)) errors.push(`overrides.${harness} names an unsupported harness`);
    if (!overrides || typeof overrides !== "object" || Array.isArray(overrides)) {
      errors.push(`overrides.${harness} must be an object`);
      continue;
    }
    for (const [role, model] of Object.entries(overrides)) {
      if (!Object.hasOwn(config.roles ?? {}, role)) errors.push(`overrides.${harness}.${role} has no role default`);
      if (typeof model !== "string" || model.length === 0) errors.push(`overrides.${harness}.${role} must be a non-empty string`);
    }
  }
  return errors;
}

export function resolveModels(config, harness) {
  return Object.fromEntries(
    Object.entries(config.roles ?? {}).map(([role, model]) => [role, config.overrides?.[harness]?.[role] ?? model]),
  );
}

export function resolveRoleModel(config, harness, role) {
  const models = resolveModels(config, harness);
  if (!Object.hasOwn(models, role)) throw new Error(`Unknown model role: ${role}`);
  return models[role];
}
