function get(id){ return document.getElementById(id); }

function setVal(id, v){ const el=get(id); if (el) el.value = (v ?? ''); }
function getVal(id){ const el=get(id); return el ? el.value : ''; }

let CURRENT_CONFIG = {};

async function fetchConfig() {
  const r = await fetch('/api/config');
  const j = await r.json();
  CURRENT_CONFIG = j || {};
  // 填充表单
  setVal('postal.server', j?.postal?.server);
  setVal('postal.key', j?.postal?.key);
  setVal('postal.from_name', j?.postal?.from_name);
  // 发件邮箱：支持数组或单值
  const froms = Array.isArray(j?.postal?.from_emails)
    ? j.postal.from_emails
    : (j?.postal?.from_email ? [j.postal.from_email] : []);
  setVal('postal.from_emails', (froms || []).filter(Boolean).join('\n'));
  // 主题：支持数组或单值
  const subs = (j?.setting?.subjects || [])
    .filter(x => (x ?? '').toString().trim() !== '');
  const subLines = subs.length ? subs : ((j?.setting?.subject ? [j.setting.subject] : []));
  setVal('setting.subjects_multiline', (subLines || []).join('\n'));
  // 兼容旧字段 limit：优先 per_hour_limit
  setVal('setting.per_hour_limit', j?.setting?.per_hour_limit ?? j?.setting?.limit);
  setVal('setting.proxy', j?.setting?.proxy);
  // 原始 JSON 视图
  const pre = get('config');
  if (pre) pre.textContent = JSON.stringify(j, null, 2);
  // 更新一次预估
  try { calcEstimate(); } catch(e) {}
}

get('refresh').onclick = fetchConfig;

get('save').onclick = async () => {
  // 简单校验
  const server = getVal('postal.server').trim();
  const key = getVal('postal.key').trim();
  const from_emails_lines = (getVal('postal.from_emails') || '').split(/\r?\n/).map(s=>s.trim()).filter(Boolean);
  if (!server || !key || from_emails_lines.length === 0) {
    alert('server / key / from_emails 至少需要一个');
    return;
  }

  // 组装完整配置对象，避免丢字段
  const subjects = (getVal('setting.subjects_multiline') || '')
    .split(/\r?\n/)
    .map(s => s.trim())
    .filter(Boolean);
  const perHour = Number(getVal('setting.per_hour_limit') || 0);
  const payload = {
    postal: {
      server,
      key,
      from_name: getVal('postal.from_name'),
      // 新：发件邮箱列表，同时兼容旧字段 from_email
      from_emails: from_emails_lines,
      from_email: from_emails_lines[0] || ''
    },
    setting: {
      subjects,
      subject: subjects[0] || '',
      // 新字段：每小时限制
      per_hour_limit: perHour,
      // 为兼容旧版本，冗余写回旧字段 limit（值相同）
      limit: perHour,
      proxy: getVal('setting.proxy')
    }
  };

  const r = await fetch('/api/config', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
  const j = await r.json();
  if (!j.ok) {
    alert('保存失败: ' + (j.error || '未知错误'));
  } else {
    const msg = get('saveMsg');
    if (msg) {
      msg.textContent = '已保存';
      setTimeout(() => msg.textContent = '', 1500);
    }
    fetchConfig();
  }
};

// 已移除上传/Excel发送相关功能

// 已移除右侧“发送结果”卡片与按钮

fetchConfig();

// 发送粘贴列表
get('sendList').onclick = async () => {
  const recipients = get('recipients_text').value || '';
  const dedupe = get('dedupe').checked;
  const subject = get('subject_override').value || '';
  const html_body = get('body_html').value || '';
  try { localStorage.setItem('mailer.body_html', html_body); } catch(e) {}
  if (!recipients.trim()) return alert('请粘贴至少一个邮箱');
  if (!html_body.trim()) return alert('请填写邮件内容');
  const r = await fetch('/api/send_list', {
    method: 'POST',
    headers: {'Content-Type': 'application/json'},
    body: JSON.stringify({ recipients, dedupe, subject, html_body })
  });
  const j = await r.json();
  if (!j.ok) return alert('发送失败: ' + (j.error || '未知错误'));
  alert('已触发后台发送，去重后 ' + j.recipients + ' 个；累计保存共 ' + j.saved_total + ' 个(本次新增 ' + j.saved_appended + ')');
  refreshRecipientsInfo();
  startPollProgress();
};

// 仅保存不发送
get('saveOnly').onclick = async () => {
  const recipients = get('recipients_text').value || '';
  const html_body = get('body_html').value || '';
  try { localStorage.setItem('mailer.body_html', html_body); } catch(e) {}
  if (!recipients.trim()) return alert('请粘贴至少一个邮箱');
  const r = await fetch('/api/save_list', {
    method: 'POST',
    headers: {'Content-Type': 'application/json'},
    body: JSON.stringify({ recipients, html_body })
  });
  const j = await r.json();
  if (!j.ok) return alert('保存失败: ' + (j.error || '未知错误'));
  alert('已保存，累计 ' + j.total + ' 个（本次新增 ' + j.appended + '）');
  refreshRecipientsInfo();
};

// 发送已累积收件人
get('sendAll').onclick = async () => {
  const subject = get('subject_override').value || '';
  const html_body = get('body_html').value || '';
  try { localStorage.setItem('mailer.body_html', html_body); } catch(e) {}
  const r = await fetch('/api/send_all', {
    method: 'POST',
    headers: {'Content-Type': 'application/json'},
    body: JSON.stringify({ subject, html_body })
  });
  const j = await r.json();
  if (!j.ok) return alert('触发失败: ' + (j.error || '未知错误'));
  alert('已触发后台发送，目标 ' + j.recipients + ' 个');
  startPollProgress();
};

// 收件人信息展示
async function refreshRecipientsInfo(){
  const r = await fetch('/api/recipients_info');
  const j = await r.json();
  get('recTotal').textContent = j.total || 0;
  get('recPreview').textContent = (j.preview || []).join('\n');
  try { calcEstimate(); } catch(e) {}
}

get('expRec').onclick = () => {
  window.location.href = '/api/recipients_export';
};

get('clearRec').onclick = async () => {
  if (!confirm('确定清空 recipients.txt 吗？此操作不可恢复')) return;
  const r = await fetch('/api/recipients_clear', { method: 'POST' });
  const j = await r.json();
  if (!j.ok) return alert('清空失败');
  refreshRecipientsInfo();
};

// 进度条轮询
let progressTimer = null;
function startPollProgress(){
  if (progressTimer) clearInterval(progressTimer);
  progressTimer = setInterval(updateProgress, 1000);
  updateProgress();
}

async function updateProgress(){
  const r = await fetch('/api/progress');
  const j = await r.json();
  const total = j.total || 0;
  const sent = j.sent || 0;
  const status = j.status || 'idle';
  const success = j.success || 0;
  const pct = total > 0 ? Math.round((sent/total)*100) : 0;
  get('progBar').style.width = pct + '%';
  get('progText').textContent = `状态：${status}，进度：${sent}/${total}（成功 ${success}）` + (j.current_email? `，当前：${j.current_email}` : '');
  if (status === 'completed' || status === 'idle'){
    if (progressTimer) clearInterval(progressTimer);
  }
}

refreshRecipientsInfo();

// 页面加载后自动检测进度，若仍在运行则继续轮询
autoInitProgress();

async function autoInitProgress(){
  try {
    const r = await fetch('/api/progress');
    if (!r.ok) return;
    const j = await r.json();
    // 立即渲染一次
    const total = j.total || 0;
    const sent = j.sent || 0;
    const status = j.status || 'idle';
    const success = j.success || 0;
    const pct = total > 0 ? Math.round((sent/total)*100) : 0;
    get('progBar').style.width = pct + '%';
    get('progText').textContent = `状态：${status}，进度：${sent}/${total}（成功 ${success}）` + (j.current_email? `，当前：${j.current_email}` : '');
    if (status === 'running') {
      startPollProgress();
    }
  } catch(e){ /* 忽略 */ }
}

// 强制停止
const stopBtn = get('forceStop');
if (stopBtn) {
  stopBtn.onclick = async () => {
    if (!confirm('确定要强制停止当前发送吗？')) return;
    try {
      const r = await fetch('/api/stop', { method: 'POST' });
      const j = await r.json();
      if (!j.ok) return alert('停止失败');
      // 立即刷新进度，并保持轮询直到状态变为 stopped
      startPollProgress();
    } catch(e) { alert('停止请求异常'); }
  };
}

// ——— 邮件内容(HTML) 自动缓存与恢复 ———
initBodyAutosave();
restoreBodyTemplate();

function initBodyAutosave(){
  const el = get('body_html');
  if (!el) return;
  el.addEventListener('input', () => {
    try { localStorage.setItem('mailer.body_html', el.value || ''); } catch(e) {}
  });
}

async function restoreBodyTemplate(){
  const el = get('body_html');
  if (!el) return;
  // 1) 本地缓存优先
  try {
    const cached = localStorage.getItem('mailer.body_html');
    if (cached && cached.trim()) { el.value = cached; return; }
  } catch(e) {}
  // 2) 后端最近保存的模板
  try {
    const r = await fetch('/api/body_template');
    if (r.ok){
      const j = await r.json();
      if (j && typeof j.html === 'string' && j.html.trim()) {
        el.value = j.html;
      }
    }
  } catch(e) {}
}

// ——— 发送时间预估 ———
function format2(n){ return n < 10 ? '0' + n : '' + n; }
function formatDateTime(d){
  if (!(d instanceof Date)) return '—';
  const y = d.getFullYear();
  const m = format2(d.getMonth()+1);
  const dd = format2(d.getDate());
  const hh = format2(d.getHours());
  const mm = format2(d.getMinutes());
  const ss = format2(d.getSeconds());
  return `${y}-${m}-${dd} ${hh}:${mm}:${ss}`;
}

function formatDuration(ms){
  if (!isFinite(ms) || ms <= 0) return '0 分钟';
  const totalMin = Math.ceil(ms / 60000);
  const days = Math.floor(totalMin / (60*24));
  const hours = Math.floor((totalMin % (60*24)) / 60);
  const mins = totalMin % 60;
  const parts = [];
  if (days) parts.push(days + ' 天');
  if (hours) parts.push(hours + ' 小时');
  if (mins || parts.length === 0) parts.push(mins + ' 分钟');
  return parts.join(' ');
}

function getAutoRecipientsCount(){
  const manualEl = get('manual_recipient_count');
  let manual = 0;
  if (manualEl) manual = Number(manualEl.value || 0);
  if (manual > 0) return Math.floor(manual);

  const ta = get('recipients_text');
  const dedupe = !!(get('dedupe') && get('dedupe').checked);
  if (ta && (ta.value || '').trim()){
    const lines = (ta.value || '')
      .split(/\r?\n/)
      .map(s => s.trim())
      .filter(s => s.length > 0);
    if (dedupe){
      const set = new Set(lines.map(s => s.toLowerCase()));
      return set.size;
    }
    return lines.length;
  }
  // fallback 用右侧累计数
  const recTotalEl = get('recTotal');
  if (recTotalEl) {
    const n = parseInt(recTotalEl.textContent || '0', 10);
    if (isFinite(n) && n > 0) return n;
  }
  return 0;
}

function calcEstimate(){
  const panel = get('estimate_panel');
  if (!panel) return; // 页面不存在则忽略

  const rateEl = get('setting.per_hour_limit');
  const rate = Number((rateEl && rateEl.value) ? rateEl.value : 0);
  const cnt = getAutoRecipientsCount();

  const now = new Date();
  const estNow = get('estNow');
  const estDuration = get('estDuration');
  const estEnd = get('estEnd');
  const estRate = get('estRate');
  const estCount = get('estCount');

  if (estNow) estNow.textContent = formatDateTime(now);
  if (estRate) estRate.textContent = rate > 0 ? String(rate) : '不限/未设';
  if (estCount) estCount.textContent = String(cnt);

  if (!(rate > 0)){
    if (estDuration) estDuration.textContent = '无法计算（每小时条数未设置或为 0=不限）';
    if (estEnd) estEnd.textContent = '—';
    return;
  }
  if (!(cnt > 0)){
    if (estDuration) estDuration.textContent = '—';
    if (estEnd) estEnd.textContent = '—';
    return;
  }

  const hours = cnt / rate; // 以小时为单位
  const ms = Math.ceil(hours * 3600 * 1000);
  const end = new Date(now.getTime() + ms);
  if (estDuration) estDuration.textContent = formatDuration(ms);
  if (estEnd) estEnd.textContent = formatDateTime(end);
}

// 事件绑定以便实时更新
const rateInput = get('setting.per_hour_limit');
if (rateInput) rateInput.addEventListener('input', () => { try { calcEstimate(); } catch(e) {} });
const recTa = get('recipients_text');
if (recTa) recTa.addEventListener('input', () => { try { calcEstimate(); } catch(e) {} });
const dedupeCb = get('dedupe');
if (dedupeCb) dedupeCb.addEventListener('change', () => { try { calcEstimate(); } catch(e) {} });
const manualCnt = get('manual_recipient_count');
if (manualCnt) manualCnt.addEventListener('input', () => { try { calcEstimate(); } catch(e) {} });

// 首次渲染
try { calcEstimate(); } catch(e) {}
