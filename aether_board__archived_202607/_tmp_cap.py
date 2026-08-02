# -*- coding: utf-8 -*-
import sqlite3
import json
import sys

sys.stdout.reconfigure(encoding="utf-8")
c = sqlite3.connect("aether.db")
c.row_factory = sqlite3.Row

print("=== msg 12 ===")
row = c.execute("SELECT * FROM messages WHERE id=12").fetchone()
if row:
    p = json.loads(row["payload"])
    print(p.get("text", p))

print("\n=== knowledge CAPTAIN / related ===")
for r in c.execute(
    "SELECT id, title, summary, tags, project, body, do_list, dont_list, links, source "
    "FROM knowledge WHERE id LIKE 'KNOW_CAPTAIN%' OR lower(tags) LIKE '%captain%' "
    "OR title LIKE '%キャプテン%' OR summary LIKE '%キャプテン%'"
):
    print("---", r["id"], "---")
    for k in r.keys():
        print(f"{k}: {r[k]}")

print("\n=== all knowledge ids ===")
for r in c.execute("SELECT id, title, tags FROM knowledge WHERE status='active' ORDER BY id"):
    print(r["id"], "|", r["title"], "|", r["tags"])
