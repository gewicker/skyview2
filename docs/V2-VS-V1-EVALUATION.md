# Critical evaluation: v2 vs v1 (pre-build gate)

An honest assessment before committing to the full-parity build. Written to be
critical, not reassuring.

## The uncomfortable meta-point

v1 works. It's tuned, deployed, self-healing, and running 24/7. The pain points that
triggered this effort were mostly fixable in v1 — and several were *already fixed in
v1 this session*: the device/web desync was a half-open-socket bug (fixed with a
heartbeat), the "mode button inoperable" was a stale build, the route src/dst bug was
fixed, and a full bug scrub landed. The genuinely v2-only motivations are: an
iOS-grade control UI, single-binary operations, a clean modular renderer, and the
Mercator projection. Those are real and durable — but they are a **frontend rewrite +
an ops change + a projection change**, not obviously a *ground-up* rewrite of the
whole stack. The rewrite is a choice to repay all the incidental complexity at once,
at the cost of reimplementing a large, detail-dense, working system. That trade can be
worth it; it is not free, and this is the last cheap moment to be sure.

## Where v2 genuinely wins (be fair)

- Single static binary: dramatically simpler deploy + OTA (binary swap vs on-device
  `pnpm build` — v1's slowest, most failure-prone step). This is the strongest win.
- Atomic config writes + shutdown flush: fixes a real v1 data-loss bug.
- Bounded enrichment/photo caches: fixes v1's slow memory creep.
- Modular, GL-ready renderer architecture vs v1's ~2,500-line monolith.
- iOS-grade control surface unified across phone + touch.
- Mercator "correct by construction" + no dead code.

## Where v2 risks being WORSE than v1

1. **Rewrite regression risk (the big one).** The renderer *is* the product, and much
   of its value is tuned-by-eye detail that doesn't read off the code: grade
   constants, glyph/trail look, label collision placement, the CPA timing, the merge
   fallback numbers, the 1.15 s render-delay smoothing. A faithful reimplementation
   will look and feel subtly different and need re-tuning. Some of this *will* be lost
   and rediscovered as bugs.

2. **Two languages, less shared code.** v1 had ONE language and a real `shared/`
   package (geo, notable, config) imported by both server and client. v2 splits Go +
   TS, so projection math now exists **twice** (Go distance helpers + TS Mercator) and
   notable logic lives only in Go. The tygo type bridge keeps *types* in sync but not
   *logic*. This is a DRY regression and a new class of drift bug. v1 couldn't
   disagree with itself about geometry; v2 can.

3. **"Full parity before deploy" is big-bang sequencing.** It maximizes the time with
   no running v2 and concentrates all validation into one late, large integration.
   This is the highest-risk ordering. A vertical slice (deploy-early) was the lower-
   risk path and was declined.

4. **Parity surface is large and subtle.** Enrichment cache semantics (negative
   caching, in-flight dedup, TTLs, disk persistence) and the two-scope stickiness were
   *just bug-fixed in v1 this session* — reimplementing them in Go risks reintroducing
   the exact bugs we just killed. The merge numbers (−2 s, `?? 6`) are load-bearing
   and easy to fat-finger.

5. **Ops regressions until parity is reached.** The mature Windows flasher
   (`flash_skydeck.py` — onboarding hotspot, discovery cascade, firstrun) is NOT yet
   ported, so v2 can't provision a *fresh* Pi the way v1 can. And the hands-off update
   path now depends on **GitHub** (release channel); v1's `lan`/`git` channels worked
   fully offline on the LAN via mDNS publish. For a home appliance, requiring an
   internet round-trip for background updates is arguably a step back.

6. **New, unproven reliability code.** The binary-swap updater, the ported watchdog/
   self-heal/seal, and the kiosk supervisor are reimplemented and **not yet tested on
   a Pi**. v1's equivalents are battle-tested. Until v2 runs 24/7 somewhere, "more
   reliable" is a claim, not a fact.

7. **Evidence from this very session.** The fresh scaffold already shipped several
   real bugs caught only at runtime: the missing Vite `@shared` alias (blank page), a
   class-field ordering bug (crash loop), a `ws`-scope bug in the heartbeat, the
   `/data/` URL copied wrong, and dropped winds fields. That's the expected texture of
   a rewrite — many small, individually-cheap regressions whose sum is the real cost.
   The Go side still isn't even compile-verified locally.

8. **Mercator may not address the original symptom.** The accounting showed v1's
   registration was already mathematically consistent (tiles + aircraft + overlay
   shared one projection). The "map accuracy" complaint that helped trigger this was
   never definitively diagnosed — it may have been basemap fidelity or correct-but-
   surprising gate clustering, neither of which Mercator fixes. We're investing in a
   projection rewrite without having confirmed it solves what you saw.

## Bottom line + recommendation

Proceed only if the iOS UI + single-binary ops + clean architecture are worth a
multi-week reimplementation with real regression risk. If yes, de-risk the plan:

- **Deploy milestones, not big-bang.** Stand v2 up on the Pi after the render core +
  aircraft layer (workstream D), gaps and all. The clean-swap means falling back to v1
  is one command, so continuous validation is cheap. Don't wait for full parity to
  first run on hardware.
- **Keep shared logic DRY across the language split.** Put projection/notable rules in
  ONE place per concern and add cross-language characterization tests that assert Go
  and TS agree, or the geometry *will* drift.
- **Confirm the map-accuracy symptom first.** One screenshot or description of what's
  actually wrong, before sinking time into the renderer on a Mercator bet.
- **Keep a LAN-local update channel.** Don't make hands-off updates depend on GitHub;
  port v1's `http`/mDNS publish so the appliance updates without the internet.
- **Hold v1 as the live fallback.** It's tagged and runnable; keep it that way until
  v2 has logged real uptime. Treat "more reliable" as unproven until then.

None of this says don't build it. It says: the rewrite's cost is the long tail of
re-tuned detail and reintroduced subtleties, the sequencing chosen is the riskiest
one, and two genuine ops regressions (no fresh-Pi flasher, GitHub-dependent updates)
exist until later workstreams close them. Go in with eyes open and deploy early.
