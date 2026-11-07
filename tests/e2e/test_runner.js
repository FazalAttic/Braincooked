// tests/e2e/test_runner.js
// Autonomous E2E Test Suite Runner for Brainroad Chrome Extension

import { runTier1Tests } from './tier1_features.test.js';
import { runTier2Tests } from './tier2_boundaries.test.js';
import { runTier3Tests } from './tier3_interactions.test.js';
import { runTier4Tests } from './tier4_scenarios.test.js';

const ANSI = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  cyan: '\x1b[36m',
  magenta: '\x1b[35m'
};

async function main() {
  console.log(`${ANSI.bold}${ANSI.cyan}========================================================================${ANSI.reset}`);
  console.log(`${ANSI.bold}${ANSI.cyan}   BRAINROAD E2E TEST SUITE — 4-TIER FULL-SPECTRUM VERIFICATION         ${ANSI.reset}`);
  console.log(`${ANSI.bold}${ANSI.cyan}========================================================================${ANSI.reset}\n`);

  const startTime = Date.now();
  const suites = [
    { name: 'Tier 1: Core Feature Verification', runner: runTier1Tests },
    { name: 'Tier 2: Boundary & Corner Cases', runner: runTier2Tests },
    { name: 'Tier 3: Cross-Module Interactions & Pairwise Flows', runner: runTier3Tests },
    { name: 'Tier 4: Real-World Workload User Scenarios', runner: runTier4Tests }
  ];

  let totalPassed = 0;
  let totalFailed = 0;
  const suiteSummaries = [];

  for (const s of suites) {
    console.log(`${ANSI.bold}${ANSI.magenta}▶ Running ${s.name}...${ANSI.reset}`);
    const suiteStart = Date.now();
    const suiteResult = await s.runner();
    const suiteDuration = Date.now() - suiteStart;

    let passedInSuite = 0;
    let failedInSuite = 0;
    const failures = [];

    for (const r of suiteResult.results) {
      if (r.passed) {
        passedInSuite++;
      } else {
        failedInSuite++;
        failures.push(r);
        console.log(`  ${ANSI.red}✖ FAIL: ${r.name} (${r.durationMs}ms)${ANSI.reset}`);
        if (r.error) {
          console.log(`    ${ANSI.red}Error: ${r.error}${ANSI.reset}`);
        }
      }
    }

    totalPassed += passedInSuite;
    totalFailed += failedInSuite;

    suiteSummaries.push({
      name: s.name,
      total: suiteResult.results.length,
      passed: passedInSuite,
      failed: failedInSuite,
      durationMs: suiteDuration,
      failures
    });

    const statusColor = failedInSuite === 0 ? ANSI.green : ANSI.red;
    console.log(`  ${statusColor}✔ ${passedInSuite}/${suiteResult.results.length} passed${ANSI.reset} ${ANSI.dim}(${suiteDuration}ms)${ANSI.reset}\n`);
  }

  const totalDuration = Date.now() - startTime;
  const totalTests = totalPassed + totalFailed;

  console.log(`${ANSI.bold}${ANSI.cyan}========================================================================${ANSI.reset}`);
  console.log(`${ANSI.bold}${ANSI.cyan}                          TEST EXECUTION SUMMARY                        ${ANSI.reset}`);
  console.log(`${ANSI.bold}${ANSI.cyan}========================================================================${ANSI.reset}`);

  for (const sm of suiteSummaries) {
    const symbol = sm.failed === 0 ? `${ANSI.green}✔ PASS${ANSI.reset}` : `${ANSI.red}✖ FAIL${ANSI.reset}`;
    console.log(`  ${symbol} ${ANSI.bold}${sm.name.padEnd(50)}${ANSI.reset} [${sm.passed}/${sm.total}] ${ANSI.dim}(${sm.durationMs}ms)${ANSI.reset}`);
  }

  console.log(`${ANSI.bold}${ANSI.cyan}------------------------------------------------------------------------${ANSI.reset}`);
  const overallColor = totalFailed === 0 ? `${ANSI.bold}${ANSI.green}` : `${ANSI.bold}${ANSI.red}`;
  console.log(`  ${ANSI.bold}Total Test Suites:${ANSI.reset} 4`);
  console.log(`  ${ANSI.bold}Total Test Cases: ${ANSI.reset} ${totalTests}`);
  console.log(`  ${ANSI.bold}Total Passed:     ${ANSI.reset} ${ANSI.green}${totalPassed}${ANSI.reset}`);
  console.log(`  ${ANSI.bold}Total Failed:     ${ANSI.reset} ${totalFailed > 0 ? ANSI.red : ANSI.dim}${totalFailed}${ANSI.reset}`);
  console.log(`  ${ANSI.bold}Total Duration:   ${ANSI.reset} ${(totalDuration / 1000).toFixed(2)}s`);
  console.log(`  ${ANSI.bold}Overall Result:   ${ANSI.reset} ${overallColor}${totalFailed === 0 ? 'ALL 4 TIERS PASSED (100%)' : 'TEST FAILURES DETECTED'}${ANSI.reset}`);
  console.log(`${ANSI.bold}${ANSI.cyan}========================================================================${ANSI.reset}\n`);

  if (totalFailed > 0) {
    process.exit(1);
  } else {
    process.exit(0);
  }
}

main().catch((err) => {
  console.error('Fatal Test Runner Error:', err);
  process.exit(1);
});
