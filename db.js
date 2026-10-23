// Data store backed by this app's own GitHub repo, on a dedicated "data"
// branch that Render does NOT watch for auto-deploys (only the "main"
// branch triggers a redeploy). Every RSVP, vote, and photo is committed to
// that branch via the GitHub API, so it survives Render's free-tier
// ephemeral disk (which is wiped on every redeploy *and* every spin-down
// after 15 minutes idle) without costing anything or needing a database.
//
// No npm dependencies — uses Node 18's built-in global fetch.

const GH_OWNER = process.env.GITHUB_OWNER || 'williamhubbell';
const GH_REPO = process.env.GITHUB_REPO || 'thanksgiving-app';
const GH_BRANCH = process.env.GITHUB_DATA_BRANCH || 'data';
const GH_TOKEN = process.env.GITHUB_TOKEN || '';

// Pacific-time date (YYYY-MM-DD): voting runs through the day before this
// date, and sign-ups open automatically on this date.
const DEFAULT_SIGNUPS_START_DATE = '2026-11-07';

function defaultData() {
  return {
    event: {
      dateLabel: 'Thursday, November 26, 2026',
      // Placeholder time (3:00 PM) until the organizer confirms the real
      // one on the dashboard — see `timeConfirmed`.
      dateTime: '2026-11-26T15:00:00',
      timeConfirmed: false,
      address: '108 North 200th Street, Shoreline, WA 98133',
    },
    // 'auto' follows the voting -> sign-up schedule below. The dashboard
    // can override it at any time with 'manual-voting' / 'manual-signup',
    // and switch back to 'auto' whenever it wants.
    potluckPhaseMode: 'auto',
    signupsStartDate: DEFAULT_SIGNUPS_START_DATE,
    families: [],
    dishes: [
      { category: 'Appetizer', itemName: 'Deviled eggs' },
      { category: 'Appetizer', itemName: 'Veggie tray & dip' },
      { category: 'Side', itemName: 'Mashed potatoes' },
      { category: 'Side', itemName: 'Green bean casserole' },
      { category: 'Side', itemName: 'Mac and cheese' },
      { category: 'Side', itemName: 'Stuffing' },
      { category: 'Side', itemName: 'Sweet potato casserole' },
      { category: 'Side', itemName: 'Cranberry sauce' },
      { category: 'Side', itemName: 'Dinner rolls' },
      { category: 'Main', itemName: 'Turkey' },
      { category: 'Dessert', itemName: 'Pumpkin pie' },
      { category: 'Dessert', itemName: 'Apple pie' },
      { category: 'Dessert', itemName: 'Cookies' },
      { category: 'Drinks', itemName: 'Sparkling cider' },
      { category: 'Drinks', itemName: 'Wine' },
    ].map((d, i) => ({
      id: i + 1,
      claimedBy: null,
      upvotes: [],
      downvotes: [],
      suggested: true,
      createdAt: new Date().toISOString(),
      ...d,
    })),
    gameCategories: [
      { name: 'Trivia', description: 'Thanksgiving & general trivia, teams of 2-4' },
      { name: 'Pictionary', description: 'Classic drawing & guessing game' },
      { name: 'Talent Show', description: "Show off a party trick, song, or skill" },
      { name: 'Prediction Pool', description: 'Friendly bets on the game, the turkey, who falls asleep first, etc.' },
    ].map((g, i) => ({ id: i + 1, createdAt: new Date().toISOString(), ...g })),
    gameSignups: [],
    photos: [],
    nextIds: { families: 1, dishes: 16, gameCategories: 5, gameSignups: 1, photos: 1 },
  };
}

let cache = null;

// Fills in fields added after someone's data.json was first created, so an
// older file doesn't crash a newer version of the app. Returns true if
// anything was added (caller should persist it).
function migrate(data) {
  let dirty = false;
  if (!data.event) {
    data.event = defaultData().event;
    dirty = true;
  }
  if (!data.potluckPhaseMode) {
    // Preserve whatever phase was already set manually before this field
    // existed, so an event already underway doesn't silently jump schedules.
    data.potluckPhaseMode = data.potluckPhase === 'signup' ? 'manual-signup' : 'auto';
    dirty = true;
  }
  if (!data.signupsStartDate) {
    data.signupsStartDate = DEFAULT_SIGNUPS_START_DATE;
    dirty = true;
  }
  if (!data.photos) {
    data.photos = [];
    dirty = true;
  }
  if (!data.nextIds.photos) {
    data.nextIds.photos = 1;
    dirty = true;
  }
  return dirty;
}

// ---- GitHub Contents API helpers ----

function ghHeaders() {
  return {
    Authorization: `Bearer ${GH_TOKEN}`,
    Accept: 'application/vnd.github+json',
    'User-Agent': 'hubbell-thanksgiving-app',
    'X-GitHub-Api-Version': '2022-11-28',
  };
}

function encodeRepoPath(repoPath) {
  return repoPath.split('/').map(encodeURIComponent).join('/');
}

async function ghGetFile(repoPath) {
  const url = `https://api.github.com/repos/${GH_OWNER}/${GH_REPO}/contents/${encodeRepoPath(repoPath)}?ref=${GH_BRANCH}`;
  const res = await fetch(url, { headers: ghHeaders() });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`GitHub read of ${repoPath} failed (${res.status}): ${await res.text()}`);
  const json = await res.json();
  return { sha: json.sha, content: Buffer.from(json.content, 'base64') };
}

async function ghPutFile(repoPath, buffer, message) {
  const url = `https://api.github.com/repos/${GH_OWNER}/${GH_REPO}/contents/${encodeRepoPath(repoPath)}`;
  let lastErr;
  for (let attempt = 0; attempt < 3; attempt++) {
    const existing = await ghGetFile(repoPath);
    const body = { message, content: buffer.toString('base64'), branch: GH_BRANCH };
    if (existing) body.sha = existing.sha;
    const res = await fetch(url, {
      method: 'PUT',
      headers: { ...ghHeaders(), 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (res.ok) return res.json();
    lastErr = new Error(`GitHub write to ${repoPath} failed (${res.status}): ${await res.text()}`);
    // A 409/422 usually means another request updated the branch between our
    // read and our write (two people saving at once) — retry from scratch.
    if (res.status !== 409 && res.status !== 422) throw lastErr;
  }
  throw lastErr;
}

async function ghDeleteFile(repoPath, message) {
  const existing = await ghGetFile(repoPath);
  if (!existing) return;
  const url = `https://api.github.com/repos/${GH_OWNER}/${GH_REPO}/contents/${encodeRepoPath(repoPath)}`;
  const res = await fetch(url, {
    method: 'DELETE',
    headers: { ...ghHeaders(), 'Content-Type': 'application/json' },
    body: JSON.stringify({ message, sha: existing.sha, branch: GH_BRANCH }),
  });
  if (!res.ok && res.status !== 404) {
    throw new Error(`GitHub delete of ${repoPath} failed (${res.status}): ${await res.text()}`);
  }
}

// ---- Public load/save (async: backed by the GitHub API, not local disk) ----

async function load() {
  if (cache) return cache;
  if (!GH_TOKEN) {
    throw new Error(
      'Server is missing GITHUB_TOKEN — add it in the Render dashboard under Environment so the app can save data.'
    );
  }
  const file = await ghGetFile('data.json');
  if (!file) {
    cache = defaultData();
    await save(cache);
    return cache;
  }
  try {
    cache = JSON.parse(file.content.toString('utf8'));
  } catch (e) {
    console.error('Failed to parse data.json from GitHub, starting fresh:', e.message);
    cache = defaultData();
  }
  if (migrate(cache)) await save(cache);
  return cache;
}

async function save(data) {
  cache = data;
  await ghPutFile('data.json', Buffer.from(JSON.stringify(data, null, 2)), 'Update data.json via Hubbell Thanksgiving app');
}

function nextId(data, collection) {
  const id = data.nextIds[collection];
  data.nextIds[collection] = id + 1;
  return id;
}

// Uploads a photo's binary content to the data branch and returns the
// public raw.githubusercontent.com URL it can be displayed from (this repo
// is public, so no auth is needed to view it).
async function uploadPhoto(buffer, repoPath, message) {
  await ghPutFile(repoPath, buffer, message);
  return `https://raw.githubusercontent.com/${GH_OWNER}/${GH_REPO}/${GH_BRANCH}/${repoPath}`;
}

async function deletePhotoFile(repoPath) {
  await ghDeleteFile(repoPath, 'Remove photo via Hubbell Thanksgiving app');
}

// YYYY-MM-DD for `date`, as seen in the Pacific timezone (where the dinner
// actually is) regardless of what timezone the server happens to run in.
function pacificDateString(date = new Date()) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Los_Angeles',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);
}

// 'voting' or 'signup', derived from the schedule unless the dashboard has
// forced one or the other.
function computePotluckPhase(data) {
  if (data.potluckPhaseMode === 'manual-voting') return 'voting';
  if (data.potluckPhaseMode === 'manual-signup') return 'signup';
  return pacificDateString() >= data.signupsStartDate ? 'signup' : 'voting';
}

module.exports = {
  load,
  save,
  nextId,
  computePotluckPhase,
  pacificDateString,
  uploadPhoto,
  deletePhotoFile,
};
