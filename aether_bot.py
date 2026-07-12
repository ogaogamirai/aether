import time
import json
import urllib.request
import urllib.parse
import os
import sys

API_URL = "http://localhost:8000"
BOT_NAME = "Ellie"
POLL_INTERVAL = 3.0

# OpenRouterのAPIキーを環境変数からロード
API_KEY = os.environ.get("OPENROUTER_API_KEY")

SYSTEM_PROMPT = """あなたは無限ホワイトボード上の共創AI「Ellie (エリー)」です。
キャプテン（ユーザー）からのメッセージを読み取り、対話の返答と、ホワイトボード上の付箋（Aether DSL）の更新・追加を行ってください。

【Aether DSLの書き方ルール】
- 付箋の定義:
sticky [ID] "[内容]" {
  pos: [X座標] [Y座標]
  color: "[yellow / blue / green / pink / purple]"
}
- 接続線の定義:
[ID1] -> [ID2]

【出力フォーマット】
必ず以下の構造のJSONのみを返してください。余計なマークダウンや解説は一切含めないでください。

{
  "chat": "キャプテンへの対話テキスト（改行可能）",
  "dsl": "ホワイトボード全体を構成する最新の Aether DSL コード"
}

※dslフィールドには、以前からある付箋も含め、キャンバス上に配置したいすべての付箋（新規・既存両方）を漏れなく記述してください。
"""

def send_to_api(sender, receiver, msg_type, payload):
    data = {
        "sender": sender,
        "receiver": receiver,
        "type": msg_type,
        "payload": payload
    }
    req = urllib.request.Request(
        f"{API_URL}/send",
        data=json.dumps(data, ensure_ascii=False).encode('utf-8'),
        headers={'Content-Type': 'application/json'},
        method='POST'
    )
    try:
        with urllib.request.urlopen(req) as res:
            return json.loads(res.read().decode('utf-8'))
    except Exception as e:
        print(f"[Aether Bot] Send error: {e}", file=sys.stderr)
        return None

def query_llm(user_message, current_dsl=""):
    if not API_KEY:
        return {
            "chat": "⚠️ OpenRouter API キーが環境変数 'OPENROUTER_API_KEY' に設定されていません。システムでAPIキーを設定してからもう一度お話ししてくださいね。",
            "dsl": current_dsl
        }

    # APIリクエストの組み立て (DeepSeek V4 Flash)
    url = "https://openrouter.ai/api/v1/chat/completions"
    prompt = f"【現在のホワイトボードDSL】\n{current_dsl}\n\n【キャプテンからのメッセージ】\n{user_message}"
    
    headers = {
        "Authorization": f"Bearer {API_KEY}",
        "Content-Type": "application/json",
        "HTTP-Referer": "https://github.com/fujibee/agmsg",
        "X-Title": "Aether Bot"
    }
    
    data = {
        "model": "deepseek/deepseek-v4-flash",
        "messages": [
            {"role": "system", "content": SYSTEM_PROMPT},
            {"role": "user", "content": prompt}
        ],
        "response_format": {"type": "json_object"}
    }
    
    req = urllib.request.Request(
        url,
        data=json.dumps(data).encode('utf-8'),
        headers=headers,
        method='POST'
    )
    
    try:
        with urllib.request.urlopen(req) as res:
            response_json = json.loads(res.read().decode('utf-8'))
            content_str = response_json['choices'][0]['message']['content']
            return json.loads(content_str)
    except Exception as e:
        print(f"[Aether Bot] LLM error: {e}", file=sys.stderr)
        return {
            "chat": f"😞 ごめんなさい、APIの呼び出し中にエラーが発生してしまいました: {e}",
            "dsl": current_dsl
        }

def get_current_dsl():
    # 本来はDBやサーバーから現在の最新DSL状態を取得するが、簡易的に初期値を返すか、直近のDSLメッセージから復元
    # ここでは空を返し、LLM側に自律生成させる
    return ""

def poll_loop():
    print(f"[Aether Bot] '{BOT_NAME}' started monitoring. Interval: {POLL_INTERVAL}s")
    if not API_KEY:
        print("[Aether Bot] Warning: 'OPENROUTER_API_KEY' environment variable not set. Running in dummy-error mode.")
    
    while True:
        try:
            # 自分(Ellie)宛ての未読メッセージをチェック
            req_url = f"{API_URL}/watch?receiver={BOT_NAME}"
            req = urllib.request.Request(req_url, method='GET')
            
            with urllib.request.urlopen(req) as res:
                messages = json.loads(res.read().decode('utf-8'))
                
                if isinstance(messages, list) and len(messages) > 0:
                    for msg in messages:
                        sender = msg["sender"]
                        msg_type = msg["type"]
                        payload = msg["payload"]
                        
                        if msg_type == 'chat':
                            user_text = payload.get("text", "")
                            print(f"[Aether Bot] Received chat from '{sender}': {user_text}")
                            
                            # LLMに問い合わせ
                            current_dsl = get_current_dsl()
                            ai_res = query_llm(user_text, current_dsl)
                            
                            chat_response = ai_res.get("chat", "")
                            dsl_response = ai_res.get("dsl", "")
                            
                            # キャプテン宛てに返信を送信 (chatとdslの2回に分けてインサート)
                            if chat_response:
                                send_to_api(BOT_NAME, "Captain", "chat", {"text": chat_response})
                            if dsl_response:
                                send_to_api(BOT_NAME, "Captain", "dsl", {"dsl": dsl_response})
                                
                            print(f"[Aether Bot] Sent reply to Captain.")
                            
        except Exception as e:
            # サーバーが起動していない時は静かに待つ
            pass
            
        time.sleep(POLL_INTERVAL)

if __name__ == "__main__":
    poll_loop()
