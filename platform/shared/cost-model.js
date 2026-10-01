const BILLING = Object.freeze({
  r2StoragePerGbMonth: 0.015,
  r2ClassAByMillion: 4.5,
  r2ClassBByMillion: 0.36,
  r2FreeStorageGbMonth: 10,
  r2FreeClassA: 1_000_000,
  r2FreeClassB: 10_000_000,
  workerBaseUsd: 5,
  workerIncludedRequests: 10_000_000,
  workerRequestPerMillionUsd: 0.3,
  workerIncludedCpuMs: 30_000_000,
  workerCpuPerMillionMsUsd: 0.02,
  supabaseProUsd: 25,
  usdToEur: 0.8797,
  stripePercent: 0.015,
  stripeFixedEur: 0.25,
});

const ceilBillable = (usage, included, unit) =>
  Math.ceil(Math.max(0, usage - included) / unit);

export function estimateCosts({
  plans,
  subscribers = 100,
  mix = { single: 0.2, gathering: 0.6, studio: 0.2 },
  eventUtilization = 0.55,
  averagePhotoPairMiB = 1.08,
  originalFraction = 0.9,
  eventDurationDays = 1,
  fullSizeViewsPerPhoto = 100,
  thumbnailViewsPerPhoto = 100,
  otherWorkerRequests = 0,
  emailUsd = 0,
  billing = BILLING,
  applyR2FreeTier = false,
} = {}) {
  if (!plans || !Number.isFinite(subscribers) || subscribers < 0) throw new Error('Invalid plan or subscriber count');
  if (Math.abs(Object.values(mix).reduce((sum, share) => sum + share, 0) - 1) > 1e-9) throw new Error('Plan mix must sum to 1');
  if (![eventUtilization, originalFraction].every((n) => Number.isFinite(n) && n >= 0 && n <= 1)) throw new Error('Utilization and original fraction must be between 0 and 1');
  if (![averagePhotoPairMiB, eventDurationDays, fullSizeViewsPerPhoto, thumbnailViewsPerPhoto, otherWorkerRequests, emailUsd].every((n) => Number.isFinite(n) && n >= 0)) throw new Error('Usage assumptions must be non-negative numbers');

  let revenueEur = 0;
  let paymentCount = 0;
  let events = 0;
  let photos = 0;
  let photoPairGbMonths = 0;
  let zipGbMonths = 0;
  let zipBytes = 0;

  for (const [id, share] of Object.entries(mix)) {
    const plan = plans[id];
    if (!plan || !Number.isFinite(share) || share < 0) throw new Error(`Invalid plan mix entry: ${id}`);
    const accounts = subscribers * share;
    const eventCount = accounts * plan.events * eventUtilization;
    const photosPerEvent = Math.min(plan.photos, plan.bytes / 1024 ** 2 / averagePhotoPairMiB);
    const photoCount = eventCount * photosPerEvent;
    const pairBytesPerEvent = photosPerEvent * averagePhotoPairMiB * 1024 ** 2;
    const pairsBytes = eventCount * pairBytesPerEvent;
    const archivesBytes = pairsBytes * originalFraction;

    events += eventCount;
    photos += photoCount;
    photoPairGbMonths += pairsBytes / 1e9 * (eventDurationDays + plan.retentionDays) / 30;
    zipGbMonths += archivesBytes / 1e9 * plan.retentionDays / 30;
    zipBytes += archivesBytes;

    if (plan.billing === 'monthly') {
      revenueEur += accounts * plan.price / 100;
      paymentCount += accounts;
    } else if (plan.billing === 'one_time') {
      revenueEur += eventCount * plan.price / 100;
      paymentCount += eventCount;
    }
  }

  const totalGbMonths = photoPairGbMonths + zipGbMonths;
  const imageViews = photos * fullSizeViewsPerPhoto;
  const thumbnailViews = photos * thumbnailViewsPerPhoto;
  const r2Writes = photos * 2 + events;
  const r2Reads = imageViews + thumbnailViews + photos;
  const r2StorageUsd = Math.max(0, totalGbMonths - (applyR2FreeTier ? billing.r2FreeStorageGbMonth : 0)) * billing.r2StoragePerGbMonth;
  const r2ClassAUsd = ceilBillable(r2Writes, applyR2FreeTier ? billing.r2FreeClassA : 0, 1_000_000) * billing.r2ClassAByMillion;
  const r2ClassBUsd = ceilBillable(r2Reads, applyR2FreeTier ? billing.r2FreeClassB : 0, 1_000_000) * billing.r2ClassBByMillion;
  const workerRequests = imageViews + thumbnailViews + otherWorkerRequests;
  const workerCpuMs = workerRequests * 7;
  const workerUsd = billing.workerBaseUsd
    + ceilBillable(workerRequests, billing.workerIncludedRequests, 1_000_000) * billing.workerRequestPerMillionUsd
    + ceilBillable(workerCpuMs, billing.workerIncludedCpuMs, 1_000_000) * billing.workerCpuPerMillionMsUsd;
  const r2Usd = r2StorageUsd + r2ClassAUsd + r2ClassBUsd;
  const stripeEur = paymentCount * (revenueEur / Math.max(paymentCount, 1) * billing.stripePercent + billing.stripeFixedEur);
  const platformUsd = billing.supabaseProUsd + workerUsd + r2Usd + emailUsd;
  const totalCostEur = platformUsd * billing.usdToEur + stripeEur;

  return {
    assumptions: { subscribers, mix, eventUtilization, averagePhotoPairMiB, originalFraction, eventDurationDays, fullSizeViewsPerPhoto, thumbnailViewsPerPhoto, otherWorkerRequests, emailUsd, freeR2AllowancesApplied: applyR2FreeTier },
    monthly: {
      revenueEur: +revenueEur.toFixed(2),
      paymentCount: +paymentCount.toFixed(1),
      events: +events.toFixed(1),
      photos: Math.round(photos),
      photoPairGbMonths: +photoPairGbMonths.toFixed(2),
      zipGbMonths: +zipGbMonths.toFixed(2),
      zipBytes: Math.round(zipBytes),
      thumbnailViews: Math.round(thumbnailViews),
      r2Writes: Math.round(r2Writes),
      r2Reads: Math.round(r2Reads),
      workerRequests: Math.round(workerRequests),
      workerCpuMs: Math.round(workerCpuMs),
      r2Usd: +r2Usd.toFixed(2),
      workerUsd: +workerUsd.toFixed(2),
      supabaseUsd: +billing.supabaseProUsd.toFixed(2),
      emailUsd: +emailUsd.toFixed(2),
      platformUsd: +platformUsd.toFixed(2),
      stripeEur: +stripeEur.toFixed(2),
      modeledCostEur: +totalCostEur.toFixed(2),
      contributionBeforeTaxSupportAndOtherCostsEur: +(revenueEur - totalCostEur).toFixed(2),
    },
    exclusions: ['VAT and taxes', 'backups', 'support and labor', 'refunds and chargebacks', 'API requests other than modeled photo views', 'multipart ZIP operations and retries', 'database growth and future compute upgrades'],
  };
}

export { BILLING };
