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
import math
import random
import time
import urllib.error
import urllib.request
from collections import Counter

import websockets


HTTP_TIMEOUT_SECONDS = 10


def http_post(url: str, body: dict, token: str | None = None) -> dict:
    data = json.dumps(body).encode("utf-8")
    headers = {"Content-Type": "application/json"}
    if token:
        headers["Authorization"] = f"Bearer {token}"
    req = urllib.request.Request(url, data=data, headers=headers, method="POST")
    with urllib.request.urlopen(req, timeout=HTTP_TIMEOUT_SECONDS) as resp:
        return json.loads(resp.read().decode("utf-8"))


def percentile(values: list[float], percentile_value: float) -> float | None:
    if not values:
        return None
    ordered = sorted(values)
    index = max(0, math.ceil(percentile_value / 100 * len(ordered)) - 1)
    return ordered[index]


def latency_summary(values: list[float]) -> dict[str, float | int | None]:
    return {
        "count": len(values),
        "average": sum(values) / len(values) if values else None,
        "p50": percentile(values, 50),
        "p95": percentile(values, 95),
        "p99": percentile(values, 99),
        "max": max(values) if values else None,
    }


def classify_http_error(error: BaseException) -> str:
    if isinstance(error, (TimeoutError, asyncio.TimeoutError, TimeoutError)):
        return "timeout"
    if isinstance(error, urllib.error.URLError) and isinstance(error.reason, TimeoutError):
        return "timeout"
    if isinstance(error, urllib.error.HTTPError):
        if 400 <= error.code < 500:
            return "4xx"
        if 500 <= error.code < 600:
            return "5xx"
    return "other"


async def simulate_participant(idx: int, base_url: str, ws_base: str, event_id: str, stats: dict) -> None:
    name = f"load-test-{idx}"
    try:
        join = await asyncio.to_thread(http_post, f"{base_url}/api/events/{event_id}/join", {"name": name})
    except Exception:
        stats["join_failed"] += 1
        return

    stats["join_succeeded"] += 1
    participant_id = join["participant_id"]
    token = join["token"]
    uri = f"{ws_base}/ws/events/{event_id}?role=participant&participant_id={participant_id}"

    connected = False
    normal_end = False
    try:
        async with websockets.connect(uri, open_timeout=10) as ws:
            connected = True
            stats["ws_connected"] += 1
            answered_question_id = None
            while True:
                try:
                    raw = await asyncio.wait_for(ws.recv(), timeout=60)
                except asyncio.TimeoutError:
                    normal_end = True
                    break
                msg = json.loads(raw)
                if msg.get("phase") == "ANSWER_OPEN" and msg.get("question"):
                    qid = msg["question"]["id"]
                    if qid == answered_question_id:
                        continue
                    answered_question_id = qid
                    await asyncio.sleep(random.uniform(0.1, 2.0))
                    choice_keys = msg["question"].get("choice_keys", [])
                    if not choice_keys:
                        stats["answers_failed"] += 1
                        stats["http_errors"]["other"] += 1
                        continue
                    choice = random.choice(choice_keys)
                    stats["answers_attempted"] += 1
                    start = time.perf_counter()
                    try:
                        result = await asyncio.to_thread(
                            http_post,
                            f"{base_url}/api/events/{event_id}/answer",
                            {"participant_id": participant_id, "question_id": qid, "choice": choice},
                            token,
                        )
                        elapsed = time.perf_counter() - start
                        if result.get("accepted") is True:
                            stats["answers_ok"] += 1
                            stats["accepted_latencies"].append(elapsed)
                        else:
                            stats["answers_rejected"] += 1
                            stats["rejected_reasons"][result.get("message") or "unspecified"] += 1
                            stats["rejected_latencies"].append(elapsed)
                    except urllib.error.HTTPError as error:
                        stats["answers_failed"] += 1
                        stats["http_errors"][classify_http_error(error)] += 1
                        stats["http_statuses"][error.code] += 1
                    except Exception as error:
                        stats["answers_failed"] += 1
                        stats["http_errors"][classify_http_error(error)] += 1
    except websockets.exceptions.ConnectionClosed:
        if normal_end:
            return
        if connected:
            stats["ws_disconnected"] += 1
        else:
            stats["ws_connect_failed"] += 1
    except Exception:
        if normal_end:
            return
        if connected:
            stats["ws_disconnected"] += 1
        else:
            stats["ws_connect_failed"] += 1


def print_latency_summary(label: str, values: list[float]) -> None:
    summary = latency_summary(values)
    print(label)
    for key in ("count", "average", "p50", "p95", "p99", "max"):
        value = summary[key]
        if isinstance(value, float):
            print(f"  {key}: {value:.3f}s")
        else:
            print(f"  {key}: {value if value is not None else '-'}")


def print_summary(stats: dict, elapsed: float) -> None:
    join_rate = stats["join_succeeded"] / stats["join_attempted"] if stats["join_attempted"] else 0
    answer_rate = stats["answers_ok"] / stats["answers_attempted"] if stats["answers_attempted"] else 0
    print("---- 結果 ----")
    print("Participants")
    print(f"  attempted: {stats['join_attempted']}")
    print(f"  joined: {stats['join_succeeded']}")
    print(f"  failed: {stats['join_failed']}")
    print(f"  success rate: {join_rate:.1%}")
    print("WebSocket")
    print(f"  connected: {stats['ws_connected']}")
    print(f"  connect failed: {stats['ws_connect_failed']}")
    print(f"  unexpected disconnected: {stats['ws_disconnected']}")
    print("Answers")
    print(f"  attempted: {stats['answers_attempted']}")
    print(f"  accepted: {stats['answers_ok']}")
    print(f"  rejected: {stats['answers_rejected']}")
    print(f"  failed: {stats['answers_failed']}")
    print(f"  success rate: {answer_rate:.1%}")
    print("HTTP errors")
    print(f"  timeout: {stats['http_errors']['timeout']}")
    print(f"  4xx: {stats['http_errors']['4xx']}")
    print(f"  5xx: {stats['http_errors']['5xx']}")
    print(f"  other: {stats['http_errors']['other']}")
    print(f"  status codes: {dict(sorted(stats['http_statuses'].items()))}")
    print_latency_summary("Answer latency (accepted)", stats["accepted_latencies"])
    print_latency_summary("Answer latency (rejected)", stats["rejected_latencies"])
    print(f"Rejected reasons: {dict(stats['rejected_reasons'])}")
    print(f"Total elapsed time: {elapsed:.3f}s")


async def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--base-url", default="http://localhost:8000")
    parser.add_argument("--event-id", required=True)
    parser.add_argument("--num-participants", type=int, default=200)
    args = parser.parse_args()

    started_at = time.perf_counter()
    ws_base = args.base_url.replace("http", "ws", 1)
    stats = {
        "join_attempted": args.num_participants,
        "join_succeeded": 0,
        "join_failed": 0,
        "ws_connected": 0,
        "ws_connect_failed": 0,
        "ws_disconnected": 0,
        "answers_attempted": 0,
        "answers_ok": 0,
        "answers_rejected": 0,
        "answers_failed": 0,
        "accepted_latencies": [],
        "rejected_latencies": [],
        "rejected_reasons": Counter(),
        "http_errors": Counter({"timeout": 0, "4xx": 0, "5xx": 0, "other": 0}),
        "http_statuses": Counter(),
    }

    tasks = [
        simulate_participant(i, args.base_url, ws_base, args.event_id, stats)
        for i in range(args.num_participants)
    ]
    print(f"{args.num_participants}人の参加者接続をシミュレートします。管理者画面から進行してください。")
    await asyncio.gather(*tasks)
    print_summary(stats, time.perf_counter() - started_at)


if __name__ == "__main__":
    asyncio.run(main())
