"""
Scheduler for the Keepwatch odds snapshot.

WHY THIS FILE IS THREE LINES OF LOGIC

Vercel's Hobby plan caps cron jobs at once per day, and a more frequent cron
expression fails at deploy time rather than degrading. Daily resolution loses the
part of line movement that matters — prices move on team news and in the hours
before kickoff. So the schedule lives here and the work stays in the Next.js app.

Modal is used ONLY as a clock. It fetches nothing, parses nothing and knows
nothing about football. All the logic — the-odds-api and Kalshi requests,
de-vigging, club-name mapping, persistence — is in lib/odds/ in TypeScript,
called through one authenticated GET. That means no second implementation to keep
in step, and in particular no Python copy of the club map to drift out of date.

DEPLOY

    modal secret create keepwatch-cron \
        CRON_SECRET=<the same value as the Vercel env var> \
        KEEPWATCH_BASE_URL=https://<your-deployment>

    modal deploy modal/snapshot_odds.py

The schedule is four times a day at 06:00, 12:00, 18:00 and 22:00 UTC. The 22:00
run exists to catch the settle after evening kickoffs.
"""

import os
import urllib.error
import urllib.request

import modal

app = modal.App("keepwatch-odds-snapshot")
image = modal.Image.debian_slim()
secret = modal.Secret.from_name("keepwatch-cron")

TIMEOUT_SECONDS = 90


def _call_snapshot() -> str:
    base = os.environ["KEEPWATCH_BASE_URL"].rstrip("/")
    token = os.environ["CRON_SECRET"]

    request = urllib.request.Request(
        f"{base}/api/cron/snapshot-odds",
        headers={"Authorization": f"Bearer {token}"},
        method="GET",
    )
    with urllib.request.urlopen(request, timeout=TIMEOUT_SECONDS) as response:
        return response.read().decode("utf-8")


@app.function(image=image, secrets=[secret], schedule=modal.Cron("0 6,12,18,22 * * *"))
def snapshot_odds() -> str:
    """
    Fire the snapshot. Raises on a non-2xx so the failure is visible in Modal's
    run history instead of being swallowed — a scheduler that reports success
    through an outage is worse than no scheduler, because the gap in the data is
    only discovered much later, when it cannot be filled.
    """
    try:
        body = _call_snapshot()
    except urllib.error.HTTPError as error:
        detail = error.read().decode("utf-8", errors="replace")
        raise RuntimeError(f"snapshot-odds returned HTTP {error.code}: {detail}") from error

    print(body)
    return body


@app.local_entrypoint()
def main() -> None:
    """`modal run modal/snapshot_odds.py` to test the wiring before deploying."""
    print(snapshot_odds.remote())
