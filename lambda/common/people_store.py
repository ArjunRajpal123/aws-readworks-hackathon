"""Data access for the people table (StorageStack's PeopleTable).

Single-table design; the full layout, every access pattern and example
items are in docs/PEOPLE_DATA_MODEL.md. Summary:

    item                 pk                 sk                          gsi1pk             gsi1sk
    person profile       PERSON#<id>        PROFILE                     ROLE#<role>        <name lower>#<id>
    Cognito sub pointer  SUB#<sub>          SUB                         -                  -
    class                CLASS#<id>         META                        CLASSES            <grade 2d>#<id>
    parent -> child      PERSON#<parent>    CHILD#<student>             PERSON#<student>   PARENT#<parent>
    teacher -> class     CLASS#<class>      TEACHER#<teacher>           PERSON#<teacher>   CLASS#<class>
    enrolment            CLASS#<class>      STUDENT#<student>           PERSON#<student>   CLASS#<class>
    assignment           PERSON#<s> or      ASSIGN#<due>#<aid>          PERSON#<by>        ASSIGNED#<at>#<aid>
                         CLASS#<c>
    reading session      PERSON#<student>   SESSION#<at>#<sid>          -                  -
    word practice        PERSON#<student>   WORD#<word lower>           -                  -

Table name comes from env PEOPLE_TABLE. The boto3 Table is created lazily
and cached per container (like pipeline_runtime). Handlers can use the
module-level functions; tests and scripts build PeopleStore(table) with
any object that has the boto3 Table methods.

Student data is kept minimal (K-12): display name and class links only.
No email, birthday or address is stored for students.
"""
from __future__ import annotations

import os
import re
import uuid
from datetime import datetime, timezone
from decimal import Decimal

import boto3
from boto3.dynamodb.conditions import Attr, Key
from botocore.exceptions import ClientError

ROLES = ("admin", "teacher", "parent", "student")
GSI1 = "gsi1"
KEY_ATTRS = ("pk", "sk", "gsi1pk", "gsi1sk")

# Ids end up inside composite keys, so '#' (the separator) is never allowed.
_ID_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$")
_SUB_RE = re.compile(r"^[A-Za-z0-9-]{1,128}$")
_EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")
_SESSION_SOURCES = ("assigned", "independent")


class PeopleStoreError(Exception):
    pass


class NotFound(PeopleStoreError):
    pass


class AlreadyExists(PeopleStoreError):
    pass


class Conflict(PeopleStoreError):
    pass


# ---------------------------------------------------------------------------
# Keys and validation
# ---------------------------------------------------------------------------

def person_pk(person_id):
    return "PERSON#" + _check_id(person_id, "person id")


def class_pk(class_id):
    return "CLASS#" + _check_id(class_id, "class id")


def sub_pk(sub):
    if not isinstance(sub, str) or not _SUB_RE.match(sub):
        raise ValueError("invalid Cognito sub")
    return "SUB#" + sub


def _check_id(value, what):
    if not isinstance(value, str) or not _ID_RE.match(value):
        raise ValueError(f"invalid {what}: {value!r}")
    return value


def _check_role(role):
    if role not in ROLES:
        raise ValueError(f"role must be one of {ROLES}, got {role!r}")
    return role


def _check_name(name):
    if not isinstance(name, str) or not name.strip() or len(name) > 100:
        raise ValueError("name must be a non-empty string of at most 100 characters")
    return name.strip()


def _fmt(dt):
    return dt.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.%f")[:-3] + "Z"


def _check_iso(value, what):
    """Parse an ISO-8601 timestamp and return it in one canonical UTC form.

    Timestamps sit inside sort keys and are compared as strings, so every
    stored value must have the same shape: YYYY-MM-DDTHH:MM:SS.mmmZ.
    """
    if not isinstance(value, str):
        raise ValueError(f"{what} must be an ISO-8601 string")
    try:
        dt = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        raise ValueError(f"{what} must be an ISO-8601 string") from None
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return _fmt(dt)


def now_iso():
    return _fmt(datetime.now(timezone.utc))


def _to_dynamo(value):
    if isinstance(value, bool):
        return value
    if isinstance(value, float):
        return Decimal(str(value))
    if isinstance(value, dict):
        return {k: _to_dynamo(v) for k, v in value.items() if v is not None}
    if isinstance(value, (list, tuple)):
        return [_to_dynamo(v) for v in value]
    return value


def _plain(value):
    # boto3 returns every Number as Decimal; give handlers JSON-ready values.
    if isinstance(value, Decimal):
        return int(value) if value % 1 == 0 else float(value)
    if isinstance(value, list):
        return [_plain(v) for v in value]
    if isinstance(value, dict):
        return {k: _plain(v) for k, v in value.items()}
    return value


def strip_keys(item):
    """Drop the table/index key attributes before returning an item to a client."""
    if item is None:
        return None
    return {k: v for k, v in item.items() if k not in KEY_ATTRS}


def _is_conditional_failure(err):
    return err.response.get("Error", {}).get("Code") == "ConditionalCheckFailedException"


# ---------------------------------------------------------------------------
# Item builders (pure; the seed script's dry run prints these)
# ---------------------------------------------------------------------------

def person_item(person_id, role, name, email=None, sub="", now=None):
    _check_id(person_id, "person id")
    _check_role(role)
    name = _check_name(name)
    if sub:
        sub_pk(sub)
    item = {
        "pk": person_pk(person_id), "sk": "PROFILE", "type": "person",
        "id": person_id, "role": role, "name": name, "sub": sub or "",
        "gsi1pk": "ROLE#" + role, "gsi1sk": f"{name.lower()}#{person_id}",
        "createdAt": now or now_iso(),
    }
    item["updatedAt"] = item["createdAt"]
    if email:
        if role == "student":
            # K-12 minimal data: Cognito holds the sign-in email; we don't copy it.
            raise ValueError("student records do not store email")
        if not isinstance(email, str) or not _EMAIL_RE.match(email):
            raise ValueError("invalid email")
        item["email"] = email.lower()
    return item


def class_item(class_id, name, grade, band, now=None):
    _check_id(class_id, "class id")
    if not isinstance(grade, int) or isinstance(grade, bool) or not 0 <= grade <= 12:
        raise ValueError("grade must be an int 0-12 (0 = kindergarten)")
    if not isinstance(band, str) or not band:
        raise ValueError("band is required (k2, 35, 68, 912)")
    return {
        "pk": class_pk(class_id), "sk": "META", "type": "class",
        "id": class_id, "name": _check_name(name), "grade": grade, "band": band,
        "gsi1pk": "CLASSES", "gsi1sk": f"{grade:02d}#{class_id}",
        "createdAt": now or now_iso(),
    }


def parent_child_item(parent, student, now=None):
    return {
        "pk": person_pk(parent["id"]), "sk": "CHILD#" + student["id"], "type": "parentChild",
        "parentId": parent["id"], "parentName": parent["name"],
        "studentId": student["id"], "studentName": student["name"],
        "gsi1pk": person_pk(student["id"]), "gsi1sk": "PARENT#" + parent["id"],
        "createdAt": now or now_iso(),
    }


def teacher_class_item(teacher, klass, now=None):
    return {
        "pk": class_pk(klass["id"]), "sk": "TEACHER#" + teacher["id"], "type": "teacherClass",
        "classId": klass["id"], "className": klass["name"],
        "teacherId": teacher["id"], "teacherName": teacher["name"],
        "gsi1pk": person_pk(teacher["id"]), "gsi1sk": "CLASS#" + klass["id"],
        "createdAt": now or now_iso(),
    }


def enrolment_item(student, klass, now=None):
    return {
        "pk": class_pk(klass["id"]), "sk": "STUDENT#" + student["id"], "type": "enrolment",
        "classId": klass["id"], "className": klass["name"],
        "studentId": student["id"], "studentName": student["name"],
        "gsi1pk": person_pk(student["id"]), "gsi1sk": "CLASS#" + klass["id"],
        "createdAt": now or now_iso(),
    }


# ---------------------------------------------------------------------------
# Store
# ---------------------------------------------------------------------------

class PeopleStore:
    def __init__(self, table):
        self.table = table

    # -- low-level helpers --------------------------------------------------

    def _get(self, pk, sk, consistent=False):
        resp = self.table.get_item(Key={"pk": pk, "sk": sk}, ConsistentRead=consistent)
        item = resp.get("Item")
        return _plain(item) if item is not None else None

    def _put_new(self, item):
        """Put that never overwrites. Returns False if the key already exists."""
        try:
            self.table.put_item(Item=_to_dynamo(item), ConditionExpression=Attr("pk").not_exists())
            return True
        except ClientError as err:
            if _is_conditional_failure(err):
                return False
            raise

    def _query_all(self, **kwargs):
        items, kwargs = [], dict(kwargs)
        while True:
            resp = self.table.query(**kwargs)
            items.extend(_plain(i) for i in resp.get("Items", []))
            lek = resp.get("LastEvaluatedKey")
            if not lek:
                return items
            kwargs["ExclusiveStartKey"] = lek

    def _children_of(self, pk, prefix, newest_first=False):
        return self._query_all(
            KeyConditionExpression=Key("pk").eq(pk) & Key("sk").begins_with(prefix),
            ScanIndexForward=not newest_first,
        )

    def _gsi1(self, gsi1pk, prefix=None):
        cond = Key("gsi1pk").eq(gsi1pk)
        if prefix:
            cond = cond & Key("gsi1sk").begins_with(prefix)
        return self._query_all(IndexName=GSI1, KeyConditionExpression=cond)

    def _require_person(self, person_id, role=None):
        person = self.get_person(person_id)
        if person is None:
            raise NotFound(f"person {person_id} not found")
        if role and person.get("role") != role:
            raise ValueError(f"{person_id} is a {person.get('role')}, expected {role}")
        return person

    def _require_class(self, class_id):
        klass = self.get_class(class_id)
        if klass is None:
            raise NotFound(f"class {class_id} not found")
        return klass

    # -- people --------------------------------------------------------------

    def get_person(self, person_id, consistent=False):
        return self._get(person_pk(person_id), "PROFILE", consistent)

    def get_person_by_sub(self, sub):
        """Every request: Cognito sub -> person record (2 strongly consistent GetItems)."""
        try:
            pointer = self._get(sub_pk(sub), "SUB", consistent=True)
        except ValueError:
            return None
        if not pointer:
            return None
        person = self.get_person(pointer["personId"], consistent=True)
        # Defend against a stale pointer: the person must still carry this sub.
        if not person or person.get("sub") != sub:
            return None
        return person

    def put_person(self, person_id, role, name, email=None, now=None):
        """Create a person. Never overwrites; raises AlreadyExists."""
        item = person_item(person_id, role, name, email=email, now=now)
        if not self._put_new(item):
            raise AlreadyExists(f"person {person_id} already exists")
        return _plain(item)

    def update_person(self, person_id, name=None, email=None, now=None):
        """Update display name / email. Role and sub are not changed here."""
        current = self._require_person(person_id)
        item = person_item(
            person_id, current["role"], name if name is not None else current["name"],
            email=email if email is not None else current.get("email"),
            sub=current.get("sub", ""), now=current.get("createdAt"),
        )
        item["updatedAt"] = now or now_iso()
        # Optimistic: fail if someone attached/detached a sub meanwhile.
        cond = Attr("pk").exists() & Attr("sub").eq(current.get("sub", ""))
        try:
            self.table.put_item(Item=_to_dynamo(item), ConditionExpression=cond)
        except ClientError as err:
            if _is_conditional_failure(err):
                raise Conflict(f"person {person_id} changed concurrently; retry") from None
            raise
        return _plain(item)

    def list_people_by_role(self, role, limit=None, start_key=None):
        """Admin: people with a role, ordered by name. Returns {items, next}."""
        kwargs = {
            "IndexName": GSI1,
            "KeyConditionExpression": Key("gsi1pk").eq("ROLE#" + _check_role(role)),
        }
        if limit:
            kwargs["Limit"] = limit
        if start_key:
            kwargs["ExclusiveStartKey"] = start_key
        resp = self.table.query(**kwargs)
        return {"items": [_plain(i) for i in resp.get("Items", [])],
                "next": resp.get("LastEvaluatedKey")}

    def attach_cognito_sub(self, person_id, sub, now=None):
        """Admin: connect a Cognito account (sub) to a person. Idempotent.

        Writes a SUB#<sub> pointer (conditional: a sub maps to one person) and
        then sets person.sub (conditional: only if the person has no sub yet).
        If the second write loses a race, the pointer is rolled back.
        """
        spk = sub_pk(sub)
        person = self._require_person(person_id)
        if person.get("sub") and person["sub"] != sub:
            raise Conflict(f"person {person_id} is already linked to another Cognito user")
        pointer = {"pk": spk, "sk": "SUB", "type": "sub", "personId": person_id,
                   "createdAt": now or now_iso()}
        if not self._put_new(pointer):
            existing = self._get(spk, "SUB", consistent=True)
            if not existing or existing.get("personId") != person_id:
                raise Conflict("that Cognito user is already linked to another person")
        if person.get("sub") == sub:
            return person
        person = dict(person, sub=sub, updatedAt=now or now_iso())
        try:
            self.table.put_item(
                Item=_to_dynamo(person),
                ConditionExpression=Attr("pk").exists() & Attr("sub").eq(""),
            )
        except ClientError as err:
            if not _is_conditional_failure(err):
                raise
            self.table.delete_item(
                Key={"pk": spk, "sk": "SUB"},
                ConditionExpression=Attr("personId").eq(person_id),
            )
            raise Conflict(f"person {person_id} was linked concurrently") from None
        return person

    def detach_cognito_sub(self, person_id, now=None):
        """Admin: disconnect a person from its Cognito account."""
        person = self._require_person(person_id)
        sub = person.get("sub")
        if not sub:
            return person
        person = dict(person, sub="", updatedAt=now or now_iso())
        self.table.put_item(Item=_to_dynamo(person),
                            ConditionExpression=Attr("sub").eq(sub))
        self.table.delete_item(Key={"pk": sub_pk(sub), "sk": "SUB"})
        return person

    # -- classes -------------------------------------------------------------

    def put_class(self, class_id, name, grade, band, now=None):
        item = class_item(class_id, name, grade, band, now=now)
        if not self._put_new(item):
            raise AlreadyExists(f"class {class_id} already exists")
        return _plain(item)

    def get_class(self, class_id):
        return self._get(class_pk(class_id), "META")

    def list_classes(self):
        return self._gsi1("CLASSES")

    # -- links (all idempotent: True = created, False = already there) -------

    def link_parent_student(self, parent_id, student_id, now=None):
        parent = self._require_person(parent_id, "parent")
        student = self._require_person(student_id, "student")
        return self._put_new(parent_child_item(parent, student, now))

    def unlink_parent_student(self, parent_id, student_id):
        self.table.delete_item(Key={"pk": person_pk(parent_id),
                                    "sk": "CHILD#" + _check_id(student_id, "student id")})

    def link_teacher_class(self, teacher_id, class_id, now=None):
        teacher = self._require_person(teacher_id, "teacher")
        klass = self._require_class(class_id)
        return self._put_new(teacher_class_item(teacher, klass, now))

    def unlink_teacher_class(self, teacher_id, class_id):
        self.table.delete_item(Key={"pk": class_pk(class_id),
                                    "sk": "TEACHER#" + _check_id(teacher_id, "teacher id")})

    def enrol_student(self, student_id, class_id, now=None):
        student = self._require_person(student_id, "student")
        klass = self._require_class(class_id)
        return self._put_new(enrolment_item(student, klass, now))

    def unenrol_student(self, student_id, class_id):
        self.table.delete_item(Key={"pk": class_pk(class_id),
                                    "sk": "STUDENT#" + _check_id(student_id, "student id")})

    def list_children(self, parent_id):
        return self._children_of(person_pk(parent_id), "CHILD#")

    def list_parents(self, student_id):
        return self._gsi1(person_pk(student_id), "PARENT#")

    def is_parent_of(self, parent_id, student_id):
        return self._get(person_pk(parent_id), "CHILD#" + _check_id(student_id, "student id")) is not None

    def list_teacher_classes(self, teacher_id):
        return self._gsi1(person_pk(teacher_id), "CLASS#")

    def list_class_teachers(self, class_id):
        return self._children_of(class_pk(class_id), "TEACHER#")

    def is_teacher_of_class(self, teacher_id, class_id):
        return self._get(class_pk(class_id), "TEACHER#" + _check_id(teacher_id, "teacher id")) is not None

    def list_class_students(self, class_id):
        return self._children_of(class_pk(class_id), "STUDENT#")

    def list_student_classes(self, student_id):
        return self._gsi1(person_pk(student_id), "CLASS#")

    # -- assignments ---------------------------------------------------------

    def put_assignment(self, pid, by_person, student_id=None, class_id=None,
                       due=None, assignment_id=None, now=None):
        """Send a passage to one student or a whole class.

        Authorization is the caller's job (rbac.can_assign). Re-sending with
        the same assignment_id is a no-op (returns the stored item).
        """
        if (student_id is None) == (class_id is None):
            raise ValueError("give exactly one of student_id or class_id")
        _check_id(pid, "passage id")
        at = _check_iso(now, "now") if now else now_iso()
        due = _check_iso(due, "due") if due else at
        aid = _check_id(assignment_id or "a" + uuid.uuid4().hex[:16], "assignment id")
        if student_id is not None:
            pk, to = person_pk(student_id), student_id
        else:
            pk, to = class_pk(class_id), "c:" + class_id
        item = {
            "pk": pk, "sk": f"ASSIGN#{due}#{aid}", "type": "assignment",
            "id": aid, "pid": pid, "to": to,
            "toType": "student" if student_id is not None else "class",
            "by": by_person["id"], "byName": by_person.get("name", ""),
            "byRole": by_person.get("role", ""), "at": at, "due": due,
            "gsi1pk": person_pk(by_person["id"]), "gsi1sk": f"ASSIGNED#{at}#{aid}",
        }
        if not self._put_new(item):
            return self._get(pk, item["sk"])
        return _plain(item)

    def list_assignments_for_class(self, class_id):
        return self._children_of(class_pk(class_id), "ASSIGN#")

    def list_assignments_for_student(self, student_id, include_classes=True):
        """Direct assignments plus those sent to any of the student's classes, by due date."""
        items = self._children_of(person_pk(student_id), "ASSIGN#")
        if include_classes:
            for link in self.list_student_classes(student_id):
                items.extend(self.list_assignments_for_class(link["classId"]))
        return sorted(items, key=lambda a: (a["due"], a["id"]))

    def list_assignments_by(self, person_id):
        """What a teacher/parent has sent, oldest first."""
        return self._gsi1(person_pk(person_id), "ASSIGNED#")

    def delete_assignment(self, assignment):
        """Delete by the stored item (needs its pk/sk). Caller authorizes."""
        if not str(assignment.get("sk", "")).startswith("ASSIGN#"):
            raise ValueError("not an assignment item")
        self.table.delete_item(Key={"pk": assignment["pk"], "sk": assignment["sk"]})

    def assignments_with_status(self, student_id):
        """Assignments with done=True once a session of that passage started at/after it was sent."""
        sessions = self.list_sessions_for_student(student_id)
        out = []
        for a in self.list_assignments_for_student(student_id):
            done = any(s["pid"] == a["pid"] and s["at"] >= a["at"] for s in sessions)
            out.append(dict(a, done=done))
        return out

    def up_next(self, student_id):
        return [a for a in self.assignments_with_status(student_id) if not a["done"]]

    # -- reading sessions ----------------------------------------------------

    def append_session(self, student_id, pid, minutes, words=(), q=None,
                       source="independent", stars=1, at=None, session_id=None):
        """Append one reading session. Same session_id twice is a no-op."""
        _check_id(pid, "passage id")
        at = _check_iso(at, "at") if at else now_iso()
        sid = _check_id(session_id or "r" + uuid.uuid4().hex[:16], "session id")
        if source not in _SESSION_SOURCES:
            raise ValueError(f"source must be one of {_SESSION_SOURCES}")
        if not isinstance(minutes, (int, float)) or isinstance(minutes, bool) or not 0 <= minutes <= 600:
            raise ValueError("minutes must be a number 0-600")
        if q is not None and (not isinstance(q, int) or not 0 <= q <= 100):
            raise ValueError("q must be an int 0-100 or None")
        if not isinstance(stars, int) or not 0 <= stars <= 3:
            raise ValueError("stars must be an int 0-3")
        words = [w for w in words if isinstance(w, str) and w][:200]
        item = {
            "pk": person_pk(student_id), "sk": f"SESSION#{at}#{sid}", "type": "session",
            "id": sid, "student": student_id, "pid": pid, "at": at, "minutes": minutes,
            "words": words, "q": q, "source": source, "stars": stars,
        }
        if not self._put_new(item):
            return self._get(item["pk"], item["sk"])
        return _plain(_to_dynamo(item))

    def list_sessions_for_student(self, student_id, limit=None, newest_first=True):
        if not limit:
            return self._children_of(person_pk(student_id), "SESSION#", newest_first)
        resp = self.table.query(
            KeyConditionExpression=Key("pk").eq(person_pk(student_id)) & Key("sk").begins_with("SESSION#"),
            ScanIndexForward=not newest_first, Limit=limit,
        )
        return [_plain(i) for i in resp.get("Items", [])]

    # -- word practice -------------------------------------------------------

    def record_word_practice(self, student_id, word, knew, now=None):
        if not isinstance(word, str) or not word.strip() or len(word) > 64 or "#" in word:
            raise ValueError("invalid word")
        w = word.strip().lower()
        resp = self.table.update_item(
            Key={"pk": person_pk(student_id), "sk": "WORD#" + w},
            UpdateExpression="SET #type = :type, #w = :w, #at = :at ADD #n :one",
            ExpressionAttributeNames={"#type": "type", "#w": "w", "#at": "at",
                                      "#n": "k" if knew else "m"},
            ExpressionAttributeValues={":type": "word", ":w": w, ":at": now or now_iso(),
                                       ":one": 1},
            ReturnValues="ALL_NEW",
        )
        return _plain(resp.get("Attributes"))

    def list_word_practice(self, student_id):
        return self._children_of(person_pk(student_id), "WORD#")


# ---------------------------------------------------------------------------
# Module-level API for Lambda handlers (lazy, cached per container)
# ---------------------------------------------------------------------------

_cache = {}


def get_store():
    if "store" not in _cache:
        table = boto3.resource("dynamodb").Table(os.environ["PEOPLE_TABLE"])
        _cache["store"] = PeopleStore(table)
    return _cache["store"]


def _delegate(name):
    def call(*args, **kwargs):
        return getattr(get_store(), name)(*args, **kwargs)
    call.__name__ = name
    call.__doc__ = getattr(PeopleStore, name).__doc__
    return call


_PUBLIC = [n for n in vars(PeopleStore) if not n.startswith("_")]
for _name in _PUBLIC:
    globals()[_name] = _delegate(_name)
del _name
