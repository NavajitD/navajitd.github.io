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

1. **No punishment for missed days** — only streak freezes and neutral resets; no XP deductions, no lost badges.
2. **Chill Mode toggle** — users can temporarily disable all challenge and streak notifications for up to 7 days (e.g., during travel or illness) without losing their streak, once every 60 days.
3. **ME Time reward** — purchasable with gems, a user-defined personal reward. The user chooses something they've been holding out on and the app celebrates the follow-through. No prescriptions, just empowerment.
4. **"Good Enough" framing** — goal hit notifications use language like *"Close enough — you were within 5%!"* rather than binary pass/fail.
5. **Offline grace** — if a user logs data late (e.g., forgets to log dinner until next morning), the app accepts backdating for the previous day up to 6 AM.
6. **No leaderboards** — social comparison is a leading cause of app abandonment among health apps. All gamification is personal-progress-based only.

> **Octalysis balance:** HealThee's gamification is deliberately **White Hat dominant**. CD1 (Epic Meaning), CD2 (Accomplishment), and CD3 (Creativity) are the primary engines. Black Hat drives (CD6 Scarcity, CD7 Unpredictability, CD8 Loss Avoidance) are used only to add urgency, never anxiety. Every Black Hat mechanic has a corresponding safeguard.

---

## 11. Octalysis Scorecard

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
| CD8 — Loss & Avoidance | 5 | Streak protection, at-risk notifications (softened by safeguards) |

**Target profile:** Strong White Hat foundation (CD1–3 average: 7.3) with moderate Black Hat urgency (CD6–8 average: 5.7). This aligns with health app best practices — sustaining motivation through positive reinforcement rather than fear of loss.

---

## 12. Phased Implementation Roadmap

### Phase 1 — Foundation & Core Loop (Weeks 1–6)

Everything needed for a functional, motivating gamification experience from day one.

| Week | Deliverables | Drives Activated |
|---|---|---|
| 1–2 | XP system with all earning actions, Levels 1–10 with titles, Level-up celebration screen | CD2 |
| 3 | Daily Streak counter with Grace Period, Streak Freeze earn logic (every 14 days, max 2) | CD2, CD8 |
| 4 | 15 core badges (all Consistency + first-time milestones), Trophy Wall screen (basic grid) | CD2, CD4 |
| 5 | Daily Challenge system (pool of 20 challenges, 3 per day), Bonus Burst reward for completing all 3 | CD7, CD2 |
| 6 | Gems currency (earning only), Weekly Challenge (pool of 6 challenges, 1 active slot), Weekly Report Card | CD4, CD6, CD2 |

**Phase 1 exit criteria:** User can earn XP, level up, maintain streaks, complete daily/weekly challenges, earn gems and badges. The core engagement loop is fully functional.

### Phase 2 — Depth, Polish & Anti-Burnout (Weeks 7–12)

Enriches the system with creativity, ownership, social-emotional features, and safeguards.

| Week | Deliverables | Drives Activated |
|---|---|---|
| 7 | Gem Shop with all 5 rewards (Streak Freeze, Avatar, Focus Mode, Bonus Slot, ME Time), Profile Avatar system | CD4, CD6, CD3, CD1 |
| 8 | Personal Records tracking + PR toast notifications, Goal Streaks (per-category streak badges) | CD2, CD3 |
| 9 | Full badge library (all 30+ standard badges), Easter Egg badges (5 hidden), Boosted Picks (daily challenge swap) | CD4, CD7, CD3 |
| 10 | Smart notification nudges (pattern-based), HealThee Mate milestone acknowledgements | CD8, CD5 |
| 11 | Anti-burnout safeguards: Chill Mode toggle, "Good Enough" framing, backdating grace period | Counter-CD8 |
| 12 | 4-week Goal Review prompts, remaining challenge pool expansion (to 30 daily + 8 weekly), final polish & QA | CD3, CD2 |

**Phase 2 exit criteria:** Full gamification system live with all 8 core drives activated, safeguards in place, and gem economy balanced.

---

*Last updated: March 2026*
