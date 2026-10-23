(function () {
  const NAME_KEY = 'tg_guest_name';
  const FAMILY_KEY = 'tg_family_name';
  const guestNameInput = document.getElementById('guestName');
  const familyNameInput = document.getElementById('familyName');
  guestNameInput.value = localStorage.getItem(NAME_KEY) || '';
  familyNameInput.value = localStorage.getItem(FAMILY_KEY) || '';

  guestNameInput.addEventListener('change', () => {
    localStorage.setItem(NAME_KEY, guestNameInput.value.trim());
  });
  familyNameInput.addEventListener('change', () => {
    localStorage.setItem(FAMILY_KEY, familyNameInput.value.trim());
  });

  function currentName() {
    return guestNameInput.value.trim();
  }

  function toast(msg) {
    const el = document.getElementById('toast');
    el.textContent = msg;
    el.classList.add('show');
    setTimeout(() => el.classList.remove('show'), 2200);
  }

  function requireName() {
    const n = currentName();
    if (!n) {
      toast('Enter your name at the top first');
      guestNameInput.focus();
      return null;
    }
    localStorage.setItem(NAME_KEY, n);
    return n;
  }

  // ---- Tabs ----
  document.querySelectorAll('.tab-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.tab-btn').forEach((b) => b.classList.remove('active'));
      document.querySelectorAll('.panel').forEach((p) => p.classList.remove('active'));
      btn.classList.add('active');
      document.getElementById('panel-' + btn.dataset.tab).classList.add('active');
    });
  });

  // ---- API helpers ----
  async function api(method, url, body) {
    const res = await fetch(url, {
      method,
      headers: body ? { 'Content-Type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || 'Something went wrong');
    return data;
  }

  let state = { families: [], dishes: [], gameCategories: [], photos: [], summary: {}, potluckPhase: 'voting', event: {} };
  let lastHeroNum = null;
  let draftMembers = [];
  let draftLoadedFor = null;
  let countdownTarget = null;
  let countdownConfirmed = false;

  async function refresh() {
    state = await api('GET', '/api/state');
    renderEventHeader();
    renderHero();
    renderKnownNames();
    renderRsvp();
    renderPotluck();
    renderGames();
    renderPhotos();
  }

  // ---- Event header + countdown ----
  function renderEventHeader() {
    const ev = state.event || {};
    if (ev.dateLabel) document.getElementById('eventDateLabel').textContent = ev.dateLabel;
    if (ev.address) {
      document.getElementById('eventAddress').textContent = ev.address;
      document.getElementById('eventAddressLink').href =
        'https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent(ev.address);
    }
    countdownTarget = ev.dateTime ? new Date(ev.dateTime) : null;
    countdownConfirmed = !!ev.timeConfirmed;
    tickCountdown();
  }

  function tickCountdown() {
    const row = document.getElementById('countdownRow');
    const sub = document.getElementById('countdownSub');
    if (!countdownTarget || isNaN(countdownTarget.getTime())) {
      row.innerHTML = '';
      sub.textContent = '';
      return;
    }
    const diffMs = countdownTarget.getTime() - Date.now();
    if (diffMs <= 0) {
      row.innerHTML = '<div class="cd-unit wide"><div class="cd-num">🦃</div><div class="cd-lbl">Happy Thanksgiving!</div></div>';
      sub.textContent = '';
      return;
    }
    const totalSeconds = Math.floor(diffMs / 1000);
    const days = Math.floor(totalSeconds / 86400);
    const hours = Math.floor((totalSeconds % 86400) / 3600);
    const mins = Math.floor((totalSeconds % 3600) / 60);
    const secs = totalSeconds % 60;

    if (countdownConfirmed) {
      row.innerHTML = `
        <div class="cd-unit"><div class="cd-num">${days}</div><div class="cd-lbl">Days</div></div>
        <div class="cd-unit"><div class="cd-num">${hours}</div><div class="cd-lbl">Hours</div></div>
        <div class="cd-unit"><div class="cd-num">${mins}</div><div class="cd-lbl">Min</div></div>
        <div class="cd-unit"><div class="cd-num">${secs}</div><div class="cd-lbl">Sec</div></div>`;
      sub.textContent = 'until dinner!';
    } else {
      row.innerHTML = `<div class="cd-unit wide"><div class="cd-num">${days}</div><div class="cd-lbl">${
        days === 1 ? 'Day to go' : 'Days to go'
      }</div></div>`;
      sub.textContent = 'Exact time still TBD — stay tuned';
    }
  }
  setInterval(tickCountdown, 1000);

  function renderHero() {
    const n = state.summary.totalHeadcountYes || 0;
    const el = document.getElementById('heroNum');
    el.textContent = n;
    if (lastHeroNum !== null && n !== lastHeroNum) {
      el.classList.remove('pulse');
      void el.offsetWidth; // restart animation
      el.classList.add('pulse');
    }
    lastHeroNum = n;
    const maybeN = state.summary.totalHeadcountMaybe || 0;
    document.getElementById('heroSub').textContent =
      `${state.summary.attendingFamiliesCount || 0} families confirmed` + (maybeN ? ` · ${maybeN} more maybe joining` : '');
  }

  function renderKnownNames() {
    const names = new Set();
    state.families.forEach((f) => f.members.forEach((m) => names.add(m)));
    const dl = document.getElementById('knownNames');
    dl.innerHTML = [...names].map((n) => `<option value="${escapeHtml(n)}"></option>`).join('');
  }

  // ---- RSVP ----
  document.querySelectorAll('#attendingRow input').forEach((input) => {
    input.addEventListener('change', () => {
      document.querySelectorAll('#attendingRow label').forEach((l) => l.classList.remove('checked'));
      input.closest('label').classList.add('checked');
    });
  });

  function renderMemberChips() {
    document.getElementById('memberChips').innerHTML = draftMembers.length
      ? draftMembers
          .map(
            (m, i) =>
              `<span class="member-chip">${escapeHtml(m)}<button type="button" data-i="${i}" title="Remove">✕</button></span>`
          )
          .join('')
      : '<span class="hint">No members added yet</span>';
    document.querySelectorAll('#memberChips button').forEach((btn) => {
      btn.addEventListener('click', () => {
        draftMembers.splice(parseInt(btn.dataset.i, 10), 1);
        renderMemberChips();
      });
    });
  }

  function addMember() {
    const input = document.getElementById('memberInput');
    const name = input.value.trim();
    if (!name) return;
    draftMembers.push(name);
    input.value = '';
    renderMemberChips();
    input.focus();
  }
  document.getElementById('addMemberBtn').addEventListener('click', addMember);
  document.getElementById('memberInput').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      addMember();
    }
  });

  document.getElementById('rsvpForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const familyName = familyNameInput.value.trim();
    if (!familyName) return toast('Enter your family name');
    const attending = document.querySelector('#attendingRow input:checked');
    if (!attending) return toast('Pick yes, maybe, or no');
    if (draftMembers.length === 0) return toast('Add at least one family member');
    const notes = document.getElementById('notes').value;
    try {
      await api('POST', '/api/families', { familyName, attending: attending.value, members: draftMembers, notes });
      localStorage.setItem(FAMILY_KEY, familyName);
      toast('RSVP saved — thank you!');
      await refresh();
    } catch (err) {
      toast(err.message);
    }
  });

  function renderRsvp() {
    const familyName = familyNameInput.value.trim().toLowerCase();
    const mine = state.families.find((f) => f.familyName.toLowerCase() === familyName);
    if (mine && draftLoadedFor !== mine.familyName.toLowerCase()) {
      draftMembers = [...mine.members];
      draftLoadedFor = mine.familyName.toLowerCase();
      const radio = document.querySelector(`#attendingRow input[value="${mine.attending}"]`);
      if (radio) {
        radio.checked = true;
        document.querySelectorAll('#attendingRow label').forEach((l) => l.classList.remove('checked'));
        radio.closest('label').classList.add('checked');
      }
      document.getElementById('notes').value = mine.notes || '';
    }
    renderMemberChips();

    const sorted = [...state.families].sort((a, b) => a.familyName.localeCompare(b.familyName));
    document.getElementById('familyList').innerHTML = sorted.length
      ? sorted
          .map(
            (f) => `
        <div class="family-block">
          <span class="family-name">${escapeHtml(f.familyName)} family</span>
          <span class="badge ${f.attending}">${f.attending}</span>
          <ul>${f.members.map((m) => `<li>${escapeHtml(m)}</li>`).join('') || '<li class="hint">No members listed</li>'}</ul>
          ${f.notes ? `<div class="item-sub">${escapeHtml(f.notes)}</div>` : ''}
        </div>`
          )
          .join('')
      : '<p class="hint">No RSVPs yet — be the first!</p>';
  }

  // ---- Potluck ----
  document.getElementById('addDishBtn').addEventListener('click', async () => {
    const name = requireName();
    if (!name) return;
    const category = document.getElementById('newDishCategory').value;
    const itemName = document.getElementById('newDishName').value.trim();
    if (!itemName) return toast('Enter a dish name');
    try {
      await api('POST', '/api/dishes', { category, itemName, guestName: name });
      document.getElementById('newDishName').value = '';
      toast(state.potluckPhase === 'signup' ? 'Added & claimed!' : 'Added to the vote!');
      await refresh();
    } catch (err) {
      toast(err.message);
    }
  });

  async function voteDish(id, vote) {
    const name = requireName();
    if (!name) return;
    try {
      await api('POST', `/api/dishes/${id}/vote`, { personName: name, vote });
      await refresh();
    } catch (err) {
      toast(err.message);
    }
  }
  async function claimDish(id) {
    const name = requireName();
    if (!name) return;
    try {
      await api('POST', `/api/dishes/${id}/claim`, { guestName: name });
      toast("Nice — you're bringing it!");
      await refresh();
    } catch (err) {
      toast(err.message);
    }
  }
  async function unclaimDish(id) {
    try {
      await api('POST', `/api/dishes/${id}/unclaim`, {});
      toast('Removed your claim');
      await refresh();
    } catch (err) {
      toast(err.message);
    }
  }
  window.__voteDish = voteDish;
  window.__claimDish = claimDish;
  window.__unclaimDish = unclaimDish;

  function renderPotluck() {
    const myName = currentName().toLowerCase();
    const voting = state.potluckPhase === 'voting';
    const note = state.potluckScheduleNote || '';
    document.getElementById('phaseBanner').textContent = voting
      ? `🗳️ Voting is open — up or down vote each dish (one vote each, no stacking). ${note}`
      : `✅ Sign-ups are open — claim a dish below! ${note}`;

    const categories = ['Appetizer', 'Side', 'Main', 'Dessert', 'Drinks', 'Other'];
    const byCategory = {};
    categories.forEach((c) => (byCategory[c] = []));
    state.dishes.forEach((d) => {
      if (!byCategory[d.category]) byCategory[d.category] = [];
      byCategory[d.category].push(d);
    });

    document.getElementById('dishLists').innerHTML = categories
      .filter((c) => byCategory[c].length)
      .map((cat) => {
        const items = byCategory[cat]
          .map((d) => {
            const iUpvoted = d.upvotes.some((n) => n.toLowerCase() === myName);
            const iDownvoted = d.downvotes.some((n) => n.toLowerCase() === myName);
            const isMine = d.claimedBy && d.claimedBy.toLowerCase() === myName;

            let rightControls;
            if (voting) {
              rightControls = `
                <div class="vote-controls">
                  <button class="vote-btn up ${iUpvoted ? 'active' : ''}" onclick="__voteDish(${d.id},'up')">▲</button>
                  <span class="score-num">${d.score > 0 ? '+' : ''}${d.score}</span>
                  <button class="vote-btn down ${iDownvoted ? 'active' : ''}" onclick="__voteDish(${d.id},'down')">▼</button>
                </div>`;
            } else {
              const action = d.claimedBy
                ? isMine
                  ? `<button class="btn small secondary" onclick="__unclaimDish(${d.id})">Unclaim</button>`
                  : ''
                : `<button class="btn small" onclick="__claimDish(${d.id})">Claim</button>`;
              rightControls = `<span class="badge ${d.claimedBy ? 'claimed' : 'open'}">${d.claimedBy ? 'Claimed' : 'Open'}</span>${action}`;
            }

            return `
          <div class="list-item">
            <div class="item-main">
              <div class="item-title">${escapeHtml(d.itemName)}</div>
              <div class="item-sub">${
                voting
                  ? `${d.upvotes.length} up · ${d.downvotes.length} down`
                  : d.claimedBy
                  ? 'Bringing: ' + escapeHtml(d.claimedBy)
                  : 'Nobody has claimed this yet'
              }</div>
            </div>
            ${rightControls}
          </div>`;
          })
          .join('');
        return `<h3>${cat}</h3>${items}`;
      })
      .join('');
  }

  // ---- Games ----
  async function joinGame(id) {
    const name = requireName();
    if (!name) return;
    try {
      await api('POST', '/api/games/signup', { guestName: name, categoryId: id });
      toast("You're in!");
      await refresh();
    } catch (err) {
      toast(err.message);
    }
  }
  async function leaveGame(id) {
    const name = requireName();
    if (!name) return;
    try {
      await api('POST', '/api/games/leave', { guestName: name, categoryId: id });
      toast('Left that game');
      await refresh();
    } catch (err) {
      toast(err.message);
    }
  }
  window.__joinGame = joinGame;
  window.__leaveGame = leaveGame;

  function renderGames() {
    const myName = currentName().toLowerCase();
    document.getElementById('gameList').innerHTML = state.gameCategories
      .map((c) => {
        const mine = c.signups.some((s) => s.toLowerCase() === myName);
        return `
        <div class="list-item">
          <div class="item-main">
            <div class="item-title">${escapeHtml(c.name)}</div>
            <div class="item-sub">${escapeHtml(c.description || '')}${c.signups.length ? ' · ' + c.signups.length + ' joined: ' + escapeHtml(c.signups.join(', ')) : ' · No one yet'}</div>
          </div>
          ${
            mine
              ? `<button class="btn small secondary" onclick="__leaveGame(${c.id})">Leave</button>`
              : `<button class="btn small" onclick="__joinGame(${c.id})">Join</button>`
          }
        </div>`;
      })
      .join('');
  }

  // ---- Photos ----

  // Resizes/compresses an image in the browser before upload, so phone
  // photos (often several MB) comfortably clear the server's ~1.3MB limit
  // and upload fast even on spotty Thanksgiving-day wifi.
  function resizeImageForUpload(file, maxDim, startQuality) {
    maxDim = maxDim || 1400;
    startQuality = startQuality || 0.85;
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onerror = () => reject(new Error('Could not read that file'));
      reader.onload = () => {
        const img = new Image();
        img.onerror = () => reject(new Error('That file does not look like an image'));
        img.onload = () => {
          let { width, height } = img;
          if (width > maxDim || height > maxDim) {
            if (width >= height) {
              height = Math.round((height * maxDim) / width);
              width = maxDim;
            } else {
              width = Math.round((width * maxDim) / height);
              height = maxDim;
            }
          }
          const canvas = document.createElement('canvas');
          canvas.width = width;
          canvas.height = height;
          canvas.getContext('2d').drawImage(img, 0, 0, width, height);

          const tryQuality = (q) => {
            canvas.toBlob(
              (blob) => {
                if (!blob) return reject(new Error('Could not process that image'));
                if (blob.size > 900 * 1024 && q > 0.35) {
                  tryQuality(q - 0.15);
                  return;
                }
                const fr = new FileReader();
                fr.onload = () => resolve(fr.result);
                fr.onerror = () => reject(new Error('Could not process that image'));
                fr.readAsDataURL(blob);
              },
              'image/jpeg',
              q
            );
          };
          tryQuality(startQuality);
        };
        img.src = reader.result;
      };
      reader.readAsDataURL(file);
    });
  }

  document.getElementById('uploadPhotoBtn').addEventListener('click', async () => {
    const name = requireName();
    if (!name) return;
    const fileInput = document.getElementById('photoFile');
    const file = fileInput.files && fileInput.files[0];
    if (!file) return toast('Choose a photo first');
    const year = document.getElementById('photoYear').value.trim() || 'Past Thanksgivings';
    const caption = document.getElementById('photoCaption').value.trim();
    const statusEl = document.getElementById('uploadStatus');
    const btn = document.getElementById('uploadPhotoBtn');
    btn.disabled = true;
    statusEl.textContent = 'Preparing photo…';
    try {
      const dataUrl = await resizeImageForUpload(file);
      statusEl.textContent = 'Uploading…';
      await api('POST', '/api/photos', { year, caption, uploadedBy: name, dataUrl });
      fileInput.value = '';
      document.getElementById('photoCaption').value = '';
      statusEl.textContent = '';
      toast('Photo added!');
      await refresh();
    } catch (err) {
      statusEl.textContent = '';
      toast(err.message);
    } finally {
      btn.disabled = false;
    }
  });

  function openLightbox(url) {
    document.getElementById('lightboxImg').src = url;
    document.getElementById('lightbox').classList.add('show');
  }
  window.__openPhoto = openLightbox;

  function renderPhotos() {
    const gallery = document.getElementById('photoGallery');
    if (!state.photos || !state.photos.length) {
      gallery.innerHTML = '<p class="hint">No photos yet — be the first to add one!</p>';
      return;
    }
    const groups = {};
    const order = [];
    state.photos.forEach((p) => {
      const key = p.year || 'Past Thanksgivings';
      if (!groups[key]) {
        groups[key] = [];
        order.push(key);
      }
      groups[key].push(p);
    });
    order.sort((a, b) => {
      const an = /^\d{4}$/.test(a);
      const bn = /^\d{4}$/.test(b);
      if (an && bn) return b - a; // newest year first
      if (an !== bn) return an ? -1 : 1; // numeric years before labels like "Past Thanksgivings"
      return a.localeCompare(b);
    });
    gallery.innerHTML = order
      .map((key) => {
        const items = groups[key]
          .map(
            (p) => `
          <div class="photo-thumb" onclick="__openPhoto('${p.url.replace(/'/g, '%27')}')">
            <img src="${p.url}" alt="${escapeHtml(p.caption || key)}" loading="lazy" />
            ${p.caption ? `<div class="photo-cap">${escapeHtml(p.caption)}</div>` : ''}
          </div>`
          )
          .join('');
        return `<h3>${escapeHtml(key)}</h3><div class="photo-grid">${items}</div>`;
      })
      .join('');
  }

  function escapeHtml(str) {
    return String(str || '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  refresh();
  setInterval(refresh, 15000); // light polling so people see new claims/RSVPs/votes without refreshing
})();
