export function nCk(n, k) {
  if (!Number.isInteger(n) || !Number.isInteger(k) || k < 0 || k > n) return 0;
  if (k === 0 || k === n) return 1;
  k = Math.min(k, n - k);
  let result = 1;
  for (let i = 0; i < k; i += 1) result = (result * (n - i)) / (i + 1);
  return result;
}

export function passHatK(n, successes, k) {
  if (k > n) throw new Error(`pass^k needs n>=k (n=${n}, k=${k})`);
  if (successes < k) return 0;
  return nCk(successes, k) / nCk(n, k);
}

export function wilsonInterval(successes, n, z = 1.96) {
  if (n === 0) return { low: 0, high: 1 };
  const p = successes / n;
  const denom = 1 + (z * z) / n;
  const center = p + (z * z) / (2 * n);
  const margin = z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n));
  return {
    low: Math.max(0, (center - margin) / denom),
    high: Math.min(1, (center + margin) / denom),
  };
}

export function cohensKappa(judgePass, humanPass) {
  if (judgePass.length !== humanPass.length || judgePass.length === 0) {
    throw new Error("kappa needs equal, non-empty arrays");
  }
  const n = judgePass.length;
  const agree = judgePass.filter((value, index) => value === humanPass[index]).length / n;
  const judgeRate = judgePass.filter(Boolean).length / n;
  const humanRate = humanPass.filter(Boolean).length / n;
  const expected = judgeRate * humanRate + (1 - judgeRate) * (1 - humanRate);
  return expected === 1 ? 1 : (agree - expected) / (1 - expected);
}

export function spearmanRho(judge, human) {
  if (judge.length !== human.length || judge.length === 0) {
    throw new Error("spearman needs equal, non-empty arrays");
  }
  const rank = (values) => {
    const sorted = values.map((value, index) => [value, index]).sort((a, b) => a[0] - b[0]);
    const ranks = new Array(values.length);
    for (let i = 0; i < sorted.length;) {
      let end = i;
      while (end + 1 < sorted.length && sorted[end + 1][0] === sorted[i][0]) end += 1;
      const average = (i + end) / 2 + 1;
      for (let j = i; j <= end; j += 1) ranks[sorted[j][1]] = average;
      i = end + 1;
    }
    return ranks;
  };
  const left = rank(judge);
  const right = rank(human);
  const mean = (judge.length + 1) / 2;
  let numerator = 0;
  let leftVariance = 0;
  let rightVariance = 0;
  for (let i = 0; i < judge.length; i += 1) {
    const a = left[i] - mean;
    const b = right[i] - mean;
    numerator += a * b;
    leftVariance += a * a;
    rightVariance += b * b;
  }
  return leftVariance === 0 || rightVariance === 0
    ? 0
    : numerator / Math.sqrt(leftVariance * rightVariance);
}

export function repairConvergenceRate(outcomes) {
  if (!Array.isArray(outcomes) || outcomes.length === 0) return 0;
  return outcomes.filter((outcome) => outcome.converged === true).length / outcomes.length;
}
