const COMMON_RATES = [
  [23.976, 24000, 1001],
  [29.97, 30000, 1001],
  [59.94, 60000, 1001],
  [119.88, 120000, 1001],
];

export function normalizeFrameRate(value) {
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new TypeError('Frame rate must be finite.');
    const common = COMMON_RATES.find(([rate]) => Math.abs(rate - value) < 0.0005);
    if (common) return `${common[1]}/${common[2]}`;
    return normalizeFrameRate(String(value));
  }
  if (typeof value !== 'string') throw new TypeError('Frame rate must be an integer, decimal, or rational string.');
  const input = value.trim();
  const rational = /^(\d+)\/(\d+)$/.exec(input);
  if (rational) {
    let numerator = Number(rational[1]);
    let denominator = Number(rational[2]);
    if (!Number.isSafeInteger(numerator) || !Number.isSafeInteger(denominator) || denominator <= 0) throw new TypeError('Frame rate rational must use positive safe integers.');
    const divisor = gcd(numerator, denominator);
    numerator /= divisor;
    denominator /= divisor;
    const rate = numerator / denominator;
    validateRate(rate);
    return denominator === 1 ? numerator : `${numerator}/${denominator}`;
  }
  if (!/^\d+(?:\.\d+)?$/.test(input)) throw new TypeError('Frame rate must be an integer, decimal, or numerator/denominator value.');
  const decimal = Number(input);
  if (!Number.isFinite(decimal)) throw new TypeError('Frame rate must be finite.');
  const common = COMMON_RATES.find(([rate]) => Math.abs(rate - decimal) < 0.0005);
  if (common) return `${common[1]}/${common[2]}`;
  const [whole, fraction = ''] = input.split('.');
  const denominator = 10 ** fraction.length;
  const numerator = Number(whole) * denominator + Number(fraction || 0);
  return normalizeFrameRate(`${numerator}/${denominator}`);
}

export function frameRateNumber(value) {
  if (typeof value === 'number') {
    validateRate(value);
    return value;
  }
  const normalized = normalizeFrameRate(value);
  if (typeof normalized === 'number') return normalized;
  const [numerator, denominator] = normalized.split('/').map(Number);
  return numerator / denominator;
}

function validateRate(rate) {
  if (!Number.isFinite(rate) || rate < 1 || rate > 240) throw new TypeError('Frame rate must be between 1 and 240 fps.');
}

function gcd(a, b) {
  while (b !== 0) [a, b] = [b, a % b];
  return Math.abs(a);
}
