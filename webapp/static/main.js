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
  setVal('setting.excel_file', j?.setting?.excel_file);
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

get('upload').onclick = async () => {
  const f = get('file').files[0];
  if (!f) return alert('请选择文件');
  const fd = new FormData();
  fd.append('file', f);
  const r = await fetch('/api/upload', { method: 'POST', body: fd });
  const j = await r.json();
  alert(JSON.stringify(j));
  fetchConfig();
};

get('send').onclick = async () => {
  const r = await fetch('/api/send', { method: 'POST' });
  const j = await r.json();
  alert(JSON.stringify(j));
};

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
  alert('已触发后台发送，去重后共 ' + j.recipients + ' 个收件人');
};
