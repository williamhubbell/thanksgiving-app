(function () {
  function toast(msg) {
    const el = document.getElementById('toast');
    el.textContent = msg;
    el.classList.add('show');
    setTimeout(() => el.classList.remove('show'), 2200);
  }

  async function api(method, url, body) {
    const headers = body ? { 'Content-Type': 'application/json' } : undefined;
    const res = await fetch(url, { method, headers, body: body ? JSON.stringify(body) : undefined });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || 'Something went wrong');
    return data;
  }

  let state = null;
  let eventFormLoaded = false;

  async function refresh() {
    state = await api('GET', '/api/state');
    renderSummary();
    renderEventForm();
    renderPhaseButtons();
    renderFamilies();
    renderDishes();
    renderGames();
  }

  function renderEventForm() {
    if (eventFormLoaded) return; // don't fight the organizer mid-edit on the 15s poll
    const ev = (state && state.event) || {};
    if (ev.dateTime && ev.dateTime.length >= 16) {
      document.getElementById('eventTimeInput').value = ev.dateTime.slice(11, 16);
    }
    document.getElementById('eventTimeConfirmed').checked = !!ev.timeConfirmed;
    document.getElementById('eventAddressInput').value = ev.address || '';
    eventFormLoaded = true;
  }

  document.getElementById('saveEventBtn').addEventListener('click', async () => {
    const time = document.getElementById('eventTimeInput').value;
    const timeConfirmed = document.getElementById('eventTimeConfirmed').checked;
    const address = document.getElementById('eventAddressInput').value.trim();
    try {
      await api('POST', '/api/event', { time, timeConfirmed, address });
      toast('Event details saved');
      refresh();
    } catch (err) {
      toast(err.message);
    }
  });

  function renderSummary() {
    const s = state.summary || {};
    document.getElementById('summaryPills').innerHTML = `
      <div class="summary-pill"><div class="num">${s.familiesCount || 0}</div><div class="lbl">Families</div></div>
      <div class="summary-pill"><div class="num">${s.totalHeadcountYes || 0}</div><div class="lbl">Confirmed</div></div>
      <div class="summary-pill"><div class="num">${s.totalHeadcountMaybe || 0}</div><div class="lbl">Maybe</div></div>
      <div class="summary-pill"><div class="num">${state.dishes.filter((d) => !d.claimedBy).length}</div><div class="lbl">Open dishes</div></div>
    `;
  }

  function renderPhaseButtons() {
    const voting = state.potluckPhase === 'voting';
    const mode = state.potluckPhaseMode || 'auto';
    document.getElementById('phaseVotingBtn').classList.toggle('active-phase', mode === 'manual-voting');
    document.getElementById('phaseSignupBtn').classList.toggle('active-phase', mode === 'manual-signup');
    document.getElementById('phaseAutoBtn').classList.toggle('active-phase', mode === 'auto');
    document.getElementById('phaseStatusLine').textContent =
      `Right now: ${voting ? 'voting is open' : 'sign-ups are open'} (${mode === 'auto' ? 'automatic schedule' : 'manual override'}).`;
  }

  async function setPhaseMode(mode) {
    try {
      await api('POST', '/api/potluck-phase', { mode });
      toast(
        mode === 'auto'
          ? 'Back to the automatic schedule'
          : mode === 'manual-voting'
          ? 'Voting forced open'
          : 'Sign-ups forced open'
      );
      refresh();
    } catch (err) {
      toast(err.message);
    }
  }
  document.getElementById('phaseVotingBtn').addEventListener('click', () => setPhaseMode('manual-voting'));
  document.getElementById('phaseSignupBtn').addEventListener('click', () => setPhaseMode('manual-signup'));
  document.getElementById('phaseAutoBtn').addEventListener('click', () => setPhaseMode('auto'));

  async function deleteFamily(id) {
    if (!confirm('Remove this family\'s RSVP?')) return;
    try {
      await api('DELETE', `/api/families/${id}`);
      toast('Removed');
      refresh();
    } catch (err) {
      toast(err.message);
    }
  }
  window.__deleteFamily = deleteFamily;

  function renderFamilies() {
    const sorted = [...state.families].sort((a, b) => a.familyName.localeCompare(b.familyName));
    document.getElementById('familyTable').innerHTML = sorted.length
      ? sorted
          .map(
            (f) => `
      <div class="list-item">
        <div class="item-main">
          <div class="item-title">${escapeHtml(f.familyName)} family <span class="badge ${f.attending}">${f.attending}</span></div>
          <div class="item-sub">${f.members.map(escapeHtml).join(', ') || 'No members listed'}${f.notes ? ' · ' + escapeHtml(f.notes) : ''}</div>
        </div>
        <button class="btn small danger" onclick="__deleteFamily(${f.id})">Remove</button>
      </div>`
          )
          .join('')
      : '<p class="hint">No RSVPs yet.</p>';
  }

  document.getElementById('addDishBtn').addEventListener('click', async () => {
    const category = document.getElementById('newDishCategory').value;
    const itemName = document.getElementById('newDishName').value.trim();
    if (!itemName) return toast('Enter a dish name');
    try {
      await api('POST', '/api/dishes', { category, itemName });
      document.getElementById('newDishName').value = '';
      toast('Added to the list');
      refresh();
    } catch (err) {
      toast(err.message);
    }
  });

  async function deleteDish(id) {
    if (!confirm('Remove this dish from the list?')) return;
    try {
      await api('DELETE', `/api/dishes/${id}`);
      toast('Removed');
      refresh();
    } catch (err) {
      toast(err.message);
    }
  }
  window.__deleteDish = deleteDish;

  function renderDishes() {
    const categories = ['Appetizer', 'Side', 'Main', 'Dessert', 'Drinks', 'Other'];
    const byCategory = {};
    categories.forEach((c) => (byCategory[c] = []));
    state.dishes.forEach((d) => {
      if (!byCategory[d.category]) byCategory[d.category] = [];
      byCategory[d.category].push(d);
    });
    const voting = state.potluckPhase === 'voting';
    document.getElementById('dishTable').innerHTML = categories
      .filter((c) => byCategory[c].length)
      .map((cat) => {
        const items = byCategory[cat]
          .map(
            (d) => `
        <div class="list-item">
          <div class="item-main">
            <div class="item-title">${escapeHtml(d.itemName)}</div>
            <div class="item-sub">${
              voting
                ? `Score: ${d.score > 0 ? '+' : ''}${d.score} (${d.upvotes.length} up · ${d.downvotes.length} down)`
                : d.claimedBy
                ? 'Bringing: ' + escapeHtml(d.claimedBy)
                : 'Not claimed yet'
            }</div>
          </div>
          <button class="btn small danger" onclick="__deleteDish(${d.id})">✕</button>
        </div>`
          )
          .join('');
        return `<h3>${cat}</h3>${items}`;
      })
      .join('');
  }

  document.getElementById('addCatBtn').addEventListener('click', async () => {
    const name = document.getElementById('newCatName').value.trim();
    const description = document.getElementById('newCatDesc').value.trim();
    if (!name) return toast('Enter a name');
    try {
      await api('POST', '/api/game-categories', { name, description });
      document.getElementById('newCatName').value = '';
      document.getElementById('newCatDesc').value = '';
      toast('Added game category');
      refresh();
    } catch (err) {
      toast(err.message);
    }
  });

  async function deleteCategory(id) {
    if (!confirm('Remove this game category and its sign-ups?')) return;
    try {
      await api('DELETE', `/api/game-categories/${id}`);
      toast('Removed');
      refresh();
    } catch (err) {
      toast(err.message);
    }
  }
  window.__deleteCategory = deleteCategory;

  function renderGames() {
    document.getElementById('gameTable').innerHTML = state.gameCategories
      .map(
        (c) => `
      <div class="list-item">
        <div class="item-main">
          <div class="item-title">${escapeHtml(c.name)}</div>
          <div class="item-sub">${escapeHtml(c.description || '')}${c.signups.length ? ' · ' + c.signups.length + ' joined: ' + escapeHtml(c.signups.join(', ')) : ' · No one yet'}</div>
        </div>
        <button class="btn small danger" onclick="__deleteCategory(${c.id})">✕</button>
      </div>`
      )
      .join('');
  }

  function escapeHtml(str) {
    return String(str || '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  refresh();
  setInterval(refresh, 15000);
})();
