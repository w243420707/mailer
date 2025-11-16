import os
import threading
from flask import Flask, jsonify, request, render_template, send_from_directory
import toml

PROJECT_ROOT = os.path.dirname(os.path.dirname(__file__))
CONFIG_PATH = os.path.join(PROJECT_ROOT, "config.toml")

app = Flask(__name__, static_folder="static", template_folder="templates")


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


if __name__ == "__main__":
    app.run(host="0.0.0.0", port=6253)
