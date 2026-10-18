// Unified task center (0.20): OCR, conversion, compression, batch exports and other long jobs in
// one place. A pill in the status bar shows how many are running; clicking it lists running and
// recent tasks with progress, results (processed / skipped / failed), the output location, cancel
// and retry. Jobs started from the toolbox can be queued while another one runs, and the list stays
// available after the toolbox closes. Finished tasks are remembered in this window (localStorage).

const STORE = 'qingye.recentTasks', KEEP = 30;
const load = () => { try { return JSON.parse(localStorage.getItem(STORE) || '[]').filter(t => t && t.id && t.label); } catch { return []; } };
const persist = list => { try { localStorage.setItem(STORE, JSON.stringify(list.slice(0, KEEP))); } catch { /* storage unavailable: keep in memory */ } };
const STATUS = { queued: '排队中', running: '进行中', done: '已完成', partial: '部分失败', failed: '失败', canceled: '已取消' };

/** Result line from counts: "已处理 28 页 · 跳过 2 页 · 失败 1 项". Only counts that exist are shown. */
export function resultSummary({ processed, skipped, failed, unit = '项', extra } = {}) {
  const parts = [];
  if (processed != null) parts.push(`已处理 ${processed} ${unit}`);
  if (skipped) parts.push(`跳过 ${skipped} ${unit}`);
  if (failed) parts.push(`失败 ${failed} ${unit}`);
  if (extra) parts.push(extra);
  return parts.join(' · ');
}

export function createTaskCenter({ api, guard, status, activate }) {
  const pill = document.createElement('button');
  pill.id = 'taskPill'; pill.type = 'button'; pill.hidden = true; pill.dataset.icon = 'history';
  pill.setAttribute('aria-haspopup', 'dialog'); pill.title = '任务中心';
  const panel = document.createElement('div');
  panel.id = 'taskPanel'; panel.popover = 'auto'; panel.setAttribute('role', 'dialog'); panel.setAttribute('aria-label', '任务中心');
  panel.innerHTML = '<header><strong>任务中心</strong><button type="button" id="taskClear">清除已完成</button></header><ol id="taskList"></ol><p id="taskEmpty">还没有任务。OCR、转换、压缩、批量导出等较长的处理会显示在这里。</p>';
  document.querySelector('footer.status')?.append(pill);
  document.body.append(panel);
  const list = panel.querySelector('#taskList');
  let tasks = load().map(t => ({ ...t, restored: true })), queue = [], runningQueued = false, tick = 0, adopting = null;
  pill.onclick = () => { panel.togglePopover(); placePanel(); draw(); };
  panel.querySelector('#taskClear').onclick = () => { tasks = tasks.filter(t => t.status === 'running' || t.status === 'queued'); save(); draw(); };
  const save = () => persist(tasks.filter(t => !['running', 'queued'].includes(t.status)).map(({ id, label, doc, status: st, note, summary, path, started, finished, items }) => ({ id, label, doc, status: st, note, summary, path, started, finished, items: (items || []).slice(0, 20) })));
  function placePanel() { const r = pill.getBoundingClientRect(); panel.style.right = Math.max(8, innerWidth - r.right) + 'px'; panel.style.bottom = Math.max(8, innerHeight - r.top + 6) + 'px'; }
  const elapsed = t => { const s = Math.round(((t.finished || Date.now()) - t.started) / 1000); return s < 60 ? `${s} 秒` : `${Math.floor(s / 60)} 分 ${s % 60} 秒`; };

  function draw() {
    const active = tasks.filter(t => t.status === 'running' || t.status === 'queued').length;
    pill.hidden = !tasks.length;
    pill.textContent = active ? `任务 · ${active} 个进行中` : `任务 · ${tasks.length}`;
    pill.classList.toggle('isBusy', !!active);
    panel.querySelector('#taskEmpty').hidden = !!tasks.length;
    if (!panel.matches(':popover-open')) return;
    list.replaceChildren(...tasks.map(t => {
      const li = document.createElement('li'); li.className = 'taskRow is-' + t.status; li.dataset.task = t.id;
      const head = document.createElement('div'); head.className = 'taskHead';
      const name = document.createElement('strong'); name.textContent = t.label;
      const chip = document.createElement('span'); chip.className = 'taskStatus'; chip.textContent = STATUS[t.status] || t.status;
      head.append(name, chip); li.append(head);
      const meta = document.createElement('small'); meta.textContent = [t.doc, elapsed(t), t.restored ? '上次记录' : ''].filter(Boolean).join(' · '); li.append(meta);
      if (t.status === 'running' && t.total) { const bar = document.createElement('progress'); bar.max = Math.max(1, t.total); bar.value = t.done || 0; li.append(bar); }
      const text = t.status === 'running' ? (t.stage || '处理中…') : (t.summary || t.note || '');
      if (text) { const p = document.createElement('p'); p.className = 'taskNote'; p.textContent = text; li.append(p); }
      if (t.items?.length && t.status !== 'running') { const d = document.createElement('details'); const s = document.createElement('summary'); s.textContent = `查看详情（${t.items.length}）`; d.append(s); for (const item of t.items) { const p = document.createElement('p'); p.className = item.ok === false ? 'taskItem isFailed' : 'taskItem'; p.textContent = item.text; d.append(p); } li.append(d); }
      const actions = document.createElement('div'); actions.className = 'taskActions';
      const act = (label, fn) => { const b = document.createElement('button'); b.type = 'button'; b.textContent = label; b.onclick = () => guard(fn); actions.append(b); };
      if ((t.status === 'running' || t.status === 'queued') && t.cancel) act('取消', async () => { await t.cancel(); });
      if (t.opened?.length) act('打开结果', () => activate(t.opened[0].id));
      if (t.path && api.revealOutput) act('在文件夹中显示', () => api.revealOutput(t.path));
      if ((t.status === 'partial' || t.status === 'failed') && t.retry) act(t.status === 'partial' ? '重试失败项' : '重试', async () => { await t.retry(); });
      if (actions.children.length) li.append(actions);
      return li;
    }));
  }
  setInterval(() => { if (tasks.some(t => t.status === 'running') && panel.matches(':popover-open') && ++tick % 2 === 0) draw(); }, 500);

  /** Starts tracking a task. Returns a handle the job updates. */
  function begin({ label, doc = '', cancel, retry, jobId } = {}) {
    // A queued job that starts takes over its own row instead of adding a second one.
    const queued = adopting && adopting.status === 'queued' ? adopting : null; adopting = null;
    const t = queued ? Object.assign(queued, { label, doc, status: 'running', started: Date.now(), cancel, retry, jobId }) : { id: crypto.randomUUID(), label, doc, status: 'running', started: Date.now(), cancel, retry, jobId, items: [] };
    if (!queued) { tasks.unshift(t); if (tasks.length > KEEP + 10) tasks.length = KEEP + 10; }
    draw();
    const handle = {
      id: t.id,
      set jobId(value) { t.jobId = value; },
      progress(done, total, stage) { t.done = done; t.total = total; if (stage) t.stage = stage; draw(); },
      stage(text) { t.stage = text; draw(); },
      item(text, ok = true) { t.items.push({ text, ok }); },
      finish({ note = '', summary = '', path = '', opened = [], failed = 0, canceled = false, retry } = {}) {
        if (retry !== undefined) t.retry = retry;
        Object.assign(t, { note, summary, path, opened, finished: Date.now(), status: canceled ? 'canceled' : failed ? (t.items.some(i => i.ok) ? 'partial' : 'failed') : 'done' });
        if (t.status !== 'partial' && t.status !== 'failed') t.retry = null;
        save(); draw();
      },
      fail(error) { Object.assign(t, { note: String(error?.message || error || '失败').replace(/^Error invoking remote method '[^']+': (?:Error: )?/, ''), finished: Date.now(), status: 'failed' }); save(); draw(); },
      cancelled() { Object.assign(t, { finished: Date.now(), status: 'canceled' }); save(); draw(); },
    };
    return handle;
  }
  // Job progress events from the backend (tool jobs carry their jobId).
  api.onJobProgress?.((id, data) => { const t = tasks.find(x => x.jobId === id && x.status === 'running'); if (t) { t.done = data.done; t.total = data.total; t.stage = `${data.label || '处理中'} ${data.done}/${data.total}`; draw(); } });

  /** Runs `run` now, or after the tasks already queued here; the task shows as queued meanwhile. */
  function enqueue({ label, doc, run }) {
    const t = { id: crypto.randomUUID(), label, doc, status: 'queued', started: Date.now(), items: [] };
    t.cancel = () => { queue = queue.filter(q => q.t !== t); Object.assign(t, { status: 'canceled', finished: Date.now() }); save(); draw(); };
    tasks.unshift(t); queue.push({ t, run }); draw(); status(`已加入任务队列：${label}`); pump();
    return t.id;
  }
  async function pump() {
    if (runningQueued) return; runningQueued = true;
    try { while (queue.length) { const { t, run } = queue.shift(); adopting = t; await guard(run); if (t.status === 'queued') { tasks = tasks.filter(x => x !== t); draw(); } adopting = null; } }
    finally { runningQueued = false; }
  }
  return { begin, enqueue, draw, tasks: () => tasks.map(({ cancel: _c, retry: _r, ...t }) => t), open: () => { panel.showPopover(); placePanel(); draw(); } };
}
