export const MODEL_ID = "onnx-community/grounding-dino-tiny-ONNX";
export const CLASSIFIER_MODEL_ID = "Xenova/clip-vit-base-patch32";
export const DEFAULT_LABELS = [
  "identification badge. employee ID card. conference badge. security credential. name tag.",
];
export const DEFAULT_THRESHOLD = 0.2;
export const PERSON_THRESHOLD = 0.22;
export const TORSO_THRESHOLD = 0.5;
export const LANYARD_THRESHOLD = 0.18;
export const LANYARD_BADGE_THRESHOLD = 0.24;
export const LANYARD_PROMPT = "lanyard. neck strap. badge lanyard.";
export const CLASSIFIER_MARGIN = 0.2;
export const CLASSIFIER_LABELS = [
  "an employee identification badge hanging from a lanyard",
  "a plastic photo ID card or conference name badge",
  "a shirt logo or printed clothing",
  "a pocket, button, zipper, or clothing detail",
  "a wall sign, sheet of paper, or equipment label",
];
export const CLASSIFIER_POSITIVE_LABEL_COUNT = 2;
export const GLOBAL_CLASSIFIER_LABELS = [
  "an employee identification badge hanging from a lanyard",
  "a plastic photo ID card or conference name badge",
  "a workplace security credential or visitor badge clipped to clothing",
  "a shirt logo or printed clothing",
  "a pocket, button, zipper, or clothing detail",
  "a wall sign, sheet of paper, or equipment label",
  "an embroidered military or organizational shoulder patch",
  "a sewn uniform insignia or rank patch",
  "a sticker or label on equipment or a control panel",
  "a phone, radio, pen, or tool clipped to clothing",
  "a lanyard clip or neck strap without an identification card",
];
export const GLOBAL_CLASSIFIER_POSITIVE_LABEL_COUNT = 3;
export const GLOBAL_CLASSIFIER_MAX_SCORE = 0.5;
export const GLOBAL_CLASSIFIER_REJECT_MARGIN = -0.5;
export const EXTENDED_TORSO_MIN_SCORE = 0.4;
export const EXTENDED_TORSO_CLASSIFIER_MARGIN = 0.05;
export const CROPPED_FOREGROUND_MIN_SCORE = 0.3;
export const CROPPED_FOREGROUND_CLASSIFIER_MARGIN = 0.2;
export const NO_PERSON_MIN_SCORE = 0.45;
export const NO_PERSON_CLASSIFIER_MARGIN = 0.2;
export const GLOBAL_BADGE_MAX_AREA_RATIO = 0.1;
export const TORSO_BADGE_MAX_AREA_RATIO = 0.12;
export const DEFAULT_PADDING_PERCENT = 18;
export const DEFAULT_REDACTION_STYLE = "gaussian";
export const DEFAULT_REDACTION_STRENGTH = 3;
export const DEFAULT_FEATHER_PERCENT = 10;
