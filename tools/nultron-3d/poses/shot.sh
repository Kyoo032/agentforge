#!/bin/bash
# usage: poses/shot.sh <out.png> <query>   (any folder; output paths are relative to tools/nultron-3d)
cd "$(dirname "$0")/.."
mkdir -p work
rm -f work/poses-run.log
timeout 200 node poses/preview.mjs --out "$1" --query "$2" --timeout 150000 > /dev/null 2>&1
grep -E "preview: (wrote|Error)|page error|\[page:[23]\] [^%]" work/poses-run.log | tail -5
