#!/usr/bin/env bash
set -euo pipefail

MODEL_REVISION="3e255bc9bf304b3358a8c1945c0a9514eefe7f10"
MODEL_ROOT="public/models/Xenova/owlv2-base-patch16-ensemble"
MODEL_URL_ROOT="https://huggingface.co/Xenova/owlv2-base-patch16-ensemble/resolve/${MODEL_REVISION}"
MODEL_SHA256="af8d6a041e4114b06eafabb03047350c7b8f136670a3f8afc7e73c5a74c2b24b"

mkdir -p "${MODEL_ROOT}/onnx"

files=(
  "config.json"
  "merges.txt"
  "preprocessor_config.json"
  "quantize_config.json"
  "special_tokens_map.json"
  "tokenizer.json"
  "tokenizer_config.json"
  "vocab.json"
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
  echo "Downloading quantized OWLv2 ONNX model (about 155 MB)"
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
  echo "Model checksum mismatch." >&2
  echo "Expected: ${MODEL_SHA256}" >&2
  echo "Actual:   ${actual_sha256}" >&2
  exit 1
fi

echo "Model verified: ${actual_sha256}"
