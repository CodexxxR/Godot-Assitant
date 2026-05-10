const config = require("../../config");

const ROLE_NAMES = ["planner", "coder", "reviewer", "fixer"];
const FREE_ROUTER_MODEL = "openrouter/free";

const isFreeModelId = (modelId = "") =>
  modelId.endsWith(":free") || modelId === FREE_ROUTER_MODEL;

const normalizeRole = (name, roleConfig = {}) => ({
  name,
  modelId: String(roleConfig.modelId || "").trim(),
  temperature: Number(roleConfig.temperature ?? 0.1),
  maxTokens: Number(roleConfig.maxTokens || config.openRouter.maxTokens),
  purpose: String(roleConfig.purpose || ""),
  jsonRequired: Boolean(roleConfig.jsonRequired),
  fallbackModels: Array.isArray(roleConfig.fallbackModels)
    ? roleConfig.fallbackModels.map((model) => String(model).trim()).filter(Boolean)
    : [],
});

const getModelRoles = () =>
  Object.fromEntries(
    ROLE_NAMES.map((roleName) => [
      roleName,
      normalizeRole(roleName, config.openRouter.roles?.[roleName]),
    ])
  );

const getModelRole = (roleName) => {
  if (!ROLE_NAMES.includes(roleName)) {
    const error = new Error(`Unknown OpenRouter role: ${roleName}`);
    error.statusCode = 400;
    throw error;
  }

  return getModelRoles()[roleName];
};

const getRoleModelsToTry = (roleName) => {
  const role = getModelRole(roleName);
  const models = [role.modelId, ...role.fallbackModels].filter(Boolean);
  return Array.from(new Set(models)).filter(isFreeModelId);
};

const validateFreeRoleConfig = () => {
  const roles = getModelRoles();
  const errors = [];

  Object.values(roles).forEach((role) => {
    if (!isFreeModelId(role.modelId)) {
      errors.push(`${role.name} model is not free: ${role.modelId}`);
    }

    role.fallbackModels.forEach((modelId) => {
      if (!isFreeModelId(modelId)) {
        errors.push(`${role.name} fallback model is not free: ${modelId}`);
      }
    });
  });

  (config.openRouter.imagePlannerModels || []).forEach((modelId) => {
    if (!isFreeModelId(modelId)) {
      errors.push(`image planner model is not free: ${modelId}`);
    }
  });

  return {
    ok: errors.length === 0,
    errors,
    roles,
  };
};

module.exports = {
  FREE_ROUTER_MODEL,
  ROLE_NAMES,
  getModelRole,
  getModelRoles,
  getRoleModelsToTry,
  isFreeModelId,
  validateFreeRoleConfig,
};
