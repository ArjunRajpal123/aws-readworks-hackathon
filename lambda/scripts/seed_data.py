#!/usr/bin/env python3
"""Seed the app-data domains in the shared reference table.

Loads the classroom roster (classes, teachers, students, parents) that the
student/parent/teacher views read, plus a little sample reading history,
assignments and word practice so the demo has data on day one. Idempotent:
every item has a stable id, so re-running overwrites rather than duplicates.
Adds to whatever is already there; never deletes.

Run against the deployed table (resolve the name from the storage stack):

    uv run --with boto3 python lambda/scripts/seed_data.py --apply
    uv run --with boto3 python lambda/scripts/seed_data.py --apply --extra   # + a second school

Without --apply it prints what it would write (dry run). Session ids are
stable (seed-<student>-<n>); --reset first deletes the seeded students'
existing history, e.g. rows left by older versions of this script.
"""
from __future__ import annotations

import argparse
import os
import random
import sys
import time
from pathlib import Path

import boto3

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from common import data_store  # noqa: E402

DEFAULT_STACK = "rg-readworks-bb-storage"

# Mirrors frontend/src/people.js seed cast. The sample history reads passages
# and vocab words from the seeded catalog (catalog#index, seed_content.py), so
# every session points at a real passage and every word has a card in both
# English and Spanish. Seed content first.
CLASSES = [
    {"id": "c2", "name": "Room 4", "grade": 2, "band": "k2", "teacher": "t-rivera"},
    {"id": "c4", "name": "Room 12", "grade": 4, "band": "35", "teacher": "t-okafor"},
    {"id": "c7", "name": "Room 207", "grade": 7, "band": "68", "teacher": "t-alvarez"},
    {"id": "c10", "name": "Room 310", "grade": 10, "band": "912", "teacher": "t-bennett"},
]
TEACHERS = [
    {"id": "t-rivera", "name": "Ms. Rivera", "cls": "c2"},
    {"id": "t-okafor", "name": "Mr. Okafor", "cls": "c4"},
    {"id": "t-alvarez", "name": "Ms. Alvarez", "cls": "c7"},
    {"id": "t-bennett", "name": "Mr. Bennett", "cls": "c10"},
]


def _student(sid, name, cls, arch):
    return {"id": f"s-{sid}", "name": name, "cls": cls, "arch": arch}


STUDENTS = [
    _student("maya", "Maya Chen", "c2", "steady"), _student("noah", "Noah Brooks", "c2", "skimmer"),
    _student("ava", "Ava Patel", "c2", "strong"), _student("leo", "Leo Garcia", "c2", "struggling"),
    _student("zoe", "Zoe Adams", "c2", "inactive"), _student("eli", "Eli Johnson", "c2", "steady"),
    _student("sofia", "Sofia Reyes", "c4", "strong"), _student("jamal", "Jamal Carter", "c4", "skimmer"),
    _student("lily", "Lily Nguyen", "c4", "steady"), _student("owen", "Owen Kim", "c4", "struggling"),
    _student("grace", "Grace Murphy", "c4", "steady"), _student("marcus", "Marcus Hill", "c4", "inactive"),
    _student("daniel", "Daniel Chen", "c7", "steady"), _student("isabella", "Isabella Rossi", "c7", "strong"),
    _student("tyler", "Tyler Moore", "c7", "skimmer"), _student("amara", "Amara Okoye", "c7", "steady"),
    _student("caleb", "Caleb Foster", "c7", "struggling"), _student("nina", "Nina Petrov", "c7", "inactive"),
    _student("hannah", "Hannah Lee", "c10", "strong"), _student("diego", "Diego Morales", "c10", "steady"),
    _student("chloe", "Chloe Turner", "c10", "skimmer"), _student("ethan", "Ethan Wallace", "c10", "struggling"),
    _student("jada", "Jada Washington", "c10", "steady"), _student("mason", "Mason Clark", "c10", "inactive"),
]
PARENTS = [
    {"id": "p-chen", "name": "Priya Chen", "kids": ["s-maya", "s-daniel"]},
    {"id": "p-brooks", "name": "Marcus Brooks", "kids": ["s-noah"]},
    {"id": "p-reyes", "name": "Elena Reyes", "kids": ["s-sofia"]},
    {"id": "p-carter", "name": "Denise Carter", "kids": ["s-jamal"]},
    {"id": "p-lee", "name": "David Lee", "kids": ["s-hannah"]},
    {"id": "p-morales", "name": "Rosa Morales", "kids": ["s-diego"]},
]
# A second school for --extra: more teachers/students so the roster isn't just one cast.
EXTRA_CLASSES = [
    {"id": "c3", "name": "Room 6", "grade": 3, "band": "35", "teacher": "t-nguyen"},
    {"id": "c8", "name": "Room 215", "grade": 8, "band": "68", "teacher": "t-flores"},
]
EXTRA_TEACHERS = [
    {"id": "t-nguyen", "name": "Ms. Nguyen", "cls": "c3"},
    {"id": "t-flores", "name": "Mr. Flores", "cls": "c8"},
]
EXTRA_STUDENTS = [
    _student("ruby", "Ruby Sanders", "c3", "steady"), _student("omar", "Omar Haddad", "c3", "strong"),
    _student("priya", "Priya Rao", "c3", "skimmer"), _student("liam", "Liam Walsh", "c3", "struggling"),
    _student("kenji", "Kenji Tanaka", "c8", "steady"), _student("aaliyah", "Aaliyah Brooks", "c8", "strong"),
    _student("mateo", "Mateo Cruz", "c8", "skimmer"), _student("harper", "Harper Quinn", "c8", "inactive"),
]
EXTRA_PARENTS = [
    {"id": "p-sanders", "name": "Gail Sanders", "kids": ["s-ruby"]},
    {"id": "p-tanaka", "name": "Yuki Tanaka", "kids": ["s-kenji"]},
]

ARCH = {
    "steady": {"n": (7, 9), "ratio": (0.9, 1.35), "q": (68, 90), "gap": (0, 3)},
    "strong": {"n": (9, 11), "ratio": (0.95, 1.25), "q": (85, 100), "gap": (0, 2)},
    "skimmer": {"n": (6, 8), "ratio": (0.3, 0.55), "q": (38, 62), "gap": (0, 4)},
    "struggling": {"n": (4, 6), "ratio": (1.7, 2.5), "q": (30, 55), "gap": (1, 5)},
    "inactive": {"n": (3, 4), "ratio": (0.9, 1.3), "q": (60, 85), "gap": (12, 20)},
}
DAY = 86400.0
def band_of(cls_id, classes):
    c = next((c for c in classes if c["id"] == cls_id), None)
    return c["band"] if c else "35"


def load_catalog():
    cat = data_store.get_raw("catalog", "index")
    if not cat or not cat.get("entries"):
        sys.exit("catalog#index is empty: run seed_content.py first")
    by_band = {}
    for e in cat["entries"]:
        by_band.setdefault(e["band"], []).append(e)
    return by_band


def sample_history(st, classes, catalog):
    """Deterministic per-student sessions + assignments + practice (seeded by id)."""
    rng = random.Random(st["id"])
    a = ARCH[st["arch"]]
    band = band_of(st["cls"], classes)
    entries = sorted(catalog.get(band, []), key=lambda e: e["pid"])
    pids = [e["pid"] for e in entries]
    vocab = {e["pid"]: [v["w"] for v in e.get("vocab", [])] for e in entries}
    n = rng.randint(*a["n"])
    ago = rng.uniform(*a["gap"])
    sessions, practiced = [], {}
    order = pids[:]
    rng.shuffle(order)
    for i in range(n):
        pid = order[i % len(order)]
        sid = f"seed-{st['id']}-{i}"
        at = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(time.time() - ago * DAY))
        words = vocab[pid]
        got = rng.sample(words, k=rng.randint(0, min(3, len(words))))
        q = round(rng.uniform(*a["q"]))
        stars = 1 + (1 if len(got) >= 2 else 0) + (1 if q >= 80 else 0)
        sessions.append({"_id": sid, "student": st["id"], "pid": pid, "at": at, "minutes": round(rng.uniform(1, 6), 1),
                         "words": got, "q": q, "source": rng.choice(["assigned", "independent"]), "stars": stars})
        for w in got:
            p = practiced.setdefault(w, {"student": st["id"], "word": w, "k": 0, "m": 0})
            p["k" if rng.random() > 0.3 else "m"] += 1
            p["at"] = at
        ago += rng.uniform(1.5, 4.2)
    # one open assignment from the class teacher
    teacher = next((t for t in TEACHERS + EXTRA_TEACHERS if t["cls"] == st["cls"]), None)
    done = {s["pid"] for s in sessions}
    unread = [p for p in pids if p not in done] or pids
    due = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(time.time() + 3 * DAY))
    assigns = [{"pid": unread[0], "to": st["id"], "by": teacher["id"] if teacher else None,
                "byName": teacher["name"] if teacher else None,
                "at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(time.time() - 2 * DAY)), "due": due}]
    return sessions, assigns, list(practiced.values())


def reset(student_ids, apply):
    """Drop existing sample history (sessions, practice, assignments) for these students."""
    n = 0
    for kind, field in (("session", "student"), ("practice", "student"), ("assign", "to")):
        for item in data_store.list_type(kind):
            if item.get(field) in student_ids:
                n += 1
                if apply:
                    data_store.delete(kind, item["id"])
    print(f"  reset    {n} history items")


def seed(table_name, extra, apply, do_reset=False):
    data_store._table = boto3.resource("dynamodb").Table(table_name)
    classes = CLASSES + (EXTRA_CLASSES if extra else [])
    teachers = TEACHERS + (EXTRA_TEACHERS if extra else [])
    students = STUDENTS + (EXTRA_STUDENTS if extra else [])
    parents = PARENTS + (EXTRA_PARENTS if extra else [])

    catalog = load_catalog()
    if do_reset:
        reset({st["id"] for st in students}, apply)
    counts = {"class": 0, "teacher": 0, "student": 0, "parent": 0, "session": 0, "assign": 0, "practice": 0}

    def w(kind, item_id, body):
        counts[kind] += 1
        if apply:
            data_store.put(kind, item_id, body)

    for c in classes:
        w("class", c["id"], {k: v for k, v in c.items() if k != "id"})
    for tch in teachers:
        w("teacher", tch["id"], {k: v for k, v in tch.items() if k != "id"})
    for p in parents:
        w("parent", p["id"], {k: v for k, v in p.items() if k != "id"})
    for st in students:
        w("student", st["id"], {k: v for k, v in st.items() if k != "id"})
        sessions, assigns, practice = sample_history(st, classes, catalog)
        for s in sessions:
            w("session", s.pop("_id"), s)
        for a in assigns:
            w("assign", f"seed-{st['id']}", a)
        for p in practice:
            w("practice", f"{p['student']}#{p['word']}", p)

    print(("APPLIED" if apply else "DRY RUN") + " to " + table_name)
    for k, v in counts.items():
        print(f"  {k:9} {v}")


def main(argv=None):
    ap = argparse.ArgumentParser(description="Seed roster + sample history into the reference table.")
    ap.add_argument("--table", help="DynamoDB table name (default: resolve from the storage stack)")
    ap.add_argument("--stack", default=DEFAULT_STACK)
    ap.add_argument("--region", default="us-west-2")
    ap.add_argument("--extra", action="store_true", help="also seed a second school")
    ap.add_argument("--reset", action="store_true",
                    help="first delete the seeded students' existing sessions/practice/assignments")
    ap.add_argument("--apply", action="store_true", help="write to DynamoDB (default: dry run)")
    args = ap.parse_args(argv)

    os.environ.setdefault("AWS_DEFAULT_REGION", args.region)
    table = args.table
    if not table:
        cfn = boto3.client("cloudformation", region_name=args.region)
        outs = cfn.describe_stacks(StackName=args.stack)["Stacks"][0]["Outputs"]
        table = next(o["OutputValue"] for o in outs if o["OutputKey"] == "ReferenceTableName")
    os.environ["TTS_REFERENCE_TABLE"] = table
    seed(table, args.extra, args.apply, args.reset)
    return 0


if __name__ == "__main__":
    sys.exit(main())
