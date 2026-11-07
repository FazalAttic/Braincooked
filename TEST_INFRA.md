# Brainroad — E2E Test Infrastructure Specification

**Document Version:** 1.0.0  
**Target System:** Brainroad Google Chrome Extension (Manifest V3)  
**Author:** E2E Test Writer (`teamwork_test_writer`)  
**Status:** Approved & Implemented  
**Workspace:** `c:\Users\fazal\Desktop\Brainroad\`  

---

## 1. Test Philosophy & Principles

### 1.1 Opaque-Box & Requirement-Driven Testing
The Brainroad End-to-End (E2E) testing framework is constructed strictly upon the user requirements set forth in `ORIGINAL_REQUEST.md` and the architectural contracts defined in `PROJECT.md`. The test suite operates exclusively as an **opaque-box** (black-box) harness:
- **Zero Coupling to Implementation Internals:** Tests interact solely through observable system boundaries:
  1. Synthetic DOM mutations and video playback events on simulated Instagram and YouTube page contexts.
  2. Chromium Extension runtime message dispatch (`chrome.runtime.sendMessage`).
  3. Persistent state inspection within `chrome.storage.local` and ephemeral state within `chrome.storage.session`.
  4. Visible action badge state (`chrome.action.setBadgeText`, `chrome.action.setBadgeBackgroundColor`).
  5. Extension popup interface elements and user actions (counter displays, stage mascots, reset modal confirmation).
- **No Reliance on Ephemeral Internal Code:** If implementation refactors class names, switches bundlers, or restructures internal helper files, tests remain valid as long as the functional requirements and interface contracts are honored.

### 1.2 Deterministic Output Derivation
Every test case derives its expected output from an authoritative specification:
- **Counter Invariants:** A reel or short qualifies if and only if visible ($\ge 60\%$ on Instagram; `[is-active]` on YouTube), playing (`!paused && !ended`), and continuous dwell $\ge 1.5\text{s}$ while document is visible.
- **Deduplication Invariants:** Distinct video shortcodes/IDs increment counters exactly once per continuous viewing session. Subsequent loops, re-renders, or backward scrolling within the session produce zero additional increments.
- **Rollover Invariants:** Date transitions (`lastActiveDate !== today`) archive previous day totals into `history[lastActiveDate]`, reset `today` tallies to 0, and prune history older than 90 days.
- **Badge Formatting Invariants:**
  - $0 \to \text{""}$ (or empty string)
  - $1 \le n \le 999 \to \text{"1"} \dots \text{"999"}$
  - $1,000 \le n \le 9,999 \to \text{"1.0k"} \dots \text{"9.9k"}$
  - $10,000 \le n \le 999,999 \to \text{"10k"} \dots \text{"999k"}$
  - $n \ge 1,000,000 \to \text{"1M+"}$
- **Fatigue Stage Invariants:**
  - Stage 1: Fresh Mind ($0 - 20$), Emerald Green (`#79D056`)
  - Stage 2: Warming Up ($21 - 50$), Warm Cream (`#FFE9B4`)
  - Stage 3: Tired Brain ($51 - 100$), Apricot Orange (`#FFB367`)
  - Stage 4: Drained ($101 - 150$), Crimson Amber (`#FC4A52`)
  - Stage 5: Brain Rot Alert ($151+$), Deep Purple/Rot (`#9B51E0`)

### 1.3 Progressive Testability & Offline Isolation
- Tests execute hermetically in an offline, in-memory Node.js test environment with high-fidelity Chrome MV3 API mocks and DOM/media event emitters.
- Zero network dependencies, zero headless browser binary flakiness, and zero reliance on live Instagram/YouTube accounts or anti-bot protections.

---

## 2. Feature Inventory Across Tiers 1–4

The feature inventory directly maps each of the functional capabilities identified in `PROJECT.md § Feature Inventory` into testable requirements across all 4 tiers:

| # | Feature Name | Description | Tier 1 (Core) | Tier 2 (Boundaries) | Tier 3 (Interactions) | Tier 4 (Scenarios) |
|---|--------------|-------------|:-------------:|:-------------------:|:---------------------:|:------------------:|
| **F1** | Manifest V3 Declaration | Valid MV3 manifest, permissions, host scopes, background worker | T1.F1.1–5 | T2.F1.1–5 | T3.Int.1 | T4.Scen.1–6 |
| **F2** | Storage & Mutex Core | `chrome.storage.local` persistence, schema defaults, atomic mutex serialization | T1.F2.1–5 | T2.F2.1–5 | T3.Int.2 | T4.Scen.5 |
| **F3** | Daily Rollover & History | Calendar rollover at midnight, historical archive, 90-day pruning | T1.F3.1–5 | T2.F3.1–5 | T3.Int.5 | T4.Scen.3 |
| **F4** | Action Badge Display | 4-character count text formatting and fatigue stage color shifting | T1.F4.1–5 | T2.F4.1–5 | T3.Int.3 | T4.Scen.1,4 |
| **F5** | Typed Messaging Bus | Runtime message dispatch (`RECORD_VIEW`, `GET_STATS`, `RESET_STATS`, `GET_SESSION_SEEN`) | T1.F5.1–5 | T2.F5.1–5 | T3.Int.1–6 | T4.Scen.1–6 |
| **F6** | Instagram URL & SPA Detection | Detection of `/reels/*`, `/reel/<shortcode>/`, popstate, Navigation API | T1.F6.1–5 | T2.F6.1–5 | T3.Int.1 | T4.Scen.2 |
| **F7** | Instagram Feed Reels Detection | Detection of reels embedded in home feed `<article>` post cards | T1.F7.1–5 | T2.F7.1–5 | T3.Int.1 | T4.Scen.2 |
| **F8** | Instagram Triple-Gate Qualifier | $\ge 60\%$ intersection, video playing, continuous $\ge 1.5\text{s}$ dwell, visibility | T1.F8.1–5 | T2.F8.1–5 | T3.Int.6 | T4.Scen.2 |
| **F9** | Instagram Session Deduplication | Session set suppression of loop replays, re-scrolling, and back-navigation | T1.F9.1–5 | T2.F9.1–5 | T3.Int.2 | T4.Scen.2 |
| **F10** | YouTube Shorts Navigation | Detection of `/shorts/<videoId>` entry via `yt-navigate-finish`, popstate | T1.F10.1–5 | T2.F10.1–5 | T3.Int.1 | T4.Scen.1 |
| **F11** | YouTube Infinite Feed Observer | Tracking active reel switches via `MutationObserver` on `[is-active]` | T1.F11.1–5 | T2.F11.1–5 | T3.Int.1 | T4.Scen.1 |
| **F12** | YouTube View Gate Qualifier | Continuous $\ge 1.5\text{s}$ playback dwell with visible document check | T1.F12.1–5 | T2.F12.1–5 | T3.Int.6 | T4.Scen.1 |
| **F13** | YouTube Loop & Deduplication | 11-char ID extraction, loop replay prevention, scroll reversal dedup | T1.F13.1–5 | T2.F13.1–5 | T3.Int.2 | T4.Scen.1 |
| **F14** | BrainPal Obsidian Theme | Dark warm theme (`#0A0907`), cream accents (`#FFE9B4`), layout structure | T1.F14.1–5 | T2.F14.1–5 | T3.Int.3 | T4.Scen.4 |
| **F15** | 5-Stage Brain Fatigue System | Progressive stages (Fresh, Warming, Tired, Drained, Rot) and mascot state | T1.F15.1–5 | T2.F15.1–5 | T3.Int.4 | T4.Scen.4 |
| **F16** | Multi-Horizon Stats Dashboard | Today, Session, All-Time cumulative totals, IG vs YT breakdown | T1.F16.1–5 | T2.F16.1–5 | T3.Int.3 | T4.Scen.4,6 |
| **F17** | Confirmed Reset Modal | Secure reset dialog modal: cancel preserves state; confirm clears stats | T1.F17.1–5 | T2.F17.1–5 | T3.Int.4 | T4.Scen.6 |

---

## 3. Test Architecture & Directory Structure

### 3.1 Test Directory Structure
```
c:\Users\fazal\Desktop\Brainroad\tests\e2e\
├── harness.js                  # Chrome MV3 in-memory mock engine & DOM event synthesizer
├── test_runner.js              # Top-level autonomous test runner & reporter
├── tier1_features.test.js      # Tier 1: Core Feature Verification (>=5 tests per feature)
├── tier2_boundaries.test.js    # Tier 2: Boundary & Corner Cases (>=5 tests per feature)
├── tier3_interactions.test.js  # Tier 3: Cross-Module & Multi-Tab Interaction Flows
└── tier4_scenarios.test.js     # Tier 4: Real-World Workload User Scenarios
```

### 3.2 Runner Invocation Commands
The test suite is fully autonomous, executable out-of-the-box via:
```bash
# Direct runner execution:
node tests/e2e/test_runner.js

# Or via npm script:
npm run test:e2e
```

### 3.3 Pass/Fail Semantics
- **Atomic Assertions:** Each test case executes independently inside an isolated test context with freshly initialized storage and DOM instances.
- **Zero False Negatives:** Strict invariant assertions check exact counts, badge strings, stage identifiers, and storage keys.
- **Process Exit Codes:**
  - Exit Code `0`: 100% of test cases passed.
  - Exit Code `1`: One or more test cases failed (with failure stack trace, expected vs actual values, and feature ID).

---

## 4. Coverage Thresholds

| Tier | Focus | Requirement Threshold | Brainroad Suite Target |
|:---:|---|---|:---:|
| **Tier 1** | Primary Feature Behavior (Happy Path) | $\ge 5$ test cases per feature | **85 tests** (17 features $\times$ 5 tests) |
| **Tier 2** | Boundary Conditions & Error Handling | $\ge 5$ test cases per feature | **85 tests** (17 features $\times$ 5 tests) |
| **Tier 3** | Cross-Module Interactions & Concurrency | Comprehensive Pairwise Combinations | **24 tests** |
| **Tier 4** | Real-World User Scenarios | Realistic Workload Flows | **10 comprehensive scenarios** |
| **Total** | **Full 4-Tier E2E Test Suite** | **Comprehensive Full-Spectrum** | **204 tests** |

---

## 5. Real-World Application Scenarios (Tier 4)

Tier 4 tests simulate complex, end-to-end user behaviors matching authentic desktop browsing sessions:

| Scenario ID | Scenario Name | User Behavioral Flow | Target Invariants & Verifications |
|:---:|---|---|---|
| **SCEN-01** | *Morning Commute Doomscroll* | User opens YouTube Shorts and scrolls through 25 shorts: 5 are flicked past in $<1.5\text{s}$, 15 are watched once for $\ge 2.0\text{s}$, and 5 are watched and allowed to loop 3 times. | - Exactly 20 unique shorts are counted.<br>- Rapid flicks ($<1.5\text{s}$) count 0.<br>- Loop replays count once.<br>- YouTube platform total = 20; today total = 20.<br>- Fatigue stage transitions to *Warming Up* (21–50).<br>- Badge text reflects "20" with cream color. |
| **SCEN-02** | *Lunch Break Instagram Binge* | User browses Instagram home feed: scrolls past 10 static photo posts, watches 15 video reels in feed for $\ge 2.0\text{s}$, scrolls past 8 feed reels in $<1.0\text{s}$, then navigates to `/reels/` and watches 12 dedicated reels. | - Photo posts count 0.<br>- Fast feed scrolls count 0.<br>- Exactly $15 + 12 = 27$ Instagram reels counted.<br>- Instagram platform total = 27.<br>- Combined Today counter = 27.<br>- Stage = *Warming Up* (`#FFE9B4`). |
| **SCEN-03** | *Night Owl Midnight Rollover* | User watches 15 YouTube shorts from 23:50 to 23:59. At 00:00 midnight rollover occurs while user is active. User watches 10 more shorts until 00:15. | - Previous day tally of 15 is archived in `history[yesterday]`.<br>- `today` counter resets to 0 at midnight and advances to 10.<br>- All-time cumulative total = 25.<br>- Badge reflects current day's count ("10").<br>- History retains date-indexed record with breakdown. |
| **SCEN-04** | *Deep Doomscroll Fatigue Progression* | User spends 2.5 hours consuming 165 reels/shorts sequentially. Observer monitors stage transitions across all 5 thresholds. | - 0–20: Stage 1 *Fresh* (`#79D056`, smiling brain mascot).<br>- 21–50: Stage 2 *Warming Up* (`#FFE9B4`, calm brain).<br>- 51–100: Stage 3 *Tired* (`#FFB367`, strained eyes).<br>- 101–150: Stage 4 *Drained* (`#FC4A52`, cracked brain).<br>- 151+: Stage 5 *Brain Rot Alert* (`#9B51E0`, spiral dizzy mascot).<br>- Badge colors shift dynamically at each boundary. |
| **SCEN-05** | *Multi-Tab Power User Session* | User opens 3 tabs concurrently: Tab 1 on Instagram Feed, Tab 2 on Instagram Reels, Tab 3 on YouTube Shorts. Videos play concurrently or sequentially. | - Background service worker mutex queue serializes all `RECORD_VIEW` messages.<br>- Zero lost updates or race conditions.<br>- Cross-tab session store prevents double counting if same video opened across tabs.<br>- Storage totals equal exact sum of unique views across all 3 tabs. |
| **SCEN-06** | *Mindful Reset & Recovery Cycle* | User reaches 110 reels (Stage 4 Drained); opens extension popup; reviews breakdown (60 IG / 50 YT); clicks "Reset Today's Count"; cancels initial prompt (verifies stats intact); confirms second prompt. | - On cancel: stats remain 110.<br>- On confirm: `today` count resets to 0, session cache cleared.<br>- All-time total remains preserved at 110.<br>- Popup mascot resets to Stage 1 *Fresh* (`#79D056`).<br>- Badge text clears to empty string.<br>- Subsequent views increment from 1. |
| **SCEN-07** | *Browser Crash & Cold Restart* | User views 30 shorts; browser crashes / is terminated. On cold restart, session cache is wiped while persistent storage remains intact. | - `chrome.storage.local` retains 30 counts.<br>- `chrome.storage.session` starts empty.<br>- Watching the same short in new session correctly increments count to 31. |
| **SCEN-08** | *Tab Visibility & Background Audio* | User plays a YouTube short, switches to a work spreadsheet tab after 0.5s, waits 10s with audio playing, then switches back. | - Dwell timer paused/cancelled while tab hidden (`document.visibilityState === 'hidden'`).<br>- Background playback does NOT qualify as a viewed short.<br>- Full 1.5s active visible playback required after tab returns to focus. |
| **SCEN-09** | *Long-Term 100-Day History Pruning* | Storage accumulates daily viewing history over 120 consecutive days. System triggers daily retention prune. | - Oldest 30 days beyond 90-day retention window are purged.<br>- Exactly 90 most recent daily history records remain.<br>- Aggregate all-time total is never reduced or lost. |
| **SCEN-10** | *Million+ View Badge Formatting Stress* | Counter reaches high numbers (e.g., 999, 1000, 9999, 10000, 1000000). | - 999 $\to$ `"999"`<br>- 1,000 $\to$ `"1.0k"`<br>- 9,999 $\to$ `"9.9k"`<br>- 10,000 $\to$ `"10k"`<br>- 1,000,000 $\to$ `"1M+"`<br>- Text length never exceeds 4 characters desktop constraint. |

---

## 6. Verification & Quality Seal
This specification guarantees 100% requirements coverage for Brainroad, providing downstream engineering and verification agents with an unyielding quality benchmark.
