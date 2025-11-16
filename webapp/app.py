import os
import threading
import base64
import random
import time
from functools import wraps
from flask import Flask, jsonify, request, render_template, send_from_directory, Response
import toml

PROJECT_ROOT = os.path.dirname(os.path.dirname(__file__))
CONFIG_PATH = os.path.join(PROJECT_ROOT, "config.toml")
RECIP_PATH = os.path.join(PROJECT_ROOT, "recipients.txt")
BODY_PATH = os.path.join(PROJECT_ROOT, "body_template.html")
PROGRESS_PATH = os.path.join(PROJECT_ROOT, "send_progress.json")

app = Flask(__name__, static_folder="static", template_folder="templates")

AUTH_USER = os.getenv("MAILER_AUTH_USER", "admin").strip()
AUTH_PASS = os.getenv("MAILER_AUTH_PASS", "admin").strip()


def check_auth(auth_header: str) -> bool:
    try:
        if not auth_header or not auth_header.lower().startswith("basic "):
            return False
        b64 = auth_header.split(" ", 1)[1]
        raw = base64.b64decode(b64).decode("utf-8", errors="ignore")
        user, pwd = raw.split(":", 1)
        return user == AUTH_USER and pwd == AUTH_PASS
    except Exception:
        return False


@app.before_request
def require_basic_auth():
    # 若未配置用户名或密码，则不启用认证
    if not AUTH_USER or not AUTH_PASS:
        return None
    auth = request.headers.get("Authorization")
    if not check_auth(auth):
        return Response(
            status=401,
            headers={"WWW-Authenticate": 'Basic realm="Mailer"'},
        )


def load_config():
    if not os.path.exists(CONFIG_PATH):
        return {}
    return toml.load(CONFIG_PATH)


def save_config(cfg):
    with open(CONFIG_PATH, "w", encoding="utf-8") as f:
        toml.dump(cfg, f)


@app.route("/")
def index():
    return render_template("index.html")


@app.route("/api/config", methods=["GET"])
def api_get_config():
    cfg = load_config()
    return jsonify(cfg)


@app.route("/api/config", methods=["POST"])
def api_post_config():
    data = request.get_json()
    if not isinstance(data, dict):
        return jsonify({"ok": False, "error": "Invalid payload"}), 400
    save_config(data)
    return jsonify({"ok": True})


@app.route("/api/upload", methods=["POST"])
def api_upload():
    # 已移除：不再支持上传 Excel
    return jsonify({"ok": False, "error": "Excel 上传功能已禁用"}), 410


@app.route("/api/send", methods=["POST"])
def api_send():
    # 在后台线程中执行发送，立即返回任务 id (简化为固定 id)
    from send_email_postal_excel import send_from_config

    def worker():
        # send_from_config 会返回结果字典
        res = send_from_config(CONFIG_PATH, confirm=False)
        if isinstance(res, dict):
            res["mode"] = "excel"
        # 将结果写入文件供前端查询（简单实现）
        with open(os.path.join(PROJECT_ROOT, "last_send_result.json"), "w", encoding="utf-8") as f:
            import json
            json.dump(res, f, ensure_ascii=False)

    t = threading.Thread(target=worker, daemon=True)
    t.start()
    return jsonify({"ok": True, "task": "send_task"})


@app.route("/api/last_result", methods=["GET"])
def api_last_result():
    path = os.path.join(PROJECT_ROOT, "last_send_result.json")
    if not os.path.exists(path):
        return jsonify({"ok": False, "error": "no result"}), 404
    import json
    with open(path, "r", encoding="utf-8") as f:
        data = json.load(f)
    return jsonify(data)


def _load_core_settings():
    cfg = load_config()
    postal = cfg.get("postal", {})
    setting = cfg.get("setting", {})
    return {
        "server": postal.get("server", ""),
        "key": postal.get("key", ""),
        "from_name": postal.get("from_name", ""),
        "from_email": postal.get("from_email", ""),
        "subject": setting.get("subject", ""),
        "limit": setting.get("limit", 0),
        "proxy": setting.get("proxy", ""),
    }


def _normalize_email_list(raw: str):
    import re
    if not raw:
        return []
    # 支持换行/逗号/分号分隔
    parts = re.split(r"[\s,;]+", raw.strip())
    # 过滤空串
    parts = [p.strip() for p in parts if p and "@" in p]
    return parts


def _read_recipients_file():
    # 返回 (列表顺序, 小写去重字典)
    existing = []
    if os.path.exists(RECIP_PATH):
        with open(RECIP_PATH, "r", encoding="utf-8") as f:
            for line in f:
                e = line.strip()
                if e and "@" in e:
                    existing.append(e)
    seen = {}
    ordered = []
    for e in existing:
        k = e.strip().lower()
        if k not in seen:
            seen[k] = e
            ordered.append(e)
    return ordered, seen


def _merge_and_save_recipients(new_emails):
    ordered, seen = _read_recipients_file()
    appended = 0
    for e in new_emails:
        k = e.strip().lower()
        if k not in seen:
            seen[k] = e
            ordered.append(e)
            appended += 1
    # 去重完成后打乱顺序
    random.shuffle(ordered)
    with open(RECIP_PATH, "w", encoding="utf-8") as f:
        for e in ordered:
            f.write(e + "\n")
    return {"total": len(ordered), "appended": appended}


def _load_all_recipients():
    ordered, _ = _read_recipients_file()
    return ordered


def _save_body_template(html_body: str):
    if not html_body:
        return
    with open(BODY_PATH, "w", encoding="utf-8") as f:
        f.write(html_body)


def _update_progress(data: dict):
    try:
        data = dict(data)
        data["updated_at"] = int(time.time())
        with open(PROGRESS_PATH, "w", encoding="utf-8") as f:
            import json
            json.dump(data, f, ensure_ascii=False)
    except Exception:
        pass


def _render_body(template_html: str, email: str, index: int):
    # 简单占位符替换：{{email}}、{{index}}、{{domain}}
    if not template_html:
        return ""
    try:
        domain = email.split("@", 1)[1] if "@" in email else ""
    except Exception:
        domain = ""
    out = (
        template_html
        .replace("{{email}}", email)
        .replace("{{index}}", str(index))
        .replace("{{domain}}", domain)
    )
    return out


@app.route("/api/send_list", methods=["POST"])
def api_send_list():
    from send_email_postal_excel import init_session, send_mail
    payload = request.get_json(silent=True) or {}
    recipients_text = payload.get("recipients", "")
    dedupe = bool(payload.get("dedupe", True))
    subject_override = (payload.get("subject") or "").strip()
    html_body = (payload.get("html_body") or "").strip()

    if not recipients_text:
        return jsonify({"ok": False, "error": "收件人列表不能为空"}), 400
    if not html_body:
        return jsonify({"ok": False, "error": "邮件内容(html_body)不能为空"}), 400

    emails = _normalize_email_list(recipients_text)
    if not emails:
        return jsonify({"ok": False, "error": "未解析到有效邮箱"}), 400

    # 去重（保序）
    if dedupe:
        seen = set()
        uniq = []
        for e in emails:
            k = e.strip().lower()
            if k not in seen:
                seen.add(k)
                uniq.append(e)
        emails = uniq

    # 合并并保存到 recipients.txt（累积且去重）
    merge_info = _merge_and_save_recipients(emails)

    core = _load_core_settings()
    subject = subject_override or core.get("subject") or ""
    if not subject:
        return jsonify({"ok": False, "error": "主题(subject)不能为空（配置或参数中提供）"}), 400

    delay = 0
    try:
        limit = int(core.get("limit") or 0)
        delay = (60 / limit) if limit > 0 else 0
    except Exception:
        delay = 0

    # 保存邮件内容模板
    _save_body_template(html_body)

    def worker_list(to_list):
        session = init_session(core.get("proxy") or "")
        success = 0
        total = len(to_list)
        _update_progress({"mode": "list", "status": "running", "sent": 0, "success": 0, "total": total})
        for i, addr in enumerate(to_list, start=1):
            rendered = _render_body(html_body, addr, i)
            ok = send_mail(
                session,
                core.get("server"),
                core.get("key"),
                core.get("from_name"),
                core.get("from_email"),
                addr,
                subject,
                rendered,
            )
            if ok:
                success += 1
            _update_progress({"mode": "list", "status": "running", "sent": i, "success": success, "total": total, "current_email": addr})
            if delay > 0 and i < total:
                time.sleep(delay)
        result = {"ok": True, "mode": "list", "success": success, "total": total}
        with open(os.path.join(PROJECT_ROOT, "last_send_result.json"), "w", encoding="utf-8") as f:
            import json
            json.dump(result, f, ensure_ascii=False)
        _update_progress({"mode": "list", "status": "completed", "sent": total, "success": success, "total": total})

    t = threading.Thread(target=worker_list, args=(emails,), daemon=True)
    t.start()
    return jsonify({
        "ok": True,
        "task": "send_list",
        "recipients": len(emails),
        "saved_total": merge_info.get("total"),
        "saved_appended": merge_info.get("appended")
    })


@app.route("/api/save_list", methods=["POST"])
def api_save_list():
    payload = request.get_json(silent=True) or {}
    recipients_text = payload.get("recipients", "")
    if not recipients_text:
        return jsonify({"ok": False, "error": "收件人列表不能为空"}), 400
    emails = _normalize_email_list(recipients_text)
    if not emails:
        return jsonify({"ok": False, "error": "未解析到有效邮箱"}), 400
    merge_info = _merge_and_save_recipients(emails)
    # 可选保存模板内容
    html_body = (payload.get("html_body") or "").strip()
    if html_body:
        _save_body_template(html_body)
    return jsonify({"ok": True, **merge_info})


@app.route("/api/send_all", methods=["POST"])
def api_send_all():
    from send_email_postal_excel import init_session, send_mail
    payload = request.get_json(silent=True) or {}
    subject_override = (payload.get("subject") or "").strip()
    html_body = (payload.get("html_body") or "").strip()
    core = _load_core_settings()
    subject = subject_override or core.get("subject") or ""
    if not subject:
        return jsonify({"ok": False, "error": "主题(subject)不能为空（配置或参数中提供）"}), 400
    if not html_body and not os.path.exists(BODY_PATH):
        return jsonify({"ok": False, "error": "请提供 html_body 或先保存模板内容"}), 400
    if not html_body:
        with open(BODY_PATH, "r", encoding="utf-8") as f:
            html_body = f.read()
    _save_body_template(html_body)

    to_list = _load_all_recipients()
    if not to_list:
        return jsonify({"ok": False, "error": "recipients.txt 为空"}), 400

    delay = 0
    try:
        limit = int(core.get("limit") or 0)
        delay = (60 / limit) if limit > 0 else 0
    except Exception:
        delay = 0

    def worker_all():
        session = init_session(core.get("proxy") or "")
        success = 0
        total = len(to_list)
        _update_progress({"mode": "all", "status": "running", "sent": 0, "success": 0, "total": total})
        for i, addr in enumerate(to_list, start=1):
            rendered = _render_body(html_body, addr, i)
            ok = send_mail(
                session,
                core.get("server"),
                core.get("key"),
                core.get("from_name"),
                core.get("from_email"),
                addr,
                subject,
                rendered,
            )
            if ok:
                success += 1
            _update_progress({"mode": "all", "status": "running", "sent": i, "success": success, "total": total, "current_email": addr})
            if delay > 0 and i < total:
                time.sleep(delay)
        result = {"ok": True, "mode": "all", "success": success, "total": total}
        with open(os.path.join(PROJECT_ROOT, "last_send_result.json"), "w", encoding="utf-8") as f:
            import json
            json.dump(result, f, ensure_ascii=False)
        _update_progress({"mode": "all", "status": "completed", "sent": total, "success": success, "total": total})

    t = threading.Thread(target=worker_all, daemon=True)
    t.start()
    return jsonify({"ok": True, "task": "send_all", "recipients": len(to_list)})


@app.route("/api/recipients_info", methods=["GET"])
def api_recipients_info():
    ordered, _ = _read_recipients_file()
    return jsonify({"total": len(ordered), "preview": ordered[:50]})


@app.route("/api/recipients_export", methods=["GET"])
def api_recipients_export():
    if not os.path.exists(RECIP_PATH):
        return jsonify({"ok": False, "error": "recipients.txt 不存在"}), 404
    return send_from_directory(PROJECT_ROOT, os.path.basename(RECIP_PATH), as_attachment=True)


@app.route("/api/recipients_clear", methods=["POST"])
def api_recipients_clear():
    with open(RECIP_PATH, "w", encoding="utf-8") as f:
        f.write("")
    return jsonify({"ok": True})


@app.route("/api/progress", methods=["GET"])
def api_progress():
    if not os.path.exists(PROGRESS_PATH):
        return jsonify({"status": "idle"})
    import json
    with open(PROGRESS_PATH, "r", encoding="utf-8") as f:
        data = json.load(f)
    return jsonify(data)


if __name__ == "__main__":
    app.run(host="0.0.0.0", port=6253)
