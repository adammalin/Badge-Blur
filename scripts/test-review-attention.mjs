import assert from "node:assert/strict";
import {
  assessReviewAttention,
  associateBadgesToPeople,
} from "../src/review-attention.js";

const people = [
  {
    id: "person-1",
    torso: { left: 0, top: 0, width: 400, height: 800 },
  },
  {
    id: "person-2",
    torso: { left: 400, top: 0, width: 400, height: 800 },
  },
];
const badge = {
  id: "badge-1",
  x: 120,
  y: 360,
  width: 90,
  height: 120,
  score: 0.52,
  source: "model",
  autoFitted: true,
};

const association = associateBadgesToPeople(people, [badge]);
assert.deepEqual(association.matchedPersonIds, ["person-1"]);
assert.deepEqual(association.unmatchedPersonIds, ["person-2"]);

const missingBadgeAssessment = assessReviewAttention({
  status: "detected",
  width: 800,
  height: 800,
  boxes: [badge],
  personGuides: people,
});
assert.equal(missingBadgeAssessment.level, "none");
assert.equal(missingBadgeAssessment.unmatchedPersonCount, 0);
assert.deepEqual(missingBadgeAssessment.reasons, []);

const fallbackAssessment = assessReviewAttention({
  status: "detected",
  width: 2000,
  height: 1200,
  boxes: [
    {
      ...badge,
      id: "badge-2",
      x: 600,
      y: 500,
      autoFitted: false,
      score: 0.22,
    },
  ],
  personGuides: [],
});
assert.equal(fallbackAssessment.level, "none");
assert.equal(fallbackAssessment.reasons.length, 0);

const clearAssessment = assessReviewAttention({
  status: "detected",
  width: 800,
  height: 800,
  boxes: [badge, { ...badge, id: "badge-2", x: 520 }],
  personGuides: people,
});
assert.equal(clearAssessment.level, "none");
assert.deepEqual(clearAssessment.reasons, []);

const backgroundBystanderIgnored = assessReviewAttention({
  status: "detected",
  width: 800,
  height: 800,
  boxes: [badge],
  personGuides: [
    people[0],
    { ...people[1], attentionEligible: false },
  ],
});
assert.equal(backgroundBystanderIgnored.unmatchedPersonCount, 0);

const visibleLanyardDoesNotAssumeBadge = assessReviewAttention({
  status: "detected",
  width: 800,
  height: 800,
  boxes: [badge],
  personGuides: [
    people[0],
    {
      ...people[1],
      attentionEligible: true,
      lanyardDetected: true,
    },
  ],
});
assert.equal(visibleLanyardDoesNotAssumeBadge.unmatchedPersonCount, 0);
assert.equal(visibleLanyardDoesNotAssumeBadge.level, "none");
assert.deepEqual(visibleLanyardDoesNotAssumeBadge.reasons, []);

const obviousLargeSignFlagged = assessReviewAttention({
  status: "detected",
  width: 1000,
  height: 1000,
  boxes: [
    {
      ...badge,
      id: "wall-sign",
      x: 50,
      y: 50,
      width: 500,
      height: 300,
      source: "model",
    },
  ],
  personGuides: [],
});
assert.equal(obviousLargeSignFlagged.level, "high");
assert.match(obviousLargeSignFlagged.reasons[0], /implausibly large/);

console.log(
  JSON.stringify({
    passed: true,
    ordinaryPeopleWithoutBadgesIgnored: true,
    uncertainMasksIgnored: true,
    obviousLargeMasksFlagged: true,
    clearImagesNotFlagged: true,
    backgroundBystandersIgnored: true,
    visibleLanyardsDoNotAssumeBadges: true,
  }),
);
