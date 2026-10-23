// Tiny JSON-file data store. No external dependencies on purpose —
// this app is meant to be as simple as possible to run and deploy.
const fs = require('fs');
const path = require('path');

const DATA_DIR = process.env.DATA_DIR || __dirname;
const DATA_FILE = path.join(DATA_DIR, 'data.json');

function defaultData() {
  return {
    potluckPhase: 'voting', // 'voting' | 'signup'
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
    save(cache);
  }
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

module.exports = { load, save, nextId, DATA_FILE };
