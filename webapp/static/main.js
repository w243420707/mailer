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
  setVal('postal.from_email', j?.postal?.from_email);
  const subs = (j?.setting?.subjects || []).filter(x => (x ?? '').toString().trim() !== '');
  setVal('setting.subject1', subs[0] || (j?.setting?.subject || ''));
  setVal('setting.subject2', subs[1] || '');
  setVal('setting.subject3', subs[2] || '');
  setVal('setting.subject4', subs[3] || '');
  setVal('setting.subject5', subs[4] || '');
  // 兼容旧字段 limit：优先 per_hour_limit
  setVal('setting.per_hour_limit', j?.setting?.per_hour_limit ?? j?.setting?.limit);
  setVal('setting.proxy', j?.setting?.proxy);
  // 原始 JSON 视图
  const pre = get('config');
  if (pre) pre.textContent = JSON.stringify(j, null, 2);
}

get('refresh').onclick = fetchConfig;

get('save').onclick = async () => {
  // 简单校验
  const server = getVal('postal.server').trim();
  const key = getVal('postal.key').trim();
  const from_email = getVal('postal.from_email').trim();
  if (!server || !key || !from_email) {
    alert('server / key / from_email 不能为空');
    return;
  }

  // 组装完整配置对象，避免丢字段
  const subjects = [
    getVal('setting.subject1').trim(),
    getVal('setting.subject2').trim(),
    getVal('setting.subject3').trim(),
    getVal('setting.subject4').trim(),
    getVal('setting.subject5').trim(),
  ].filter(x => !!x);
  const perHour = Number(getVal('setting.per_hour_limit') || 0);
  const payload = {
    postal: {
      server,
      key,
      from_name: getVal('postal.from_name'),
      from_email
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

get('last').onclick = async () => {
  const r = await fetch('/api/last_result');
  if (!r.ok) return alert('暂无结果');
  const j = await r.json();
  document.getElementById('result').textContent = JSON.stringify(j, null, 2);
};

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
