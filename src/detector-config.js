export const MODEL_ID = "onnx-community/grounding-dino-tiny-ONNX";
export const CLASSIFIER_MODEL_ID = "Xenova/clip-vit-base-patch32";
export const DEFAULT_LABELS = [
  "identification badge. employee ID card. conference badge. security credential. name tag.",
];
export const DEFAULT_THRESHOLD = 0.2;
export const PERSON_THRESHOLD = 0.22;
export const TORSO_THRESHOLD = 0.5;
export const CLASSIFIER_MARGIN = 0.2;
export const CLASSIFIER_LABELS = [
  "an employee identification badge hanging from a lanyard",
  "a plastic photo ID card or conference name badge",
  "a shirt logo or printed clothing",
  "a pocket, button, zipper, or clothing detail",
  "a wall sign, sheet of paper, or equipment label",
];
export const DEFAULT_PADDING_PERCENT = 18;
export const DEFAULT_REDACTION_STRENGTH = 24;
export const DEFAULT_FEATHER_PERCENT = 10;
