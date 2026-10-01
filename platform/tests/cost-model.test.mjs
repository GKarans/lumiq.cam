import test from 'node:test';
import assert from 'node:assert/strict';
import {BILLING, estimateCosts} from '../shared/cost-model.js';
import {PLANS} from '../shared/plans.js';

test('cost model applies each event byte cap and includes retained ZIP copies', () => {
  const cappedPlans = {...PLANS, studio: {...PLANS.studio, bytes: 400 * 1024 ** 2}};
  const result = estimateCosts({
    plans: cappedPlans,
    subscribers: 1,
    mix: {studio: 1},
    eventUtilization: 1,
    averagePhotoPairMiB: 1,
    fullSizeViewsPerPhoto: 0,
    thumbnailViewsPerPhoto: 0,
  });

  assert.equal(result.monthly.events, 12);
  assert.equal(result.monthly.photos, 4800);
  assert.ok(result.monthly.photoPairGbMonths > 4.8);
  assert.ok(result.monthly.zipGbMonths > 4.3);
  assert.equal(result.monthly.r2Writes, 9612);
  assert.equal(result.monthly.r2Reads, 4800);
});

test('photo-count cap binds when average photo pairs are small', () => {
  const result = estimateCosts({
    plans: PLANS,
    subscribers: 1,
    mix: {studio: 1},
    eventUtilization: 1,
    averagePhotoPairMiB: 0.2,
    fullSizeViewsPerPhoto: 0,
    thumbnailViewsPerPhoto: 0,
  });

  assert.equal(result.monthly.photos, 12_000);
});

test('subscription payments are monthly while Single Event revenue follows purchases', () => {
  const result = estimateCosts({
    plans: PLANS,
    subscribers: 100,
    mix: {single: 0.2, gathering: 0.6, studio: 0.2},
    eventUtilization: 0.5,
    averagePhotoPairMiB: 0.4,
    fullSizeViewsPerPhoto: 0,
    thumbnailViewsPerPhoto: 0,
  });

  assert.equal(result.monthly.events, 250);
  assert.equal(result.monthly.revenueEur, 3350);
  assert.equal(result.monthly.paymentCount, 90);
});

test('invalid portfolio and negative usage assumptions are rejected', () => {
  assert.throws(() => estimateCosts({plans: PLANS, mix: {studio: 0.9}}), /sum to 1/);
  assert.throws(() => estimateCosts({plans: PLANS, averagePhotoPairMiB: -1}), /non-negative/);
});

test('thumbnail loads count as separate Worker requests and R2 reads', () => {
  const plans = {...PLANS, studio: {...PLANS.studio, events: 1, photos: 1, bytes: 2 * 1024 ** 2, retentionDays: 1}};
  const result = estimateCosts({
    plans,
    subscribers: 1,
    mix: {studio: 1},
    eventUtilization: 1,
    averagePhotoPairMiB: 1,
    fullSizeViewsPerPhoto: 2,
    thumbnailViewsPerPhoto: 3,
  });

  assert.equal(result.monthly.thumbnailViews, 3);
  assert.equal(result.monthly.workerRequests, 5);
  assert.equal(result.monthly.r2Reads, 6);
});

test('cost model includes non-photo Worker requests in request and CPU charges', () => {
  const plans = {...PLANS, studio: {...PLANS.studio, events: 1, photos: 1, bytes: 2 * 1024 ** 2, retentionDays: 1}};
  const result = estimateCosts({
    plans,
    subscribers: 1,
    mix: {studio: 1},
    eventUtilization: 1,
    averagePhotoPairMiB: 1,
    fullSizeViewsPerPhoto: 0,
    thumbnailViewsPerPhoto: 0,
    otherWorkerRequests: 10_000_000,
  });

  assert.equal(result.monthly.workerRequests, 10_000_000);
  assert.equal(result.monthly.workerCpuMs, 70_000_000);
  assert.equal(result.monthly.workerUsd, 5.8);
});

test('R2 free tier is an explicit option and storage bills fractional GB-months', () => {
  const plans = {...PLANS, studio: {...PLANS.studio, events: 1, photos: 1, bytes: 2 * 1024 ** 2, retentionDays: 1}};
  const options = {
    plans,
    subscribers: 1,
    mix: {studio: 1},
    eventUtilization: 1,
    averagePhotoPairMiB: 1,
    fullSizeViewsPerPhoto: 0,
    thumbnailViewsPerPhoto: 0,
    billing: {...BILLING, r2ClassAByMillion: 0, r2ClassBByMillion: 0},
  };
  const paid = estimateCosts(options);
  const free = estimateCosts({...options, applyR2FreeTier: true});

  assert.equal(paid.monthly.r2Usd, +((paid.monthly.photoPairGbMonths + paid.monthly.zipGbMonths) * 0.015).toFixed(2));
  assert.equal(paid.assumptions.freeR2AllowancesApplied, false);
  assert.equal(free.monthly.r2Usd, 0);
  assert.equal(free.assumptions.freeR2AllowancesApplied, true);
});
