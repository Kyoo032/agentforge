export type NumberSummary = {
  min: number;
  max: number;
  mean: number;
  median: number;
  /** Population standard deviation. */
  stddev: number;
};

function medianOf(sorted: ReadonlyArray<number>): number {
  const middle = Math.floor(sorted.length / 2);
  const upper = sorted[middle] as number;
  if (sorted.length % 2 === 1) {
    return upper;
  }
  return ((sorted[middle - 1] as number) + upper) / 2;
}

/** Summary statistics over a list of numbers; null for an empty list. */
export function summarizeNumbers(numbers: ReadonlyArray<number>): NumberSummary | null {
  if (numbers.length === 0) {
    return null;
  }
  const sorted = [...numbers].sort((a, b) => a - b);
  const mean = numbers.reduce((sum, value) => sum + value, 0) / numbers.length;
  const variance = numbers.reduce((sum, value) => sum + (value - mean) ** 2, 0) / numbers.length;
  return {
    min: sorted[0] as number,
    max: sorted[sorted.length - 1] as number,
    mean,
    median: medianOf(sorted),
    stddev: Math.sqrt(variance),
  };
}
