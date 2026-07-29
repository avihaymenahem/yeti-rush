# Play Store submission

Everything needed to fill the Play Console in one sitting, plus the short list of
things a person has to do that a repository cannot.

The artwork here is generated — `npm run icon` rebuilds `icon-512.png` and
`feature.png` from `assets/splash.png`. Do not hand-edit either.

## What is still on you

| | |
| --- | --- |
| **Upload key** | Not in this repository and must never be. See the comment at the top of [`android/app/build.gradle`](../android/app/build.gradle) for the `keytool` command and the `keystore.properties` it expects. Back the `.jks` up somewhere that is not this machine — Play accepts updates signed by that key and no other, for the life of the listing. |
| **Twelve testers, fourteen days** | Personal developer accounts created after 13 November 2023 must run a closed test with at least twelve testers opted in for fourteen consecutive days before production access can even be applied for. Start this first; it is the only item here measured in weeks. |
| **Screenshots** | At least two phone screenshots, and 7"/10" tablet ones unless you want the "not designed for tablets" note on the listing. Take them on a real device — the demo in a desktop browser is the wrong aspect ratio and the wrong frame rate. |
| **The splash art's provenance** | [`LICENSES.md`](../LICENSES.md) accounts for every model in the game but says nothing about `assets/splash.png`, which is the source of the icon, the launch poster and the feature graphic. Play requires you to hold the rights to listing assets. Record where it came from. |

## Listing

**App name** — `Yeti Rush` (30 characters allowed, this is 9)

**Short description** — 80 characters allowed, this is 76:

```
Three lanes of alpine powder. Dodge, jump, grind — and outrun the ski patrol.
```

**Full description** — 4000 characters allowed, this is around 1500:

```
A yeti, a snowboard, and a mountain that never ends.

Yeti Rush is a three-lane endless runner set on an alpine piste at dusk. Swipe
to carve between lanes, jump the fallen logs, slide under the barriers, and keep
ahead of the ski patrol closing in behind you. The longer you last, the faster
the mountain comes at you.

RIDE IT PROPERLY
• Hit a ramp to launch clean over a chalet and the coin line strung above it
• Jump onto a grind rail and it carries you over whatever was in the way
• Pull tricks in the air for bonus score — but land them, or you bank nothing
• Thread the gap beside an obstacle instead of avoiding it, and score for the
  near miss

FIVE POWER-UPS
Hot Cocoa pulls every coin on the slope to you. The Avalanche Board turns you
into a ghost that rides straight through anything. The Chairlift carries you
above the track along a trail of coins. Snow Angel gives you a second jump in
mid-air. And Score x2 is exactly what it says.

SPEND WHAT YOU COLLECT
Seven boards that genuinely handle differently — one steers quicker, one holds
its speed through a crash, none is simply best. Five riders. And upgrades that
make every power-up last longer.

SOMETHING TO COME BACK FOR
Daily missions, a daily reward that grows the more days you keep the streak, and
a personal best that is always just slightly out of reach.

NO STRINGS
No adverts. No in-app purchases. No account, no login, no leaderboard servers.
It collects nothing about you and never touches the network — the whole game is
in the app, so it plays exactly the same in aeroplane mode at 30,000 feet.
```

**Category** — Games ▸ Arcade

**Tags** — Endless runner, Arcade, Casual, Snowboarding, Offline

**Graphics**

| Asset | File | Required size |
| --- | --- | --- |
| App icon | `icon-512.png` | 512 × 512 |
| Feature graphic | `feature.png` | 1024 × 500 |
| Phone screenshots | — | 2–8, 16:9 or 9:16 |

## App content

Every section below blocks release until it is answered.

**Privacy policy** — <https://avihaymenahem.github.io/yeti-rush/privacy.html>
(source: [`public/privacy.html`](../public/privacy.html), published by the same
Pages workflow as the demo).

**Ads** — No, this app does not contain ads.

**App access** — All functionality is available without any special access. No
login, no gated content.

**Content rating (IARC questionnaire)** — category *Game*, and every question
answers No: no violence, no sexuality, no language, no controlled substances, no
gambling or simulated gambling, no user-generated content, no user-to-user
communication, no location sharing, no purchases of any kind. Expect PEGI 3 /
ESRB Everyone / USK 0.

> If a loot crate or prize spin is ever added, this stops being true. Randomised
> rewards bought with anything require disclosed odds under Play policy — worth
> knowing before it is built rather than after.

**Target audience and content** — the one genuine judgement call here.

The app qualifies for every age group: no ads, no purchases, no data collection,
no social features, no advertising ID. Including under-13 in the target audience
is therefore compliant today and widens the audience for a game that plainly
appeals to children.

What it commits you to is Families policy for the life of the listing. If ads or
IAP are ever added, they must come from a certified ads SDK and follow the
children's rules — which is a real constraint on how the game could be monetised
later. Choose accordingly; it is much easier to widen the audience later than to
narrow it.

**Data safety** — no data collected, no data shared, by the app or by any SDK in
it. There is nothing to encrypt in transit and nothing to request deletion of.
[`tests/release.test.ts`](../tests/release.test.ts) scans the source for `fetch`,
`XMLHttpRequest`, `WebSocket`, `sendBeacon` and geolocation, and fails if any of
them appears — so this declaration cannot quietly stop being true.

Android's own system backup is allowed (`allowBackup="true"`), so a player's save
may be included in *their* Google backup. That is between the player and Google,
involves no server of ours, and is disclosed in the privacy policy.

**Government apps / financial features / health** — No to all.

## Building the upload

Play has not accepted APKs for new apps since 2021; the upload is an App Bundle.

```bash
npm run check && npm run build && npx cap sync android
```

```bash
cd android && ./gradlew.bat bundleRelease
```

The bundle lands at `android/app/build/outputs/bundle/release/app-release.aab`.
Without `android/keystore.properties` it is built **unsigned** and Play will
reject it — that is deliberate, so the failure happens here rather than at the
console.

Then confirm the bundle really is the build you just made, which has caught a
stale artefact more than once:

```bash
grep -o 'index-[A-Za-z0-9_-]*\.js' dist/index.html android/app/src/main/assets/public/index.html
```
