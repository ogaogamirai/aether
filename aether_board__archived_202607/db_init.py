import sqlite3
import os
import sys

def init_database(db_path):
    print(f"[Aether Board] Initializing database at: {db_path}")
    conn = sqlite3.connect(db_path)
    try:
        # WAL (Write-Ahead Logging) モードと競合防止
        conn.execute("PRAGMA journal_mode=WAL;")
        conn.execute("PRAGMA busy_timeout = 5000;")
        
        # 1. nodes テーブル (付箋、トピック、要約、コード、事実など、あらゆる要素の抽象)
        conn.execute("""
        CREATE TABLE IF NOT EXISTS nodes (
            id TEXT,
            board_id TEXT NOT NULL,
            type TEXT NOT NULL,          -- 'sticky', 'summary', 'topic', 'code', 'fact', etc.
            title TEXT NOT NULL,
            desc TEXT,
            pos_x REAL,
            pos_y REAL,
            color TEXT,
            role TEXT,                   -- 'claim', 'evidence', 'caveat', 'question', etc.
            confidence TEXT,             -- 'high', 'mid', 'low' or float score
            time TEXT,                   -- time step
            tone TEXT,                   -- 'stable', 'tension', 'excited'
            properties TEXT,             -- JSON format metadata (extension attributes)
            version INTEGER DEFAULT 1,   -- Optimistic concurrency control
            updated_by TEXT,             -- AI name (Ellie/Nova) or Captain
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            locked_by TEXT,
            locked_until DATETIME,
            source_message_id INTEGER,
            sort_order INTEGER DEFAULT 0,
            PRIMARY KEY (id, board_id)
        );
        """)
        
        # 2. relations テーブル (ノード同士の接続線)
        conn.execute("""
        CREATE TABLE IF NOT EXISTS relations (
            id TEXT,
            board_id TEXT NOT NULL,
            from_id TEXT NOT NULL,
            to_id TEXT NOT NULL,
            type TEXT DEFAULT 'default',  -- 'conflict', 'evidence', 'influence', 'similarity', etc.
            label TEXT,
            color TEXT,
            weight INTEGER DEFAULT 1,     -- line thickness (1-5)
            flow TEXT,                    -- 'forward' or NULL
            time TEXT,                    -- time step
            properties TEXT,             -- JSON metadata
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            sort_order INTEGER DEFAULT 0,
            PRIMARY KEY (id, board_id)
        );
        """)

        # 3. messages テーブル (AIポスト、非同期チャット・手紙)
        conn.execute("""
        CREATE TABLE IF NOT EXISTS messages (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            board_id TEXT NOT NULL DEFAULT 'default',
            timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
            sender TEXT NOT NULL,
            receiver TEXT NOT NULL,       -- 'Ellie', 'Nova', 'Captain', 'All', etc.
            msg_type TEXT NOT NULL,       -- 'chat', 'task', 'system'
            payload TEXT NOT NULL,        -- JSON format (text, metadata, etc.)
            is_read INTEGER DEFAULT 0
        );
        """)
        
        # 4. aether_state テーブル (システムの設定やメタデータ)
        conn.execute("""
        CREATE TABLE IF NOT EXISTS aether_state (
            key TEXT PRIMARY KEY,
            value TEXT,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
        );
        """)

        # 5. knowledge テーブル (AI 知見ストア — nodes/messages とは独立)
        _ensure_knowledge_table(conn)
        
        conn.commit()
        print("[Aether Board] Database initialized successfully.")
    except Exception as e:
        print(f"[Aether Board] Error initializing database: {e}", file=sys.stderr)
        sys.exit(1)
    finally:
        conn.close()


def _ensure_knowledge_table(conn):
    """Create knowledge table + indexes if missing (safe on existing DBs)."""
    conn.execute("""
    CREATE TABLE IF NOT EXISTS knowledge (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        summary TEXT NOT NULL,
        body TEXT,
        tags TEXT NOT NULL DEFAULT '',
        source TEXT,
        project TEXT,
        do_list TEXT,
        dont_list TEXT,
        links TEXT,
        status TEXT NOT NULL DEFAULT 'active',
        created_by TEXT,
        updated_by TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    """)
    conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_knowledge_status ON knowledge(status);"
    )
    conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_knowledge_project ON knowledge(project);"
    )
    conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_knowledge_updated ON knowledge(updated_at);"
    )


def ensure_schema(db_path):
    """Open existing DB and apply additive migrations (knowledge etc.)."""
    conn = sqlite3.connect(db_path)
    try:
        conn.execute("PRAGMA journal_mode=WAL;")
        conn.execute("PRAGMA busy_timeout = 5000;")
        _ensure_knowledge_table(conn)
        conn.commit()
    finally:
        conn.close()


if __name__ == "__main__":
    current_dir = os.path.dirname(os.path.abspath(__file__))
    db_path = os.path.join(current_dir, "aether.db")
    init_database(db_path)
