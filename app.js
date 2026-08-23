(() => {
  'use strict';

  const STORAGE_KEY = 'taskroulette_state_v1';

  const DEFAULT_STATE = () => ({
    version: 1,
    tasks: [],
    history: [],
    today: null, // { date, picks: [{taskId,taskName,type,duration,status,notes}] }
    settings: { minWeightPct: 15 },
  });

  let state = loadState();

  // ---------- persistence ----------

  function loadState() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return DEFAULT_STATE();
      const parsed = JSON.parse(raw);
      return Object.assign(DEFAULT_STATE(), parsed);
    } catch (e) {
      console.error('Failed to load state', e);
      return DEFAULT_STATE();
    }
  }

  function saveState() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  }

  // ---------- date helpers ----------

  function todayStr() {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }

  function daysBetween(dateStrA, dateStrB) {
    const a = new Date(dateStrA + 'T00:00:00');
    const b = new Date(dateStrB + 'T00:00:00');
    return Math.round((b - a) / 86400000);
  }

  function uid() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  }

  function randInt(min, max) {
    if (max < min) [min, max] = [max, min];
    return Math.floor(Math.random() * (max - min + 1)) + min;
  }

  // ---------- weighting / selection ----------

  function taskAvailability(task) {
    // returns { weight, statusLabel, statusClass, detail }
    if (task.type === 'oneoff' || !task.lastCompletedAt) {
      return { weight: 1, statusLabel: 'Available', statusClass: 'status-available', detail: '' };
    }
    const minWeight = Math.max(0.01, Math.min(1, (state.settings.minWeightPct || 15) / 100));
    const daysSince = daysBetween(task.lastCompletedAt, todayStr());
    const cooldown = task.cooldownDays || 0;
    const cooling = task.coolingDays || 0;

    if (daysSince < cooldown) {
      const left = cooldown - daysSince;
      return {
        weight: 0,
        statusLabel: `Cooldown · ${left}d left`,
        statusClass: 'status-cooldown',
        detail: `Not eligible for ${left} more day${left === 1 ? '' : 's'}`,
      };
    }
    if (cooling > 0 && daysSince < cooldown + cooling) {
      const progress = (daysSince - cooldown) / cooling; // 0..1
      const weight = minWeight + (1 - minWeight) * progress;
      const left = cooldown + cooling - daysSince;
      return {
        weight,
        statusLabel: `Cooling off · ${left}d`,
        statusClass: 'status-cooling',
        detail: `~${Math.round(weight * 100)}% of normal likelihood, ${left} day${left === 1 ? '' : 's'} left`,
      };
    }
    return { weight: 1, statusLabel: 'Available', statusClass: 'status-available', detail: '' };
  }

  function pickWeightedTask(excludeIds = []) {
    const candidates = state.tasks
      .filter(t => !excludeIds.includes(t.id))
      .map(t => ({ task: t, weight: taskAvailability(t).weight }))
      .filter(c => c.weight > 0);

    if (candidates.length === 0) return null;

    const total = candidates.reduce((s, c) => s + c.weight, 0);
    let r = Math.random() * total;
    for (const c of candidates) {
      r -= c.weight;
      if (r <= 0) return c.task;
    }
    return candidates[candidates.length - 1].task;
  }

  function generateDuration(task) {
    if (task.untilDone) return null;
    const min = task.timeMin, max = task.timeMax;
    if (min == null || max == null || min === '' || max === '') return null;
    return randInt(Number(min), Number(max));
  }

  // ---------- today logic ----------

  function ensureTodayBucket() {
    const t = todayStr();
    if (!state.today || state.today.date !== t) {
      state.today = { date: t, picks: [] };
      saveState();
    }
  }

  function currentPick() {
    ensureTodayBucket();
    const picks = state.today.picks;
    return picks.length ? picks[picks.length - 1] : null;
  }

  function rollNewPick(excludeCurrent) {
    ensureTodayBucket();
    const exclude = [];
    if (excludeCurrent) {
      const cur = currentPick();
      if (cur && cur.status === 'pending') exclude.push(cur.taskId);
    }
    const task = pickWeightedTask(exclude) || pickWeightedTask([]); // fall back to including excluded if only one option
    if (!task) return null;
    const pick = {
      id: uid(),
      taskId: task.id,
      taskName: task.name,
      notes: task.notes || '',
      type: task.type,
      duration: generateDuration(task),
      untilDone: !!task.untilDone,
      status: 'pending',
    };
    if (excludeCurrent) {
      const cur = currentPick();
      if (cur && cur.status === 'pending') {
        state.today.picks.pop(); // replace pending pick, don't keep as noise
      }
    }
    state.today.picks.push(pick);
    saveState();
    return pick;
  }

  function completeCurrentPick() {
    const pick = currentPick();
    if (!pick || pick.status !== 'pending') return;
    pick.status = 'completed';
    pick.completedAt = new Date().toISOString();

    const historyEntry = {
      id: uid(),
      taskId: pick.taskId,
      taskName: pick.taskName,
      type: pick.type,
      duration: pick.duration,
      untilDone: pick.untilDone,
      date: state.today.date,
      completedAt: pick.completedAt,
    };
    state.history.unshift(historyEntry);

    const task = state.tasks.find(t => t.id === pick.taskId);
    if (task) {
      if (task.type === 'recurring') {
        task.lastCompletedAt = state.today.date;
      } else {
        state.tasks = state.tasks.filter(t => t.id !== task.id);
      }
    }
    saveState();
  }

  function skipCurrentPick() {
    const pick = currentPick();
    if (!pick || pick.status !== 'pending') return;
    state.today.picks.pop();
    saveState();
  }

  // ---------- rendering ----------

  const $ = sel => document.querySelector(sel);
  const $$ = sel => Array.from(document.querySelectorAll(sel));

  function fmtDuration(min) {
    if (min == null) return null;
    if (min < 60) return `${min} min`;
    const h = Math.floor(min / 60), m = min % 60;
    return m ? `${h}h ${m}m` : `${h}h`;
  }

  // Label for a pick or history entry (has .duration / .untilDone)
  function pickDurationLabel(entry) {
    if (entry.untilDone) return 'Until done';
    if (entry.duration != null) return fmtDuration(entry.duration);
    return null;
  }

  // Label for a task's configured time range, shown in the task list
  function taskDurationLabel(task) {
    if (task.untilDone) return 'Until done';
    if (task.timeMin != null && task.timeMax != null && task.timeMin !== '' && task.timeMax !== '') {
      return `${fmtDuration(Number(task.timeMin))}–${fmtDuration(Number(task.timeMax))}`;
    }
    return task.type === 'oneoff' ? 'No estimate' : '';
  }

  function renderToday() {
    ensureTodayBucket();
    const pick = currentPick();

    $('#todayEmpty').classList.add('hidden');
    $('#todayAllCooldown').classList.add('hidden');
    $('#todayCard').classList.add('hidden');
    $('#todayDoneCard').classList.add('hidden');

    if (state.tasks.length === 0) {
      $('#todayEmpty').classList.remove('hidden');
      renderCompletedToday();
      return;
    }

    if (!pick) {
      // try to auto-roll for today if nothing picked yet
      const anyWeighted = state.tasks.some(t => taskAvailability(t).weight > 0);
      if (!anyWeighted) {
        const soonest = state.tasks
          .map(t => ({ t, a: taskAvailability(t) }))
          .filter(x => x.a.statusClass === 'status-cooldown');
        $('#todayAllCooldownDetail').textContent = soonest.length
          ? `${soonest.length} recurring task${soonest.length === 1 ? '' : 's'} still cooling down.`
          : '';
        $('#todayAllCooldown').classList.remove('hidden');
        renderCompletedToday();
        return;
      }
      rollNewPick(false);
      return renderToday();
    }

    if (pick.status === 'completed') {
      $('#todayDoneCard').classList.remove('hidden');
      const durLabel = pickDurationLabel(pick);
      const durTxt = durLabel ? ` (${durLabel})` : '';
      $('#doneSummary').textContent = `You completed "${pick.taskName}"${durTxt}. Want to do more?`;
      renderCompletedToday();
      return;
    }

    // pending
    $('#todayCard').classList.remove('hidden');
    $('#todayType').textContent = pick.type === 'recurring' ? 'Recurring' : 'One-off';
    $('#todayName').textContent = pick.taskName;
    $('#todayNotes').textContent = pick.notes || '';
    $('#todayNotes').classList.toggle('hidden', !pick.notes);
    const durLabel = pickDurationLabel(pick);
    if (durLabel) {
      $('#todayDuration').textContent = `⏱ ${durLabel}`;
      $('#todayDuration').classList.remove('hidden');
    } else {
      $('#todayDuration').classList.add('hidden');
    }
    renderCompletedToday();
  }

  function renderCompletedToday() {
    ensureTodayBucket();
    const completed = state.today.picks.filter(p => p.status === 'completed');
    const list = $('#completedTodayList');
    const wrap = $('#todayCompletedList');
    if (completed.length === 0) {
      wrap.classList.add('hidden');
      list.innerHTML = '';
      return;
    }
    wrap.classList.remove('hidden');
    list.innerHTML = completed.map(p => `
      <li><span>${escapeHtml(p.taskName)}</span><span class="muted">${pickDurationLabel(p) || ''}</span></li>
    `).join('');
  }

  function statusInfoForList(task) {
    return taskAvailability(task);
  }

  function renderTasks() {
    const filter = $('#taskFilterSeg .seg-btn.active').dataset.filter;
    let list = state.tasks;
    if (filter === 'recurring') list = list.filter(t => t.type === 'recurring');
    if (filter === 'oneoff') list = list.filter(t => t.type === 'oneoff');

    const container = $('#taskList');
    $('#taskListEmpty').classList.toggle('hidden', list.length > 0);
    container.innerHTML = list.map(t => {
      const a = statusInfoForList(t);
      const durTxt = taskDurationLabel(t);
      const sub = [t.type === 'recurring' ? `Cooldown ${t.cooldownDays}d, cooling ${t.coolingDays}d` : 'One-off', durTxt]
        .filter(Boolean).join(' · ');
      return `
        <li class="task-item" data-id="${t.id}">
          <div class="task-item-top">
            <span class="task-item-name">${escapeHtml(t.name)}</span>
            <span class="task-item-status ${a.statusClass}">${a.statusLabel}</span>
          </div>
          <div class="task-item-sub">${escapeHtml(sub)}</div>
        </li>
      `;
    }).join('');
  }

  function renderHistory() {
    const has = state.history.length > 0;
    $('#historyEmpty').classList.toggle('hidden', has);
    const container = $('#historyList');
    if (!has) { container.innerHTML = ''; return; }

    const groups = {};
    for (const h of state.history) {
      (groups[h.date] = groups[h.date] || []).push(h);
    }
    const dates = Object.keys(groups).sort((a, b) => b.localeCompare(a));
    container.innerHTML = dates.map(date => {
      const items = groups[date];
      const label = formatDayLabel(date);
      return `
        <div class="history-day">
          <div class="history-day-label">${label}</div>
          ${items.map(h => `
            <div class="history-item">
              <div>
                <div class="history-item-name">${escapeHtml(h.taskName)}</div>
                <div class="history-item-badge">${h.type === 'recurring' ? 'Recurring' : 'One-off'}</div>
              </div>
              <div class="history-item-time">${pickDurationLabel(h) || ''}</div>
            </div>
          `).join('')}
        </div>
      `;
    }).join('');
  }

  function formatDayLabel(dateStr) {
    const t = todayStr();
    const diff = daysBetween(dateStr, t);
    if (diff === 0) return 'Today';
    if (diff === 1) return 'Yesterday';
    const d = new Date(dateStr + 'T00:00:00');
    return d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
  }

  function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str == null ? '' : String(str);
    return div.innerHTML;
  }

  // ---------- view switching ----------

  function showView(name) {
    $$('.view').forEach(v => v.classList.add('hidden'));
    $(`#view-${name}`).classList.remove('hidden');
    $$('.tab-btn').forEach(b => b.classList.toggle('active', b.dataset.view === name));
    $('#topbarTitle').textContent = name === 'today' ? 'Today' : name === 'tasks' ? 'Tasks' : 'History';
    if (name === 'today') renderToday();
    if (name === 'tasks') renderTasks();
    if (name === 'history') renderHistory();
  }

  $$('.tab-btn').forEach(btn => btn.addEventListener('click', () => showView(btn.dataset.view)));
  $$('[data-goto]').forEach(btn => btn.addEventListener('click', () => showView(btn.dataset.goto)));

  // ---------- today view actions ----------

  $('#rerollBtn').addEventListener('click', () => {
    rollNewPick(true);
    renderToday();
  });

  $('#completeBtn').addEventListener('click', () => {
    completeCurrentPick();
    renderToday();
  });

  $('#skipBtn').addEventListener('click', () => {
    skipCurrentPick();
    renderToday();
  });

  $('#anotherBtn').addEventListener('click', () => {
    const p = rollNewPick(false);
    if (!p) toast("Nothing else available right now");
    renderToday();
  });

  // ---------- task filter segmented control ----------

  $('#taskFilterSeg').addEventListener('click', e => {
    const btn = e.target.closest('.seg-btn');
    if (!btn) return;
    $$('#taskFilterSeg .seg-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    renderTasks();
  });

  // ---------- task list -> edit ----------

  $('#taskList').addEventListener('click', e => {
    const item = e.target.closest('.task-item');
    if (!item) return;
    openTaskModal(item.dataset.id);
  });

  $('#fabAdd').addEventListener('click', () => openTaskModal(null));

  // ---------- task modal ----------

  let editingId = null;

  const DURATION_OPTIONS = [30, 60, 90, 120, 150, 180]; // minutes, 30min steps up to 3hr

  function populateDurationSelect(select) {
    select.innerHTML = DURATION_OPTIONS.map(m => `<option value="${m}">${fmtDuration(m)}</option>`).join('');
  }

  // Sets a duration <select>'s value, adding a one-off option first if the
  // existing task value doesn't fall on one of the standard 30min steps.
  function setDurationSelectValue(select, value) {
    if (value != null && value !== '' && !DURATION_OPTIONS.includes(Number(value))) {
      const opt = document.createElement('option');
      opt.value = value;
      opt.textContent = `${fmtDuration(Number(value))} (custom)`;
      select.insertBefore(opt, select.firstChild);
    }
    select.value = value;
  }

  function openTaskModal(id) {
    editingId = id;
    const task = id ? state.tasks.find(t => t.id === id) : null;

    $('#taskModalTitle').textContent = task ? 'Edit Task' : 'New Task';
    $('#deleteTaskBtn').classList.toggle('hidden', !task);

    $('#fName').value = task ? task.name : '';
    $('#fNotes').value = task ? (task.notes || '') : '';

    const type = task ? task.type : 'recurring';
    setModalType(type);

    const recurMode = task && task.type === 'recurring' && task.untilDone ? 'untilDone' : 'range';
    setRecurTimeMode(recurMode);
    setDurationSelectValue($('#fTimeMin'), task && task.type === 'recurring' && task.timeMin != null ? task.timeMin : 30);
    setDurationSelectValue($('#fTimeMax'), task && task.type === 'recurring' && task.timeMax != null ? task.timeMax : 60);
    $('#fCooldown').value = task ? (task.cooldownDays ?? 3) : 3;
    $('#fCooling').value = task ? (task.coolingDays ?? 7) : 7;

    let oneoffMode = 'none';
    if (task && task.type === 'oneoff') {
      oneoffMode = task.untilDone ? 'untilDone' : (task.timeMin != null ? 'range' : 'none');
    }
    setOneoffTimeMode(oneoffMode);
    setDurationSelectValue($('#fTimeMinOne'), task && task.type === 'oneoff' && task.timeMin != null ? task.timeMin : 30);
    setDurationSelectValue($('#fTimeMaxOne'), task && task.type === 'oneoff' && task.timeMax != null ? task.timeMax : 60);

    $('#taskModal').classList.remove('hidden');
  }

  function closeTaskModal() {
    $('#taskModal').classList.add('hidden');
    editingId = null;
  }

  function setModalType(type) {
    $$('#typeSeg .seg-btn').forEach(b => b.classList.toggle('active', b.dataset.type === type));
    $('#recurringFields').classList.toggle('hidden', type !== 'recurring');
    $('#oneoffFields').classList.toggle('hidden', type !== 'oneoff');
  }

  function setRecurTimeMode(mode) {
    $$('#recurTimeModeSeg .seg-btn').forEach(b => b.classList.toggle('active', b.dataset.mode === mode));
    $('#recurRangeRow').classList.toggle('hidden', mode !== 'range');
  }

  function setOneoffTimeMode(mode) {
    $$('#oneoffTimeModeSeg .seg-btn').forEach(b => b.classList.toggle('active', b.dataset.mode === mode));
    $('#oneoffRangeRow').classList.toggle('hidden', mode !== 'range');
  }

  $('#typeSeg').addEventListener('click', e => {
    const btn = e.target.closest('.seg-btn');
    if (!btn) return;
    setModalType(btn.dataset.type);
  });

  $('#recurTimeModeSeg').addEventListener('click', e => {
    const btn = e.target.closest('.seg-btn');
    if (!btn) return;
    setRecurTimeMode(btn.dataset.mode);
  });

  $('#oneoffTimeModeSeg').addEventListener('click', e => {
    const btn = e.target.closest('.seg-btn');
    if (!btn) return;
    setOneoffTimeMode(btn.dataset.mode);
  });

  $('#taskModalCancel').addEventListener('click', closeTaskModal);

  $('#taskModalSave').addEventListener('click', () => {
    const name = $('#fName').value.trim();
    if (!name) { toast('Please enter a task name'); return; }
    const type = $('#typeSeg .seg-btn.active').dataset.type;

    let payload = {
      name,
      notes: $('#fNotes').value.trim(),
      type,
    };

    if (type === 'recurring') {
      const mode = $('#recurTimeModeSeg .seg-btn.active').dataset.mode;
      if (mode === 'untilDone') {
        payload.untilDone = true;
        payload.timeMin = null;
        payload.timeMax = null;
      } else {
        const min = Number($('#fTimeMin').value) || 30;
        const max = Number($('#fTimeMax').value) || min;
        payload.untilDone = false;
        payload.timeMin = Math.min(min, max);
        payload.timeMax = Math.max(min, max);
      }
      payload.cooldownDays = Math.max(0, Number($('#fCooldown').value) || 0);
      payload.coolingDays = Math.max(0, Number($('#fCooling').value) || 0);
    } else {
      const mode = $('#oneoffTimeModeSeg .seg-btn.active').dataset.mode;
      if (mode === 'untilDone') {
        payload.untilDone = true;
        payload.timeMin = null;
        payload.timeMax = null;
      } else if (mode === 'range') {
        const min = Number($('#fTimeMinOne').value) || 30;
        const max = Number($('#fTimeMaxOne').value) || min;
        payload.untilDone = false;
        payload.timeMin = Math.min(min, max);
        payload.timeMax = Math.max(min, max);
      } else {
        payload.untilDone = false;
        payload.timeMin = null;
        payload.timeMax = null;
      }
    }

    if (editingId) {
      const task = state.tasks.find(t => t.id === editingId);
      Object.assign(task, payload);
    } else {
      state.tasks.push(Object.assign({ id: uid(), createdAt: new Date().toISOString(), lastCompletedAt: null }, payload));
    }
    saveState();
    closeTaskModal();
    renderTasks();
    renderToday();
  });

  $('#deleteTaskBtn').addEventListener('click', () => {
    if (!editingId) return;
    state.tasks = state.tasks.filter(t => t.id !== editingId);
    saveState();
    closeTaskModal();
    renderTasks();
    renderToday();
  });

  // ---------- settings modal ----------

  $('#settingsBtn').addEventListener('click', () => {
    $('#fMinWeight').value = state.settings.minWeightPct;
    $('#settingsModal').classList.remove('hidden');
  });
  $('#settingsClose').addEventListener('click', () => $('#settingsModal').classList.add('hidden'));

  $('#saveTuningBtn').addEventListener('click', () => {
    const v = Math.min(100, Math.max(1, Number($('#fMinWeight').value) || 15));
    state.settings.minWeightPct = v;
    saveState();
    toast('Saved');
  });

  $('#exportBtn').addEventListener('click', () => {
    const blob = new Blob([JSON.stringify(state, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `task-roulette-backup-${todayStr()}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  });

  $('#importBtn').addEventListener('click', () => {
    const file = $('#importFile').files[0];
    if (!file) { toast('Choose a backup file first'); return; }
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const parsed = JSON.parse(reader.result);
        if (!parsed || !Array.isArray(parsed.tasks)) throw new Error('bad file');
        state = Object.assign(DEFAULT_STATE(), parsed);
        saveState();
        toast('Restored');
        renderToday(); renderTasks(); renderHistory();
      } catch (e) {
        toast('Could not read that file');
      }
    };
    reader.readAsText(file);
  });

  $('#wipeBtn').addEventListener('click', () => {
    if (!confirm('Erase all tasks and history? This cannot be undone.')) return;
    state = DEFAULT_STATE();
    saveState();
    $('#settingsModal').classList.add('hidden');
    renderToday(); renderTasks(); renderHistory();
    toast('All data erased');
  });

  // ---------- toast ----------

  let toastTimer = null;
  function toast(msg) {
    const el = $('#toast');
    el.textContent = msg;
    el.classList.remove('hidden');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.add('hidden'), 2200);
  }

  // ---------- init ----------

  populateDurationSelect($('#fTimeMin'));
  populateDurationSelect($('#fTimeMax'));
  populateDurationSelect($('#fTimeMinOne'));
  populateDurationSelect($('#fTimeMaxOne'));

  ensureTodayBucket();
  showView('today');

  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('sw.js').catch(() => {});
    });
  }
})();
