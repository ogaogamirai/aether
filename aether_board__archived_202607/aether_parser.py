import sqlite3
import os
import re
import json
import sys

# 各定義ブロックを抽出するための正規表現
BLOCK_re = re.compile(
    r'(sticky|drawing|callout|path|relation)\s+(\S+)?\s*(?:"([^"]*)")?\s*([^->{\s]+)?\s*(?:->\s*(\S+))?\s*\{([^}]*)\}',
    re.DOTALL
)

# 単純接続（A -> B）を抽出するための正規表現（コメントアウト行以外）
SIMPLE_RELATION_re = re.compile(r'^\s*(\S+)\s*->\s*(\S+)\s*$', re.MULTILINE)

def parse_dsl_to_db(db_path, board_id, dsl_path):
    print(f"[Aether Parser] Parsing DSL file {dsl_path} to DB '{board_id}'...")
    if not os.path.exists(dsl_path):
        print(f"[Aether Parser] Error: DSL file not found at {dsl_path}", file=sys.stderr)
        return False
        
    with open(dsl_path, "r", encoding="utf-8") as f:
        content = f.read()
        
    conn = sqlite3.connect(db_path)
    try:
        conn.execute("PRAGMA journal_mode=WAL;")
        conn.execute("PRAGMA busy_timeout = 5000;")
        cursor = conn.cursor()
        
        # トランザクション開始
        conn.execute("BEGIN TRANSACTION;")
        
        # 1. 既存の board_id に属するデータを一旦クリーンアップ (冪等性の確保)
        cursor.execute("DELETE FROM nodes WHERE board_id = ?;", (board_id,))
        cursor.execute("DELETE FROM relations WHERE board_id = ?;", (board_id,))
        
        relation_auto_idx = 1
        sort_order = 1
        
        # 2. finditer を用いて各マッチの正確な位置を基準に処理
        for match in BLOCK_re.finditer(content):
            btype = match.group(1)
            bid_or_from = match.group(2)
            title = match.group(3)
            detail_token = match.group(4)
            to_id = match.group(5)
            body_content = match.group(6)
            
            # 各ブロック内プロパティの辞書化
            props = {}
            lines = body_content.strip().split("\n")
            for line in lines:
                line = line.strip()
                if not line or line.startswith("#") or ":" not in line:
                    continue
                k, v = line.split(":", 1)
                k = k.strip()
                v = v.strip().strip('"').strip("'")
                props[k] = v
                
            # --- 各ブロックタイプに応じたDB格納 ---
            if btype == "sticky":
                sid = bid_or_from
                pos_x, pos_y = None, None
                if "pos" in props:
                    pos_parts = props["pos"].split()
                    if len(pos_parts) >= 2:
                        try:
                            pos_x, pos_y = float(pos_parts[0]), float(pos_parts[1])
                        except ValueError:
                            pass
                
                desc = props.get("desc", "").replace("\\n", "\n")
                
                std_keys = ("pos", "color", "role", "confidence", "time", "tone", "desc")
                ext_props = {k: (float(v) if v.replace('.', '', 1).isdigit() else v) for k, v in props.items() if k not in std_keys}
                ext_json = json.dumps(ext_props, ensure_ascii=False) if ext_props else None
                
                cursor.execute("""
                    INSERT OR REPLACE INTO nodes (
                        id, board_id, type, title, desc, pos_x, pos_y, color, role, confidence, time, tone, properties, sort_order
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);
                """, (
                    sid, board_id, "sticky", title or sid, desc, pos_x, pos_y,
                    props.get("color"), props.get("role"), props.get("confidence"),
                    props.get("time"), props.get("tone"), ext_json, sort_order
                ))
                sort_order += 1
                
            elif btype in ("drawing", "circle-area", "icon"):
                did = bid_or_from
                pos_x, pos_y = None, None
                if "pos" in props:
                    pos_parts = props["pos"].split()
                    if len(pos_parts) >= 2:
                        try:
                            pos_x, pos_y = float(pos_parts[0]), float(pos_parts[1])
                        except ValueError:
                            pass
                            
                offset_x, offset_y = 0, 0
                if "offset" in props:
                    off_parts = props["offset"].split()
                    if len(off_parts) >= 2:
                        try:
                            offset_x, offset_y = float(off_parts[0]), float(off_parts[1])
                        except ValueError:
                            pass
                            
                draw_type = props.get("type", btype)
                
                std_keys = ("type", "style", "targets", "anchor", "pos", "offset", "color", "tags", "time")
                ext_props = {k: v for k, v in props.items() if k not in std_keys}
                ext_props.update({
                    "type": draw_type,
                    "style": props.get("style", ""),
                    "targets": props.get("targets", ""),
                    "anchor": props.get("anchor", ""),
                    "offset_x": offset_x,
                    "offset_y": offset_y,
                    "tags": props.get("tags", "")
                })
                ext_json = json.dumps(ext_props, ensure_ascii=False)
                
                cursor.execute("""
                    INSERT OR REPLACE INTO nodes (
                        id, board_id, type, title, pos_x, pos_y, color, time, properties, sort_order
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?);
                """, (
                    did, board_id, draw_type, title or did, pos_x, pos_y,
                    props.get("color"), props.get("time"), ext_json, sort_order
                ))
                sort_order += 1
                
            elif btype == "callout":
                cid = bid_or_from
                offset_x, offset_y = 0, 0
                if "offset" in props:
                    off_parts = props["offset"].split()
                    if len(off_parts) >= 2:
                        try:
                            offset_x, offset_y = float(off_parts[0]), float(off_parts[1])
                        except ValueError:
                            pass
                            
                ext_props = {
                    "anchor": props.get("anchor", ""),
                    "offset_x": offset_x,
                    "offset_y": offset_y,
                    "color": props.get("color", ""),
                    "tags": props.get("tags", ""),
                    "time": props.get("time", "")
                }
                ext_json = json.dumps(ext_props, ensure_ascii=False)
                
                cursor.execute("""
                    INSERT OR REPLACE INTO nodes (
                        id, board_id, type, title, color, time, properties, sort_order
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?);
                """, (
                    cid, board_id, "callout", title or cid, props.get("color"), props.get("time"), ext_json, sort_order
                ))
                sort_order += 1
                
            elif btype == "path":
                pid = bid_or_from
                ext_props = {
                    "nodes": props.get("nodes", ""),
                    "style": props.get("style", "pulse"),
                    "color": props.get("color", ""),
                    "tags": props.get("tags", ""),
                    "time": props.get("time", "")
                }
                ext_json = json.dumps(ext_props, ensure_ascii=False)
                
                cursor.execute("""
                    INSERT OR REPLACE INTO nodes (
                        id, board_id, type, title, color, time, properties, sort_order
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?);
                """, (
                    pid, board_id, "path", title or pid, props.get("color"), props.get("time"), ext_json, sort_order
                ))
                sort_order += 1
                
            elif btype == "relation":
                # match.group(0) 内の '{' の前（ヘッダー行）を抽出して確実に from -> to をパースする
                header_part = match.group(0).split('{')[0].strip()
                # header_part: "relation [ID] from -> to" または "relation from -> to"
                
                # "relation" 単語を除去してトリミング
                rel_parts_str = header_part.replace("relation", "").strip()
                # rel_parts_str: "GOAL -> TERM_TITLE" または "REL_ID GOAL -> TERM_TITLE"
                
                rid = None
                from_node = None
                to_node = None
                
                left_right = rel_parts_str.split("->")
                if len(left_right) == 2:
                    left_side = left_right[0].strip()
                    to_node = left_right[1].strip()
                    
                    left_tokens = left_side.split()
                    if len(left_tokens) >= 2:
                        # 左辺にスペースがある場合 ➔ [ID] [from]
                        rid = left_tokens[0]
                        from_node = " ".join(left_tokens[1:])
                    elif len(left_tokens) == 1:
                        # 左辺が1単語 ➔ [from]
                        rid = None
                        from_node = left_tokens[0]
                else:
                    # fallback (マッチが取れない場合)
                    rid = bid_or_from
                    from_node = detail_token or bid_or_from
                    to_node = to_id
                
                if not rid:
                    rid = f"auto_rel_{relation_auto_idx}"
                    relation_auto_idx += 1
                    
                weight_val = 1
                if "weight" in props:
                    try:
                        weight_val = int(props["weight"])
                    except ValueError:
                        pass
                
                cursor.execute("""
                    INSERT OR REPLACE INTO relations (
                        id, board_id, from_id, to_id, type, label, color, weight, flow, time, sort_order
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);
                """, (
                    rid, board_id, from_node, to_node,
                    props.get("type", "default"), props.get("label"), props.get("color"),
                    weight_val, props.get("flow"), props.get("time"), sort_order
                ))
                sort_order += 1

        # 3. 単純接続（A -> B）のパース (コメント行除外)
        clean_content = "\n".join(line for line in content.split("\n") if not line.strip().startswith("#"))
        simple_rels = SIMPLE_RELATION_re.findall(clean_content)
        for rel in simple_rels:
            from_node, to_node = rel
            cursor.execute(
                "SELECT 1 FROM relations WHERE board_id = ? AND from_id = ? AND to_id = ?;",
                (board_id, from_node, to_node)
            )
            if not cursor.fetchone():
                rid = f"auto_rel_{relation_auto_idx}"
                relation_auto_idx += 1
                cursor.execute("""
                    INSERT OR REPLACE INTO relations (id, board_id, from_id, to_id, type, sort_order)
                    VALUES (?, ?, ?, ?, 'default', ?);
                """, (rid, board_id, from_node, to_node, sort_order))
                sort_order += 1
                
        conn.commit()
        print(f"[Aether Parser] Successfully parsed DSL into DB tables. (Items: {sort_order-1})")
        return True
        
    except Exception as e:
        conn.rollback()
        print(f"[Aether Parser] Parse error: {e}", file=sys.stderr)
        import traceback
        traceback.print_exc()
        return False
    finally:
        conn.close()

if __name__ == "__main__":
    current_dir = os.path.dirname(os.path.abspath(__file__))
    db_path = os.path.join(current_dir, "aether.db")
    dsl_path = os.path.join(os.path.dirname(current_dir), "aether_dsl.txt")
    parse_dsl_to_db(db_path, "succession_navi", dsl_path)
