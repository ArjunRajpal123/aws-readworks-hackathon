"""Role-based access checks for Sound Along API handlers.

Identity comes from the API Gateway HTTP API JWT authorizer:
event["requestContext"]["authorizer"]["jwt"]["claims"] with `sub`, `email`
and `cognito:groups`. The groups claim arrives in several shapes depending
on the authorizer and token: "[admin teacher]", "admin", "admin,teacher",
'["admin","teacher"]', or a real list. parse_groups handles all of them.

Two sources are combined, and both must agree:
  - Cognito groups say which role the token may act as;
  - the person record (people table, looked up by sub) carries the
    relationships (classes taught, children, enrolment).
resolve_caller only returns a person whose stored role is one of the
token's groups. Everything else is deny-by-default.

`store` is a people_store.PeopleStore (or the people_store module).
"""
from __future__ import annotations

import functools
import json

ROLE_PRECEDENCE = ("admin", "teacher", "parent", "student")


def claims_from_event(event):
    try:
        return event["requestContext"]["authorizer"]["jwt"]["claims"] or {}
    except (KeyError, TypeError):
        return {}


def parse_groups(claims):
    """Return the caller's groups as a list of strings (known roles first-seen order)."""
    raw = (claims or {}).get("cognito:groups")
    if raw is None:
        return []
    if isinstance(raw, (list, tuple)):
        values = raw
    elif isinstance(raw, str):
        text = raw.strip()
        values = None
        if text.startswith("[") and '"' in text:
            try:
                parsed = json.loads(text)
                if isinstance(parsed, list):
                    values = parsed
            except ValueError:
                values = None
        if values is None:
            values = text.strip("[]").replace(",", " ").split()
    else:
        return []
    out = []
    for v in values:
        if isinstance(v, str):
            g = v.strip().strip('"').strip("'")
            if g and g not in out:
                out.append(g)
    return out


def primary_role(groups):
    """Highest-precedence known role: admin > teacher > parent > student. None if none."""
    for role in ROLE_PRECEDENCE:
        if role in (groups or ()):
            return role
    return None


def resolve_caller(event_or_claims, store):
    """Signed-in caller's person record, or None (unknown sub / role not in token groups)."""
    claims = event_or_claims
    if isinstance(event_or_claims, dict) and "requestContext" in event_or_claims:
        claims = claims_from_event(event_or_claims)
    sub = (claims or {}).get("sub")
    if not isinstance(sub, str) or not sub:
        return None
    person = store.get_person_by_sub(sub)
    if not person or person.get("role") not in parse_groups(claims):
        return None
    return person


def _deny_on_bad_input(fn):
    # Malformed ids (people_store raises ValueError) are a denial, not a 500.
    @functools.wraps(fn)
    def wrapper(*args, **kwargs):
        try:
            return fn(*args, **kwargs)
        except ValueError:
            return False
    return wrapper


def _role(caller):
    if not isinstance(caller, dict) or not caller.get("id"):
        return None
    role = caller.get("role")
    return role if role in ROLE_PRECEDENCE else None


def teaches_student(teacher_id, student_id, store):
    for link in store.list_student_classes(student_id):
        if store.is_teacher_of_class(teacher_id, link["classId"]):
            return True
    return False


@_deny_on_bad_input
def can_view_student(caller_person, student_id, store):
    """admin: all; teacher: students in their classes; parent: linked children; student: self."""
    role = _role(caller_person)
    if not role or not student_id:
        return False
    if role == "admin":
        return True
    if role == "student":
        return caller_person["id"] == student_id
    if role == "parent":
        return store.is_parent_of(caller_person["id"], student_id)
    if role == "teacher":
        return teaches_student(caller_person["id"], student_id, store)
    return False


@_deny_on_bad_input
def can_view_class(caller_person, class_id, store):
    """admin: all; teacher: classes they teach. Parents/students: no roster access."""
    role = _role(caller_person)
    if not role or not class_id:
        return False
    if role == "admin":
        return True
    if role == "teacher":
        return store.is_teacher_of_class(caller_person["id"], class_id)
    return False


@_deny_on_bad_input
def can_assign(caller_person, store, student_id=None, class_id=None):
    """Who may send a reading to a target (exactly one of student_id / class_id).

    admin: anyone/any class; teacher: their classes, or a student in one of
    their classes; parent: only their own linked child (not a class);
    student: nobody.
    """
    if (student_id is None) == (class_id is None):
        return False
    role = _role(caller_person)
    if role == "admin":
        return True
    if role == "teacher":
        if class_id is not None:
            return store.is_teacher_of_class(caller_person["id"], class_id)
        return teaches_student(caller_person["id"], student_id, store)
    if role == "parent":
        return student_id is not None and store.is_parent_of(caller_person["id"], student_id)
    return False


@_deny_on_bad_input
def can_append_session(caller_person, student_id):
    """Only the student records their own reading (admin allowed for backfill/repair)."""
    role = _role(caller_person)
    if role == "admin":
        return bool(student_id)
    return role == "student" and caller_person["id"] == student_id


def can_manage_people(caller_person):
    """Create/update people, link parent<->student and teacher<->class, enrol: admin only."""
    return _role(caller_person) == "admin"
