# HealThee Gamification Plan

A behaviour-change framework built on **Yu-kai Chou's Octalysis Framework** — designed to keep users engaged, build habits, and celebrate progress without turning health into a stressful chore.

---

## Core Philosophy

Gamification here is about **identity reinforcement**, not point-chasing. The goal is for the user to feel like *"I am someone who takes care of themselves"* rather than *"I need to hit my numbers today."* Every mechanic should:

- Reward **consistency** over perfection
- Make small wins feel meaningful
- Surface progress that would otherwise be invisible
- Never punish missed days harshly enough to trigger disengagement

---

## Octalysis Framework Alignment

All gamification mechanics in HealThee are mapped to the **8 Core Drives** of the Octalysis Framework, ensuring balanced motivation across both intrinsic (Right Brain) and extrinsic (Left Brain) dimensions, and a healthy mix of White Hat (empowering) and Black Hat (urgency-creating) drives.

```
                    ┌─────────────────────┐
                    │  1. Epic Meaning &   │
                    │     Calling          │  ← WHITE HAT (top)
                    └────────┬────────────┘
             ┌───────────────┼───────────────┐
    ┌────────┴─────────┐           ┌─────────┴────────┐
    │ 2. Development & │           │ 3. Empowerment   │
    │  Accomplishment  │           │  of Creativity   │
    │   (LEFT BRAIN)   │           │  (RIGHT BRAIN)   │
    └────────┬─────────┘           └─────────┬────────┘
    ┌────────┴─────────┐           ┌─────────┴────────┐
    │ 4. Ownership &   │           │ 5. Social        │
    │   Possession     │           │  Influence       │
    │   (LEFT BRAIN)   │           │  (RIGHT BRAIN)   │
    └────────┬─────────┘           └─────────┬────────┘
    ┌────────┴─────────┐           ┌─────────┴────────┐
    │ 6. Scarcity &    │           │ 7. Unpredictability│
    │   Impatience     │           │  & Curiosity      │
    │   (LEFT BRAIN)   │           │  (RIGHT BRAIN)    │
    └────────┬─────────┘           └─────────┬────────┘
             └───────────────┼───────────────┘
                    ┌────────┴────────────┐
                    │ 8. Loss &           │
                    │    Avoidance        │  ← BLACK HAT (bottom)
                    └─────────────────────┘
```

### Drive-by-Drive Mapping

| # | Core Drive | HealThee Mechanic | Type |
|---|---|---|---|
| 1 | **Epic Meaning & Calling** | Level titles with narrative arc (Seedling → Greek God), "ME time" reward, HealThee Mate journal framing as self-care mission | White Hat · Right Brain |
| 2 | **Development & Accomplishment** | XP system, Levels 1–10+, Badges, Personal Records, Weekly Report Card | White Hat · Left Brain |
| 3 | **Empowerment of Creativity & Feedback** | Custom goals, HealThee Mate journal/AI chat, real-time XP feedback, instant PR toasts, choose-your-own daily challenge (Boosted Picks) | White Hat · Right Brain |
| 4 | **Ownership & Possession** | Gems currency, Trophy Wall collection, Profile Avatars, accent colour unlocks, Focus Mode theme | Left Brain |
| 5 | **Social Influence & Relatedness** | HealThee Mate as a companion presence, encouraging AI personality, Weekly Report Card share-ready cards (personal only, no leaderboards) | Right Brain |
| 6 | **Scarcity & Impatience** | Limited Streak Freezes, Gems as scarce currency, bonus Weekly Challenge slot unlock, daily challenge refresh timer, level-gated badge tiers | Left Brain · Black Hat |
| 7 | **Unpredictability & Curiosity** | Randomised Daily Challenges, mystery milestone toasts, surprise "Bonus Burst" from completing all 3 dailies, Easter Egg badges | Right Brain · Black Hat |
| 8 | **Loss & Avoidance** | Streak at risk notifications, Streak Freeze consumption warnings, grace period urgency, Chill Mode as an intentional opt-out | Black Hat |

> **Design Principle:** HealThee intentionally leans toward **White Hat** drives (Drives 1–3) to sustain long-term engagement. Black Hat drives (6–8) are used sparingly and always paired with safeguards (Chill Mode, grace periods, no XP deductions) to avoid anxiety-driven churn.

---

## 1. XP & Levels

**Primary Drives:** CD2 (Development & Accomplishment) · CD3 (Empowerment of Creativity & Feedback)

### Earning XP

| Action | XP |
|---|---|
| Log any meal | +5 |
| Log all 3 meals in a day | +10 bonus |
| Hit calorie goal (within ±10%) | +15 |
| Hit protein goal | +15 |
| Log sleep | +5 |
| Hit sleep duration goal | +10 |
| Log steps | +5 |
| Hit step goal | +15 |
| Log a custom exercise | +10 |
| Log water intake | +3 |
| Use HealThee Mate (journal entry / AI chat) | +5 (once/day) |
| Complete a Daily Challenge | +25 |
| Complete a Weekly Challenge | +75 |

### Level Progression

Levels scale non-linearly so early progress feels fast, and later levels feel earned.

| Level | Title | XP Required (cumulative) |
|---|---|---|
| 1 | Seedling | 0 |
| 2 | Sprout | 150 |
| 3 | Sapling | 400 |
| 4 | Grower | 800 |
| 5 | Nurturer | 1,400 |
| 6 | Cultivator | 2,200 |
| 7 | Sustainer | 3,200 |
| 8 | Thriver | 4,500 |
| 9 | Vitalist | 6,200 |
| 10 | Luminary | 8,500 |
| 11 | Greek God | 12,000 |
| 12+ | Ascended (repeating) | +3,000 per tier |

Each level-up triggers a **full-screen celebration moment** with the new title and a short message (e.g., *"You've become a Nurturer — consistency is your superpower."*).

**Octalysis note:** The narrative arc from *Seedling* to *Greek God* taps into **CD1 (Epic Meaning)** — users aren't just earning points, they're ascending toward their peak self. The non-linear XP curve ensures early **CD2 (Accomplishment)** wins while keeping later levels aspirational (**CD6 — Scarcity**).

---

## 2. Streaks

**Primary Drives:** CD2 (Development & Accomplishment) · CD8 (Loss & Avoidance) · CD6 (Scarcity & Impatience)

### Daily Streak

A streak increments when the user logs **at least one entry in each of the four tabs** (Eat, Move, Sleep, Care) on a given day. The bar is intentionally achievable — one meal, any exercise, a sleep entry, one journal note.

- Streak counter displayed prominently on the dashboard
- Milestone toasts at 3, 7, 14, 21, 30, 60, 90, 180, 365 days
- **Streak Freeze:** The user earns one Streak Freeze every 14 days of continuous streaking. It is consumed automatically on the first missed day, preserving the streak. Max 2 banked at any time. Additional freezes can be purchased from the Gem Shop (5 gems each).
- **Grace Period:** If the user misses a day but logs on the next day within 2 hours of midnight (i.e., they were logged in very late), the streak holds.

### Goal Streaks (per goal)

Separate streaks track consecutive days of hitting each individual goal:
- Calorie goal streak
- Protein goal streak
- Step goal streak
- Sleep goal streak

These appear as small streak badges on the respective tab cards and feed into badge unlocks (see Section 3).

**Octalysis note:** Streaks are a classic **CD8 (Loss & Avoidance)** mechanic — users feel the urge to not break their chain. The Streak Freeze (**CD6 — Scarcity**, since they're limited) softens this into a healthy tension. The low daily bar (one entry per tab) is a deliberate White Hat counterbalance.

---

## 3. Badges

**Primary Drives:** CD2 (Development & Accomplishment) · CD4 (Ownership & Possession) · CD7 (Unpredictability & Curiosity)

Badges are permanent, collectible milestones. They live on a **Trophy Wall** screen.

### Consistency Badges

| Badge | Condition |
|---|---|
| First Step | Log anything for the first time |
| Three-peat | 3-day streak |
| Week Warrior | 7-day streak |
| Fortnight Focus | 14-day streak |
| Monthly Maven | 30-day streak |
| Quarter Century | 90-day streak |
| Half Year Hero | 180-day streak |
| Annual Legend | 365-day streak |

### Nutrition Badges

| Badge | Condition |
|---|---|
| Macro Mind | Hit all 3 macros (protein, carbs, fat) in a single day |
| Protein Pioneer | 7-day protein goal streak |
| Calorie Commander | 14-day calorie goal streak |
| The 100 | Log 100 meals total |
| Variety Pack | Log 5 different meal types in one week |
| Rainbow Plate | Log a fruit, vegetable, protein, grain, and dairy in one day |

### Movement Badges

| Badge | Condition |
|---|---|
| On Your Feet | Log first step entry |
| Step Starter | Hit step goal for the first time |
| Step Streak | 7-day step goal streak |
| Iron Week | Log exercise every day for 7 days |
| 10K Club | Log 10,000+ steps in a single day |
| Marathon Month | Accumulate 42km of walking/running in one calendar month |

### Sleep Badges

| Badge | Condition |
|---|---|
| Early Bird | Log wake time before 7:00 AM three times |
| Night Owl Redeemed | Improve average bedtime by 30+ min over a 2-week period |
| Sleep Scholar | Hit sleep duration goal 7 days in a row |
| Deep Sleeper | Log 8+ hours of sleep 5 times in a week |

### Mindfulness & Care Badges

| Badge | Condition |
|---|---|
| First Thoughts | Write first journal entry |
| Reflector | Write journal entries 7 days in a row |
| Mate Connection | Have 10 conversations with HealThee Mate |
| Mood Tracker | Log mood for 14 consecutive days |

### Special Badges

| Badge | Condition |
|---|---|
| Overachiever | Complete all Daily Challenges for an entire week |
| Clean Sweep | Hit every single goal on a given day |
| Comeback Kid | Return after a 7+ day gap and complete a full day of logging |
| Night Shift | Log data after midnight 3 times (for shift workers / late-night users) |
| Goal Setter | Set all health goals (calories, protein, steps, sleep) |

### Easter Egg Badges (Hidden — CD7: Unpredictability & Curiosity)

These badges are **undiscovered until earned** — no hints, no visible progress bars. They create moments of delight and surprise.

| Badge | Condition | Reveal Text |
|---|---|---|
| 🌙 Midnight Logger | Log all 4 tabs between 12 AM and 5 AM | *"The world sleeps; you improve."* |
| 🎯 Bullseye | Hit your calorie goal within ±1% | *"Precision is an art form."* |
| 🔁 Déjà Vu | Log the exact same 3 meals two days in a row | *"If it works, it works."* |
| 🌈 Full Spectrum | Earn at least one badge from every category | *"A truly well-rounded human."* |
| 📖 Storyteller | Write a journal entry of 200+ words | *"Your story matters."* |

**Octalysis note:** The Trophy Wall fulfills **CD4 (Ownership)** — badges are permanent possessions the user accumulates. Hidden Easter Egg badges add **CD7 (Unpredictability)** — the surprise of an unexpected reward is more motivating than an expected one. The act of collecting creates a **CD2 (Accomplishment)** feedback loop.

---

## 4. Daily Challenges

**Primary Drives:** CD7 (Unpredictability & Curiosity) · CD2 (Development & Accomplishment) · CD3 (Empowerment of Creativity)

Each day, 3 randomised challenges are generated from a pool. They refresh at midnight. Completing all 3 gives a **Bonus Burst** (+50 XP, +1 "gem" currency).

### Boosted Picks (CD3: Empowerment of Creativity)

Once per day, the user may **swap one challenge** for a random replacement from the same category. This small act of agency (choosing which challenge to tackle) taps into the Empowerment drive, giving users a feeling of strategic control without making challenges too easy.

### Challenge Pool Examples

**Nutrition Challenges**
- Log breakfast before 10:00 AM
- Eat at least 30g protein at lunch
- Stay within 100 kcal of your calorie goal
- Log a meal with 5+ ingredients
- Avoid snacks for the entire day
- Try a meal you've never logged before

**Movement Challenges**
- Walk 8,000+ steps today
- Log at least 20 minutes of cardio
- Do two separate exercise sessions
- Hit your step goal before 6 PM
- Add a new custom exercise

**Sleep Challenges**
- Be in bed by 11:00 PM
- Get at least 7.5 hours of sleep
- Wake up within 15 minutes of your target wake time
- Log sleep before 9:00 AM

**Mindfulness Challenges**
- Write a journal entry of at least 50 words
- Ask HealThee Mate one health question
- Reflect on what you ate today in the Care tab
- Log your mood and add a note about what influenced it

---

## 5. Weekly Challenges

**Primary Drives:** CD2 (Development & Accomplishment) · CD6 (Scarcity & Impatience)

One larger challenge persists for the full week. Users receive **one active Weekly Challenge slot** by default. A **second bonus slot** can be unlocked via the Gem Shop (4 gems), adding a layer of strategic scarcity.

Examples:

- **Protein Week:** Hit your protein goal every day for 7 days — *"Your muscles will thank you."*
- **Step Challenge:** Accumulate 70,000 steps this week
- **Sleep Reset:** Average 7+ hours of sleep across all 7 days
- **Full Logger:** Log all four tabs (Eat, Move, Sleep, Care) every single day
- **Mindful Week:** Write a journal entry every day
- **Calorie Precision:** Stay within ±5% of your calorie goal for 5 out of 7 days

Weekly challenge progress is shown as a visual progress bar with a goal marker.

---

## 6. Goals & Personal Records

**Primary Drives:** CD2 (Development & Accomplishment) · CD3 (Empowerment of Creativity & Feedback)

### Personal Records (PRs)

The app silently tracks all-time bests:
- Most steps in a single day
- Longest sleep streak
- Highest protein in a day
- Longest logging streak
- Most XP earned in a single week

When a PR is broken, a **"New Personal Record!"** toast fires immediately — no click required. PRs are visible on a dedicated "My Records" screen.

### Goal Check-ins (CD3: Empowerment of Creativity)

Every 4 weeks, the app prompts: *"It's been a month — want to review your goals?"* Users who update their goals get a +30 XP "Goal Calibration" bonus. This prevents stale goals from killing motivation and reinforces the user's creative agency over their own journey.

---

## 7. Gems (Premium Currency)

**Primary Drives:** CD4 (Ownership & Possession) · CD6 (Scarcity & Impatience) · CD3 (Empowerment of Creativity)

Gems are a soft currency earned through play — never purchasable for real money (to avoid pay-to-win dynamics). They fund cosmetic upgrades and quality-of-life perks, creating a personal economy that the user controls.

### Earning Gems

| Source | Amount |
|---|---|
| Complete all 3 Daily Challenges | +1 |
| Complete a Weekly Challenge | +3 |
| Level up | +2 |
| 30-day streak milestone | +5 |
| Unlock a badge | +1 |

### Spending Gems — The HealThee Shop

| Item | Cost | Octalysis Drive |
|---|---|---|
| **Streak Freeze (extra)** | 5 gems | CD8 (Loss & Avoidance) — protect your streak |
| **Profile Avatar / Icon Unlock** | 3 gems | CD4 (Ownership) — personalize your identity |
| **"Focus Mode" Theme** (minimal UI for a week) | 5 gems | CD3 (Empowerment) — customise your experience |
| **Unlock a Bonus Weekly Challenge Slot** | 4 gems | CD6 (Scarcity) — expand your capacity |
| **ME Time** | 5 gems | CD3 (Empowerment of Creativity) — redeem to unlock a personal "ME time" slot where the user defines what they've been holding out on and finally does it. The app doesn't prescribe the activity — it simply creates the space and celebrates the follow-through. |

**Octalysis note:** The Gem Shop is where **CD4 (Ownership)** and **CD6 (Scarcity)** intersect — gems are limited enough to feel valuable, but earnable enough that the user feels in control (**CD3**). **ME Time** is a deliberate White Hat reward that reinforces **CD3 (Empowerment of Creativity)** — the user decides what they've been putting off, and the app simply celebrates them for finally doing it.

### Gem Decay

After 14 consecutive days without any logging, 10% of banked gems are lost (min 1, max 10). A warning notification fires at day 10. Chill Mode suspends decay entirely. Full mechanics in **Section 11: Penalties & Consequence Mechanics**.

---

## 8. Notifications & Nudges

**Primary Drives:** CD8 (Loss & Avoidance) · CD7 (Unpredictability & Curiosity) · CD5 (Social Influence & Relatedness)

### Smart Reminders

Notifications fire based on the user's own historical patterns — not arbitrary fixed times:
- *"You usually log lunch around now — don't forget!"*
- *"You're 2,000 steps from your goal and it's only 4 PM."*
- *"Your streak is at risk — log anything before midnight."*

### Celebration Moments

Triggered immediately on completion:
- Badge unlocks: full-screen overlay with badge name and flavour text
- Level-ups: animated level card with title reveal
- PR breaks: toast + confetti burst
- Clean Sweep day: end-of-day summary with gold card
- Easter Egg badge: delayed reveal with mystery animation (**CD7**)

### HealThee Mate as Companion (CD5: Social Influence & Relatedness)

HealThee Mate acts as a **virtual companion** that acknowledges milestones socially:
- *"You just hit a 14-day streak! I'm genuinely impressed."*
- *"I noticed you've been sleeping better this week. That's real progress."*
- *"Tough day? Even logging one thing today counts. I'm here."*

This simulated social connection fulfils **CD5** without requiring leaderboards or real multiplayer, which can trigger comparison anxiety.

### Weekly Report Card

Every Sunday, a summary card shows:
- XP earned this week
- Goals hit (out of 7) per category
- Best streak day
- One encouraging insight (*"You slept 45 min more on days you exercised — keep it up."*)
- Any badges earned
- Progress toward Weekly Challenge

---

## 9. Progression Moments Map

Below is the rough cadence of when users hit major milestones, to ensure early-game feel stays rewarding:

| Day | Likely Milestones | Primary Drives Activated |
|---|---|---|
| Day 1 | First Step badge, Seedling → Sprout level-up (if active) | CD2, CD7 |
| Day 2 | First Daily Challenge complete | CD2, CD7 |
| Day 3 | Three-peat streak badge | CD2, CD8 |
| Day 7 | Week Warrior streak badge, first Weekly Challenge reward | CD2, CD4, CD6 |
| Day 14 | Fortnight Focus badge, first Streak Freeze earned | CD2, CD6, CD8 |
| Day 21 | Typically Level 4–5, several category badges, possible Easter Egg surprise | CD2, CD4, CD7 |
| Day 30 | Monthly Maven badge, +5 gems, HealThee Mate congratulatory message, goal review prompt | CD1, CD2, CD4, CD5 |

---

## 10. Anti-Burnout Safeguards

**Primary Drive:** Countering over-reliance on CD8 (Loss & Avoidance) and CD6 (Scarcity & Impatience)

Gamification can backfire if it creates anxiety. These mechanics prevent that:

1. **Graduated consequences only** — penalties (detailed in Section 11) scale with inactivity, always with advance warnings and clear recovery paths. No XP is ever deducted; no badge is ever permanently removed.
2. **Chill Mode toggle** — users can temporarily disable all challenge and streak notifications for up to 7 days (e.g., during travel or illness) without losing their streak, once every 60 days.
3. **ME Time reward** — purchasable with gems, a user-defined personal reward. The user chooses something they've been holding out on and the app celebrates the follow-through. No prescriptions, just empowerment.
4. **"Good Enough" framing** — goal hit notifications use language like *"Close enough — you were within 5%!"* rather than binary pass/fail.
5. **Offline grace** — if a user logs data late (e.g., forgets to log dinner until next morning), the app accepts backdating for the previous day up to 6 AM.
6. **No leaderboards** — social comparison is a leading cause of app abandonment among health apps. All gamification is personal-progress-based only.

> **Octalysis balance:** HealThee's gamification is deliberately **White Hat dominant**. CD1 (Epic Meaning), CD2 (Accomplishment), and CD3 (Creativity) are the primary engines. Black Hat drives (CD6 Scarcity, CD7 Unpredictability, CD8 Loss Avoidance) are used only to add urgency, never anxiety. Every Black Hat mechanic — including all consequence mechanics in Section 11 — has a corresponding safeguard in this section.

---

## 11. Penalties & Consequence Mechanics

**Primary Drives:** CD8 (Loss & Avoidance) · CD6 (Scarcity & Impatience) · CD4 (Ownership & Possession)

Penalties in HealThee function as **natural consequences** — graduated, forewarned, and always reversible. Every mechanic below scales with inactivity rather than triggering immediately, and each has a clear recovery path. The aim is to create *stakes*, not *stress*.

> **Design Principle:** No penalty is permanent. No XP or badge is ever deducted or removed. All consequence mechanics are paired with a safeguard from Section 10. Chill Mode suspends all penalty timers for its full duration.

### 1. Streak Loss (CD8)

The foundational consequence: a broken daily streak resets to 0 the morning after a missed day. Streak Freezes auto-consume first if one is banked.

- **Recovery:** The first logged day after a reset awards a **Comeback Bonus (+20 XP)** to restart momentum.
- **Safeguards:** Streak Freezes (earned every 14 days or purchased for 5 gems), Grace Period (2-hour midnight window), Chill Mode.

### 2. XP Momentum Decay (CD8 · CD2)

A multiplier on all XP earned degrades with consecutive days of no logging. Existing XP and level progress are never touched — only *future* earnings are affected.

| Days Without Logging | XP Multiplier |
|---|---|
| 0–2 | 1.0× (baseline) |
| 3–6 | 0.85× |
| 7–13 | 0.7× |
| 14+ | 0.5× |

Recovery: **+0.1× per consecutive logged day**, returning to 1.0× after 5 active days. The current multiplier is shown in the Profile screen with a progress indicator.

- **Safeguard:** Chill Mode freezes the multiplier at its current value — it neither decays nor recovers while active.
- **Notification:** A nudge fires on day 3 of inactivity: *"Your XP momentum is slipping — log anything to keep it up."*

### 3. Gem Decay (CD4 · CD8)

After 14 consecutive days without any logging, **10% of banked gems are lost** (min 1, max 10 gems). Repeats every 14 days of continued inactivity.

- **Advance warning:** Notification at day 10 — *"Your gems are at risk. Log anything to protect them."*
- **Recovery:** Logging any entry before day 14 resets the decay timer.
- **Safeguards:** Chill Mode fully suspends gem decay. Gems already spent in the Shop are unaffected.

### 4. Badge Dormancy (CD4 · CD8)

Streak-based badges earn a **greyed-out "Dormant" overlay** on the Trophy Wall when their qualifying streak is broken. The badge is never removed or reset — dormancy is cosmetic only.

| Badge Type | Behaviour on Streak Break |
|---|---|
| Streak-based (e.g., Week Warrior, Step Streak, Sleep Scholar) | Goes dormant; reactivates automatically when streak is re-achieved |
| One-time achievements (e.g., First Step, Clean Sweep, Easter Eggs) | Unaffected — permanent |

A dormant badge counter appears at the top of the Trophy Wall: *"2 badges dormant — rebuild your streak to reactivate."*

### 5. Level Title Dormancy (CD1 · CD8)

Extended inactivity adds a staged cosmetic indicator to the user's level title — tapping into narrative identity (CD1) rather than any numeric loss.

| Inactivity Duration | Effect |
|---|---|
| 7 days | Notification: *"Your [Title] status is at risk."* |
| 14 days | Title displays as **"[Title] · Dormant"** in Profile and on the dashboard |
| 21 days | HealThee Mate sends a personal check-in message |
| 5 consecutive logged days | Dormant tag removed; full title restored |

Level and XP are **never deducted**. This is a display-only penalty.

### 6. Challenge Forfeit (CD6 · CD8)

| Scenario | Consequence |
|---|---|
| Daily Challenge not completed by midnight | Expires — no XP or Bonus Burst; no carryover to next day |
| Weekly Challenge with 4+ days of zero logging | Forfeited and marked "Abandoned"; slot resets for the following week |
| Purchased Bonus Weekly Slot + forfeited challenge | **Gems not refunded** — a confirmation prompt warns the user at purchase time |

The gem non-refund on a purchased forfeited slot is the sharpest penalty in HealThee. It is intentional — spending creates commitment (**CD6**). The upfront confirmation preserves informed consent.

### Summary

| Mechanic | Trigger | Consequence | Recovery | Safeguard |
|---|---|---|---|---|
| **Streak Loss** | 1 missed day (no Freeze) | Streak → 0 | Log any day (+20 XP Comeback bonus) | Streak Freeze, Grace Period, Chill Mode |
| **XP Momentum Decay** | 3+ days without logging | XP multiplier 0.85× → 0.5× | +0.1× per active day (full at 5 days) | Chill Mode freezes multiplier |
| **Gem Decay** | 14 days without logging | −10% gems (min 1, max 10) | Log before day 14 to reset timer | Chill Mode suspends; day-10 warning |
| **Badge Dormancy** | Qualifying streak broken | Badge greyed out on Trophy Wall | Re-achieve the streak | One-time badges never affected |
| **Level Title Dormancy** | 14 days without logging | "(Dormant)" suffix on title | 5 consecutive logged days | Cosmetic only; no XP/level lost |
| **Challenge Forfeit** | Midnight / 4+ inactive days | No XP; gems not refunded (purchased slot) | Fresh challenges next day/week | Confirmation prompt at gem purchase |

> **Octalysis note:** All six mechanics map primarily to **CD8 (Loss & Avoidance)**, with CD4 (Ownership) and CD6 (Scarcity) as secondary drivers. None deduct earned XP, remove badges, or demote levels — the historical progress record is always protected.

---

## 12. Octalysis Scorecard

A self-assessment of how strongly each drive is represented in HealThee's design:

| Core Drive | Strength (1–10) | Key Mechanics |
|---|---|---|
| CD1 — Epic Meaning & Calling | 6 | Level narrative arc (Seedling → Greek God), journal framing |
| CD2 — Development & Accomplishment | 9 | XP, Levels, Badges, PRs, Challenges, Report Card |
| CD3 — Empowerment of Creativity | 7 | Custom goals, Boosted Picks, Goal Calibration, Gem Shop choices |
| CD4 — Ownership & Possession | 7 | Trophy Wall, Gems, Avatars, Accent Colours, Focus Mode |
| CD5 — Social Influence & Relatedness | 4 | HealThee Mate companion, shareable Report Card |
| CD6 — Scarcity & Impatience | 6 | Limited Streak Freezes, Gem economy, bonus challenge slot |
| CD7 — Unpredictability & Curiosity | 6 | Random daily challenges, Easter Egg badges, mystery PR toasts |
| CD8 — Loss & Avoidance | 7 | Streak Loss, XP Momentum Decay, Gem Decay, Badge Dormancy, Level Title Dormancy, Challenge Forfeit (all graduated; all paired with safeguards) |

**Target profile:** Strong White Hat foundation (CD1–3 average: 7.3) with measured Black Hat urgency (CD6–8 average: 6.3). This aligns with health app best practices — sustaining motivation through positive reinforcement, with graduated consequences that create meaningful stakes without anxiety.

---

## 13. Phased Implementation Roadmap

### Phase 1 — Foundation & Core Loop ✅ SHIPPED (May 2026)

**4 commits on `main` · 70 tests (63 unit + 7 Playwright e2e) · All green**

The complete core engagement loop is live. Users can switch to Gamified mode in Profile → App Mode and immediately start earning.

#### Architecture

The gamification system is isolated in `Projects/HealThee/gamification/` as pure ES modules — no changes to the existing health.html logic. The app hooks in via a single `window.HTGam.onDaySaved(dayData, dateKey)` call inside `saveDay()`. Everything else is derived inside the module.

```
gamification/
  core.js     — pure logic: XP math, level table, streak rules, challenge
                picking, badge predicates, gems. No DOM, testable in Node.
  store.js    — Firestore + localStorage + memory adapters with migration.
  ui.js       — toast, level-up overlay, Trophy Wall, HUD, challenge list.
  index.js    — HTGam singleton: orchestrates core + store + ui,
                exposes window.HTGam public API.
tests/
  unit/core.test.js   — 34 tests: XP/levels, streaks, challenges, badges, gems
  unit/store.test.js  — 10 tests: adapter round-trips, migration, composite
  unit/index.test.js  — 19 tests: applyDaySave, idempotency, level-up, persist
  e2e/healthee.baseline.spec.js     — 3 Playwright tests: page loads, no errors
  e2e/healthee.gamification.spec.js — 4 Playwright tests: API surface, end-to-end
```

#### What shipped

| Deliverable | Status | Notes |
|---|---|---|
| XP system — all earning actions | ✅ | Signature-based, idempotent per day — no double-awarding on re-saves |
| Levels 1–11 with titles + Ascended tiers | ✅ | Non-linear curve; full-screen celebration overlay on level-up |
| Daily streak — 4-tab qualification | ✅ | Streak increments only when Eat + Move + Sleep + Care all touched |
| Streak Freeze — earn every 14 days, max 2 banked | ✅ | Auto-consumed on 1-day gap |
| Comeback Bonus — +20 XP after broken streak | ✅ | |
| Streak milestone toasts — 3/7/14/21/30/60/90/180/365 | ✅ | |
| 15 core badges + Trophy Wall grid | ✅ | Consistency (8), Nutrition (2), Movement (2), Sleep (1), Care (1), Special (1) |
| Badge unlock toast + +1 gem per badge | ✅ | |
| Daily Challenges — 3/day from pool of 20 | ✅ | Deterministic by date (seeded Fisher-Yates); different every day |
| Bonus Burst — +50 XP + 1 gem for all 3 completed | ✅ | Fires exactly once per day |
| Weekly Challenge — 1 slot, pool of 6 | ✅ | Deterministic by ISO week key |
| Gems (earn-only) | ✅ | All earning sources wired: badge, level-up, bonus burst, 30-day streak |
| HUD — level, XP, streak counter, gem balance | ✅ | Renders inside Profile modal when Gamified |
| Daily challenges list in Profile modal | ✅ | Shows current day's 3 picks with completion state |
| Gamified / Vanilla toggle — live, persistent | ✅ | Saves to Firestore; re-renders modal on toggle; no reload needed |
| Firestore + localStorage persistence | ✅ | Composite adapter: local-first, Firestore fan-out |
| Offline resilience | ✅ | HTGam.onDaySaved is try/caught; never blocks the save path |
| Service worker cache bumped to v4 | ✅ | Forces fresh module fetch on next visit |
| Mode toggle re-renders Profile immediately | ✅ | Fixed: toggle inside open modal now shows/hides sections without close-reopen |

#### What is NOT in Phase 1 (deferred to Phase 2)

- Gem Shop (gems are earned but unspendable)
- Boosted Picks (daily challenge swap)
- Full badge library (30+ badges) and Easter Egg badges
- Goal Streaks (per-category streak tracking)
- Personal Records + PR toasts
- Smart / pattern-based notifications
- HealThee Mate milestone messages
- Weekly Report Card
- All penalty mechanics (XP Momentum Decay, Gem Decay, Badge Dormancy, Level Title Dormancy, Challenge Forfeit rules)
- Anti-burnout safeguards (Chill Mode, "Good Enough" framing)
- Goal Calibration prompts
- Daily challenges visible outside Profile (e.g., on dashboard)

---

### Phase 2 — Depth, Polish & Anti-Burnout

**Target: 6 sessions across the mechanics below. Ship per-mechanic, test before each push.**

Everything in Phase 2 enriches the system with ownership mechanics (Gem Shop), creative agency (Boosted Picks, Goal Calibration), social-emotional depth (HealThee Mate milestones, Weekly Report Card), and the full consequence/safeguard system that keeps long-term users engaged without burnout.

#### Week 7 — Gem Shop + Personal Records

**Gem Shop** (CD4, CD6, CD3, CD1)

Build the spendable economy. All 5 reward types:

| Item | Cost | Implementation notes |
|---|---|---|
| **Streak Freeze (extra)** | 5 gems | Increment `streak.freezesBanked` (cap at 3 when purchased, vs 2 earned); deduct gems with confirmation dialog |
| **Profile Avatar / Icon Unlock** | 3 gems | Unlock one of a set of pixel-art avatars stored on `userProfile.avatar`; render in Profile header |
| **"Focus Mode" Theme** | 5 gems | Set `userProfile.focusMode = true`; minimal CSS class on `<body>` that hides decorative elements for 7 days |
| **Unlock Bonus Weekly Challenge Slot** | 4 gems | Set `gam.weeklyChallenge.bonusSlotActive = true`; pick a second challenge from the pool; gem non-refund if forfeited |
| **ME Time** | 5 gems | Modal prompts user to define their ME Time activity; confirms follow-through; awards a special badge |

**Personal Records** (CD2, CD3)

Track in `gam.stats.records`: `{ maxSteps, maxProtein, maxSleepHours, longestStreak, maxXpWeek }`. On each `onDaySaved`, compare new values to records; fire a PR toast (`🏆 New record: 12,450 steps!`) when broken. Add a "My Records" section to the Profile modal.

---

#### Week 8 — Full Badge Library + Easter Eggs + Boosted Picks

**Full badge library** (CD2, CD4)

Expand from 15 to 30+ badges. Add all the badges defined in Section 3 that aren't yet implemented:

- Nutrition: Protein Pioneer, Calorie Commander, Variety Pack, Rainbow Plate
- Movement: Step Streak, Iron Week, 10K Club, Marathon Month
- Sleep: Early Bird, Night Owl Redeemed, Deep Sleeper
- Care: Reflector, Mate Connection, Mood Tracker
- Special: Overachiever, Clean Sweep, Comeback Kid, Night Shift

Each requires new context fields in `applyDaySave`: goal-streak tracking, cumulative stats (total steps, step history, sleep history). These are safe to add to `gam.stats` without touching `dayData`.

**Easter Egg badges** (CD7)

Five hidden badges (see Section 3). Key implementation note: they must not appear in the Trophy Wall until earned — locked slots show as `?` tiles. The unlock animation should have a 1-second delay with a mystery "reveal" effect to maximise the surprise. Their predicates require cross-day context (e.g., Déjà Vu needs meal history, Bullseye needs exact calorie comparison to target).

**Boosted Picks** (CD3)

Once per day, user can swap one of their 3 daily challenges for a new one from the same category. Store `gam.dailyChallenges.swapUsed: boolean`. The swap draws a new challenge that isn't already in today's picks. Show a "Swap" button next to uncompleted challenges.

---

#### Week 9 — Goal Streaks + Weekly Report Card

**Goal Streaks** (CD2, CD8)

Track per-category consecutive days of hitting the goal in `gam.stats`:
- `calorieGoalStreak`, `proteinGoalStreak`, `stepGoalStreak`, `sleepGoalStreak`

These require the existing `computeTotals()` output and goal targets to be passed into `onDaySaved`. Show small flame icons on each tab's summary card when a goal streak is active. Feed into the badge predicates (Protein Pioneer, Calorie Commander, etc.).

**Weekly Report Card** (CD2, CD5)

Every Sunday, generate and surface a summary card:
- XP earned this week vs. last week
- Goal hit rate per category (out of 7 days)
- Streak status
- Badges earned this week
- One insight line (generated by HealThee Mate — a simple template, not an LLM call)
- Weekly Challenge result

Render as a shareable card (screenshot-friendly layout, no PII visible by default).

---

#### Week 10 — HealThee Mate Milestone Messages + Smart Nudges

**HealThee Mate milestones** (CD5)

At specific gamification events, inject a contextual message into the chat history so HealThee Mate "notices" the user's progress. Triggered by events from `applyDaySave`:
- Streak milestones (7, 14, 30 days)
- Level-ups
- First badge in a new category
- Coming back after a break (comeback event)
- Weekly Challenge completion

These are templated messages, not LLM-generated — fast, offline-capable, and predictable.

**Smart nudge notifications** (CD8, CD7)

Extend the existing notification system (`_ntfCheck`) with gamification-aware nudges:
- Day's streak not yet qualified by 8 PM: *"3 tabs done — just add a Care entry to keep your streak alive."*
- Daily challenges expiring at midnight (if 1–2 incomplete): *"You've got time — 2 challenges left today."*
- XP close to a level-up (within 20 XP): *"Almost there — just log one more thing to level up."*

---

#### Week 11 — Penalty Mechanics + Anti-Burnout Safeguards

**All consequence mechanics** (CD8, CD6, CD4) — see Section 11 for full spec:
- XP Momentum Decay: track `gam.inactiveDays`; apply multiplier on all XP earned
- Gem Decay: fire at day 14 inactivity with day-10 warning notification
- Badge Dormancy: grey out streak-based badges in Trophy Wall; show dormant counter
- Level Title Dormancy: show `"[Title] · Dormant"` in HUD and Profile after 14 days

**Anti-burnout safeguards** (Counter-CD8) — see Section 10:
- **Chill Mode toggle**: 7-day freeze on all streak/challenge notifications and penalty timers. Once every 60 days. Stored on `userProfile.chillMode: { active, activatedAt, expiresAt }`.
- **"Good Enough" framing**: when a goal is hit within ±5%, show a softer success message rather than nothing.
- **Backdating grace**: accept `dayData` saves to the previous calendar day up to 6 AM. Already partially supported by `saveDay`; needs the grace window explicitly enforced in `applyDaySave`.

---

#### Week 12 — Challenge Pool Expansion + Goal Calibration + Polish

**Challenge pool expansion**

Grow daily pool from 20 → 30 challenges. Grow weekly pool from 6 → 8. New additions should skew toward the lower-logged categories (Sleep, Care) to balance engagement across all tabs.

**Goal Calibration** (CD3)

Every 28 days, surface a prompt: *"It's been a month — want to review your goals?"* If the user opens Profile and updates any goal value, award +30 XP "Goal Calibration" bonus. Track `gam.lastGoalCalibration` date.

**Polish pass**

- Confetti burst on PR breaks (use a lightweight canvas confetti lib or CSS animation — no heavy dependency)
- Level-up overlay: add the level-specific flavour message (*"You've become a Nurturer — consistency is your superpower."*)
- Trophy Wall: add category tabs (All / Consistency / Nutrition / Movement / Sleep / Care / Special / Hidden)
- HUD: add a thin XP progress bar under the level title
- Daily challenges: surface them on the main dashboard (outside Profile), as a collapsible card on the Fuel tab

---

### Phase 2 exit criteria

Full gamification system live with all 8 core drives activated:
- Gem Shop functional with all 5 rewards
- 30+ standard badges + 5 Easter Eggs
- Goal Streaks per category
- Personal Records visible in Profile
- Weekly Report Card auto-surfaces every Sunday
- HealThee Mate acknowledges milestones in chat
- All 6 penalty mechanics live with safeguards (Chill Mode, Good Enough framing, backdating)
- Challenge pools expanded; Boosted Picks available
- Goal Calibration prompt every 28 days

---

## 14. Feature Suggestions for Future Consideration

These ideas emerged during Phase 1 development and are not yet in the roadmap. None are urgent, but each is worth revisiting as the user base grows.

### Visibility improvements

- **Daily challenges on the dashboard** — The biggest UX gap post-Phase 1: challenges live only in the Profile modal. Moving them to a collapsible card on the Fuel tab (or a persistent widget on the dashboard) would dramatically increase engagement. Already flagged for Phase 2 Week 12 polish.
- **Streak counter on the main screen** — The streak is stored and maintained but only visible in the Profile HUD. A small flame badge next to the date picker would surface the streak without requiring a modal open.

### Engagement depth

- **Themed weeks** — Occasional special-event weeks (e.g., "Hydration Week" where water logging earns double XP, or "Sleep Month" in October). Entirely cosmetic on the data side — just a `theme` flag that tweaks XP multipliers for a category.
- **Personal bests as daily context** — Surface the user's personal best for today's category ("Your best day was 14,200 steps — you're at 8,000 so far") to create organic motivation without a formal challenge mechanic.
- **Challenge difficulty tiers** — Easy / Medium / Hard variants of each challenge. Easy challenges award less XP but count toward Bonus Burst. Lets the user calibrate their own bar without the system judging.
- **Streak recovery grace extension** — Allow the user to "repair" a broken streak once every 90 days by logging a double-entry day (all 4 tabs twice). Expensive but not impossible — prevents long-term disengagement from a single missed day after a 60+ day run.

### Architecture & scalability

- **Multi-user support** — The current data model is per-UID in Firestore, which is inherently multi-user. The gamification module is already initialised per-UID. Adding a second user is a sign-up/onboarding flow change, not a data model change.
- **Framework migration path** — When/if HealThee grows to a team-developed product, migrate to a framework (React/Svelte/Solid). The gamification module (`core.js`, `store.js`) is pure logic with no DOM coupling — it ports cleanly to any framework without rewriting. The `ui.js` layer would be rewritten as components; `index.js` would become a store hook.
- **Weekly Report Card as a server-side function** — Currently planned as a client-side summary. If HealThee ever adds email delivery, the report card could move to a Cloud Function that reads Firestore and sends a formatted email or push notification. The data shape is already Firestore-native.

---

## 15. Technical Notes (for future developers)

### How XP awarding works (idempotency)

`HTGam.onDaySaved(dayData, dateKey)` is called every time the user saves any data. To avoid awarding XP multiple times for the same action, the module maintains a **signature cache** per date:

```
sigCache[dateKey] = { meals: N, sleepLogged: bool, stepEntries: N, ... }
```

Each save computes the current signature, diffs it against the cached one, and only awards XP for the delta. The cache is in-memory (lost on page reload) — meaning a hard reload could re-award XP for the first save of a session. This is acceptable since `dayData` usually only changes incrementally within a session. Phase 2 could persist `sigCache` to Firestore if this becomes a concern.

### Module API surface

```js
// Initialise (called once after Firebase auth + profile load)
await HTGam.init({ firebaseDb, uid, enabled })

// Called on every saveDay() — the only required integration point
await HTGam.onDaySaved(dayData, dateKey)

// Toggle gamified mode on/off (called by setGameMode in health.html)
HTGam.setEnabled(bool)

// Render UI into mount elements
HTGam.renderHud(el)
HTGam.renderTrophyWall(el)
HTGam.renderDailyChallenges(el, dateKey)

// Complete a daily challenge (called when user taps a challenge)
await HTGam.completeDailyChallenge(challengeId, dateKey)

// Read state (for debugging / testing)
HTGam.getState()
```

### Testing strategy

- **Unit tests** (`npm test`): pure logic in Node — no browser, no Firebase. Run in milliseconds. Cover all edge cases.
- **E2E tests** (`npx playwright test`): real Chromium, real ES module loading, real DOM. Cover: module loads, API surface, end-to-end `onDaySaved` flow, Trophy Wall rendering.
- **To run all tests:** `npm run test:all`

### Adding a new badge

1. Add the badge definition to `BADGES` in `core.js` with an `id`, `cat`, `name`, and `test(ctx)` predicate.
2. Add the badge icon to `BADGE_ICONS` in `ui.js`.
3. Ensure the `ctx` object passed to `evaluateBadges()` in `applyDaySave` includes whatever field the predicate needs.
4. Add a unit test in `tests/unit/core.test.js`.

### Adding a new XP action

1. Add the XP value to `XP_REWARDS` in `core.js`.
2. Add the delta computation to `diffSignatures()` in `index.js`.
3. Add the field to `computeDaySignature()` so it's tracked in the sig cache.
4. Update the unit tests in `index.test.js`.

---

*Last updated: May 2026 — Phase 1 shipped. Phase 2 roadmap defined.*
