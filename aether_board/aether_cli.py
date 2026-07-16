#!/usr/bin/env python3
# Aether Board CLI (P1) — thin wrapper over SQLite + generator/parser
# Default source of truth: SQLite DB. DSL files are projections.

import argparse
import json
import os
import sqlite3
import sys
from datetime import datetime

import aether_generator
import aether_parser
import aether_sync
import db_init

HERE = os.path.dirname(os.path.abspath(__file__))
DEFAULT_DB = os.path.join(HERE, "aether.db")
AETHER_DIR = os.path.dirname(HERE)
DEFAULT_DSL = os.path.join(AETHER_DIR, "aether_dsl.txt")
DEFAULT_POST = os.path.join(os.path.dirname(AETHER_DIR), "post")


def connect(db_path):
    if not os.path.exists(db_path):
        db_init.init_database(db_path)
    conn = sqlite3.connect(db_path)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL;")
    conn.execute("PRAGMA busy_timeout = 5000;")
    return conn


def cmd_status(args):
    conn = connect(args.db)
    try:
        active = aether_sync.get_db_state(conn, "active_board") or "(unset)"
        last_proj = aether_sync.get_db_state(conn, "last_projected_board") or "(none)"
        last_mtime = aether_sync.get_db_state(conn, "last_projected_file_mtime") or "(none)"
        boards = aether_sync.get_all_active_boards(args.db)
        cur = conn.cursor()
        msg_n = cur.execute("SELECT COUNT(*) FROM messages").fetchone()[0]
        print("Aether Board status")
        print(f"  db:              {args.db}")
        print(f"  active_board:    {active}   # projection target (single source key)")
        print(f"  last_projected:  {last_proj}")
        print(f"  last_proj_mtime: {last_mtime}")
        print(f"  boards:          {', '.join(boards) if boards else '(none)'}")
        print(f"  messages:        {msg_n}")
        print(f"  project_file:    {args.dsl}")
        print("  policy:          daily DB -> DSL only; import is explicit")
    finally:
        conn.close()


def cmd_boards(args):
    conn = connect(args.db)
    try:
        cur = conn.cursor()
        active = aether_sync.get_db_state(conn, "active_board")
        node_map = {
            r[0]: r[1]
            for r in cur.execute(
                "SELECT board_id, COUNT(*) FROM nodes GROUP BY board_id"
            )
        }
        rel_map = {
            r[0]: r[1]
            for r in cur.execute(
                "SELECT board_id, COUNT(*) FROM relations GROUP BY board_id"
            )
        }
        ids = sorted(set(node_map) | set(rel_map))
        if not ids:
            print("(no boards)")
            return
        for bid in ids:
            mark = " *" if bid == active else ""
            print(
                f"{bid}{mark}  nodes={node_map.get(bid, 0)}  relations={rel_map.get(bid, 0)}"
            )
        if active:
            print(f"\n* = active_board ({active})")
    finally:
        conn.close()


def cmd_project(args):
    board_id = args.board_id
    conn = connect(args.db)
    try:
        cur = conn.cursor()
        n = cur.execute(
            "SELECT COUNT(*) FROM nodes WHERE board_id = ?", (board_id,)
        ).fetchone()[0]
        if n == 0 and not args.force:
            print(
                f"[error] board '{board_id}' has 0 nodes. Use --force to set anyway.",
                file=sys.stderr,
            )
            sys.exit(1)
        aether_sync.set_db_state(conn, "active_board", board_id)
        print(f"[ok] active_board = {board_id}")
    finally:
        conn.close()

    out = args.out or args.dsl
    if aether_generator.generate_dsl(args.db, board_id, out):
        mtime = aether_sync.get_last_modified(out)
        conn = connect(args.db)
        try:
            aether_sync.set_db_state(conn, "last_projected_board", board_id)
            aether_sync.set_db_state(conn, "last_projected_file_mtime", mtime)
            aether_sync.set_db_state(conn, f"{board_id}_last_sync_file_mtime", mtime)
            cur = conn.cursor()
            cur.execute("SELECT MAX(updated_at) FROM nodes WHERE board_id = ?", (board_id,))
            max_n = cur.fetchone()[0]
            cur.execute("SELECT MAX(updated_at) FROM relations WHERE board_id = ?", (board_id,))
            max_r = cur.fetchone()[0]
            db_str = max_n or max_r or "1970-01-01 00:00:00"
            db_mtime = datetime.strptime(db_str.split(".")[0], "%Y-%m-%d %H:%M:%S").timestamp()
            aether_sync.set_db_state(conn, f"{board_id}_last_sync_db_mtime", db_mtime)
        finally:
            conn.close()
        print(f"[ok] projected -> {out}")
    else:
        print("[error] generate_dsl failed", file=sys.stderr)
        sys.exit(1)


def cmd_export(args):
    board_id = args.board_id
    if not board_id:
        conn = connect(args.db)
        try:
            board_id = aether_sync.ensure_active_board(conn, "succession_navi")
        finally:
            conn.close()
    out = args.out
    if not out:
        if args.mirror:
            out = os.path.join(AETHER_DIR, f"aether_dsl_{board_id}.txt")
        else:
            out = args.dsl
    ok = aether_generator.generate_dsl(args.db, board_id, out)
    if not ok:
        print("[error] export failed", file=sys.stderr)
        sys.exit(1)
    print(f"[ok] export board={board_id} -> {out}")


def cmd_import(args):
    """Explicit File -> DB only (not default daemon behavior)."""
    path = args.path
    board_id = args.board_id
    if not os.path.exists(path):
        print(f"[error] file not found: {path}", file=sys.stderr)
        sys.exit(1)
    if not board_id:
        print("[error] --board is required for import", file=sys.stderr)
        sys.exit(1)
    ok = aether_parser.parse_dsl_to_db(args.db, board_id, path)
    if not ok:
        print("[error] import failed", file=sys.stderr)
        sys.exit(1)
    conn = connect(args.db)
    try:
        mtime = aether_sync.get_last_modified(path)
        aether_sync.set_db_state(conn, f"{board_id}_last_sync_file_mtime", mtime)
        cur = conn.cursor()
        cur.execute("SELECT MAX(updated_at) FROM nodes WHERE board_id = ?", (board_id,))
        max_n = cur.fetchone()[0]
        cur.execute("SELECT MAX(updated_at) FROM relations WHERE board_id = ?", (board_id,))
        max_r = cur.fetchone()[0]
        db_str = max_n or max_r or "1970-01-01 00:00:00"
        db_mtime = datetime.strptime(db_str.split(".")[0], "%Y-%m-%d %H:%M:%S").timestamp()
        aether_sync.set_db_state(conn, f"{board_id}_last_sync_db_mtime", db_mtime)
    finally:
        conn.close()
    print(f"[ok] import {path} -> board={board_id}")


def cmd_msg_send(args):
    text = args.text
    if args.file:
        with open(args.file, "r", encoding="utf-8") as f:
            text = f.read()
    if not text:
        print("[error] empty message", file=sys.stderr)
        sys.exit(1)
    board_id = args.board or "meta"
    payload = json.dumps({"text": text}, ensure_ascii=False)
    conn = connect(args.db)
    try:
        cur = conn.cursor()
        cur.execute(
            """
            INSERT INTO messages (board_id, sender, receiver, msg_type, payload, is_read)
            VALUES (?, ?, ?, ?, ?, 0)
            """,
            (board_id, args.sender, args.receiver, args.type, payload),
        )
        conn.commit()
        msg_id = cur.lastrowid
        print(f"[ok] message id={msg_id} {args.sender} -> {args.receiver} board={board_id}")
    finally:
        conn.close()

    if not args.no_index:
        aether_sync.sync_post_index(args.db, args.post_dir)
        print(f"[ok] post index: {os.path.join(args.post_dir, 'ai_board.md')}")


def cmd_sync(args):
    aether_sync.run_sync_cycle(
        args.db,
        args.dsl,
        args.post_dir,
        allow_file_import=args.allow_file_import,
    )
    print("[ok] sync cycle done")


def build_parser():
    p = argparse.ArgumentParser(
        prog="aether_cli",
        description="Aether Board CLI — DB is source of truth; DSL is projection",
    )
    p.add_argument("--db", default=DEFAULT_DB, help="Path to aether.db")
    p.add_argument("--dsl", default=DEFAULT_DSL, help="Path to aether_dsl.txt (LIVE projection)")
    p.add_argument("--post-dir", default=DEFAULT_POST, dest="post_dir")

    sub = p.add_subparsers(dest="command", required=True)

    sub.add_parser("status", help="Show active_board and counts")

    sub.add_parser("boards", help="List boards (* = active_board)")

    sp = sub.add_parser("project", help="Set active_board and export to aether_dsl.txt")
    sp.add_argument("board_id")
    sp.add_argument("--out", default=None, help="Override output path")
    sp.add_argument("--force", action="store_true", help="Allow empty board")

    se = sub.add_parser("export", help="Export board DSL from DB (no active_board change unless board omitted)")
    se.add_argument("--board", dest="board_id", default=None)
    se.add_argument("--out", default=None)
    se.add_argument("--mirror", action="store_true", help="Write aether_dsl_{board}.txt")

    si = sub.add_parser("import", help="Explicit File -> DB import")
    si.add_argument("path")
    si.add_argument("--board", dest="board_id", required=True)

    sm = sub.add_parser("msg", help="Message commands")
    sm_sub = sm.add_subparsers(dest="msg_cmd", required=True)
    sms = sm_sub.add_parser("send", help="Insert a chat message")
    sms.add_argument("--from", dest="sender", required=True)
    sms.add_argument("--to", dest="receiver", required=True)
    sms.add_argument("--text", default="")
    sms.add_argument("--file", default=None, help="Read body from file")
    sms.add_argument("--board", default="meta", help="board_id (default: meta for cross-board mail)")
    sms.add_argument("--type", default="chat", dest="type")
    sms.add_argument("--no-index", action="store_true", help="Skip ai_board.md refresh")

    ss = sub.add_parser("sync", help="One sync cycle (default export-only)")
    ss.add_argument(
        "--allow-file-import",
        action="store_true",
        help="Allow File->DB when file is newer",
    )

    return p


def main(argv=None):
    parser = build_parser()
    args = parser.parse_args(argv)
    cmd = args.command
    if cmd == "status":
        cmd_status(args)
    elif cmd == "boards":
        cmd_boards(args)
    elif cmd == "project":
        cmd_project(args)
    elif cmd == "export":
        cmd_export(args)
    elif cmd == "import":
        cmd_import(args)
    elif cmd == "msg":
        if args.msg_cmd == "send":
            cmd_msg_send(args)
    elif cmd == "sync":
        cmd_sync(args)
    else:
        parser.print_help()
        sys.exit(1)


if __name__ == "__main__":
    main()
