# -*- coding: utf-8 -*-
"""One-shot seed: migrate knowledge_hub sticky pointers into knowledge table."""
import subprocess
import sys
import os

HERE = os.path.dirname(os.path.abspath(__file__))
CLI = os.path.join(HERE, "aether_cli.py")


def run(args):
    cmd = [sys.executable, "-X", "utf8", CLI] + args
    print("+", " ".join(cmd))
    r = subprocess.run(cmd, cwd=HERE)
    if r.returncode != 0:
        sys.exit(r.returncode)


ITEMS = [
    {
        "id": "KNOW_AEGIS_HMM",
        "title": "AEGIS: HMMは核にならず、実効は先行ブレーキ",
        "summary": "1D HMMはP_safe≈1に張り付き方向予測ゼロ。対BH劣後の主因は摩擦と機会損失。効くレバーはブレーキ側(thr/cap/mom)。",
        "tags": "aegis,hmm,trading,friction,brake",
        "project": "AEGIS",
        "source": "VERIFY_HMM.md / PHASE12_RESULTS.md / knowledge_hub sticky",
        "links": "projects/AEGIS/VERIFY_HMM.md,projects/AEGIS/PHASE12_RESULTS.md,projects/AEGIS/NEXT.md",
        "do": "ブレーキパラメータ(thr/cap/mom/deadband)を先に測る; 営業日ズレは0.0%処理; 性能はret/BHとDD/BHで比較表に残す",
        "dont": "P_safe直写を主戦術にする; 摩擦0.05%を無視した机上最適化; 多変量HMMを未検証のまま既定にする",
        "body": """## Problem
AEGIS の「多変量HMM動的ブレーキ」は、実装上 1D log-return HMM に落ち、P_safe がほぼ常時 1.0。
ポジション制御の実効は米国先行ブレーキ。dynamic は BH に対しリターン劣後・DD は改善。

## Insight
- corr(P_safe, next_ret) ≈ 0 / 翌日ボラとは弱い負相関のみ
- close_reentry の close_hmm は事実上死んでいる
- Phase1: thr=-1.2%, cap=0.7, mom → ret/BH≈0.87 が既定候補
- Phase2 uni vol は低DD向け。multi HMM は不安定で非推奨
- 摩擦コストは小さく見えて累積で破壊的

## Do / Don't
上記 do_list / dont_list を運用の正とする。

## Refs
projects/AEGIS/VERIFY_HMM.md, PHASE12_RESULTS.md, NEXT.md
""",
    },
    {
        "id": "KNOW_AETHER_ARCH",
        "title": "AetherBoard: DB正本・差分・薄いinbox",
        "summary": "正本はaether.db。DSLはLIVE投影のみ。messagesはlimit付きlist/read。起動時にDB/DSL全走査しない。Windowsはpython -X utf8。",
        "tags": "aether,board,context,cli,windows",
        "project": "aether",
        "source": "house_ops / aether_board README / Ellie #6",
        "links": "aether/aether_board/README.md,docs/house_ops.md,aether/SKILL.md",
        "do": "書くのはCLI経由でDB; 読むのはlist/search/readにLIMIT; DSLはexport/project; 明示importのみFile→DB",
        "dont": "起動でaether_dsl全文やmessages全件; SELECT * without LIMIT; 巨大payloadをチャットに貼る",
        "body": """## Problem
キャンバス・手紙・作業メモを同じ経路で全文ロードするとコンテキストが爆発する。

## Insight
- AI正本 = SQLite (aether.db)
- Aether UI = 見る層（任意）
- DSL = LIVE用フィルム
- msg list --unread --limit 5 / msg read --full は明示時のみ
- 知見は knowledge テーブル（nodes と分離）

## Windows
コンソール文字化け回避: python -X utf8 aether_cli.py ...
""",
    },
    {
        "id": "KNOW_DVC_CONSENSUS",
        "title": "Deep Value Consensus (DVC): 事実と価値を分け、Caveatを残す",
        "summary": "事実認識と価値観を分離し、当事者意思の留保(Caveat)を含めた高次合意パッケージにする。",
        "tags": "dvc,consensus,governance,caveat",
        "project": "succession_navi",
        "source": "knowledge_hub / succession work",
        "links": "aether board succession_navi",
        "do": "claim / evidence / caveat を役割分けして残す; 合意と未解決を明示",
        "dont": "価値観を事実として固定する; 留保なしの断定を合意扱いする",
        "body": """## Insight
深層価値の合意は「正しい答えを一つに潰す」ことではなく、
事実レイヤと価値レイヤを分け、当事者が留保できる形でパッケージすること。

Board 上では role=claim|evidence|caveat|question がこの型の視覚化に使える。
知見ストアでは tags と do/dont に蒸留して再利用する。
""",
    },
    {
        "id": "KNOW_CO_CREATION",
        "title": "Living Knowledge & 分散開発 (Ellie設計 / Nova実装)",
        "summary": "設計と実装の分業でトークンを最適化。知見は生ログではなく蒸留してDBに残し、必要なときだけreadする。",
        "tags": "process,delm,knowledge,co-creation",
        "project": "house",
        "source": "Ellie #10 / CO_CREATION sticky",
        "links": "docs/house_ops.md,skills/delm-stable-process/SKILL.md",
        "do": "セッション区切りで知見を1件でも結晶化; knowledge add でsummary必須; 詳細はbodyかlinks",
        "dont": "dailyや手紙の生文をそのまま知見扱い; 起動時にknowledge全件ロード",
        "body": """## Insight
- Ellie: 設計・合意・地図
- Nova: 実装・検証・着地
- 共有の正本: AetherBoard DB（messages / knowledge / nodesは用途分離）
- 人格の結晶は各家 memories（HITL）。Boardの知見とは混ぜない

## Knowledge intake
原料: 検証メモ・失敗・再現手順
製品: title + summary(+ do/dont) + tags + links
""",
    },
]


def main():
    for it in ITEMS:
        args = [
            "knowledge",
            "add",
            "--id",
            it["id"],
            "--title",
            it["title"],
            "--summary",
            it["summary"],
            "--tags",
            it["tags"],
            "--project",
            it["project"],
            "--source",
            it["source"],
            "--links",
            it["links"],
            "--do",
            it["do"],
            "--dont",
            it["dont"],
            "--body",
            it["body"],
            "--by",
            "Nova",
            "--force",
        ]
        run(args)
    run(["knowledge", "list", "--limit", "10"])
    run(["status"])


if __name__ == "__main__":
    main()
