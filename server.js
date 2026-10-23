const http = require('http');
const fs = require('fs');
const path = require('path');
const { load, save, nextId, computePotluckPhase } = require('./db');

const PORT = process.env.PORT || 3000;
const PUBLIC_DIR = path.join(__dirname, 'public');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
};

function sendJson(res, status, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
  });
  res.end(body);
}

function notFound(res) {
  sendJson(res, 404, { error: 'Not found' });
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let chunks = [];
    let size = 0;
    req.on('data', (c) => {
      size += c.length;
      if (size > 1e6) {
        reject(new Error('Body too large'));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => {
      if (chunks.length === 0) return resolve({});
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
      } catch (e) {
        reject(new Error('Invalid JSON body'));
      }
    });
    req.on('error', reject);
  });
}

function serveStatic(req, res, urlPath) {
  let filePath = urlPath === '/' ? '/index.html' : urlPath;
  filePath = path.normalize(filePath).replace(/^(\.\.[/\\])+/, '');
  const fullPath = path.join(PUBLIC_DIR, filePath);
  if (!fullPath.startsWith(PUBLIC_DIR)) return notFound(res);
  fs.readFile(fullPath, (err, data) => {
    if (err) return notFound(res);
    const ext = path.extname(fullPath);
    res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
    res.end(data);
  });
}

function dishScore(d) {
  return d.upvotes.length - d.downvotes.length;
}

// Event date/time, with a fixed Pacific-time offset appended so every
// guest's browser (whatever timezone they're in) computes the same
// countdown. Nov 26, 2026 is during Pacific Standard Time (UTC-8).
function publicEvent(data) {
  const ev = data.event || {};
  return { ...ev, dateTime: ev.dateTime ? ev.dateTime + '-08:00' : null };
}

function scheduleNote(data) {
  const phase = computePotluckPhase(data);
  if (data.potluckPhaseMode !== 'auto') {
    return phase === 'voting' ? 'Voting was reopened by the host.' : 'Sign-ups were opened early by the host.';
  }
  return phase === 'voting' ? 'Voting closes and sign-ups open Nov 7.' : 'Sign-ups opened automatically on Nov 7.';
}

function publicState(data) {
  const attending = data.families.filter((f) => f.attending === 'yes');
  const maybe = data.families.filter((f) => f.attending === 'maybe');
  const totalHeadcountYes = attending.reduce((sum, f) => sum + f.members.length, 0);
  const totalHeadcountMaybe = maybe.reduce((sum, f) => sum + f.members.length, 0);

  const sortedDishes = [...data.dishes].sort((a, b) => dishScore(b) - dishScore(a) || a.id - b.id);

  return {
    event: publicEvent(data),
    potluckPhase: computePotluckPhase(data),
    potluckPhaseMode: data.potluckPhaseMode,
    potluckScheduleNote: scheduleNote(data),
    families: data.families,
    dishes: sortedDishes.map((d) => ({
      id: d.id,
      category: d.category,
      itemName: d.itemName,
      claimedBy: d.claimedBy,
      suggested: d.suggested,
      upvotes: d.upvotes,
      downvotes: d.downvotes,
      score: dishScore(d),
    })),
    gameCategories: data.gameCategories.map((cat) => ({
      ...cat,
      signups: data.gameSignups.filter((s) => s.categoryId === cat.id).map((s) => s.guestName),
    })),
    summary: {
      familiesCount: data.families.length,
      attendingFamiliesCount: attending.length,
      totalHeadcountYes,
      totalHeadcountMaybe,
    },
  };
}

const routes = [];
function route(method, pattern, handler) {
  const paramNames = [];
  const regexStr = pattern
    .split('/')
    .map((seg) => {
      if (seg.startsWith(':')) {
        paramNames.push(seg.slice(1));
        return '([^/]+)';
      }
      return seg.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    })
    .join('/');
  const regex = new RegExp(`^${regexStr}$`);
  routes.push({ method, regex, paramNames, handler });
}

async function handleApi(req, res, urlPath) {
  for (const r of routes) {
    if (r.method !== req.method) continue;
    const match = r.regex.exec(urlPath);
    if (!match) continue;
    const params = {};
    r.paramNames.forEach((name, i) => (params[name] = match[i + 1]));
    try {
      await r.handler(req, res, params);
    } catch (e) {
      console.error(e);
      sendJson(res, 500, { error: e.message || 'Server error' });
    }
    return true;
  }
  return false;
}

// ---- Public state ----

route('GET', '/api/state', async (req, res) => {
  const data = load();
  sendJson(res, 200, publicState(data));
});

// ---- Families (RSVP) ----

route('POST', '/api/families', async (req, res) => {
  const body = await readBody(req);
  const familyName = (body.familyName || '').trim();
  const attending = body.attending;
  if (!familyName) return sendJson(res, 400, { error: 'Family name is required' });
  if (!['yes', 'no', 'maybe'].includes(attending)) {
    return sendJson(res, 400, { error: 'Attending must be yes, no, or maybe' });
  }
  const members = Array.isArray(body.members)
    ? body.members.map((m) => String(m).trim()).filter(Boolean).slice(0, 30)
    : [];
  const notes = (body.notes || '').trim().slice(0, 500);

  const data = load();
  let family = data.families.find((f) => f.familyName.toLowerCase() === familyName.toLowerCase());
  if (family) {
    family.attending = attending;
    family.members = members;
    family.notes = notes;
    family.updatedAt = new Date().toISOString();
  } else {
    family = {
      id: nextId(data, 'families'),
      familyName,
      attending,
      members,
      notes,
      createdAt: new Date().toISOString(),
    };
    data.families.push(family);
  }
  save(data);
  sendJson(res, 200, { family });
});

route('DELETE', '/api/families/:id', async (req, res, params) => {
  const data = load();
  data.families = data.families.filter((f) => f.id !== parseInt(params.id, 10));
  save(data);
  sendJson(res, 200, { ok: true });
});

// ---- Dishes: voting + claiming ----

route('POST', '/api/dishes', async (req, res) => {
  const body = await readBody(req);
  const category = (body.category || '').trim();
  const itemName = (body.itemName || '').trim();
  const guestName = (body.guestName || '').trim();
  if (!category || !itemName) return sendJson(res, 400, { error: 'Category and item name are required' });

  const data = load();
  const dish = {
    id: nextId(data, 'dishes'),
    category,
    itemName,
    suggested: false,
    upvotes: [],
    downvotes: [],
    // Only let an immediate claim happen once sign-ups are open.
    claimedBy: computePotluckPhase(data) === 'signup' && guestName ? guestName : null,
    createdAt: new Date().toISOString(),
  };
  data.dishes.push(dish);
  save(data);
  sendJson(res, 201, { dish });
});

route('POST', '/api/dishes/:id/vote', async (req, res, params) => {
  const body = await readBody(req);
  const personName = (body.personName || '').trim();
  const voteValue = body.vote; // 'up' | 'down'
  if (!personName) return sendJson(res, 400, { error: 'Your name is required to vote' });
  if (!['up', 'down'].includes(voteValue)) return sendJson(res, 400, { error: 'Invalid vote' });

  const data = load();
  if (computePotluckPhase(data) !== 'voting') {
    return sendJson(res, 409, { error: 'Voting has closed — sign-ups are open now' });
  }
  const dish = data.dishes.find((d) => d.id === parseInt(params.id, 10));
  if (!dish) return notFound(res);

  const key = personName.toLowerCase();
  const hasUp = dish.upvotes.some((n) => n.toLowerCase() === key);
  const hasDown = dish.downvotes.some((n) => n.toLowerCase() === key);

  if (voteValue === 'up') {
    dish.downvotes = dish.downvotes.filter((n) => n.toLowerCase() !== key);
    if (hasUp) {
      dish.upvotes = dish.upvotes.filter((n) => n.toLowerCase() !== key); // toggle off
    } else {
      dish.upvotes.push(personName);
    }
  } else {
    dish.upvotes = dish.upvotes.filter((n) => n.toLowerCase() !== key);
    if (hasDown) {
      dish.downvotes = dish.downvotes.filter((n) => n.toLowerCase() !== key); // toggle off
    } else {
      dish.downvotes.push(personName);
    }
  }
  save(data);
  sendJson(res, 200, { dish });
});

route('POST', '/api/dishes/:id/claim', async (req, res, params) => {
  const body = await readBody(req);
  const guestName = (body.guestName || '').trim();
  if (!guestName) return sendJson(res, 400, { error: 'Your name is required' });

  const data = load();
  if (computePotluckPhase(data) !== 'signup') {
    return sendJson(res, 409, { error: 'Sign-ups open once voting ends' });
  }
  const dish = data.dishes.find((d) => d.id === parseInt(params.id, 10));
  if (!dish) return notFound(res);
  if (dish.claimedBy) return sendJson(res, 409, { error: 'That item is already claimed' });
  dish.claimedBy = guestName;
  save(data);
  sendJson(res, 200, { dish });
});

route('POST', '/api/dishes/:id/unclaim', async (req, res, params) => {
  const data = load();
  const dish = data.dishes.find((d) => d.id === parseInt(params.id, 10));
  if (!dish) return notFound(res);
  dish.claimedBy = null;
  save(data);
  sendJson(res, 200, { dish });
});

route('DELETE', '/api/dishes/:id', async (req, res, params) => {
  const data = load();
  data.dishes = data.dishes.filter((d) => d.id !== parseInt(params.id, 10));
  save(data);
  sendJson(res, 200, { ok: true });
});

// ---- Potluck phase control (dashboard) ----

route('POST', '/api/potluck-phase', async (req, res) => {
  const body = await readBody(req);
  if (!['auto', 'manual-voting', 'manual-signup'].includes(body.mode)) {
    return sendJson(res, 400, { error: 'Mode must be auto, manual-voting, or manual-signup' });
  }
  const data = load();
  data.potluckPhaseMode = body.mode;
  save(data);
  sendJson(res, 200, { potluckPhaseMode: data.potluckPhaseMode, potluckPhase: computePotluckPhase(data) });
});

// ---- Event details (dashboard) ----

route('POST', '/api/event', async (req, res) => {
  const body = await readBody(req);
  const data = load();
  const time = (body.time || '').trim();
  if (/^\d{2}:\d{2}$/.test(time)) {
    data.event.dateTime = '2026-11-26T' + time + ':00';
  }
  data.event.timeConfirmed = !!body.timeConfirmed;
  const address = (body.address || '').trim();
  if (address) data.event.address = address.slice(0, 300);
  save(data);
  sendJson(res, 200, { event: publicEvent(data) });
});

// ---- Games ----

route('POST', '/api/games/signup', async (req, res) => {
  const body = await readBody(req);
  const guestName = (body.guestName || '').trim();
  const categoryId = parseInt(body.categoryId, 10);
  if (!guestName || !categoryId) return sendJson(res, 400, { error: 'Your name and a category are required' });

  const data = load();
  const category = data.gameCategories.find((c) => c.id === categoryId);
  if (!category) return sendJson(res, 404, { error: 'Game category not found' });
  const exists = data.gameSignups.some(
    (s) => s.categoryId === categoryId && s.guestName.toLowerCase() === guestName.toLowerCase()
  );
  if (!exists) {
    data.gameSignups.push({
      id: nextId(data, 'gameSignups'),
      guestName,
      categoryId,
      createdAt: new Date().toISOString(),
    });
    save(data);
  }
  sendJson(res, 200, { ok: true });
});

route('POST', '/api/games/leave', async (req, res) => {
  const body = await readBody(req);
  const guestName = (body.guestName || '').trim();
  const categoryId = parseInt(body.categoryId, 10);
  const data = load();
  data.gameSignups = data.gameSignups.filter(
    (s) => !(s.categoryId === categoryId && s.guestName.toLowerCase() === guestName.toLowerCase())
  );
  save(data);
  sendJson(res, 200, { ok: true });
});

route('POST', '/api/game-categories', async (req, res) => {
  const body = await readBody(req);
  const name = (body.name || '').trim();
  const description = (body.description || '').trim();
  if (!name) return sendJson(res, 400, { error: 'Name is required' });
  const data = load();
  const category = { id: nextId(data, 'gameCategories'), name, description, createdAt: new Date().toISOString() };
  data.gameCategories.push(category);
  save(data);
  sendJson(res, 201, { category });
});

route('DELETE', '/api/game-categories/:id', async (req, res, params) => {
  const id = parseInt(params.id, 10);
  const data = load();
  data.gameCategories = data.gameCategories.filter((c) => c.id !== id);
  data.gameSignups = data.gameSignups.filter((s) => s.categoryId !== id);
  save(data);
  sendJson(res, 200, { ok: true });
});

const server = http.createServer(async (req, res) => {
  const urlPath = req.url.split('?')[0];
  if (urlPath.startsWith('/api/')) {
    const handled = await handleApi(req, res, urlPath);
    if (!handled) notFound(res);
    return;
  }
  serveStatic(req, res, urlPath);
});

server.listen(PORT, () => {
  console.log(`Thanksgiving planner running at http://localhost:${PORT}`);
  console.log('Dashboard (unlisted, no password) at /dashboard.html');
});
