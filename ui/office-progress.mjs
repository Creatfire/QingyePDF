// Progress cards for Office files opened as PDF (0.19): one card per conversion with the current
// stage, elapsed time, an indeterminate bar and a cancel button; a batch shows its whole queue. The
// same corner also offers "convert again" when the original Word / Excel / PowerPoint file changes.
const STAGE_LABEL = { waiting: '等待中', reading: '读取文件', queued: '排队中', starting: '启动转换引擎', converting: '转换为 PDF', cached: '使用缓存', loading: '载入 PDF', done: '完成', error: '失败', canceled: '已取消' };
const FINISHED = new Set(['done', 'error', 'canceled']);

export function createOfficeProgress({ api, guard, status }) {
  const box = document.createElement('div');
  box.className = 'officeJobs'; box.setAttribute('role', 'status'); box.setAttribute('aria-live', 'polite');
  document.body.append(box);
  const cards = new Map();
  let ticker = null;

  const seconds = card => Math.max(0, Math.floor((Date.now() - card.started) / 1000));
  function tick() {
    for (const card of cards.values()) if (!FINISHED.has(card.stage)) {
      const s = seconds(card);
      card.el.querySelector('.officeJobTime').textContent = s + ' 秒';
      // A long conversion is still working: say so instead of looking frozen.
      if (s >= 30 && !card.slowShown) { card.slowShown = true; card.el.querySelector('.officeJobHint').textContent = '文件较大或较复杂，仍在转换，请稍候；也可以取消。'; }
    }
    if (![...cards.values()].some(c => !FINISHED.has(c.stage))) { clearInterval(ticker); ticker = null; }
  }
  function card(id, name) {
    let c = cards.get(id);
    if (c) return c;
    const el = document.createElement('div'); el.className = 'officeJob';
    el.innerHTML = '<div class="officeJobHead"><span class="officeJobIcon" aria-hidden="true">W</span><b class="officeJobName"></b><span class="officeJobTime">0 秒</span><button type="button" class="officeJobCancel" data-icon="x" title="取消" aria-label="取消打开"></button></div>'
      + '<div class="officeJobStage"></div><div class="officeJobBar"><i></i></div><div class="officeJobHint"></div>';
    el.querySelector('.officeJobName').textContent = name || '';
    el.querySelector('.officeJobCancel').onclick = () => guard(async () => { el.querySelector('.officeJobCancel').disabled = true; await api.officeCancel(id); });
    box.append(el);
    c = { id, el, started: Date.now(), stage: 'waiting' }; cards.set(id, c);
    ticker ??= setInterval(tick, 1000);
    return c;
  }
  const iconFor = name => { const ext = (/\.([^.]+)$/.exec(name || '') || [])[1]?.toLowerCase() || ''; return /^(xls|xlsx|xlsm|xlsb|ods|csv|et)$/.test(ext) ? ['X', 'excel'] : /^(ppt|pptx|pptm|pps|ppsx|odp|dps)$/.test(ext) ? ['P', 'powerpoint'] : ['W', 'word']; };

  function update(data = {}) {
    if (!data.id) return;
    const c = card(data.id, data.name);
    if (data.name) { c.el.querySelector('.officeJobName').textContent = data.name; const [letter, kind] = iconFor(data.name); const icon = c.el.querySelector('.officeJobIcon'); icon.textContent = letter; icon.dataset.kind = kind; }
    c.stage = data.stage || c.stage;
    c.el.dataset.stage = c.stage;
    c.el.querySelector('.officeJobStage').textContent = c.stage === 'error' ? '无法打开：' + (data.text || '') : (data.text || STAGE_LABEL[c.stage] || c.stage);
    c.el.querySelector('.officeJobCancel').hidden = FINISHED.has(c.stage) || c.stage === 'loading';
    if (FINISHED.has(c.stage)) {
      tick();
      if (c.stage === 'error') status('无法打开 ' + (data.name || c.el.querySelector('.officeJobName').textContent) + '：' + (data.text || ''));
      setTimeout(() => remove(data.id), c.stage === 'error' ? 8000 : c.stage === 'done' ? 1200 : 2500);
    }
  }
  function remove(id) { const c = cards.get(id); if (!c) return; c.el.classList.add('isLeaving'); setTimeout(() => c.el.remove(), 200); cards.delete(id); }
  // Called once the converted PDF is showing in its tab.
  function opened(id) { if (id && cards.has(id)) update({ id, stage: 'done', text: '已打开' }); }

  // "The original changed" notice with convert-again / ignore.
  function sourceChanged({ name, deleted }, reconvert) {
    const el = document.createElement('div'); el.className = 'officeJob officeNotice';
    el.innerHTML = '<div class="officeJobHead"><span class="officeJobIcon" aria-hidden="true">!</span><b class="officeJobName"></b></div><div class="officeJobStage"></div><div class="officeNoticeActions"></div>';
    el.querySelector('.officeJobName').textContent = name;
    el.querySelector('.officeJobStage').textContent = deleted ? '原文件已被删除或移动；这个 PDF 标签仍可使用。' : '原文件已更新。重新转换会替换当前标签里的 PDF（未保存的批注会丢失，可撤销）。';
    const actions = el.querySelector('.officeNoticeActions'), close = () => el.remove();
    if (!deleted) { const again = document.createElement('button'); again.type = 'button'; again.className = 'primary'; again.textContent = '重新转换'; again.onclick = () => { close(); guard(reconvert); }; actions.append(again); }
    const ignore = document.createElement('button'); ignore.type = 'button'; ignore.textContent = deleted ? '知道了' : '暂不'; ignore.onclick = close; actions.append(ignore);
    box.append(el);
  }
  return { update, opened, sourceChanged, active: () => [...cards.values()].filter(c => !FINISHED.has(c.stage)).length };
}
