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
  setVal('setting.subject', j?.setting?.subject);
  setVal('setting.limit', j?.setting?.limit);
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
  const payload = {
    postal: {
      server,
      key,
      from_name: getVal('postal.from_name'),
      from_email
    },
    setting: {
      excel_file: getVal('setting.excel_file'),
      subject: getVal('setting.subject'),
      limit: Number(getVal('setting.limit') || 0),
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
