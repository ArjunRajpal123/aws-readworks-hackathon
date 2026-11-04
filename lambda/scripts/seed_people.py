#!/usr/bin/env python3
"""Seed the people table with the demo cast from frontend/src/people.js.

Dry run by default: prints every item that would be written and touches
nothing. Pass --yes to write. Safe to re-run: existing people/classes are
skipped (conditional writes), links are idempotent.

    # preview
    python lambda/scripts/seed_people.py --table dynamodb-readworks-bb-dev-people
    # write
    python lambda/scripts/seed_people.py --table dynamodb-readworks-bb-dev-people --yes
    # connect Cognito accounts to people (admin), may be combined with --yes
    python lambda/scripts/seed_people.py --table ... --yes --attach t-rivera=<cognito-sub>

People are created with an empty `sub`; --attach (people_store.attach_cognito_sub)
connects a person to the Cognito user that signs in as them.

The demo `arch` field (steady/skimmer/struggling/...) only drives the UI's
synthetic history; it is a label about a child and is NOT stored.
Sessions and assignments are not seeded (the UI generates them locally).
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

LAMBDA_DIR = Path(__file__).resolve().parent.parent
if str(LAMBDA_DIR) not in sys.path:
    sys.path.insert(0, str(LAMBDA_DIR))

from common import people_store as ps  # noqa: E402

# Copied from frontend/src/people.js (CLASSES, TEACHERS, STUDENTS, PARENTS).
# lambda/tests/test_people_store.py checks this stays in sync with that file.
DEMO = {
    "admins": [{"id": "a-admin", "name": "Site Admin"}],
    "classes": [
        {"id": "c2", "name": "Room 4", "grade": 2, "band": "k2", "teacher": "t-rivera"},
        {"id": "c4", "name": "Room 12", "grade": 4, "band": "35", "teacher": "t-okafor"},
        {"id": "c7", "name": "Room 207", "grade": 7, "band": "68", "teacher": "t-alvarez"},
        {"id": "c10", "name": "Room 310", "grade": 10, "band": "912", "teacher": "t-bennett"},
    ],
    "teachers": [
        {"id": "t-rivera", "name": "Ms. Rivera", "cls": "c2"},
        {"id": "t-okafor", "name": "Mr. Okafor", "cls": "c4"},
        {"id": "t-alvarez", "name": "Ms. Alvarez", "cls": "c7"},
        {"id": "t-bennett", "name": "Mr. Bennett", "cls": "c10"},
    ],
    "students": [
        {"id": "s-" + sid, "name": name, "cls": cls}
        for sid, name, cls in [
            ("maya", "Maya Chen", "c2"), ("noah", "Noah Brooks", "c2"), ("ava", "Ava Patel", "c2"),
            ("leo", "Leo Garcia", "c2"), ("zoe", "Zoe Adams", "c2"), ("eli", "Eli Johnson", "c2"),
            ("sofia", "Sofia Reyes", "c4"), ("jamal", "Jamal Carter", "c4"), ("lily", "Lily Nguyen", "c4"),
            ("owen", "Owen Kim", "c4"), ("grace", "Grace Murphy", "c4"), ("marcus", "Marcus Hill", "c4"),
            ("daniel", "Daniel Chen", "c7"), ("isabella", "Isabella Rossi", "c7"), ("tyler", "Tyler Moore", "c7"),
            ("amara", "Amara Okoye", "c7"), ("caleb", "Caleb Foster", "c7"), ("nina", "Nina Petrov", "c7"),
            ("hannah", "Hannah Lee", "c10"), ("diego", "Diego Morales", "c10"), ("chloe", "Chloe Turner", "c10"),
            ("ethan", "Ethan Wallace", "c10"), ("jada", "Jada Washington", "c10"), ("mason", "Mason Clark", "c10"),
        ]
    ],
    "parents": [
        {"id": "p-chen", "name": "Priya Chen", "kids": ["s-maya", "s-daniel"]},
        {"id": "p-brooks", "name": "Marcus Brooks", "kids": ["s-noah"]},
        {"id": "p-reyes", "name": "Elena Reyes", "kids": ["s-sofia"]},
        {"id": "p-carter", "name": "Denise Carter", "kids": ["s-jamal"]},
        {"id": "p-lee", "name": "David Lee", "kids": ["s-hannah"]},
        {"id": "p-morales", "name": "Rosa Morales", "kids": ["s-diego"]},
    ],
}


def plan(demo=DEMO, now="2026-01-01T00:00:00.000Z"):
    """Every item the seed writes, in write order, built with people_store's builders."""
    people = {}
    for role, key in (("admin", "admins"), ("teacher", "teachers"),
                      ("parent", "parents"), ("student", "students")):
        for p in demo[key]:
            people[p["id"]] = ps.person_item(p["id"], role, p["name"], now=now)
    classes = {c["id"]: ps.class_item(c["id"], c["name"], c["grade"], c["band"], now=now)
               for c in demo["classes"]}
    links = []
    for c in demo["classes"]:
        links.append(ps.teacher_class_item(people[c["teacher"]], classes[c["id"]], now))
    for s in demo["students"]:
        links.append(ps.enrolment_item(people[s["id"]], classes[s["cls"]], now))
    for p in demo["parents"]:
        for kid in p["kids"]:
            links.append(ps.parent_child_item(people[p["id"]], people[kid], now))
    return list(people.values()), list(classes.values()), links


def seed(store, demo=DEMO, log=print):
    """Write the demo cast through PeopleStore. Returns counts."""
    counts = {"people": 0, "classes": 0, "links": 0, "skipped": 0}

    def create(fn, *args, kind):
        try:
            fn(*args)
            counts[kind] += 1
        except ps.AlreadyExists as err:
            counts["skipped"] += 1
            log(f"skip: {err}")

    for role, key in (("admin", "admins"), ("teacher", "teachers"),
                      ("parent", "parents"), ("student", "students")):
        for p in demo[key]:
            create(store.put_person, p["id"], role, p["name"], kind="people")
    for c in demo["classes"]:
        create(store.put_class, c["id"], c["name"], c["grade"], c["band"], kind="classes")

    def link(created):
        counts["links" if created else "skipped"] += 1

    for c in demo["classes"]:
        link(store.link_teacher_class(c["teacher"], c["id"]))
    for s in demo["students"]:
        link(store.enrol_student(s["id"], s["cls"]))
    for p in demo["parents"]:
        for kid in p["kids"]:
            link(store.link_parent_student(p["id"], kid))
    return counts


def _parse_attach(values):
    pairs = []
    for v in values or []:
        if "=" not in v:
            raise SystemExit(f"--attach expects PERSON_ID=SUB, got {v!r}")
        pid, sub = v.split("=", 1)
        pairs.append((pid.strip(), sub.strip()))
    return pairs


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("--table", required=True, help="people table name (StorageStack output PeopleTableName)")
    ap.add_argument("--region", default=None, help="AWS region (default: from the AWS profile/env)")
    ap.add_argument("--yes", action="store_true", help="actually write (default is a dry run)")
    ap.add_argument("--attach", action="append", metavar="PERSON_ID=SUB",
                    help="connect a Cognito user (sub) to a person; repeatable")
    args = ap.parse_args(argv)
    attach = _parse_attach(args.attach)

    if not args.yes:
        people, classes, links = plan()
        for item in people + classes + links:
            print(json.dumps(item, sort_keys=True))
        for pid, sub in attach:
            print(json.dumps({"attach": pid, "sub": sub}))
        print(f"# dry run: {len(people)} people, {len(classes)} classes, {len(links)} links "
              f"would be written to {args.table}. Re-run with --yes to write.", file=sys.stderr)
        return 0

    import boto3
    store = ps.PeopleStore(boto3.resource("dynamodb", region_name=args.region).Table(args.table))
    counts = seed(store)
    for pid, sub in attach:
        store.attach_cognito_sub(pid, sub)
        print(f"attached {pid} -> {sub}")
    print(f"wrote {counts['people']} people, {counts['classes']} classes, "
          f"{counts['links']} links; skipped {counts['skipped']} existing")
    return 0


if __name__ == "__main__":
    sys.exit(main())
