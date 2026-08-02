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
    else:
        db_init.ensure_schema(db_path)
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
        try:
            know_n = cur.execute(
                "SELECT COUNT(*) FROM knowledge WHERE status = 'active'"
            ).fetchone()[0]
        except sqlite3.OperationalError:
            know_n = 0
        print("Aether Board status")
        print(f"  db:              {args.db}")
        print(f"  active_board:    {active}   # projection target (single source key)")
        print(f"  last_projected:  {last_proj}")
        print(f"  last_proj_mtime: {last_mtime}")
        print(f"  boards:          {', '.join(boards) if boards else '(none)'}")
        print(f"  messages:        {msg_n}")
        print(f"  knowledge:       {know_n} active")
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


DEFAULT_MSG_LIMIT = 5
DEFAULT_SUMMARY_CHARS = 120
DEFAULT_BODY_CHARS = 4000


def _payload_text(payload_str):
    if not payload_str:
        return ""
    try:
        data = json.loads(payload_str)
        if isinstance(data, dict):
            return data.get("text") or data.get("summary") or ""
        return str(data)
    except (ValueError, TypeError):
        return str(payload_str)


def _one_line(text, max_chars):
    s = (text or "").replace("\r\n", "\n").replace("\n", " ").strip()
    if max_chars > 0 and len(s) > max_chars:
        return s[: max_chars - 3] + "..."
    return s


def _truncate_body(text, max_chars):
    s = text or ""
    if max_chars > 0 and len(s) > max_chars:
        return s[:max_chars] + f"\n...[truncated body_chars={max_chars}; use --full]"
    return s


def _refresh_post_index(db_path, post_dir, skip=False):
    if skip:
        return
    aether_sync.sync_post_index(db_path, post_dir)
    print(f"[ok] post index: {os.path.join(post_dir, 'ai_board.md')}")


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

    _refresh_post_index(args.db, args.post_dir, skip=args.no_index)


def cmd_msg_list(args):
    """Thin inbox: LIMIT + optional unread/to/from filters. Summaries only by default."""
    limit = max(1, int(args.limit))
    summary_chars = max(20, int(args.summary_chars))
    clauses = []
    params = []
    if args.to:
        clauses.append("receiver = ?")
        params.append(args.to)
    if args.sender:
        clauses.append("sender = ?")
        params.append(args.sender)
    if args.board:
        clauses.append("board_id = ?")
        params.append(args.board)
    if args.unread:
        clauses.append("is_read = 0")
    if args.after_id is not None:
        clauses.append("id > ?")
        params.append(int(args.after_id))
    where = (" WHERE " + " AND ".join(clauses)) if clauses else ""
    sql = (
        "SELECT id, board_id, timestamp, sender, receiver, msg_type, is_read, payload "
        f"FROM messages{where} ORDER BY id DESC LIMIT ?"
    )
    params.append(limit)
    conn = connect(args.db)
    try:
        rows = conn.execute(sql, params).fetchall()
    finally:
        conn.close()
    if not rows:
        print("(no messages)")
        return
    print(
        f"# id | ts | from -> to | board | type | read | summary"
    )
    for r in rows:
        text = _payload_text(r["payload"])
        summary = _one_line(text, summary_chars)
        read_flag = "Y" if r["is_read"] else "N"
        print(
            f"{r['id']} | {r['timestamp']} | {r['sender']} -> {r['receiver']} | "
            f"{r['board_id']} | {r['msg_type']} | {read_flag} | {summary}"
        )
    print(f"[ok] listed {len(rows)} (limit={limit})")


def cmd_msg_read(args):
    """Load one message body (truncated unless --full). Optionally mark read."""
    msg_id = int(args.id)
    body_chars = 0 if args.full else max(200, int(args.body_chars))
    conn = connect(args.db)
    try:
        cur = conn.cursor()
        row = cur.execute(
            """
            SELECT id, board_id, timestamp, sender, receiver, msg_type, is_read, payload
            FROM messages WHERE id = ?
            """,
            (msg_id,),
        ).fetchone()
        if not row:
            print(f"[error] message id={msg_id} not found", file=sys.stderr)
            sys.exit(1)
        text = _payload_text(row["payload"])
        body = text if args.full else _truncate_body(text, body_chars)
        print(f"id:       {row['id']}")
        print(f"board:    {row['board_id']}")
        print(f"time:     {row['timestamp']}")
        print(f"from:     {row['sender']}")
        print(f"to:       {row['receiver']}")
        print(f"type:     {row['msg_type']}")
        print(f"is_read:  {row['is_read']}")
        print("---")
        print(body)
        if args.mark_read and not row["is_read"]:
            cur.execute("UPDATE messages SET is_read = 1 WHERE id = ?", (msg_id,))
            conn.commit()
            print(f"[ok] marked read id={msg_id}")
        elif args.mark_read:
            print(f"[ok] already read id={msg_id}")
    finally:
        conn.close()


def cmd_msg_index(args):
    """Rebuild post/ai_board.md from messages (repair path)."""
    aether_sync.sync_post_index(args.db, args.post_dir)
    print(f"[ok] post index rebuilt: {os.path.join(args.post_dir, 'ai_board.md')}")


def cmd_sync(args):
    aether_sync.run_sync_cycle(
        args.db,
        args.dsl,
        args.post_dir,
        allow_file_import=args.allow_file_import,
    )
    print("[ok] sync cycle done")


# --- knowledge (AI insight store; independent of canvas nodes) ---

DEFAULT_KNOW_LIMIT = 10
DEFAULT_KNOW_BODY_CHARS = 2000
DEFAULT_KNOW_SUMMARY_CHARS = 120


def _normalize_tags(raw):
    if not raw:
        return ""
    parts = []
    for p in str(raw).replace(";", ",").split(","):
        t = p.strip().lower()
        if t and t not in parts:
            parts.append(t)
    return ",".join(parts)


def _read_optional_file(path):
    if not path:
        return None
    with open(path, "r", encoding="utf-8") as f:
        return f.read()


def _next_knowledge_id(conn, prefix="KNOW"):
    day = datetime.now().strftime("%Y%m%d")
    base = f"{prefix}-{day}-"
    rows = conn.execute(
        "SELECT id FROM knowledge WHERE id LIKE ?", (base + "%",)
    ).fetchall()
    n = 0
    for r in rows:
        tail = r["id"][len(base) :]
        if tail.isdigit():
            n = max(n, int(tail))
    return f"{base}{n + 1:02d}"


def cmd_know_add(args):
    title = (args.title or "").strip()
    if not title:
        print("[error] --title is required", file=sys.stderr)
        sys.exit(1)
    summary = (args.summary or "").strip()
    body = args.body
    if args.body_file:
        body = _read_optional_file(args.body_file)
    if not summary and body:
        summary = _one_line(body, DEFAULT_KNOW_SUMMARY_CHARS)
    if not summary:
        print("[error] --summary (or body) is required", file=sys.stderr)
        sys.exit(1)
    tags = _normalize_tags(args.tags)
    now = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    by = args.by or "Nova"
    conn = connect(args.db)
    try:
        kid = (args.id or "").strip() or _next_knowledge_id(conn)
        exists = conn.execute(
            "SELECT id FROM knowledge WHERE id = ?", (kid,)
        ).fetchone()
        if exists and not args.force:
            print(
                f"[error] id={kid} exists. Use --force to replace.",
                file=sys.stderr,
            )
            sys.exit(1)
        conn.execute(
            """
            INSERT INTO knowledge (
                id, title, summary, body, tags, source, project,
                do_list, dont_list, links, status,
                created_by, updated_by, created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(id) DO UPDATE SET
                title=excluded.title,
                summary=excluded.summary,
                body=excluded.body,
                tags=excluded.tags,
                source=excluded.source,
                project=excluded.project,
                do_list=excluded.do_list,
                dont_list=excluded.dont_list,
                links=excluded.links,
                status=excluded.status,
                updated_by=excluded.updated_by,
                updated_at=excluded.updated_at
            """,
            (
                kid,
                title,
                summary,
                body or "",
                tags,
                args.source or "",
                args.project or "",
                args.do or "",
                args.dont or "",
                args.links or "",
                args.status or "active",
                by,
                by,
                now,
                now,
            ),
        )
        conn.commit()
        print(f"[ok] knowledge id={kid} title={title}")
    finally:
        conn.close()


def cmd_know_list(args):
    limit = max(1, int(args.limit))
    summary_chars = max(20, int(args.summary_chars))
    clauses = []
    params = []
    status = args.status if args.status is not None else "active"
    if status and status != "all":
        clauses.append("status = ?")
        params.append(status)
    if args.project:
        clauses.append("project = ?")
        params.append(args.project)
    if args.tag:
        # loose: tag token appears in tags csv
        for t in args.tag.replace(";", ",").split(","):
            t = t.strip().lower()
            if not t:
                continue
            clauses.append(
                "(',' || lower(tags) || ',') LIKE ?"
            )
            params.append("%," + t + ",%")
    where = (" WHERE " + " AND ".join(clauses)) if clauses else ""
    sql = (
        "SELECT id, title, summary, tags, project, status, updated_at "
        f"FROM knowledge{where} ORDER BY updated_at DESC LIMIT ?"
    )
    params.append(limit)
    conn = connect(args.db)
    try:
        rows = conn.execute(sql, params).fetchall()
    finally:
        conn.close()
    if not rows:
        print("(no knowledge)")
        return
    print("# id | updated | project | tags | title | summary")
    for r in rows:
        sm = _one_line(r["summary"], summary_chars)
        print(
            f"{r['id']} | {r['updated_at']} | {r['project'] or '-'} | "
            f"{r['tags'] or '-'} | {r['title']} | {sm}"
        )
    print(f"[ok] listed {len(rows)} (limit={limit})")


def cmd_know_search(args):
    q = (args.query or "").strip()
    if not q:
        print("[error] query required", file=sys.stderr)
        sys.exit(1)
    limit = max(1, int(args.limit))
    summary_chars = max(20, int(args.summary_chars))
    like = f"%{q}%"
    status = args.status if args.status is not None else "active"
    clauses = [
        "(title LIKE ? OR summary LIKE ? OR body LIKE ? OR tags LIKE ? "
        "OR source LIKE ? OR project LIKE ? OR do_list LIKE ? OR dont_list LIKE ?)"
    ]
    params = [like] * 8
    if status and status != "all":
        clauses.append("status = ?")
        params.append(status)
    if args.project:
        clauses.append("project = ?")
        params.append(args.project)
    where = " WHERE " + " AND ".join(clauses)
    sql = (
        "SELECT id, title, summary, tags, project, status, updated_at "
        f"FROM knowledge{where} ORDER BY updated_at DESC LIMIT ?"
    )
    params.append(limit)
    conn = connect(args.db)
    try:
        rows = conn.execute(sql, params).fetchall()
    finally:
        conn.close()
    if not rows:
        print("(no matches)")
        return
    print(f"# search q={q!r}")
    print("# id | updated | project | tags | title | summary")
    for r in rows:
        sm = _one_line(r["summary"], summary_chars)
        print(
            f"{r['id']} | {r['updated_at']} | {r['project'] or '-'} | "
            f"{r['tags'] or '-'} | {r['title']} | {sm}"
        )
    print(f"[ok] matches {len(rows)} (limit={limit})")


def cmd_know_read(args):
    kid = args.id
    body_chars = 0 if args.full else max(200, int(args.body_chars))
    conn = connect(args.db)
    try:
        row = conn.execute(
            "SELECT * FROM knowledge WHERE id = ?", (kid,)
        ).fetchone()
        if not row:
            print(f"[error] knowledge id={kid} not found", file=sys.stderr)
            sys.exit(1)
        print(f"id:        {row['id']}")
        print(f"title:     {row['title']}")
        print(f"status:    {row['status']}")
        print(f"project:   {row['project'] or ''}")
        print(f"tags:      {row['tags'] or ''}")
        print(f"source:    {row['source'] or ''}")
        print(f"links:     {row['links'] or ''}")
        print(f"created:   {row['created_at']} by {row['created_by'] or ''}")
        print(f"updated:   {row['updated_at']} by {row['updated_by'] or ''}")
        print("--- summary ---")
        print(row["summary"] or "")
        if row["do_list"]:
            print("--- do ---")
            print(row["do_list"])
        if row["dont_list"]:
            print("--- dont ---")
            print(row["dont_list"])
        body = row["body"] or ""
        if body:
            print("--- body ---")
            print(body if args.full else _truncate_body(body, body_chars))
    finally:
        conn.close()


def cmd_know_archive(args):
    kid = args.id
    now = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    by = args.by or "Nova"
    conn = connect(args.db)
    try:
        cur = conn.cursor()
        row = cur.execute(
            "SELECT id, status FROM knowledge WHERE id = ?", (kid,)
        ).fetchone()
        if not row:
            print(f"[error] knowledge id={kid} not found", file=sys.stderr)
            sys.exit(1)
        cur.execute(
            """
            UPDATE knowledge
            SET status = 'archived', updated_by = ?, updated_at = ?
            WHERE id = ?
            """,
            (by, now, kid),
        )
        conn.commit()
        print(f"[ok] archived id={kid}")
    finally:
        conn.close()


def build_parser():
    p = argparse.ArgumentParser(
        prog="aether_cli",
        description="Aether Board CLI - DB is source of truth; DSL is projection",
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

    sm = sub.add_parser("msg", help="Message commands (thin inbox; never dump full history)")
    sm_sub = sm.add_subparsers(dest="msg_cmd", required=True)

    sms = sm_sub.add_parser("send", help="Insert a chat message")
    sms.add_argument("--from", dest="sender", required=True)
    sms.add_argument("--to", dest="receiver", required=True)
    sms.add_argument("--text", default="")
    sms.add_argument("--file", default=None, help="Read body from file")
    sms.add_argument("--board", default="meta", help="board_id (default: meta for cross-board mail)")
    sms.add_argument("--type", default="chat", dest="type")
    sms.add_argument("--no-index", action="store_true", help="Skip ai_board.md refresh")

    sml = sm_sub.add_parser("list", help="List messages with LIMIT (summaries only)")
    sml.add_argument("--to", dest="to", default=None, help="Filter receiver (e.g. Nova)")
    sml.add_argument("--from", dest="sender", default=None, help="Filter sender")
    sml.add_argument("--board", default=None, help="Filter board_id")
    sml.add_argument("--unread", action="store_true", help="Only is_read=0")
    sml.add_argument("--after-id", dest="after_id", type=int, default=None, help="Only id > N")
    sml.add_argument("--limit", type=int, default=DEFAULT_MSG_LIMIT, help=f"Max rows (default {DEFAULT_MSG_LIMIT})")
    sml.add_argument(
        "--summary-chars",
        type=int,
        default=DEFAULT_SUMMARY_CHARS,
        help=f"Summary width (default {DEFAULT_SUMMARY_CHARS})",
    )

    smr = sm_sub.add_parser("read", help="Read one message body (truncated by default)")
    smr.add_argument("id", type=int, help="Message id")
    smr.add_argument("--mark-read", action="store_true", help="Set is_read=1 after show")
    smr.add_argument(
        "--body-chars",
        type=int,
        default=DEFAULT_BODY_CHARS,
        help=f"Body truncate length (default {DEFAULT_BODY_CHARS})",
    )
    smr.add_argument("--full", action="store_true", help="No body truncation")

    sm_sub.add_parser("index", help="Rebuild post/ai_board.md from DB")

    ss = sub.add_parser("sync", help="One sync cycle (default export-only)")
    ss.add_argument(
        "--allow-file-import",
        action="store_true",
        help="Allow File->DB when file is newer",
    )

    sk = sub.add_parser(
        "knowledge",
        aliases=["know"],
        help="AI insight store (independent of canvas nodes; thin list/search/read)",
    )
    sk_sub = sk.add_subparsers(dest="know_cmd", required=True)

    ska = sk_sub.add_parser("add", help="Add or replace a distilled insight")
    ska.add_argument("--id", default=None, help="Stable id (default KNOW-YYYYMMDD-NN)")
    ska.add_argument("--title", required=True)
    ska.add_argument("--summary", default="", help="1-3 line reusable summary")
    ska.add_argument("--body", default="", help="Optional medium body")
    ska.add_argument("--body-file", dest="body_file", default=None)
    ska.add_argument("--tags", default="", help="Comma-separated tags")
    ska.add_argument("--source", default="", help="Where this came from")
    ska.add_argument("--project", default="", help="e.g. AEGIS, aether, house")
    ska.add_argument("--do", default="", dest="do", help="Do list (newline or ; )")
    ska.add_argument("--dont", default="", dest="dont", help="Don't list")
    ska.add_argument("--links", default="", help="Paths or refs, comma-separated")
    ska.add_argument("--status", default="active", choices=["active", "draft", "archived"])
    ska.add_argument("--by", default="Nova", help="Author agent")
    ska.add_argument("--force", action="store_true", help="Replace if id exists")

    skl = sk_sub.add_parser("list", help="List insights (summaries only, LIMIT)")
    skl.add_argument("--tag", default=None, help="Filter tag(s), comma = AND")
    skl.add_argument("--project", default=None)
    skl.add_argument(
        "--status",
        default="active",
        help="active|draft|archived|all (default active)",
    )
    skl.add_argument("--limit", type=int, default=DEFAULT_KNOW_LIMIT)
    skl.add_argument(
        "--summary-chars",
        type=int,
        default=DEFAULT_KNOW_SUMMARY_CHARS,
    )

    sks = sk_sub.add_parser("search", help="Full-text-ish search (LIKE, LIMIT)")
    sks.add_argument("query")
    sks.add_argument("--project", default=None)
    sks.add_argument("--status", default="active")
    sks.add_argument("--limit", type=int, default=DEFAULT_KNOW_LIMIT)
    sks.add_argument(
        "--summary-chars",
        type=int,
        default=DEFAULT_KNOW_SUMMARY_CHARS,
    )

    skr = sk_sub.add_parser("read", help="Read one insight (body truncated unless --full)")
    skr.add_argument("id")
    skr.add_argument(
        "--body-chars",
        type=int,
        default=DEFAULT_KNOW_BODY_CHARS,
    )
    skr.add_argument("--full", action="store_true")

    skar = sk_sub.add_parser("archive", help="Set status=archived")
    skar.add_argument("id")
    skar.add_argument("--by", default="Nova")

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
        elif args.msg_cmd == "list":
            cmd_msg_list(args)
        elif args.msg_cmd == "read":
            cmd_msg_read(args)
        elif args.msg_cmd == "index":
            cmd_msg_index(args)
        else:
            print(f"[error] unknown msg command: {args.msg_cmd}", file=sys.stderr)
            sys.exit(1)
    elif cmd in ("knowledge", "know"):
        if args.know_cmd == "add":
            cmd_know_add(args)
        elif args.know_cmd == "list":
            cmd_know_list(args)
        elif args.know_cmd == "search":
            cmd_know_search(args)
        elif args.know_cmd == "read":
            cmd_know_read(args)
        elif args.know_cmd == "archive":
            cmd_know_archive(args)
        else:
            print(f"[error] unknown knowledge command: {args.know_cmd}", file=sys.stderr)
            sys.exit(1)
    elif cmd == "sync":
        cmd_sync(args)
    else:
        parser.print_help()
        sys.exit(1)


if __name__ == "__main__":
    main()
