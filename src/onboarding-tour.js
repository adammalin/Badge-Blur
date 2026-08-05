export const ONBOARDING_TOUR_VERSION = "1";
export const ONBOARDING_TOUR_STORAGE_KEY = "badge-blur-onboarding-tour";

export const ONBOARDING_TOUR_STEPS = Object.freeze([
  Object.freeze({
    id: "welcome",
    selector: ".title-lockup",
    stage: "setup",
    title: "Welcome to Badge Blur",
    body: "Badge Blur finds likely ID badges locally, lets you review every mask, and exports redacted copies without changing your originals.",
  }),
  Object.freeze({
    id: "source",
    selector: "#chooseSourceButton",
    stage: "setup",
    title: "Choose a folder of photos",
    body: "Start with the source folder you want to process. Badge Blur reads supported photos from that folder and keeps the originals untouched.",
  }),
  Object.freeze({
    id: "format",
    selector: "#outputFormatInput",
    stage: "setup",
    title: "Choose the output format",
    body: "Pick the format for redacted copies before starting. The default destination remains a nested exports folder beside the source images.",
  }),
  Object.freeze({
    id: "settings",
    selector: ".advanced-settings summary",
    stage: "setup",
    title: "Adjust only when needed",
    body: "Advanced settings control detection, blur, mask expansion, and processing speed. The defaults are designed to be a good starting point.",
  }),
  Object.freeze({
    id: "start",
    selector: "#runAllButton",
    stage: "setup",
    title: "Start local processing",
    body: "After choosing a folder and output format, this button becomes available. Processing stays on this computer and can be paused safely.",
  }),
  Object.freeze({
    id: "review",
    selector: "#review-title",
    stage: "review",
    title: "Review every photo",
    body: "After processing, review begins at the first image. Add, reshape, remove, or strengthen badge masks, then use Save, review & next to continue.",
  }),
  Object.freeze({
    id: "assistance",
    selector: "#attentionQueueButton",
    stage: "review",
    title: "Ready for review is normal",
    body: "Most photos should simply be ready for review. Badge Blur only calls attention to the clearest mask or processing problems; your visual check remains the final decision.",
  }),
  Object.freeze({
    id: "export",
    selector: "#exportAllButton",
    stage: "review",
    title: "Export after review",
    body: "Once every photo is reviewed, Export all becomes the final action. Later edits can be re-exported individually or as changed images only.",
  }),
  Object.freeze({
    id: "replay",
    selector: "#tutorialButton",
    stage: null,
    title: "Replay this tour anytime",
    body: "Use Tutorial in the upper-right corner whenever you want to walk through the workflow again.",
  }),
]);

export function shouldShowOnboardingTour(storedVersion) {
  return String(storedVersion || "") !== ONBOARDING_TOUR_VERSION;
}

export function clampTourStep(index, stepCount = ONBOARDING_TOUR_STEPS.length) {
  const maximum = Math.max(0, Number(stepCount) - 1);
  return Math.min(maximum, Math.max(0, Math.trunc(Number(index) || 0)));
}

export function tourCardPosition(
  targetRect,
  cardSize,
  viewport,
  { margin = 16, gap = 18 } = {},
) {
  const viewportWidth = Math.max(0, Number(viewport?.width) || 0);
  const viewportHeight = Math.max(0, Number(viewport?.height) || 0);
  const cardWidth = Math.min(
    Math.max(0, Number(cardSize?.width) || 0),
    Math.max(0, viewportWidth - margin * 2),
  );
  const cardHeight = Math.min(
    Math.max(0, Number(cardSize?.height) || 0),
    Math.max(0, viewportHeight - margin * 2),
  );
  const maxLeft = Math.max(margin, viewportWidth - cardWidth - margin);
  const maxTop = Math.max(margin, viewportHeight - cardHeight - margin);
  const clampLeft = (value) => Math.min(maxLeft, Math.max(margin, value));
  const clampTop = (value) => Math.min(maxTop, Math.max(margin, value));

  if (!targetRect) {
    return {
      placement: "center",
      left: clampLeft((viewportWidth - cardWidth) / 2),
      top: clampTop((viewportHeight - cardHeight) / 2),
    };
  }

  const target = {
    left: Number(targetRect.left) || 0,
    right: Number(targetRect.right) || 0,
    top: Number(targetRect.top) || 0,
    bottom: Number(targetRect.bottom) || 0,
    width: Number(targetRect.width) || 0,
    height: Number(targetRect.height) || 0,
  };
  const centeredLeft = clampLeft(
    target.left + target.width / 2 - cardWidth / 2,
  );
  const centeredTop = clampTop(
    target.top + target.height / 2 - cardHeight / 2,
  );

  if (target.bottom + gap + cardHeight <= viewportHeight - margin) {
    return {
      placement: "below",
      left: centeredLeft,
      top: target.bottom + gap,
    };
  }
  if (target.top - gap - cardHeight >= margin) {
    return {
      placement: "above",
      left: centeredLeft,
      top: target.top - gap - cardHeight,
    };
  }
  if (target.right + gap + cardWidth <= viewportWidth - margin) {
    return {
      placement: "right",
      left: target.right + gap,
      top: centeredTop,
    };
  }
  if (target.left - gap - cardWidth >= margin) {
    return {
      placement: "left",
      left: target.left - gap - cardWidth,
      top: centeredTop,
    };
  }
  return {
    placement: "center",
    left: clampLeft((viewportWidth - cardWidth) / 2),
    top: clampTop((viewportHeight - cardHeight) / 2),
  };
}
