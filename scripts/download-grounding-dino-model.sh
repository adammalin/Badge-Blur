#!/usr/bin/env bash
set -euo pipefail

MODEL_REVISION="ff690b0a8050566c290287545bd059350f3e9096"
MODEL_ROOT="public/models/onnx-community/grounding-dino-tiny-ONNX"
MODEL_URL_ROOT="https://huggingface.co/onnx-community/grounding-dino-tiny-ONNX/resolve/${MODEL_REVISION}"
MODEL_SHA256="70bf2d3310d1ae73769c96a71e00cbf2861eb33a1f4d97d84a108a7bf02c03c9"

mkdir -p "${MODEL_ROOT}/onnx"

files=(
  "config.json"
  "preprocessor_config.json"
  "special_tokens_map.json"
  "tokenizer.json"
  "tokenizer_config.json"
  "vocab.txt"
)

for file in "${files[@]}"; do
  destination="${MODEL_ROOT}/${file}"
  if [[ ! -s "${destination}" ]]; then
    echo "Downloading ${file}"
    curl --fail --location --retry 3 \
      "${MODEL_URL_ROOT}/${file}?download=true" \
      --output "${destination}"
  fi
done

model_destination="${MODEL_ROOT}/onnx/model_quantized.onnx"
if [[ ! -s "${model_destination}" ]]; then
  echo "Downloading quantized Grounding DINO Tiny ONNX model (about 204 MB)"
  curl --fail --location --retry 3 \
    "${MODEL_URL_ROOT}/onnx/model_quantized.onnx?download=true" \
    --output "${model_destination}"
fi

actual_sha256="$(shasum -a 256 "${model_destination}" | awk '{print $1}')"
if [[ "${actual_sha256}" != "${MODEL_SHA256}" ]]; then
  echo "Model checksum mismatch." >&2
  echo "Expected: ${MODEL_SHA256}" >&2
  echo "Actual:   ${actual_sha256}" >&2
  exit 1
fi

echo "Grounding DINO model verified: ${actual_sha256}"
