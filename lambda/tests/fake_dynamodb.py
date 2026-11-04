"""Minimal in-memory stand-in for a boto3 DynamoDB Table resource.

Supports what lambda/common/people_store.py uses, with real-DynamoDB
behaviour where it matters for correctness:
  - get_item / put_item / delete_item / update_item (SET and ADD only)
  - ConditionExpression as boto3 condition objects (Attr/Key builders) or
    the plain strings "attribute_not_exists(x)" / "attribute_exists(x)";
    a failed condition raises botocore ClientError
    ConditionalCheckFailedException, like the real service
  - query on the table or a GSI with KeyConditionExpression (= on the
    partition key, begins_with / comparisons / between on the sort key),
    ScanIndexForward, Limit, ExclusiveStartKey / LastEvaluatedKey
  - sparse GSIs (items without the index keys are not in the index)
  - floats rejected (boto3 does too); stored items are deep-copied
No network, no moto.
"""
from __future__ import annotations

import copy
import re
from decimal import Decimal

from botocore.exceptions import ClientError


def _ccf(op):
    return ClientError(
        {"Error": {"Code": "ConditionalCheckFailedException",
                   "Message": "The conditional request failed"}}, op)


def _validation(op, msg):
    return ClientError({"Error": {"Code": "ValidationException", "Message": msg}}, op)


def _reject_floats(value, path="item"):
    if isinstance(value, float):
        raise TypeError(f"Float types are not supported. Use Decimal types instead ({path})")
    if isinstance(value, dict):
        for k, v in value.items():
            _reject_floats(v, f"{path}.{k}")
    elif isinstance(value, list):
        for i, v in enumerate(value):
            _reject_floats(v, f"{path}[{i}]")


_MISSING = object()


def _operand(value, item):
    # Attr/Key objects have a .name; everything else is a literal.
    name = getattr(value, "name", None)
    if name is not None and value.__class__.__name__ in ("Attr", "Key"):
        return item.get(name, _MISSING)
    return value


def evaluate(cond, item):
    """Evaluate a boto3 condition (or a simple string) against an item dict."""
    if isinstance(cond, str):
        m = re.fullmatch(r"\s*(attribute_not_exists|attribute_exists)\(\s*(\w+)\s*\)\s*", cond)
        if not m:
            raise NotImplementedError(f"string condition not supported: {cond}")
        present = m.group(2) in item
        return present if m.group(1) == "attribute_exists" else not present
    expr = cond.get_expression()
    op, vals = expr["operator"], expr["values"]
    if op == "AND":
        return evaluate(vals[0], item) and evaluate(vals[1], item)
    if op == "OR":
        return evaluate(vals[0], item) or evaluate(vals[1], item)
    if op == "NOT":
        return not evaluate(vals[0], item)
    if op == "attribute_exists":
        return _operand(vals[0], item) is not _MISSING
    if op == "attribute_not_exists":
        return _operand(vals[0], item) is _MISSING
    left = _operand(vals[0], item)
    if left is _MISSING:
        return False
    if op == "begins_with":
        return isinstance(left, str) and left.startswith(vals[1])
    if op == "BETWEEN":
        return vals[1] <= left <= vals[2]
    right = _operand(vals[1], item)
    if right is _MISSING:
        return False
    try:
        return {"=": left == right, "<>": left != right, "<": left < right,
                "<=": left <= right, ">": left > right, ">=": left >= right}[op]
    except KeyError:
        raise NotImplementedError(f"operator {op}") from None
    except TypeError:
        return False


def _key_condition_parts(cond):
    """Split a KeyConditionExpression into (partition_name, value, sort_condition)."""
    expr = cond.get_expression()
    if expr["operator"] == "AND":
        a, b = expr["values"]
        pk = _key_condition_parts(a)
        return pk[0], pk[1], b
    if expr["operator"] != "=":
        raise ValueError("partition key condition must be equality")
    return expr["values"][0].name, expr["values"][1], None


class FakeTable:
    def __init__(self, hash_key="pk", range_key="sk", gsis=None, name="fake-people"):
        self.name = self.table_name = name
        self.hash_key, self.range_key = hash_key, range_key
        # {index_name: (hash, range)}
        self.gsis = gsis if gsis is not None else {"gsi1": ("gsi1pk", "gsi1sk")}
        self.items = {}
        self.calls = []

    # -- helpers --
    def _key(self, key, op):
        expected = {self.hash_key} | ({self.range_key} if self.range_key else set())
        if set(key) != expected:
            raise _validation(op, "The provided key element does not match the schema")
        return tuple(key[k] for k in (self.hash_key, self.range_key) if k)

    def _item_key(self, item):
        return {k: item[k] for k in (self.hash_key, self.range_key) if k}

    def _check(self, cond, current, op):
        if cond is not None and not evaluate(cond, current or {}):
            raise _ccf(op)

    # -- API --
    def get_item(self, Key, ConsistentRead=False, **_):
        self.calls.append(("get_item", Key))
        item = self.items.get(self._key(Key, "GetItem"))
        return {"Item": copy.deepcopy(item)} if item is not None else {}

    def put_item(self, Item, ConditionExpression=None, **_):
        self.calls.append(("put_item", Item))
        _reject_floats(Item)
        for k in (self.hash_key, self.range_key):
            if k and not isinstance(Item.get(k), str):
                raise _validation("PutItem", f"missing key {k}")
        k = self._key(self._item_key(Item), "PutItem")
        self._check(ConditionExpression, self.items.get(k), "PutItem")
        self.items[k] = copy.deepcopy(Item)
        return {}

    def delete_item(self, Key, ConditionExpression=None, **_):
        self.calls.append(("delete_item", Key))
        k = self._key(Key, "DeleteItem")
        self._check(ConditionExpression, self.items.get(k), "DeleteItem")
        self.items.pop(k, None)
        return {}

    def update_item(self, Key, UpdateExpression, ExpressionAttributeNames=None,
                    ExpressionAttributeValues=None, ConditionExpression=None,
                    ReturnValues="NONE", **_):
        self.calls.append(("update_item", Key))
        names = ExpressionAttributeNames or {}
        values = ExpressionAttributeValues or {}
        _reject_floats(values, "values")
        k = self._key(Key, "UpdateItem")
        current = self.items.get(k)
        self._check(ConditionExpression, current, "UpdateItem")
        item = copy.deepcopy(current) if current else dict(Key)
        for clause, body in re.findall(r"(SET|ADD)\s+(.*?)(?=\s+(?:SET|ADD)\s+|$)", UpdateExpression.strip()):
            for part in (p.strip() for p in body.split(",")):
                if clause == "SET":
                    lhs, rhs = (x.strip() for x in part.split("="))
                    item[names.get(lhs, lhs)] = copy.deepcopy(values[rhs])
                else:
                    lhs, rhs = part.split()
                    attr = names.get(lhs, lhs)
                    item[attr] = Decimal(item.get(attr, 0)) + Decimal(values[rhs])
        self.items[k] = item
        return {"Attributes": copy.deepcopy(item)} if ReturnValues == "ALL_NEW" else {}

    def query(self, KeyConditionExpression, IndexName=None, ScanIndexForward=True,
              Limit=None, ExclusiveStartKey=None, ConsistentRead=False, **_):
        self.calls.append(("query", IndexName))
        if IndexName:
            if IndexName not in self.gsis:
                raise _validation("Query", f"index {IndexName} not found")
            if ConsistentRead:
                raise _validation("Query", "Consistent reads are not supported on GSIs")
            hk, rk = self.gsis[IndexName]
        else:
            hk, rk = self.hash_key, self.range_key
        pname, pval, sort_cond = _key_condition_parts(KeyConditionExpression)
        if pname != hk:
            raise _validation("Query", f"partition key must be {hk}, got {pname}")
        rows = [i for i in self.items.values()
                if hk in i and (not rk or rk in i) and i[hk] == pval
                and (sort_cond is None or evaluate(sort_cond, i))]
        # Index rows are ordered by index sort key, ties by table key.
        rows.sort(key=lambda i: ((i.get(rk) if rk else ""), i[self.hash_key], i.get(self.range_key, "")),
                  reverse=not ScanIndexForward)
        if ExclusiveStartKey:
            start = self._key(self._item_key(ExclusiveStartKey), "Query")
            idx = next((n for n, i in enumerate(rows)
                        if self._key(self._item_key(i), "Query") == start), None)
            rows = rows[idx + 1:] if idx is not None else rows
        resp = {}
        if Limit is not None and len(rows) > Limit:
            rows = rows[:Limit]
            last = rows[-1]
            lek = self._item_key(last)
            if IndexName:
                lek.update({hk: last[hk], rk: last[rk]})
            resp["LastEvaluatedKey"] = lek
        resp["Items"] = copy.deepcopy(rows)
        resp["Count"] = len(rows)
        return resp
