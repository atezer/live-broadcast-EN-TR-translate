#!/bin/bash
set -e

VERSION=$(grep '"version"' manifest.json | head -1 | sed 's/.*"\([0-9.]*\)".*/\1/')
OUTPUT="live-turkish-sub-v${VERSION}.zip"

echo "Paketleniyor: ${OUTPUT}"
echo "Versiyon: ${VERSION}"
echo ""

rm -f "${OUTPUT}"

zip -r "${OUTPUT}" \
  manifest.json \
  popup.html \
  popup.js \
  content.js \
  content.css \
  background.js \
  offscreen.html \
  offscreen.js \
  privacy-policy.html \
  icons/ \
  -x "icons/.DS_Store" "*.DS_Store"

echo ""
echo "Paket oluşturuldu: ${OUTPUT}"
echo "Boyut: $(du -h "${OUTPUT}" | cut -f1)"
echo ""
echo "Sonraki adım: https://chrome.google.com/webstore/devconsole adresine yükleyin."
