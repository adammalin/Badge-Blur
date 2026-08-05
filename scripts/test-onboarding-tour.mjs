import assert from "node:assert/strict";
import {
  ONBOARDING_TOUR_STEPS,
  ONBOARDING_TOUR_VERSION,
  clampTourStep,
  shouldShowOnboardingTour,
  tourCardPosition,
} from "../src/onboarding-tour.js";

assert.equal(shouldShowOnboardingTour(null), true);
assert.equal(shouldShowOnboardingTour("old"), true);
assert.equal(shouldShowOnboardingTour(ONBOARDING_TOUR_VERSION), false);
assert.equal(clampTourStep(-4), 0);
assert.equal(clampTourStep(999), ONBOARDING_TOUR_STEPS.length - 1);
assert.equal(ONBOARDING_TOUR_STEPS.at(0).id, "welcome");
assert.equal(ONBOARDING_TOUR_STEPS.at(-1).selector, "#tutorialButton");
assert.ok(ONBOARDING_TOUR_STEPS.some((step) => step.stage === "review"));

const card = { width: 320, height: 220 };
const viewport = { width: 1200, height: 800 };
assert.equal(
  tourCardPosition(
    { left: 300, right: 500, top: 100, bottom: 180, width: 200, height: 80 },
    card,
    viewport,
  ).placement,
  "below",
);
assert.equal(
  tourCardPosition(
    { left: 300, right: 500, top: 650, bottom: 720, width: 200, height: 70 },
    card,
    viewport,
  ).placement,
  "above",
);
assert.deepEqual(
  tourCardPosition(null, card, viewport),
  { placement: "center", left: 440, top: 290 },
);

console.log("Onboarding tour helpers passed.");
