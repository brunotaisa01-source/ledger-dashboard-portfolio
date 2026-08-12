"""Regression tests for category-driven Ledger owner-map rules."""

from pathlib import Path

from openpyxl import Workbook
from openpyxl.worksheet.table import Table

from scripts.utils.masterdata_core import build_owner_map_rol, current_ledger_owners


def _write_owner_map(path: Path) -> None:
    workbook = Workbook()
    worksheet = workbook.active
    worksheet.title = "Owner Map"
    headers = [
        "Sheet",
        "Category",
        "Category Alias",
        "Owner",
        "Active",
        "Required Owner",
        "Rule Type",
    ]
    worksheet.append(headers)
    worksheet.append(["ROL", "Bakery", "bakery", "Synthetic Owner 001", True, True, "Current"])
    worksheet.append(["ROL", "Fuel AP", "fuel ap", "", True, False, "Current"])
    table = Table(displayName="LedgerOwnerMap", ref="A1:G3")
    worksheet.add_table(table)
    workbook.save(path)
    workbook.close()


def test_required_owner_false_keeps_category_without_creating_fuel_owner(tmp_path: Path):
    path = tmp_path / "Owner_map_Ledger.xlsx"
    _write_owner_map(path)

    mapping = build_owner_map_rol(owner_map_path=path)

    assert mapping["bakery"] == "Synthetic Owner 001"
    assert mapping["fuel ap"] == ""
    assert "Fuel AP" not in current_ledger_owners(owner_map_path=path)
