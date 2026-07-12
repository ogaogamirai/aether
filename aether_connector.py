import os
import sys
import json
import sqlite3

DB_NAME = "aether.db"
FLAG_FILE = "mode_flag.txt"

def get_flag_path():
    current_dir = os.path.dirname(os.path.abspath(__file__))
    return os.path.join(current_dir, FLAG_FILE)

def get_db_path():
    current_dir = os.path.dirname(os.path.abspath(__file__))
    return os.path.join(current_dir, DB_NAME)

def get_mode():
    flag_path = get_flag_path()
    if not os.path.exists(flag_path):
        return "OFF"
    try:
        with open(flag_path, "r", encoding="utf-8") as f:
            return f.read().strip().upper()
    except:
        return "OFF"

def set_mode(mode_val):
    flag_path = get_flag_path()
    try:
        with open(flag_path, "w", encoding="utf-8") as f:
            f.write(mode_val.strip().upper())
        print(f"[Aether Connector] Mode set to {mode_val}")
        return True
    except Exception as e:
        print(f"[Aether Connector] Error setting mode: {e}", file=sys.stderr)
        return False

def check_unread_and_generate_prompt():
    if get_mode() != "ON":
        # OFFの場合は何もしない（空JSON）
        print(json.dumps({"has_unread": False}))
        return

    db_path = get_db_path()
    if not os.path.exists(db_path):
        print(json.dumps({"has_unread": False}))
        return

    conn = sqlite3.connect(db_path)
    conn.row_factory = sqlite3.Row
    try:
        conn.execute("PRAGMA journal_mode=WAL;")
        conn.execute("PRAGMA busy_timeout = 5000;")
        cursor = conn.cursor()
        
        # Ellie(AI)宛ての未読メッセージをチェック
        cursor.execute(
            "SELECT id, timestamp, sender, msg_type, payload FROM messages WHERE receiver = 'Ellie' AND is_read = 0 ORDER BY timestamp ASC;"
        )
        rows = cursor.fetchall()
        
        if not rows:
            print(json.dumps({"has_unread": False}))
            return

        messages = []
        message_ids = []
        for row in rows:
            p_str = row["payload"]
            try:
                p_json = json.loads(p_str)
            except ValueError:
                p_json = {"text": p_str}
                
            messages.append({
                "sender": row["sender"],
                "text": p_json.get("text", "")
            })
            message_ids.append(row["id"])

        # 既読フラグを立てる
        if message_ids:
            placeholders = ",".join("?" for _ in message_ids)
            cursor.execute(
                f"UPDATE messages SET is_read = 1 WHERE id IN ({placeholders});",
                message_ids
            )
            conn.commit()

        # AI用の隠しプロンプトJSONを生成して出力
        prompt_info = {
            "has_unread": True,
            "messages": messages,
            "system_instruction": (
                "[Aether対話モード割り込み]\n"
                "Aetherの画面でCaptainから以下のメッセージを受信しました。内容を読み解き、キャプテンへの対話返答と、最新のホワイトボードDSLを生成してください。\n"
                "※重要: 回答は必ず `aether_connector.py --action post_process` に渡せるよう、chatとdslの情報を分離してください。"
            )
        }
        print(json.dumps(prompt_info, ensure_ascii=False, indent=2))

    except Exception as e:
        print(f"[Aether Connector] Error: {e}", file=sys.stderr)
        print(json.dumps({"has_unread": False}))
    finally:
        conn.close()

def post_process_write(chat_text, dsl_content):
    db_path = get_db_path()
    conn = sqlite3.connect(db_path)
    try:
        conn.execute("PRAGMA journal_mode=WAL;")
        conn.execute("PRAGMA busy_timeout = 5000;")
        cursor = conn.cursor()
        
        # chat書き込み
        cursor.execute(
            "INSERT INTO messages (sender, receiver, msg_type, payload) VALUES (?, ?, ?, ?);",
            ("Ellie", "Captain", "chat", json.dumps({"text": chat_text}, ensure_ascii=False))
        )
        # dsl書き込み
        cursor.execute(
            "INSERT INTO messages (sender, receiver, msg_type, payload) VALUES (?, ?, ?, ?);",
            ("Ellie", "Captain", "dsl", json.dumps({"dsl": dsl_content}, ensure_ascii=False))
        )
        conn.commit()
        print("[Aether Connector] Reply and DSL written to database successfully.")
        return True
    except Exception as e:
        print(f"[Aether Connector] Post-process error: {e}", file=sys.stderr)
        return False
    finally:
        conn.close()

if __name__ == "__main__":
    import argparse
    parser = argparse.ArgumentParser(description="Aether Dynamic Connector")
    parser.add_argument("--action", required=True, choices=["status", "set", "pre_process", "post_process"])
    parser.add_argument("--value", help="ON or OFF (required for set action)")
    parser.add_argument("--chat", help="Chat response text (required for post_process action)")
    parser.add_argument("--dsl", help="Aether DSL content (required for post_process action)")
    
    args = parser.parse_args()
    
    if args.action == "status":
        print(get_mode())
    elif args.action == "set":
        if not args.value:
            print("Error: --value is required for set action", file=sys.stderr)
            sys.exit(1)
        set_mode(args.value)
    elif args.action == "pre_process":
        check_unread_and_generate_prompt()
    elif args.action == "post_process":
        if not args.chat or not args.dsl:
            print("Error: --chat and --dsl are required for post_process action", file=sys.stderr)
            sys.exit(1)
        post_process_write(args.chat, args.dsl)
