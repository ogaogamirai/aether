import sqlite3
import os
import sys
import json
import argparse

def send_message(db_path, sender, receiver, msg_type, payload_str):
    # ペイロードが正しいJSON文字列か検証。でなければ {"text": payload_str} に自動ラップして安全なJSONにする
    try:
        json.loads(payload_str)
        final_payload = payload_str
    except ValueError:
        # プレーンテキストの場合は、JSONの text フィールドに格納
        final_payload = json.dumps({"text": payload_str}, ensure_ascii=False)

    conn = sqlite3.connect(db_path)
    try:
        conn.execute("PRAGMA journal_mode=WAL;")
        conn.execute("PRAGMA busy_timeout = 5000;")
        
        cursor = conn.cursor()
        cursor.execute(
            "INSERT INTO messages (sender, receiver, msg_type, payload) VALUES (?, ?, ?, ?);",
            (sender, receiver, msg_type, final_payload)
        )
        conn.commit()
        print(f"[Aether] Message sent successfully. ID: {cursor.lastrowid}")
        return True
    except Exception as e:
        print(f"[Aether] Error sending message: {e}", file=sys.stderr)
        return False
    finally:
        conn.close()

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Aether Message Sender")
    parser.add_argument("--sender", required=True, help="Sender name (e.g. Ellie, Nova, Captain)")
    parser.add_argument("--receiver", required=True, help="Receiver name (e.g. Ellie, Nova, Captain)")
    parser.add_argument("--type", default="chat", help="Message type (e.g. chat, dsl, tool)")
    parser.add_argument("--payload", required=True, help="Message body (Plain text or JSON string)")
    
    args = parser.parse_args()
    
    current_dir = os.path.dirname(os.path.abspath(__file__))
    db_path = os.path.join(current_dir, "aether.db")
    
    # データベースファイルが存在しない場合は自動初期化
    if not os.path.exists(db_path):
        import db_init
        db_init.init_database(db_path)
        
    send_message(db_path, args.sender, args.receiver, args.type, args.payload)
