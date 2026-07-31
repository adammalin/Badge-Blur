import assert from "node:assert/strict";
import {
  classifierEvidence,
  contextualBadgeDecision,
  globalClassifierDecision,
} from "../src/classifier-utils.js";

const labels = ["badge", "credential", "patch", "equipment label"];
const evidence = classifierEvidence(
  [
    { label: "patch", score: 0.72 },
    { label: "badge", score: 0.1 },
    { label: "credential", score: 0.08 },
    { label: "equipment label", score: 0.1 },
  ],
  labels,
  2,
);

assert.equal(evidence.positiveScore, 0.1);
assert.equal(evidence.negativeScore, 0.72);
assert.equal(Number(evidence.margin.toFixed(2)), -0.62);
assert.equal(
  globalClassifierDecision(0.42, evidence, 0.5, -0.5),
  "rejected-negative",
);
assert.equal(
  contextualBadgeDecision(0.76, {
    ...evidence,
    margin: 0.74,
  }, {
    eligibleContext: true,
    minimumDetectionScore: 0.45,
    minimumClassifierMargin: 0.2,
  }),
  "kept-context-rescue",
);
assert.equal(
  contextualBadgeDecision(0.8, evidence, {
    eligibleContext: true,
    minimumDetectionScore: 0.45,
    minimumClassifierMargin: 0.2,
  }),
  "rejected-context-negative",
);
assert.equal(
  contextualBadgeDecision(0.9, {
    ...evidence,
    margin: 0.74,
  }, {
    eligibleContext: false,
    minimumDetectionScore: 0.45,
    minimumClassifierMargin: 0.2,
  }),
  "rejected-outside-person",
);
assert.equal(
  globalClassifierDecision(0.55, evidence, 0.5, -0.5),
  "kept-high-confidence",
);
assert.equal(
  globalClassifierDecision(
    0.42,
    { ...evidence, margin: -0.45 },
    0.5,
    -0.5,
  ),
  "kept-classified",
);

console.log(JSON.stringify({ passed: true, evidence }, null, 2));
