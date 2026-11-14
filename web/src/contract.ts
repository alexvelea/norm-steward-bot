// The dashboard's one door to the shared wire shapes and rule numbers.
// Shapes come from src/shared/api.ts and numbers from src/rules/config.ts; nothing here redefines either.
export type * from "../../src/shared/api";
export {
  BUILDINGS,
  BUILDING_IDS,
  COMBAT,
  ECONOMY,
  HALL_SPEED_BASE,
  HISTORY,
  LIMITS,
  MAP,
  MARKET,
  RESOURCES,
  SANDBOX,
  SCORING,
  SERVER,
  TRAINING,
  UNITS,
  UNIT_IDS,
  WATCHTOWER,
  round as roundHalfUp,
} from "../../src/rules/config";
