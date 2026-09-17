#!/bin/sh
# Everything, in the order that fails fastest.
set -e
cd "$(dirname "$0")/.."
node tools/build.mjs
node tools/audit.mjs          | tail -1
node tools/check-imports.mjs
node tools/unused-imports.mjs | tail -1
node tools/check-strings.mjs  | tail -1
node tools/check-docs.mjs     | tail -1
node tools/test.mjs           | tail -1
node tools/plate-preview.mjs "$(mktemp -d)" | tail -1
node tools/e2e.mjs            | tail -1
