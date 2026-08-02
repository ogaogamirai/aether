#!/usr/bin/env python3
# Round-trip test: DB export -> import to temp board -> export -> compare counts
# Usage: python test_roundtrip.py

import os
import sys
import tempfile
import sqlite3

import aether_generator
import aether_parser

HERE = os.path.dirname(os.path.abspath(__file__))
DB = os.path.join(HERE, "aether.db")
SOURCE_BOARD = "succession_navi"
TEMP_BOARD = "_roundtrip_test"


def counts(conn, board_id):
    cur = conn.cursor()
    n = cur.execute("SELECT COUNT(*) FROM nodes WHERE board_id=?", (board_id,)).fetchone()[0]
    r = cur.execute("SELECT COUNT(*) FROM relations WHERE board_id=?", (board_id,)).fetchone()[0]
    types = cur.execute(
        "SELECT type, COUNT(*) FROM nodes WHERE board_id=? GROUP BY type ORDER BY type",
        (board_id,),
    ).fetchall()
    return n, r, dict(types)


def main():
    if not os.path.exists(DB):
        print("FAIL: aether.db not found", file=sys.stderr)
        return 1

    conn = sqlite3.connect(DB)
    try:
        n0, r0, t0 = counts(conn, SOURCE_BOARD)
        if n0 == 0:
            print(f"FAIL: source board '{SOURCE_BOARD}' empty", file=sys.stderr)
            return 1
        print(f"[1] source {SOURCE_BOARD}: nodes={n0} relations={r0} types={t0}")

        with tempfile.TemporaryDirectory() as td:
            dsl1 = os.path.join(td, "export1.txt")
            dsl2 = os.path.join(td, "export2.txt")

            if not aether_generator.generate_dsl(DB, SOURCE_BOARD, dsl1):
                print("FAIL: export1", file=sys.stderr)
                return 1
            size1 = os.path.getsize(dsl1)
            print(f"[2] export1 ok ({size1} bytes)")

            # wipe temp board
            cur = conn.cursor()
            cur.execute("DELETE FROM nodes WHERE board_id=?", (TEMP_BOARD,))
            cur.execute("DELETE FROM relations WHERE board_id=?", (TEMP_BOARD,))
            conn.commit()

            if not aether_parser.parse_dsl_to_db(DB, TEMP_BOARD, dsl1):
                print("FAIL: import", file=sys.stderr)
                return 1
            n1, r1, t1 = counts(conn, TEMP_BOARD)
            print(f"[3] import -> {TEMP_BOARD}: nodes={n1} relations={r1} types={t1}")

            if not aether_generator.generate_dsl(DB, TEMP_BOARD, dsl2):
                print("FAIL: export2", file=sys.stderr)
                return 1
            size2 = os.path.getsize(dsl2)
            print(f"[4] export2 ok ({size2} bytes)")

            # cleanup temp board
            cur.execute("DELETE FROM nodes WHERE board_id=?", (TEMP_BOARD,))
            cur.execute("DELETE FROM relations WHERE board_id=?", (TEMP_BOARD,))
            conn.commit()
            print(f"[5] cleaned {TEMP_BOARD}")

        # Allow small drift in relation ids but node/rel counts must match
        ok = n0 == n1 and r0 == r1
        if ok:
            print("PASS: node/relation counts preserved on round-trip")
            return 0
        print(
            f"FAIL: count mismatch source nodes/rels={n0}/{r0} vs roundtrip={n1}/{r1}",
            file=sys.stderr,
        )
        return 1
    finally:
        conn.close()


if __name__ == "__main__":
    sys.exit(main())
