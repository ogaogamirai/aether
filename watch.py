import sqlite3
import os
import sys
import json
import argparse

def watch_messages(db_path, receiver):
    conn = sqlite3.connect(db_path)
    # 読み込んだレコードを辞書形式で扱いやすくする設定
    conn.row_factory = sqlite3.Row
    try:
        conn.execute("PRAGMA journal_mode=WAL;")
        conn.execute("PRAGMA busy_timeout = 5000;")
        
        cursor = conn.cursor()
        # 自分宛て（receiver）の未読メッセージを時系列順に取得
        cursor.execute(
            "SELECT id, timestamp, sender, msg_type, payload FROM messages WHERE receiver = ? AND is_read = 0 ORDER BY timestamp ASC;",
            (receiver,)
        )
        rows = cursor.fetchall()
        
        if not rows:
            # 未読メッセージなし
            print(json.dumps([], ensure_ascii=False))
            return
            
        messages = []
        message_ids = []
        
        for row in rows:
            payload_data = row["payload"]
            # ペイロードがJSON文字列であるため、辞書にパースしてパッキングする
            try:
                payload_json = json.loads(payload_data)
            except ValueError:
                payload_json = {"text": payload_data}
                
            messages.append({
                "id": row["id"],
                "timestamp": row["timestamp"],
                "sender": row["sender"],
                "type": row["msg_type"],
                "payload": payload_json
            })
            message_ids.append(row["id"])
            
        # 取得したメッセージの既読フラグを一括で1に更新
        if message_ids:
            placeholders = ",".join("?" for _ in message_ids)
            cursor.execute(
                f"UPDATE messages SET is_read = 1 WHERE id IN ({placeholders});",
                message_ids
            )
            conn.commit()
            
        # 標準出力にJSON文字列として結果を一括ダンプ
        print(json.dumps(messages, ensure_ascii=False, indent=2))
        
    except Exception as e:
        print(f"[Aether] Error reading messages: {e}", file=sys.stderr)
        sys.exit(1)
    finally:
        conn.close()

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Aether Message Watcher (Polls unread)")
    parser.add_argument("--receiver", required=True, help="Your agent name (e.g. Ellie, Nova, Captain)")
    
    args = parser.parse_args()
    
    current_dir = os.path.dirname(os.path.abspath(__file__))
    db_path = os.path.join(current_dir, "aether.db")
    
    # データベースファイルが存在しない場合は自動初期化
    if not os.path.exists(db_path):
        import db_init
        db_init.init_database(db_path)
        
    watch_messages(db_path, args.receiver)
