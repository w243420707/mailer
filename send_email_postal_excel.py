import json
import time
import pandas as pd
import requests
import toml
from tqdm import tqdm
from requests.adapters import HTTPAdapter
from urllib3.util.retry import Retry


def init_session(proxy):
    """初始化带自动重试和代理的 HTTP 会话"""
    s = requests.Session()
    retries = Retry(total=5, backoff_factor=0.2, status_forcelist=[500, 502, 503, 504])
    s.mount('http://', HTTPAdapter(max_retries=retries))
    s.mount('https://', HTTPAdapter(max_retries=retries))
    if proxy:
        s.proxies = {"http": proxy, "https": proxy}
    return s


def send_mail(session, server, key, from_name, from_email, to_addr, subject, html_body):
    """调用 Postal API 发送邮件"""
    data = {
        "from": f"{from_name} <{from_email}>",
        "sender": from_email,
        "to": [to_addr],
        "subject": subject,
        "html_body": html_body
    }

    try:
        r = session.post(
            f"{server}/api/v1/send/message",
            data=json.dumps(data),
            headers={"X-Server-API-Key": key, "Content-Type": "application/json"},
            timeout=30
        )
        if r.status_code == 200:
            result = r.json()
            if result.get("status") == "success":
                return True
            else:
                print(f"❌ {to_addr} 发件失败：{result.get('data', {}).get('message', '未知错误')}")
        else:
            print(f"❌ {to_addr} HTTP错误 {r.status_code}：{r.text}")
    except Exception as e:
        print(f"❌ {to_addr} 网络错误：{e}")
    return False


if __name__ == "__main__":
    # 读取配置文件
    try:
        config = toml.load("config.toml")
    except FileNotFoundError:
        print("❌ 未找到 config.toml")
        exit()

    server = config["postal"]["server"]
    key = config["postal"]["key"]
    from_name = config["postal"]["from_name"]
    from_email = config["postal"]["from_email"]
    excel_path = config["setting"]["excel_file"]
    subject = config["setting"]["subject"]
    limit = config["setting"]["limit"]
    proxy = config["setting"]["proxy"]

    delay = (60 / limit) if limit > 0 else 0

    # 读取 Excel 文件
    try:
        df = pd.read_excel(excel_path)
    except FileNotFoundError:
        print(f"❌ Excel 文件 {excel_path} 未找到")
        exit()

    # 确保至少有两列
    if len(df.columns) < 2:
        print("❌ Excel 文件格式错误：至少需要两列（第一列邮箱，第二列内容）")
        exit()

    # 初始化会话
    session = init_session(proxy)
    print(f"✅ 成功读取 {len(df)} 行邮件数据")

    # 用户确认
    confirm = input(f"确认发送 {len(df)} 封邮件？(y/n): ").lower()
    if confirm != "y":
        print("已取消发送。")
        exit()

    success = 0
    for i, row in enumerate(tqdm(df.itertuples(index=False), desc="🚀 发送中"), start=1):
        # 第一列是邮箱，第二列是内容
        to_addr = str(row[0]).strip()
        html_body = str(row[1]).strip()

        ok = send_mail(session, server, key, from_name, from_email, to_addr, subject, html_body)
        if ok:
            success += 1
        if delay > 0 and i < len(df):
            time.sleep(delay)

    print(f"\n✅ 全部完成：成功发送 {success}/{len(df)} 封邮件")