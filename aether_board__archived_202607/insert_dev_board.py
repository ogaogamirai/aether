import sqlite3
import json
import os
import aether_generator

def build_dev_board(db_path):
    print("[Aether Dev Board] Inserting comprehensive roadmap, decisions, and history...")
    conn = sqlite3.connect(db_path)
    try:
        conn.execute("PRAGMA journal_mode=WAL;")
        conn.execute("PRAGMA busy_timeout = 5000;")
        cursor = conn.cursor()
        
        board_id = "aether_board_dev"
        
        # 既存データをクリア
        cursor.execute("DELETE FROM nodes WHERE board_id = ?;", (board_id,))
        cursor.execute("DELETE FROM relations WHERE board_id = ?;", (board_id,))
        
        nodes = [
            # =====================================================
            # 1. 構想と目的
            # =====================================================
            ("GOAL", "sticky", "Aether Board System 開発ロードマップ", 
             "SQLiteを中核とし、AI同士の非同期対話（ポスト）とAetherビジュアル表現を双方向同期させる次世代協調インフラの開発状況。",
             500, 50, "blue", "claim", "high", "1_構想", "excited"),
             
            # =====================================================
            # 2. 歴史・経緯 (History)
            # =====================================================
            ("HIST_1", "sticky", "2026-07-16: アイデアの誕生", 
             "■ 経緯:\n・キャプテンより『Aetherをそのままに、裏にSQLiteを置いてAI同士の非同期掲示板にする』という着想が提示される。\n・『AIポスト』『増分要約』の方向性がブレストで合意される。",
             850, 180, "pink", "evidence", "high", "1_構想", "stable"),
             
            ("HIST_2", "sticky", "2026-07-17 05:40: 開発開始とバグ修復", 
             "■ 経緯:\n・クリーンなサブフォルダ分離設計で開発開始。\n・初回の同期テストで『関係線の欠落（上書き消失）』と『定義順序の崩壊』を検知し、パーサーとソート処理を即時修復。",
             850, 360, "pink", "evidence", "high", "2_実装", "stable"),

            # =====================================================
            # 3. 設計判断 (Decisions)
            # =====================================================
            ("DEC_1", "sticky", "意思決定: サブフォルダによる分離", 
             "■ 決定背景:\nブラウザ側の静的UIアセットと、バックエンドのPython/DBロジックが混ざり合うのを防ぐため、`aether_board/` という専用フォルダに分離し、クリーンな開発スペースを確保した。",
             500, 220, "orange", "claim", "high", "1_構想", "stable"),

            ("DEC_2", "sticky", "意思決定: ヘッダー同期ポスト", 
             "■ 決定背景:\nAIの手紙の本文をそのままポスト用Markdownに追記するとファイルが肥大化するため、[ai_board.md] には『見出しとメタデータ』のみを軽量に追記し、本文はDBで一元管理する設計にした。",
             500, 380, "orange", "claim", "high", "1_構想", "stable"),

            ("DEC_3", "sticky", "意思決定: sort_order 列の導入", 
             "■ 決定背景:\nDBがアルファベットID順でDSLを吐き出すと可読性が壊れるため、ファイル記述順（定義順）を記憶する `sort_order` 列を導入し、インポート/エクスポートの一貫性を100%保証した。",
             500, 540, "orange", "claim", "high", "2_実装", "stable"),

            # =====================================================
            # 4. 実装ステップ
            # =====================================================
            ("STEP1", "sticky", "Step 1: データベース設計と初期化", 
             "・nodes, relations, messages, aether_state テーブルの定義。\n・多重ボード(`board_id`)および拡張プロパティのサポート。",
             150, 200, "green", "evidence", "high", "2_実装", "stable"),
             
            ("STEP2", "sticky", "Step 2: DB ➔ DSL 自動コンパイラ", 
             "・DBの構造化レコードから `aether_dsl.txt` の構文を自動組み立て出力する generator の開発。",
             150, 360, "green", "evidence", "high", "2_実装", "stable"),
             
            ("STEP3", "sticky", "Step 3: DSL ➔ DB 逆同期パーサー", 
             "・物理ファイルの変更をDBに逆インポート。\n・re.finditer と文字列『->』分割による堅牢な関係線パースロジックへの改善。",
             150, 520, "green", "evidence", "high", "2_実装", "stable"),
             
            ("STEP4", "sticky", "Step 4: 双方向同期デーモン ＆ ポスト同期", 
             "・mtimeタイムスタンプ比較による安全な双方向同期機能の実装。\n・[post/ai_board.md] ポストインデックスファイルの生成統合。",
             150, 680, "green", "evidence", "high", "2_実装", "stable"),
             
            ("STEP5", "sticky", "Step 5: 順序保存機能 (Refining)", 
             "・`sort_order` のDB格納とジェネレータへのソート適用によるインポート/エクスポート順の完全同期確認。",
             150, 840, "green", "evidence", "high", "2_実装", "stable"),
             
            # =====================================================
            # 5. 将来展望 (Future)
            # =====================================================
            ("FUTURE1", "sticky", "将来展望: 自動要約・構造化エンジン", 
             "■ 状態: 未着手 (Backlog)\n\n・一定の会話区切りでLLMが要約ノードを生成し、関連メッセージへリンクを張る自律要約機能の構築。\n・コンテキスト負荷の最小化のコア。",
             800, 560, "purple", "question", "mid", "3_展望", "tension"),
             
            ("FUTURE2", "sticky", "将来展望: AI間コミュニケーション本格稼働", 
             "■ 状態: 未着手 (Backlog)\n\n・エリーとノヴァが実際にDBポストを通じて開発タスクやブレストの進捗をリレー・協調動作する実証実験。",
             800, 720, "purple", "question", "mid", "3_展望", "tension")
        ]
        
        sort_order = 1
        for n in nodes:
            cursor.execute("""
                INSERT OR REPLACE INTO nodes (
                    id, board_id, type, title, desc, pos_x, pos_y, color, role, confidence, time, tone, sort_order
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);
            """, (
                n[0], board_id, n[1], n[2], n[3], n[4], n[5], n[6], n[7], n[8], n[9], n[10], sort_order
            ))
            sort_order += 1
            
        relations = [
            # 構想から意思決定へ
            ("rel_goal_dec1", "GOAL", "DEC_1", "default", "設計判断", "blue", 2, "forward"),
            ("rel_goal_dec2", "GOAL", "DEC_2", "default", "設計判断", "blue", 2, "forward"),
            ("rel_goal_dec3", "GOAL", "DEC_3", "default", "設計判断", "blue", 2, "forward"),
            
            # 意思決定から実装ステップへ
            ("rel_dec1_s1", "DEC_1", "STEP1", "influence", "モジュール分離適用", "orange", 2, ""),
            ("rel_dec2_s4", "DEC_2", "STEP4", "influence", "ポストインデックス実装", "orange", 2, ""),
            ("rel_dec3_s5", "DEC_3", "STEP5", "influence", "並び順インデックス実装", "orange", 2, ""),
            
            # 実装ステップの順序
            ("rel_s1_s2", "STEP1", "STEP2", "default", "コンパイル", "green", 2, "forward"),
            ("rel_s2_s3", "STEP2", "STEP3", "default", "パース", "green", 2, "forward"),
            ("rel_s3_s4", "STEP3", "STEP4", "default", "デーモン", "green", 2, "forward"),
            ("rel_s4_s5", "STEP4", "STEP5", "default", "チューニング", "green", 2, "forward"),
            
            # 歴史からステップへの接続
            ("rel_h1_dec1", "HIST_1", "DEC_1", "influence", "構想を決定へ", "pink", 1, ""),
            ("rel_h1_dec2", "HIST_1", "DEC_2", "influence", "構想を決定へ", "pink", 1, ""),
            ("rel_h2_s3", "HIST_2", "STEP3", "influence", "バグ修正トリガー", "pink", 2, ""),
            
            # 展望へ
            ("rel_goal_f1", "GOAL", "FUTURE1", "influence", "要約の自動化", "purple", 2, "forward"),
            ("rel_f1_f2", "FUTURE1", "FUTURE2", "influence", "自律協調へ", "purple", 2, "forward")
        ]
        
        for r in relations:
            rid, from_id, to_id, rtype, label, color, weight, flow = r
            cursor.execute("""
                INSERT OR REPLACE INTO relations (
                    id, board_id, from_id, to_id, type, label, color, weight, flow, sort_order
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?);
            """, (rid, board_id, from_id, to_id, rtype, label, color, weight, flow, sort_order))
            sort_order += 1
            
        conn.commit()
        print("[Aether Dev Board] Database insertion successful.")
        return True
    except Exception as e:
        print(f"[Aether Dev Board] Error: {e}")
        return False
    finally:
        conn.close()

if __name__ == "__main__":
    current_dir = os.path.dirname(os.path.abspath(__file__))
    db_path = os.path.join(current_dir, "aether.db")
    if build_dev_board(db_path):
        output_path = os.path.join(os.path.dirname(current_dir), "aether_dsl_aether_board.txt")
        aether_generator.generate_dsl(db_path, "aether_board_dev", output_path)
