import assert from "node:assert/strict";
import {
  GLOBAL_BADGE_MAX_AREA_RATIO,
  TORSO_BADGE_MAX_AREA_RATIO,
} from "../src/detector-config.js";
import {
  filterBadgeDetections,
  isPlausibleBadgeBox,
} from "../src/detection-utils.js";

const image = { width: 1000, height: 1000 };
const largeCloseBadge = {
  id: "large-close-badge",
  x: 350,
  y: 500,
  width: 250,
  height: 240,
  score: 0.76,
};

assert.equal(isPlausibleBadgeBox(largeCloseBadge, image), false);
assert.equal(
  isPlausibleBadgeBox(largeCloseBadge, image, {
    maxAreaRatio: GLOBAL_BADGE_MAX_AREA_RATIO,
  }),
  true,
);
assert.equal(
  filterBadgeDetections([largeCloseBadge], image, {
    maxAreaRatio: GLOBAL_BADGE_MAX_AREA_RATIO,
  }).length,
  1,
);
assert.ok(TORSO_BADGE_MAX_AREA_RATIO > GLOBAL_BADGE_MAX_AREA_RATIO);

const implausiblyHugeCandidate = {
  ...largeCloseBadge,
  id: "implausibly-huge",
  x: 100,
  y: 200,
  width: 800,
  height: 700,
};
assert.equal(
  isPlausibleBadgeBox(implausiblyHugeCandidate, image, {
    maxAreaRatio: GLOBAL_BADGE_MAX_AREA_RATIO,
  }),
  false,
);

console.log(JSON.stringify({
  passed: true,
  largeCloseBadgeRetained: true,
  implausiblyHugeCandidateRejected: true,
}));
