import os
import threading
import base64
from functools import wraps
from flask import Flask, jsonify, request, render_template, send_from_directory, Response
import toml

PROJECT_ROOT = os.path.dirname(os.path.dirname(__file__))
CONFIG_PATH = os.path.join(PROJECT_ROOT, "config.toml")

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
    # 上传 Excel 文件并更新配置中的 excel_file 路径
    if "file" not in request.files:
        return jsonify({"ok": False, "error": "no file"}), 400
    f = request.files["file"]
    filename = f.filename or "upload.xlsx"
    save_path = os.path.join(PROJECT_ROOT, filename)
    f.save(save_path)

    cfg = load_config()
    if "setting" not in cfg:
        cfg["setting"] = {}
    cfg["setting"]["excel_file"] = filename
    save_config(cfg)

    return jsonify({"ok": True, "filename": filename})


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

    def worker_list(to_list):
        session = init_session(core.get("proxy") or "")
        success = 0
        total = len(to_list)
        for i, addr in enumerate(to_list, start=1):
            ok = send_mail(
                session,
                core.get("server"),
                core.get("key"),
                core.get("from_name"),
                core.get("from_email"),
                addr,
                subject,
                html_body,
            )
            if ok:
                success += 1
            if delay > 0 and i < total:
                import time
                time.sleep(delay)
        result = {"ok": True, "mode": "list", "success": success, "total": total}
        with open(os.path.join(PROJECT_ROOT, "last_send_result.json"), "w", encoding="utf-8") as f:
            import json
            json.dump(result, f, ensure_ascii=False)

    t = threading.Thread(target=worker_list, args=(emails,), daemon=True)
    t.start()
    return jsonify({"ok": True, "task": "send_list", "recipients": len(emails)})


if __name__ == "__main__":
    app.run(host="0.0.0.0", port=6253)
