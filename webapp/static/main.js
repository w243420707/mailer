async function fetchConfig() {
  const r = await fetch('/api/config');
  const j = await r.json();
  document.getElementById('config').textContent = JSON.stringify(j, null, 2);
}

document.getElementById('refresh').onclick = fetchConfig;

document.getElementById('upload').onclick = async () => {
  const f = document.getElementById('file').files[0];
  if (!f) return alert('请选择文件');
  const fd = new FormData();
  fd.append('file', f);
  const r = await fetch('/api/upload', { method: 'POST', body: fd });
  const j = await r.json();
  alert(JSON.stringify(j));
  fetchConfig();
};

document.getElementById('send').onclick = async () => {
  const r = await fetch('/api/send', { method: 'POST' });
  const j = await r.json();
  alert(JSON.stringify(j));
};

document.getElementById('last').onclick = async () => {
  const r = await fetch('/api/last_result');
  if (!r.ok) return alert('暂无结果');
  const j = await r.json();
  document.getElementById('result').textContent = JSON.stringify(j, null, 2);
};

fetchConfig();
