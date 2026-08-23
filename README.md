# Task Roulette

A personal iPhone "pick my task for the day" app. It's a installable web app (PWA) — no
Xcode, App Store, or Apple Developer account needed.

## How the picking logic works

- **Recurring tasks** (e.g. vacuum, clean bathroom): when you add one, you set
  - a **time**: either a time range (pick two values, 30 min–3 hr in 30 min steps — the app
    rolls a random duration in that range each time the task is picked), or **Until done**
    for tasks with no fixed duration
  - a **cooldown**: days after completing it during which it can't be picked at all
  - a **cooling-off** period: extra days after the cooldown where it *can* be picked but
    is less likely to (its odds ramp linearly from a low starting chance back up to normal
    by the end of the cooling-off window)
- **One-off tasks** (e.g. clean the pantry, fix the dog door): picked like any other task,
  but once you mark one complete it's removed from the list for good (it still stays in
  History). Time can be set to No estimate, a time range, or Until done, same as recurring.
- Each day the app auto-picks one task for you, weighted by the above. Buttons let you:
  - **🎲 Different Task** — reroll before doing it
  - **✓ Mark Complete** — logs it to History; recurring tasks restart their cooldown,
    one-offs get removed
  - **Pick Another Task** — after completing one, grab an additional task for the day if
    you want to keep going
  - **Skip for today** — clear today's pick without completing it

The minimum likelihood during cooling-off (default 15%) is adjustable in Settings (⚙️).

## Data & backups

Everything is stored locally in the browser (`localStorage`) on your iPhone — nothing is
sent anywhere. Since it only lives on-device, use **Settings → Export Backup** occasionally
to save a `.json` file (e.g. into Files/iCloud Drive) and **Import Backup** to restore it.

## Running it locally (for development)

```
python -m http.server 8934
```
then open http://localhost:8934

## Live URL

Deployed via GitHub Pages from this repo (`Kmarspython/task-roulette`, `main` branch):

**https://kmarspython.github.io/task-roulette/**

**On your iPhone:**
1. Open that URL in **Safari** (must be Safari, not Chrome, for Add to Home Screen to make a
   full standalone app)
2. Tap the Share icon → **Add to Home Screen**
3. Launch it from the home screen icon — it opens full-screen like a native app and keeps
   working offline

## Updating later

Push changes to the `main` branch and GitHub Pages redeploys automatically within a minute
or two:

```
git add -A
git commit -m "describe the change"
git push
```

Then reopen the app on your phone (pull down to refresh once if it doesn't pick up the
change immediately — the service worker caches assets).
