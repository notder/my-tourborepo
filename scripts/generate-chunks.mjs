#!/usr/bin/env zx

import { readFileSync, writeFileSync } from 'fs';
import path from 'path';

const NUM_BUCKETS = process.env.TESTS_NUM_CHUNKS || 1;

// Download latest jest package timings for each chunk from the last green build
// on the default branch.
const downloadTimings = async () => {
  await $`mkdir -p ./test-results`;

  const downloads = [];
  for (let i = 0; i < NUM_BUCKETS; i += 1) {
    downloads.push($`wget https://[hostname]/test-results/timings_${i}.json -N -P ./test-results`);
  }

  try {
    await Promise.allSettled(downloads);
  } catch {
    console.error('Error downloading one or more timings report.');
  }
};

// Merges timings for each chunk into a single entity.
const getPreviousTimings = async () => {
  await downloadTimings();

  let previousTimings = {};
  for (let i = 0; i < NUM_BUCKETS; i += 1) {
    try {
      const bucketTiming = JSON.parse(
        readFileSync(path.resolve(`./test-results/timings_${i}.json`)),
      );
      previousTimings = { ...previousTimings, ...bucketTiming };
    } catch {
      console.warn(
        `Error downloading/parsing previous timings for timings_${i}.json.`,
      );
    }
  }
  return previousTimings;
};

// Its possible that at the package for an existing timing was removed, or a new
// package was added that doesn't yet have a timing report.  This handles this
// reconciliation and transforms the result into an object array for balancing.
const reconcilePackages = async (previousTimings) => {
  const { stdout } = await $`lerna ls --all --json | jq 'map(.name)'`;
  console.log('stdout:', stdout);
  const allPackages = JSON.parse(stdout);
  console.log('allPackages:', allPackages);
  const result = allPackages.reduce((c, p) => {
    c.push({
      [p]: previousTimings[p] || 0,
    });
    return c;
  }, []);
  console.log('result:', result);
  return result;
};

const getTiming = (entry) => {
  if (entry) {
    return entry[Object.keys(entry)[0]];
  }
  return undefined;
};

/*
Returns a single bucket of packages that in total, meet target sum.
*/
const getBucket = (A, target) => {
  const last = A.pop();
  let sum = getTiming(last);
  const result = [last];

  if (A.length === 0) return result;

  let cursor = A.length - 1;
  while (sum <= target && cursor >= 0) {
    if (sum + getTiming(A[cursor]) <= target) {
      const [elem] = A.splice(cursor, 1);
      result.push(elem);
      sum += getTiming(elem);
    } else {
      cursor -= 1;
    }
  }

  return result;
};

/*
Balancing algorithum: https://en.wikipedia.org/wiki/Balanced_number_partitioning
Implementation adapted from: https://tinyurl.com/4vfa5xu7

Calculate the average value and then create buckets to reach that average.
*/
const balance = (A, n) => {
  let total = 0;
  for (let i = 0; i < A.length; i += 1) {
    total += getTiming(A[i]);
  }

  const target = total / n;
  const result = [];
  for (let i = 0; i < n; i += 1) {
    const bucket = getBucket(A, target);
    result.push(bucket);
  }

  return result;
};

const normalize = (bucketedResult) =>
  bucketedResult.map((chunk) => chunk.map((entry) => Object.keys(entry)[0]));

const getBucketTimeDistribution = (bucketedResult) =>
  bucketedResult.map((chunk) => chunk.reduce((total, entry) => total + getTiming(entry), 0));

const run = async () => {
  const previousTimings = await getPreviousTimings();
  const reconciledPackages = await reconcilePackages(previousTimings);
  const bucketedResult = balance(reconciledPackages, NUM_BUCKETS);
  console.log('bucketedResult:',bucketedResult);
  const bucketTimeDistribution = getBucketTimeDistribution(bucketedResult);
  console.log('bucketTimeDistribution:',bucketTimeDistribution);

  console.debug('distribution', bucketTimeDistribution);

  const chunks = normalize(bucketedResult);
  console.log('chunks:',chunks);
  writeFileSync(path.resolve(`./test-results/chunks.json`), JSON.stringify(chunks));
};

await run();