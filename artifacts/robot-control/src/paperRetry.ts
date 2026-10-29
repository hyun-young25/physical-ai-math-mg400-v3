import type { PaperTrialRecord, PaperFrame, PaperCoordinateLevel, PaperGridPoint } from "./paperCoordinateStudy";
import { isMergedPaper } from "./paperMergedLesson";
import { paperTaskTargets } from "./paperRectangleTask";

/** Copy only submitted student inputs, never target coordinates or error values.
 * Frame identity AND contents are checked: a moved/re-recorded sheet is a new task. */
export function paperRetryInputs(parent: PaperTrialRecord | undefined, level: PaperCoordinateLevel,
  frame: PaperFrame | null | undefined, targets: PaperGridPoint[]) {
  if (!parent || !isMergedPaper(level) || parent.level !== level || !frame || !parent.frame
    || JSON.stringify(parent.frame) !== JSON.stringify(frame)
    || JSON.stringify(paperTaskTargets(parent.level, parent.targetSet)) !== JSON.stringify(targets)
    || !parent.transform || parent.predictions?.length !== targets.length) return null;
  return structuredClone({ transform: parent.transform, predictions: parent.predictions, pathConcept: parent.pathConcept });
}

/** Highlight observed differences, not inferred student misconceptions. No tracking errors. */
export function paperRetryFields(parent: PaperTrialRecord) {
  const d = parent.diagnosis;
  if (!d || d.status !== "complete" || d.pattern === "tracking" || d.pattern === "match") return [];
  const rows = d.pattern === "calculation" ? d.predictionEvidence : d.taskEvidence;
  const tolerance = d.toleranceMm ?? 2;
  return (rows ?? []).filter(e => e.distance > tolerance).flatMap(e => {
    const fields = [Math.abs(e.dx) > tolerance ? "robotX" : "", Math.abs(e.dy) > tolerance ? "robotY" : ""].filter(Boolean);
    // A combined XY distance may exceed tolerance while each component is below it.
    return (fields.length ? fields : ["robotX", "robotY"]).map(field => `${e.point}.${field}`);
  });
}
