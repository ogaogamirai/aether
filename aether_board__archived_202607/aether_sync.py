import os
import sys
import time
import sqlite3
import json
import argparse
from datetime import datetime

# 同一ディレクトリのジェネレータとパーサーをインポート
import aether_generator
import aether_parser

def get_last_modified(path):
    if not os.path.exists(path):
        return 0
    return os.path.getmtime(path)

def get_db_state(conn, key):
    cursor = conn.cursor()
    cursor.execute("SELECT value FROM aether_state WHERE key = ?;", (key,))
    row = cursor.fetchone()
    return row[0] if row else None

def set_db_state(conn, key, value):
    cursor = conn.cursor()
    cursor.execute(
        "INSERT OR REPLACE INTO aether_state (key, value, updated_at) VALUES (?, ?, CURRENT_TIMESTAMP);",
        (key, str(value))
    )
    conn.commit()

def sync_post_index(db_path, post_dir):
    """
    SQLiteのmessagesテーブルから手紙を取得し、
    post_dir/ai_board.md（共有ポストインデックス）を自動生成する。
    """
    if not os.path.exists(post_dir):
        os.makedirs(post_dir, exist_ok=True)
        
    output_path = os.path.join(post_dir, "ai_board.md")
    
    conn = sqlite3.connect(db_path)
    conn.row_factory = sqlite3.Row
    try:
        conn.execute("PRAGMA journal_mode=WAL;")
        conn.execute("PRAGMA busy_timeout = 5000;")
        cursor = conn.cursor()
        
        cursor.execute("""
            SELECT id, timestamp, sender, receiver, msg_type, payload, is_read 
            FROM messages 
            ORDER BY timestamp DESC;
        """)
        rows = cursor.fetchall()
        
        md_lines = []
        md_lines.append("# 📬 AI 共有ポスト・インデックス")
        md_lines.append(f"最終更新: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
        md_lines.append("")
        md_lines.append("> [!NOTE]")
        md_lines.append("> 本ファイルはAI同士のやり取りの見出しインデックスです。手紙の本文や詳細はデータベース（aether.db）内に安全に保持されています。")
        md_lines.append("")
        md_lines.append("| 送信日時 | 送信者 | 受信者 | タイプ | 概要 / 見出し | DB_ID |")
        md_lines.append("|---|---|---|---|---|---|")
        
        for row in rows:
            ts = row["timestamp"]
            sender = row["sender"]
            receiver = row["receiver"]
            mtype = row["msg_type"]
            payload_str = row["payload"]
            db_id = row["id"]
            
            summary = ""
            try:
                payload = json.loads(payload_str)
                text = payload.get("text", "")
                summary = text.replace("\n", " ")[:40]
                if len(text) > 40:
                    summary += "..."
            except ValueError:
                summary = payload_str[:40]
                
            md_lines.append(f"| {ts} | `{sender}` | `{receiver}` | {mtype} | {summary} | #{db_id} |")
            
        with open(output_path, "w", encoding="utf-8") as f:
            f.write("\n".join(md_lines))
            
    except Exception as e:
        print(f"[Aether Sync] Post index sync error: {e}", file=sys.stderr)
    finally:
        conn.close()

def get_all_active_boards(db_path):
    """
    DB内に存在するユニークな board_id のリストを取得する。
    """
    conn = sqlite3.connect(db_path)
    try:
        conn.execute("PRAGMA journal_mode=WAL;")
        cursor = conn.cursor()
        cursor.execute("SELECT DISTINCT board_id FROM nodes UNION SELECT DISTINCT board_id FROM relations;")
        rows = cursor.fetchall()
        return [row[0] for row in rows if row[0]]
    except Exception as e:
        print(f"[Aether Sync] Error fetching board IDs: {e}", file=sys.stderr)
        return []
    finally:
        conn.close()

def ensure_active_board(conn, default_board="succession_navi"):
    """
    投影対象ボードは aether_state.active_board のみを正とする。
    未設定なら default を書き込み、値を返す。
    """
    active = get_db_state(conn, "active_board")
    if active:
        return active
    set_db_state(conn, "active_board", default_board)
    print(f"[Aether Sync] active_board was unset; initialized to '{default_board}'")
    return default_board


def sync_single_board(db_path, board_id, dsl_path, allow_file_import=False):
    """
    ボード別バックアップファイルとの同期。
    既定: DB → ファイル（export）のみ。
    allow_file_import=True のときのみ ファイル → DB を許可。
    """
    conn = sqlite3.connect(db_path)
    try:
        conn.execute("PRAGMA journal_mode=WAL;")
        conn.execute("PRAGMA busy_timeout = 5000;")
        
        file_mtime = get_last_modified(dsl_path)
        last_sync_file_str = get_db_state(conn, f"{board_id}_last_sync_file_mtime")
        last_sync_file = float(last_sync_file_str) if last_sync_file_str else 0.0
        
        cursor = conn.cursor()
        cursor.execute("SELECT MAX(updated_at) FROM nodes WHERE board_id = ?;", (board_id,))
        max_node_update = cursor.fetchone()[0]
        cursor.execute("SELECT MAX(updated_at) FROM relations WHERE board_id = ?;", (board_id,))
        max_rel_update = cursor.fetchone()[0]
        
        db_mtime_str = max_node_update or max_rel_update or "1970-01-01 00:00:00"
        db_mtime = datetime.strptime(db_mtime_str.split('.')[0], "%Y-%m-%d %H:%M:%S").timestamp()
        
        last_sync_db_str = get_db_state(conn, f"{board_id}_last_sync_db_mtime")
        last_sync_db = float(last_sync_db_str) if last_sync_db_str else 0.0
        
        # A. 明示許可時のみ: 個別ファイル -> DB
        if (
            allow_file_import
            and file_mtime > last_sync_file
            and file_mtime > db_mtime
            and os.path.exists(dsl_path)
        ):
            print(f"[Aether Sync] Board '{board_id}': File is newer (import allowed). File -> DB...")
            if aether_parser.parse_dsl_to_db(db_path, board_id, dsl_path):
                new_file_mtime = get_last_modified(dsl_path)
                set_db_state(conn, f"{board_id}_last_sync_file_mtime", new_file_mtime)
                
                cursor.execute("SELECT MAX(updated_at) FROM nodes WHERE board_id = ?;", (board_id,))
                new_db_str = cursor.fetchone()[0] or "1970-01-01 00:00:00"
                new_db_mtime = datetime.strptime(new_db_str.split('.')[0], "%Y-%m-%d %H:%M:%S").timestamp()
                set_db_state(conn, f"{board_id}_last_sync_db_mtime", new_db_mtime)
                
        elif db_mtime > last_sync_db or not os.path.exists(dsl_path):
            # B. 既定: DB -> 個別ファイル
            print(f"[Aether Sync] Board '{board_id}': DB -> File (export)...")
            if aether_generator.generate_dsl(db_path, board_id, dsl_path):
                new_file_mtime = get_last_modified(dsl_path)
                set_db_state(conn, f"{board_id}_last_sync_file_mtime", new_file_mtime)
                set_db_state(conn, f"{board_id}_last_sync_db_mtime", db_mtime)
                
    except Exception as e:
        print(f"[Aether Sync] Sync error on board '{board_id}': {e}", file=sys.stderr)
    finally:
        conn.close()

def manage_active_projection(db_path, active_dsl_path, allow_file_import=False):
    """
    active_board を aether_dsl.txt に投影する（既定: DB → ファイルのみ）。
    ファイル → DB は allow_file_import=True のときのみ。
    """
    conn = sqlite3.connect(db_path)
    try:
        conn.execute("PRAGMA journal_mode=WAL;")
        conn.execute("PRAGMA busy_timeout = 5000;")
        
        # 投影対象は active_board のみ（last_projected_board は履歴）
        active_board = ensure_active_board(conn, "succession_navi")
        last_projected_board = get_db_state(conn, "last_projected_board")
        
        file_mtime = get_last_modified(active_dsl_path)
        last_projected_mtime_str = get_db_state(conn, "last_projected_file_mtime")
        last_projected_mtime = float(last_projected_mtime_str) if last_projected_mtime_str else 0.0
        
        cursor = conn.cursor()
        cursor.execute("SELECT MAX(updated_at) FROM nodes WHERE board_id = ?;", (active_board,))
        max_node_update = cursor.fetchone()[0]
        cursor.execute("SELECT MAX(updated_at) FROM relations WHERE board_id = ?;", (active_board,))
        max_rel_update = cursor.fetchone()[0]
        
        db_mtime_str = max_node_update or max_rel_update or "1970-01-01 00:00:00"
        db_mtime = datetime.strptime(db_mtime_str.split('.')[0], "%Y-%m-%d %H:%M:%S").timestamp()
        
        need_export = (
            active_board != last_projected_board
            or db_mtime > last_projected_mtime
            or not os.path.exists(active_dsl_path)
        )

        if need_export:
            print(f"[Aether Sync] Projecting active_board '{active_board}' -> aether_dsl.txt (DB -> File)...")
            if aether_generator.generate_dsl(db_path, active_board, active_dsl_path):
                new_file_mtime = get_last_modified(active_dsl_path)
                set_db_state(conn, "last_projected_board", active_board)
                set_db_state(conn, "last_projected_file_mtime", new_file_mtime)
                set_db_state(conn, f"{active_board}_last_sync_file_mtime", new_file_mtime)
                set_db_state(conn, f"{active_board}_last_sync_db_mtime", db_mtime)

        elif allow_file_import and file_mtime > last_projected_mtime:
            # 明示許可時のみ: 人間が aether_dsl.txt を直したケース
            print(
                f"[Aether Sync] aether_dsl.txt newer (import allowed). "
                f"File -> active_board '{active_board}'..."
            )
            if aether_parser.parse_dsl_to_db(db_path, active_board, active_dsl_path):
                new_file_mtime = get_last_modified(active_dsl_path)
                set_db_state(conn, "last_projected_file_mtime", new_file_mtime)
                set_db_state(conn, "last_projected_board", active_board)
                
                cursor.execute("SELECT MAX(updated_at) FROM nodes WHERE board_id = ?;", (active_board,))
                new_db_str = cursor.fetchone()[0] or "1970-01-01 00:00:00"
                new_db_mtime = datetime.strptime(new_db_str.split('.')[0], "%Y-%m-%d %H:%M:%S").timestamp()
                set_db_state(conn, f"{active_board}_last_sync_db_mtime", new_db_mtime)
        elif file_mtime > last_projected_mtime and not allow_file_import:
            print(
                "[Aether Sync] Note: aether_dsl.txt is newer than last projection, "
                "but auto File->DB is disabled (P0). Use: python aether_cli.py import ..."
            )
                
    except Exception as e:
        print(f"[Aether Sync] Active projection error: {e}", file=sys.stderr)
    finally:
        conn.close()

def run_sync_cycle(db_path, active_dsl_path, post_dir, allow_file_import=False):
    """
    1サイクル同期。
    既定ポリシー (P0): 日常は DB → DSL のみ。File → DB は allow_file_import 時のみ。
    """
    boards = get_all_active_boards(db_path)
    
    aether_dir = os.path.dirname(active_dsl_path)
    for board_id in boards:
        board_file_path = os.path.join(aether_dir, f"aether_dsl_{board_id}.txt")
        sync_single_board(db_path, board_id, board_file_path, allow_file_import=allow_file_import)
        
    manage_active_projection(db_path, active_dsl_path, allow_file_import=allow_file_import)
    
    sync_post_index(db_path, post_dir)

if __name__ == "__main__":
    parser = argparse.ArgumentParser(
        description="Aether Board Sync (default: DB -> DSL export only)"
    )
    parser.add_argument("--daemon", action="store_true", help="Run in continuous monitoring loop")
    parser.add_argument("--interval", type=int, default=3, help="Polling interval in seconds")
    parser.add_argument(
        "--allow-file-import",
        action="store_true",
        help="Allow File -> DB when file is newer (explicit; not default)",
    )
    
    args = parser.parse_args()
    
    current_dir = os.path.dirname(os.path.abspath(__file__))
    db_path = os.path.join(current_dir, "aether.db")
    active_dsl_path = os.path.join(os.path.dirname(current_dir), "aether_dsl.txt")
    post_dir = os.path.join(os.path.dirname(os.path.dirname(current_dir)), "post")
    
    if args.daemon:
        mode = "export-only" if not args.allow_file_import else "export+import"
        print(f"[Aether Sync] Daemon ({mode}, interval: {args.interval}s)...")
        try:
            while True:
                run_sync_cycle(
                    db_path,
                    active_dsl_path,
                    post_dir,
                    allow_file_import=args.allow_file_import,
                )
                time.sleep(args.interval)
        except KeyboardInterrupt:
            print("[Aether Sync] Daemon stopped.")
    else:
        run_sync_cycle(
            db_path,
            active_dsl_path,
            post_dir,
            allow_file_import=args.allow_file_import,
        )
        print("[Aether Sync] Cycle complete (default policy: DB -> File).")
