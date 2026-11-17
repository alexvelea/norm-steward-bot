import type { BuildingId, UnitId } from "../../contract";
import { BUILDINGS, UNITS } from "../../contract";

type Levels = Record<BuildingId, number>;
function missing(requirements: Partial<Levels>, levels: Levels): string {
  const needs = (Object.entries(requirements) as [BuildingId, number][])
    .filter(([building, level]) => levels[building] < level)
    .map(([building, level]) => `${BUILDINGS[building].name} ${level}`);
  return needs.length ? `Needs ${needs.join(" · ")}` : "";
}

export function buildingNeeds(building: BuildingId, levels: Levels): string {
  return missing(BUILDINGS[building].requires, levels);
}

export function unitNeeds(unit: UnitId, levels: Levels): string {
  const rule = UNITS[unit];
  return missing({ [rule.building]: rule.buildingLevel, smithy: rule.smithyLevel }, levels);
}

export function blockerMessage(blockers: string[], needs: string): string {
  return blockers.map((b) => b === "REQUIREMENTS_NOT_MET" && needs ? needs : b.toLowerCase().replaceAll("_", " ")).join(" · ");
}
