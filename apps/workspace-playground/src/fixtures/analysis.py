"""Sample analysis script for the workspace playground."""

import csv
from collections import Counter


def load_data(path: str) -> list[dict]:
    with open(path) as f:
        return list(csv.DictReader(f))


def count_by_role(records: list[dict]) -> dict[str, int]:
    return dict(Counter(r["role"] for r in records))


def active_users(records: list[dict]) -> list[str]:
    return [r["name"] for r in records if r["active"] == "true"]


if __name__ == "__main__":
    data = load_data("data.csv")
    print("Roles:", count_by_role(data))
    print("Active:", active_users(data))
