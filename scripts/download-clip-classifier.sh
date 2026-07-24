#!/usr/bin/env bash
set -euo pipefail

MODEL_REVISION="d15189d7028b43f1d3e65039190477f6af591c2a"
MODEL_ROOT="public/models/Xenova/clip-vit-base-patch32"
MODEL_URL_ROOT="https://huggingface.co/Xenova/clip-vit-base-patch32/resolve/${MODEL_REVISION}"
MODEL_SHA256="0898a3facfdb27f0a041e57649b4989cfd094e4a0040d6ae75ed69917dfc7328"

mkdir -p "${MODEL_ROOT}/onnx"

files=(
  "config.json"
  "merges.txt"
  "preprocessor_config.json"
  "special_tokens_map.json"
  "tokenizer.json"
  "tokenizer_config.json"
  "vocab.json"
)

for file in "${files[@]}"; do
  destination="${MODEL_ROOT}/${file}"
  if [[ ! -s "${destination}" ]]; then
    echo "Downloading CLIP ${file}"
    curl --fail --location --retry 3 \
      "${MODEL_URL_ROOT}/${file}?download=true" \
      --output "${destination}"
  fi
done

model_destination="${MODEL_ROOT}/onnx/model_quantized.onnx"
if [[ ! -s "${model_destination}" ]]; then
  echo "Downloading quantized CLIP classifier (about 154 MB)"
  curl --fail --location --retry 3 \
    "${MODEL_URL_ROOT}/onnx/model_quantized.onnx?download=true" \
    --output "${model_destination}"
fi

if command -v shasum >/dev/null 2>&1; then
  actual_sha256="$(shasum -a 256 "${model_destination}" | awk '{print $1}')"
else
  actual_sha256="$(sha256sum "${model_destination}" | awk '{print $1}')"
fi
if [[ "${actual_sha256}" != "${MODEL_SHA256}" ]]; then
  echo "CLIP classifier checksum mismatch." >&2
  echo "Expected: ${MODEL_SHA256}" >&2
  echo "Actual:   ${actual_sha256}" >&2
  exit 1
fi

echo "CLIP classifier verified: ${actual_sha256}"
