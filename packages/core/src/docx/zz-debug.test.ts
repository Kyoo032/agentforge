import { it } from "vitest";
import { diffDocuments } from "./diff";
import { readDocx } from "./read";
import { diceSimilarity, words } from "./similarity";
import { loadFixture } from "./test-support";

it("debug", async () => {
  const original = await readDocx(loadFixture("original-term-sheet"));
  const markup = await readDocx(loadFixture("lender-markup-term-sheet"));
  const ts = diffDocuments(original, markup);
  const removed = ts.changes.filter((c) => c.kind === "removed");
  let good = 0;
  let mid = 0;
  const samples: string[] = [];
  for (const change of removed) {
    const prior = original.paragraphs.find((p) => p.anchor === change.prior);
    if (!prior) continue;
    let best = 0;
    let bestText = "";
    for (const next of markup.paragraphs) {
      const score = Math.max(
        diceSimilarity(words(prior.text), words(next.text)),
        diceSimilarity(words(prior.text), words(next.originalText)),
      );
      if (score > best) {
        best = score;
        bestText = next.text;
      }
    }
    if (best >= 0.6) good += 1;
    else if (best >= 0.3) mid += 1;
    if (samples.length < 14 && prior.text.length > 30) samples.push(`${best.toFixed(2)} | ${prior.text.slice(0, 70)} || ${bestText.slice(0, 70)}`);
  }
  console.info(`TS removed=${removed.length} withGoodMatchSomewhere=${good} mid=${mid}`);
  for (const s of samples) console.info("TS SAMPLE:", s);
  console.info("ORIGINAL 17-30:", JSON.stringify(original.paragraphs.slice(17, 30).map((p) => p.text.slice(0, 60))));
  console.info("MARKUP 5-40:", JSON.stringify(markup.paragraphs.slice(5, 40).map((p) => p.text.slice(0, 60))));
});
