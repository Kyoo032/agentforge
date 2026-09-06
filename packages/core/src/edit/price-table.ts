export type PriceResolution = "480p" | "720p" | "1080p";

export type PriceRow = {
  match: RegExp;
  usdPerSecond?: number;
  usdPerImage?: number;
  usdPerCall?: number;
  resolutionMultiplier?: Partial<Record<PriceResolution, number>>;
  asOf: string;
};

export const PRICE_TABLE: PriceRow[] = [
  {
    match: /^grok-imagine-video/i,
    usdPerSecond: 0.06,
    asOf: "2026-09",
  },
  {
    match: /^seedance-2\.0-fast$/i,
    usdPerSecond: 0.3,
    resolutionMultiplier: { "480p": 0.5, "720p": 1, "1080p": 2 },
    asOf: "2026-09",
  },
  {
    match: /^gpt-image-2$/i,
    usdPerImage: 0.04,
    asOf: "2026-09",
  },
];

const NINETY_DAYS_MS = 90 * 24 * 60 * 60 * 1000;

export function parseAsOf(asOf: string): Date {
  if (/^\d{4}-\d{2}$/.test(asOf)) {
    return new Date(`${asOf}-01T00:00:00.000Z`);
  }
  return new Date(asOf);
}

export function isPriceRowStale(row: PriceRow, now: Date = new Date()): boolean {
  const asOf = parseAsOf(row.asOf);
  if (Number.isNaN(asOf.getTime())) {
    return true;
  }
  return now.getTime() - asOf.getTime() > NINETY_DAYS_MS;
}

export function findPriceRow(model: string, now: Date = new Date()): PriceRow | undefined {
  const row = PRICE_TABLE.find((item) => item.match.test(model));
  if (!row || isPriceRowStale(row, now)) {
    return undefined;
  }
  return row;
}

export function estimateJobUsd(
  model: string,
  opts: { seconds?: number; resolution?: PriceResolution; count?: number } = {},
  now: Date = new Date(),
): number | null {
  const row = findPriceRow(model, now);
  if (!row) {
    return null;
  }
  if (row.usdPerImage !== undefined) {
    const count = opts.count ?? 1;
    return row.usdPerImage * count;
  }
  if (row.usdPerCall !== undefined && opts.seconds === undefined) {
    return row.usdPerCall * (opts.count ?? 1);
  }
  if (row.usdPerSecond !== undefined) {
    if (opts.seconds === undefined || !Number.isFinite(opts.seconds)) {
      return null;
    }
    const multiplier = opts.resolution ? (row.resolutionMultiplier?.[opts.resolution] ?? 1) : 1;
    return row.usdPerSecond * opts.seconds * multiplier;
  }
  if (row.usdPerCall !== undefined) {
    return row.usdPerCall * (opts.count ?? 1);
  }
  return null;
}
