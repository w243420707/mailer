import json
import time
import secrets
import pandas as pd
import requests
import toml
from tqdm import tqdm
from requests.adapters import HTTPAdapter
from urllib3.util.retry import Retry


def init_session(proxy):
    """初始化带自动重试和代理的 HTTP 会话
    - 对 429/5xx 做重试
    - 允许对 POST 进行重试（allowed_methods=False）
    - 遵循 Retry-After 头
    """
    s = requests.Session()
    retries = Retry(
        total=5,
        backoff_factor=0.5,
        status_forcelist=[429, 500, 502, 503, 504],
        allowed_methods=False,  # 对所有方法生效，包含 POST
        respect_retry_after_header=True,
        raise_on_status=False,
    )
    adapter = HTTPAdapter(max_retries=retries)
    s.mount('http://', adapter)
    s.mount('https://', adapter)
    if proxy:
        s.proxies = {"http": proxy, "https": proxy}
    return s


def send_mail(session, server, key, from_name, from_email, to_addr, subject, html_body):
    """调用 Postal API 发送邮件（含轻量重试与限流处理）"""
    data = {
        "from": f"{from_name} <{from_email}>",
        "sender": from_email,
        "to": [to_addr],
        "subject": subject,
        "html_body": html_body,
    }

    url = f"{server}/api/v1/send/message"
    headers = {"X-Server-API-Key": key, "Content-Type": "application/json"}

    max_attempts = 4
    for attempt in range(1, max_attempts + 1):
        try:
            r = session.post(url, data=json.dumps(data), headers=headers, timeout=(10, 20))
            # 速率限制
            if r.status_code == 429:
                retry_after = r.headers.get("Retry-After")
                try:
                    wait = int(retry_after)
                except Exception:
                    wait = 30 * attempt  # 递增等待
                wait = max(10, min(wait, 180))
                print(f"⏳ {to_addr} 触发限速 429，等待 {wait}s 后重试（第{attempt}/{max_attempts}次）")
                time.sleep(wait)
                continue
            # 临时性错误
            if r.status_code >= 500:
                backoff = min(60, 2 ** attempt)
                print(f"⏳ {to_addr} 服务器错误 {r.status_code}，{backoff}s 后重试（第{attempt}/{max_attempts}次）")
                time.sleep(backoff)
                continue

            if r.status_code == 200:
                try:
                    result = r.json()
                except Exception:
                    result = {}
                if result.get("status") == "success":
                    return True
                else:
                    print(f"❌ {to_addr} 发件失败：{result.get('data', {}).get('message', '未知错误')}")
                    return False
            else:
                print(f"❌ {to_addr} HTTP错误 {r.status_code}：{r.text}")
                return False
        except Exception as e:
            if attempt < max_attempts:
                backoff = min(45, 3 * attempt)
                print(f"⏳ {to_addr} 网络错误：{e}，{backoff}s 后重试（第{attempt}/{max_attempts}次）")
                time.sleep(backoff)
                continue
            print(f"❌ {to_addr} 网络错误：{e}")
            return False
    return False


def send_from_config(config_path="config.toml", confirm=True):
    """根据给定的 TOML 配置文件发送邮件。返回一个 dict，包含统计信息和可能的错误消息。"""
    try:
        config = toml.load(config_path)
    except FileNotFoundError:
        return {"ok": False, "error": f"未找到配置文件: {config_path}"}

    server = config["postal"]["server"]
    key = config["postal"]["key"]
    from_name = config["postal"]["from_name"]
    from_email = config["postal"]["from_email"]
    excel_path = config["setting"]["excel_file"]
    subject = config["setting"]["subject"]
    limit = config["setting"].get("limit", 0)
    proxy = config["setting"].get("proxy", "")

    delay = (60 / limit) if limit > 0 else 0

    # 读取 Excel 文件
    try:
        df = pd.read_excel(excel_path)
    except FileNotFoundError:
        return {"ok": False, "error": f"Excel 文件 {excel_path} 未找到"}

    # 确保至少有两列
    if len(df.columns) < 2:
        return {"ok": False, "error": "Excel 文件格式错误：至少需要两列（第一列邮箱，第二列内容）"}

    # 如果需要确认但被禁用则返回信息
    if confirm is True:
        # 当作为模块通过 Web 调用时，不做交互确认；confirm=True 表示需要交互的调用者处理确认
        pass

    # 初始化会话
    session = init_session(proxy)

    success = 0
    total = len(df)
    for i, row in enumerate(df.itertuples(index=False), start=1):
        to_addr = str(row[0]).strip()
        html_body = str(row[1]).strip()
        # 附加不可见追踪行：64位随机码 + 时间戳（HTML 注释）
        trace = f"{secrets.token_hex(8)}-{int(time.time())}"
        html_body = f"{html_body}\n<!-- trace:{trace} -->"

        ok = send_mail(session, server, key, from_name, from_email, to_addr, subject, html_body)
        if ok:
            success += 1
        if delay > 0 and i < total:
            time.sleep(delay)

    return {"ok": True, "success": success, "total": total}


if __name__ == "__main__":
    # 保持原有命令行交互行为
    result = send_from_config("config.toml", confirm=True)
    if not result.get("ok"):
        print(f"❌ {result.get('error')}")
        exit(1)
    else:
        print(f"\n✅ 全部完成：成功发送 {result.get('success')}/{result.get('total')} 封邮件")