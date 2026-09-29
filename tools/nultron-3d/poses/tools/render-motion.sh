#!/bin/bash
# Renders the one-shot clip strips (work/poses/clip-<state>.png) and the loop strips (work/poses/loop-<state>.png) with poses/preview.mjs.
cd "$(dirname "$0")/../.."
mkdir -p work/poses
node -e "
const p=require('./poses.json');
for (const [n,s] of Object.entries(p.states)) {
  if (s.clip) console.log('clip', n, (s.clip.frames.at(-1).f / s.clip.fps).toFixed(4));
  if (s.loop) console.log('loop', n, (3 / s.loop.fps).toFixed(4));
}" | while read kind state t1; do
  if [ "$kind" = "clip" ]; then
    poses/shot.sh "work/poses/clip-$state.png" "model=real&view=front&cols=8&tw=320&th=400&states=$state&strip=8&t0=0&t1=$t1"
  else
    poses/shot.sh "work/poses/loop-$state.png" "model=real&view=front&cols=4&tw=300&th=380&states=$state&strip=4&t0=0&t1=$t1&mode=loop"
  fi
done
