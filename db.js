// Tiny JSON-file data store. No external dependencies on purpose —
// this app is meant to be as simple as possible to run and deploy.
const fs = require('fs');
const path = require('path');

const DATA_DIR = process.env.DATA_DIR || __dirname;
const DATA_FILE = path.join(DATA_DIR, 'data.json');

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
    nextIds: { families: 1, dishes: 16, gameCategories: 5, gameSignups: 1 },
  };
}

let cache = null;

// Fills in fields added after someone's data.json was first created, so an
// older file on disk doesn't crash a newer version of the app. Returns true
// if anything was added (caller should persist it).
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
  return dirty;
}

function load() {
  if (cache) return cache;
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
  if (!fs.existsSync(DATA_FILE)) {
    cache = defaultData();
    save(cache);
    return cache;
  }
  try {
    cache = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
  } catch (e) {
    console.error('Failed to read data.json, starting fresh:', e.message);
    cache = defaultData();
  }
  if (migrate(cache)) save(cache);
  return cache;
}

function save(data) {
  cache = data;
  fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
}

function nextId(data, collection) {
  const id = data.nextIds[collection];
  data.nextIds[collection] = id + 1;
  return id;
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

module.exports = { load, save, nextId, DATA_FILE, computePotluckPhase, pacificDateString };
