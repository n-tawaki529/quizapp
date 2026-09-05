"""
200人程度の同時接続を想定した簡易負荷テストスクリプト。

使い方:
    python scripts/load_test.py --base-url http://localhost:8000 --event-id <UUID> --num-participants 200

事前準備:
    1. 管理者で大会を作成し、問題を1問以上登録しておく
    2. 大会のUUIDを --event-id に指定する
    3. このスクリプト実行後、管理者画面で「次の問題へ」→「回答開始」を押すと、
       接続中の全参加者が同時に回答を送信し、応答時間を計測する。

このスクリプトは追加の依存ライブラリを増やさないよう、
標準ライブラリ(urllib, asyncio)と backend が既に依存している websockets のみを使用する。
"""
from __future__ import annotations

import argparse
import asyncio
import json
import random
import time
import urllib.request

import websockets


def http_post(url: str, body: dict, token: str | None = None) -> dict:
    data = json.dumps(body).encode("utf-8")
    headers = {"Content-Type": "application/json"}
    if token:
        headers["Authorization"] = f"Bearer {token}"
    req = urllib.request.Request(url, data=data, headers=headers, method="POST")
    with urllib.request.urlopen(req) as resp:
        return json.loads(resp.read().decode("utf-8"))


async def simulate_participant(idx: int, base_url: str, ws_base: str, event_id: str, stats: dict) -> None:
    name = f"load-test-{idx}"
    try:
        join = await asyncio.to_thread(http_post, f"{base_url}/api/events/{event_id}/join", {"name": name})
    except Exception as e:
        stats["join_failed"] += 1
        return

    participant_id = join["participant_id"]
    token = join["token"]
    uri = f"{ws_base}/ws/events/{event_id}?role=participant&participant_id={participant_id}"

    try:
        async with websockets.connect(uri, open_timeout=10) as ws:
            stats["connected"] += 1
            answered_question_id = None
            while True:
                try:
                    raw = await asyncio.wait_for(ws.recv(), timeout=60)
                except asyncio.TimeoutError:
                    break
                msg = json.loads(raw)
                if msg.get("phase") == "ANSWER_OPEN" and msg.get("question"):
                    qid = msg["question"]["id"]
                    if qid == answered_question_id:
                        continue
                    answered_question_id = qid
                    await asyncio.sleep(random.uniform(0.1, 2.0))
                    choice = random.choice(["A", "B", "C", "D"])
                    start = time.time()
                    try:
                        await asyncio.to_thread(
                            http_post,
                            f"{base_url}/api/events/{event_id}/answer",
                            {"participant_id": participant_id, "question_id": qid, "choice": choice},
                            token,
                        )
                        stats["answers_ok"] += 1
                        stats["answer_latency_sum"] += time.time() - start
                    except Exception:
                        stats["answers_failed"] += 1
    except Exception:
        stats["ws_failed"] += 1


async def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--base-url", default="http://localhost:8000")
    parser.add_argument("--event-id", required=True)
    parser.add_argument("--num-participants", type=int, default=200)
    args = parser.parse_args()

    ws_base = args.base_url.replace("http", "ws", 1)
    stats = {
        "connected": 0,
        "join_failed": 0,
        "ws_failed": 0,
        "answers_ok": 0,
        "answers_failed": 0,
        "answer_latency_sum": 0.0,
    }

    tasks = [
        simulate_participant(i, args.base_url, ws_base, args.event_id, stats)
        for i in range(args.num_participants)
    ]
    print(f"{args.num_participants}人の参加者接続をシミュレートします。管理者画面から進行してください。")
    await asyncio.gather(*tasks)

    print("---- 結果 ----")
    print(stats)
    if stats["answers_ok"]:
        print(f"平均回答APIレイテンシ: {stats['answer_latency_sum'] / stats['answers_ok']:.3f}秒")


if __name__ == "__main__":
    asyncio.run(main())
