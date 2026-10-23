# Thanksgiving Dinner Planner

A tiny, fully public, shareable web app for planning Thanksgiving: families
RSVP (one entry per family, with everyone's name listed underneath), the
group votes on which dishes make the menu before claiming who's bringing
what, and everyone can join a game. A live counter at the top shows the
total headcount so far — people like seeing the number climb.

There's no login and no password anywhere. Just share one link and
everyone can use it from their phone (works great opened from a text
message in Safari).

It has **zero external dependencies** — just plain Node.js — so there's
nothing to install and nothing that can fail to install. That also makes
deploying it about as simple as this kind of app gets.

## Running it locally (optional, just to look at it first)

```
node server.js
```

Then open http://localhost:3000 for the shared planner, and
http://localhost:3000/dashboard.html for the organizer dashboard.

## The two pages

- **`/` — the shared planner.** This is the link you send to everyone.
  No password, nothing hidden.
- **`/dashboard.html` — the organizer dashboard.** Also has no password —
  it's just not linked from the main page, so casual visitors won't find
  it. Treat the dashboard link itself as the thing you keep private: don't
  post it in the group chat. From here you can remove a family's RSVP,
  remove a dish or game category, and — most importantly — flip the
  potluck between **Voting** and **Sign-ups** (see below).

## How the potluck works

1. **Voting phase (the default).** Everyone upvotes/downvotes the
   suggested dishes (and can suggest their own). Dishes are shown ranked by
   score within each category — popular dishes rise to the top.
2. You, the organizer, look at the rankings on the dashboard whenever
   you're ready and click **"✅ Sign-ups open"**.
3. **Sign-up phase.** Voting locks. The same ranked order stays, but now
   instead of voting, people claim a dish to actually bring. The
   highest-ranked dish in each category is right at the top, so it gets
   claimed first.

You can flip back to **"🗳️ Voting open"** from the dashboard at any time if
you want to reopen the vote.

## Deploying to Railway

### From GitHub (this repo)

1. Go to [railway.app](https://railway.app), sign in, and click **New
   Project → Deploy from GitHub repo**. Pick this repo.
2. Railway detects the `package.json` and runs `npm start` automatically —
   there's nothing to install, so this takes seconds.
3. In **Settings → Networking**, click **Generate Domain** to get your
   public `https://....up.railway.app` link.
4. Open that link, check it looks right, then text/email it to everyone.
   Open `yourlink/dashboard.html` yourself and keep that one URL to
   yourself.

### A note on saved data

This app stores RSVPs/dishes/games in a small `data.json` file on the
server. That's plenty durable for a single event, with one caveat: if you
redeploy the app (e.g. push a code change) *after* people start RSVPing,
Railway spins up a fresh container and that file resets.

If you want to be extra safe, add a **Volume** in Railway (Settings →
Volumes → mount path `/data`), then set the variable `DATA_DIR=/data`. Data
then survives redeploys. For a single Thanksgiving where you deploy once and
just share the link, you can skip this.

## Changing things

- **Default potluck items / game categories**: edit the lists near the top
  of `db.js`, in the `defaultData()` function. Only affects a brand-new
  `data.json` — once the app has run once, add/remove items from the
  dashboard instead.
- **Colors / wording**: `public/styles.css` and the HTML files in
  `public/`.

## What everyone can do (`/`)

- **RSVP** — enter a family name, mark the whole family yes/maybe/no, and
  add each family member one at a time (shows up as a bulleted list under
  the family name, e.g. "Hubbell family → William Hubbell, Niko Hubbell,
  Mitchell Hubbell"). Re-submitting the same family name updates that
  family's RSVP instead of creating a duplicate.
- **See the live headcount** — a big number at the top shows how many
  people are confirmed, updating automatically as RSVPs come in.
- **Potluck** — vote on dishes (during voting) or claim one to bring
  (during sign-ups), grouped by category and ranked by popularity. Add a
  dish that's not on the list at any time.
- **Games** — join (or leave) any game category — Trivia, Pictionary,
  Talent Show, and a Prediction Pool are built in. The organizer can add
  more from the dashboard.

## What the organizer sees (`/dashboard.html`)

Headcount and RSVP totals, the voting/sign-ups toggle, the full family list
with remove, the full potluck list with scores or claims and remove, and
every game category's roster with add/remove.
