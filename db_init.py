import sqlite3
import os
import sys

def init_database(db_path):
    print(f"[Aether] Initializing database at: {db_path}")
    conn = sqlite3.connect(db_path)
    try:
        # WAL (Write-Ahead Logging) モードを有効化して同時書き込み/読み込みを競合なしに可能にする
        conn.execute("PRAGMA journal_mode=WAL;")
        conn.execute("PRAGMA busy_timeout = 5000;") # 競合時に5秒間自動で待機してリトライする
        
        # messages テーブルの作成
        conn.execute("""
        CREATE TABLE IF NOT EXISTS messages (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
            sender TEXT NOT NULL,
            receiver TEXT NOT NULL,
            msg_type TEXT NOT NULL,
            payload TEXT NOT NULL,  -- JSON形式のテキストを格納する拡張性ペイロード列
            is_read INTEGER DEFAULT 0
        );
        """)
        conn.commit()
        print("[Aether] Database initialized successfully.")
    except Exception as e:
        print(f"[Aether] Error initializing database: {e}", file=sys.stderr)
        sys.exit(1)
    finally:
        conn.close()

if __name__ == "__main__":
    # デフォルトのデータベースパス（スクリプトと同じフォルダの aether.db）
    current_dir = os.path.dirname(os.path.abspath(__file__))
    db_path = os.path.join(current_dir, "aether.db")
    init_database(db_path)
