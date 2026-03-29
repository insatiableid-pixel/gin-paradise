# Gin Paradise Checklist: Match Backgammon Galaxy's Published Virtual-Coin Model

Date: 2026-03-25

Purpose: turn the published Backgammon Galaxy model into a practical launch checklist for Gin Paradise.

Important: this is a product and implementation checklist, not legal advice. It is based on public source material from Backgammon Galaxy and a scan of the current Gin Paradise codebase.

## 1. What Backgammon Galaxy Publicly Says

Based on its published App Store listing, Terms of Service, and public Q&A:

- The product is framed as social gaming and entertainment only.
- Coins are described as virtual items with no real-world monetary value.
- Coins cannot be cashed out, exchanged, or redeemed for money, goods, or services.
- Coins are licensed, not sold, and are non-transferable.
- Users can buy coins, receive coins for free, and stake coins in matches to win more virtual coins.
- The service uses coin rake.
- Users must be at least 18 years old or the age of majority in their jurisdiction.
- Their terms explicitly ban bots, chip dumping, and match-fixing.
- Their terms allow forfeiture of coins and memberships for abuse.

Public sources used:

- https://www.backgammongalaxy.com/terms-of-service
- https://www.backgammongalaxy.com/backgammon-galaxy-blog/zsjxdtelna46wd31xp8mwgzgsc4ogk
- https://apps.apple.com/us/app/backgammon-galaxy-play-online/id1606706936

## 2. Current Gin Paradise Status

Already aligned in part:

- `server/ledger.ts` already says "Single non-redeemable coin economy. No sweepstakes, no dual currency."
- `src/pages/Wallet.tsx` already labels gold coins as "Non-redeemable gameplay currency."
- `server/billing.ts` already supports coin purchases and subscriptions.
- `server/escrow.ts` already supports virtual-coin stakes, escrow, payout, refund, and rake.

Current gaps:

- No public Terms of Service page was found in the app.
- No public Privacy Policy page was found in the app.
- No 18+ or age-of-majority gating was found in the app.
- No public fair-play policy page was found in the app.
- The product language still uses terms like "prize pool" and "winner payout," which are mechanically accurate but more gambling-adjacent than Backgammon Galaxy's public wording.
- No visible anti-chip-dumping or collusion detection system was found beyond general fairness/game integrity features.
- No clear processor-reviewed go-to-market package exists yet for paid virtual-coin staking.

## 3. Recommended Goal State

If the goal is to match Backgammon Galaxy's published public model, Gin Paradise should ship as:

- An entertainment-only online gin rummy platform.
- With non-redeemable virtual coins only.
- No cash-out, no withdrawals, no peer-to-peer transfers, no redemption for goods or services.
- Coins usable for entry into virtual-coin matches, cosmetics, and optional premium features.
- Strong public rules against bots, match-fixing, chip dumping, and abusive behavior.
- 18+ or age-of-majority gating.
- Clear terms stating coins are licensed, not property.

## 4. Must-Do Before Public Launch

### A. Publish the legal and product-policy pages

Create and link all of the following pages:

- `Terms of Service`
- `Privacy Policy`
- `Fair Play and Abuse Policy`
- `Virtual Currency Policy`

Minimum statements to include:

- The service is for entertainment purposes only.
- Gin Paradise is not a cash-out service.
- Gold Coins are virtual items with no real-world monetary value.
- Gold Coins cannot be redeemed, exchanged, transferred, or withdrawn for money, goods, or services.
- Coins are licensed, not sold, and remain part of the service.
- Purchases are final except as required by law or platform rules.
- We may modify, remove, or rebalance the virtual economy.
- We may suspend accounts and forfeit coins for cheating, botting, collusion, chip dumping, and match-fixing.
- Users must be at least 18 years old or the age of majority where they live.

### B. Add age gating

Before account creation or first paid purchase:

- Require confirmation that the user is 18+ or the age of majority in their jurisdiction.
- Store acceptance timestamp and version of the terms.
- Block access or purchases if the user does not accept.

### C. Change the public wording

To better match Backgammon Galaxy's published framing, revise product copy:

- Prefer "virtual coins" or "non-redeemable gameplay currency"
- Prefer "win virtual coins" over "prize payout"
- Prefer "entry fee in virtual coins" over "buy-in" where possible
- Prefer "coin rake" or "house fee in virtual coins" over cash-style language

Suggested copy changes:

- `Prize Pool` -> `Virtual Coin Pot`
- `Winner Payout` -> `Winner Receives Virtual Coins`
- `Platform rake` -> `Coin rake`
- `High Stakes` -> `High Coin Stakes`

This does not change the underlying math. It changes how the model is presented.

### D. Add explicit anti-abuse rules and enforcement

Backgammon Galaxy publicly bans chip dumping and match-fixing. Gin Paradise should do the same.

Add explicit prohibited conduct:

- Using bots or external assistance in live PvP
- Multi-accounting
- Chip dumping
- Intentional losses to transfer balance
- Collusion
- Queue manipulation
- Rating manipulation
- Abuse of refunds, forfeits, disconnects, and timeouts

Add explicit remedies:

- Match cancellation
- Coin forfeiture
- Rating rollback
- Temporary suspension
- Permanent ban

## 5. Product Work Needed in the App

### A. Add the missing pages and footer links

Add footer or settings links to:

- Terms of Service
- Privacy Policy
- Fair Play
- Support

Suggested implementation:

- Create static routes in `src/pages/`
- Add links from auth, wallet, and settings surfaces
- Require acceptance on sign-up

### B. Add terms acceptance tracking

Database work:

- Add fields or a separate table for `terms_version`, `accepted_at`, and `privacy_version`
- Capture acceptance on registration and on major terms updates

### C. Rework wallet and stake presentation

Current files to update:

- `src/pages/Wallet.tsx`
- `src/pages/MultiplayerRoom.tsx`
- `server/escrow.ts`

Goals:

- Emphasize non-redeemable virtual currency
- Explain that coins are for entertainment use within Gin Paradise only
- De-emphasize language that sounds like cash gambling

### D. Add visible economy rules

On wallet and matchmaking pages, add a short rules block:

- Coins are non-redeemable virtual currency
- No cash-out or transfers
- Paid matches are for virtual coins only
- Abuse may result in balance forfeiture and account suspension

## 6. Integrity and Trust Work Needed

### A. Add anti-chip-dumping detection

Minimum heuristics:

- Repeated same-opponent transfers with extreme directional results
- Fast resign patterns between the same accounts
- Multiple accounts from the same device/IP/payment pattern
- Sudden balance spikes tied to a small opponent set
- Abnormal timeout/forfeit behavior favoring one account

Recommended outputs:

- Risk score per account pair
- Admin review queue
- Automatic temporary stake restrictions above a threshold

### B. Add stake-risk controls

Before launch, consider:

- Daily stake caps for new accounts
- Cooling-off period before first staked match
- Minimum account age for higher coin stakes
- Lower default stake exposure for new users
- Stronger anti-abandon penalties

### C. Add transaction and match audit tools

Admin tools should make it easy to answer:

- Who bought coins
- Who won or lost coins
- Which matches transferred balances
- Which pairs/accounts look suspicious

You already have part of this foundation in:

- `server/ledger.ts`
- `server/escrow.ts`
- `server/houseAccounting.ts`
- `src/pages/AdminDashboard.tsx`

## 7. Payments and Processor Work

### A. Prepare a processor review packet

Even if the model is virtual-only, do not assume payment processors will approve it automatically.

Prepare a short written packet covering:

- Coins are non-redeemable virtual items
- No cash-out, no withdrawals, no resale, no transfers
- Coins are used only inside the game
- Terms and UI make this explicit
- Abuse controls exist
- Users are 18+
- Screenshots of wallet, matchmaking, and rules copy

### B. Ask the processor for written confirmation

Before turning on live purchases for staked virtual-coin play:

- Explain the exact model in writing
- Ask whether the virtual-coin stake/rake system is allowed
- Keep the response for your records

### C. Have a fallback business model

If a processor objects to paid staked virtual-coin play, keep launch viable by shifting purchases to:

- Cosmetics
- Battle pass or membership
- Analysis features
- AI coaching
- Non-staked bot modes

## 8. Launch Order I Recommend

### Phase 1: Safest public beta

Ship:

- Website
- Accounts
- Free PvP
- Bot play
- Replays and training
- Cosmetics
- Premium subscription
- Coin wallet with free earnable coins only, if desired

Do not ship yet:

- Paid coin purchases linked to staked PvP

### Phase 2: Virtual-coin commercial launch

Only after terms, age gating, policy pages, and processor confirmation:

- Paid Gold Coin purchases
- Virtual-coin stake matchmaking
- Coin rake
- Coin-based tournaments

### Phase 3: Scale and hardening

- Stronger collusion detection
- Better admin moderation
- Country/jurisdiction restrictions if needed
- More explicit compliance and reporting processes

## 9. Concrete Repo Changes to Make Next

High priority:

1. Add `Terms`, `Privacy`, and `Fair Play` pages under `src/pages/`
2. Add footer/settings links to those pages
3. Add age-of-majority checkbox and terms acceptance to registration
4. Add acceptance storage in the database
5. Rewrite wallet and stake copy for virtual-coin framing
6. Add anti-chip-dumping policy text and admin flags

Medium priority:

1. Add stake/risk limits for new accounts
2. Add suspicious transfer analytics in admin
3. Add clearer abuse penalties for disconnect and resignation farming

## 10. Bottom Line

If you want to match Backgammon Galaxy's published public model, the target is not "real-money gin."

The target is:

- entertainment-only
- 18+
- non-redeemable virtual coins
- paid top-ups plus free earnable coins
- virtual-coin stake matches
- coin rake
- strong anti-cheating and anti-chip-dumping rules
- clear terms saying coins have no cash value

Gin Paradise already has much of the economy and game logic. The biggest missing pieces are the public legal wrapper, the user-facing wording, and the anti-abuse/compliance layer around paid virtual-coin competition.

## 11. Useful Internal References

- `server/ledger.ts`
- `server/billing.ts`
- `server/escrow.ts`
- `server/routes/wallet.ts`
- `src/pages/Wallet.tsx`
- `src/pages/MultiplayerRoom.tsx`
- `src/pages/AdminDashboard.tsx`
- `DEPLOYMENT.md`
