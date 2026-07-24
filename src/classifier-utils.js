export function classifierEvidence(
  classifications,
  labels,
  positiveLabelCount,
) {
  const scores = Object.fromEntries(
    classifications.map(({ label, score }) => [label, Number(score)]),
  );
  const positiveScore = Math.max(
    ...labels
      .slice(0, positiveLabelCount)
      .map((label) => scores[label] ?? Number.NEGATIVE_INFINITY),
  );
  const negativeScore = Math.max(
    ...labels
      .slice(positiveLabelCount)
      .map((label) => scores[label] ?? Number.NEGATIVE_INFINITY),
  );
  return {
    positiveScore,
    negativeScore,
    margin: positiveScore - negativeScore,
    topLabel: classifications[0]?.label || null,
  };
}

export function globalClassifierDecision(
  detectionScore,
  evidence,
  maxDetectionScore,
  rejectMargin,
) {
  if (detectionScore > maxDetectionScore) {
    return "kept-high-confidence";
  }
  return evidence.margin >= rejectMargin
    ? "kept-classified"
    : "rejected-negative";
}
