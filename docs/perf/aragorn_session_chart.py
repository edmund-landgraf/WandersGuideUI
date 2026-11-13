#!/usr/bin/env python3
"""Chart the 2 Nov 2026 Aragorn wgui MCP session.

Reads aragorn-mcp-session-2026-11-02-tools.csv and writes
aragorn-mcp-session-2026-11-02.png beside this script.

    python3 docs/perf/aragorn_session_chart.py

matplotlib and pandas are used only to draw the figure. They are not
project dependencies.
"""

from __future__ import annotations

import math
from collections import Counter
from pathlib import Path

import matplotlib

matplotlib.use("Agg")

import matplotlib.pyplot as plt
import numpy as np
import pandas as pd
from matplotlib.patches import Patch

HERE = Path(__file__).resolve().parent
CSV_PATH = HERE / "aragorn-mcp-session-2026-11-02-tools.csv"
PNG_PATH = HERE / "aragorn-mcp-session-2026-11-02.png"

# Kong completion that opens the session. The x-axis is seconds after this.
ORIGIN = pd.to_datetime("16:57:35.765", format="%H:%M:%S.%f")
MIN_BAR_S = 0.6

FAMILY_ORDER = [
    "choose",
    "list_options",
    "list_open_choices",
    "add_inventory",
    "set_identity",
    "create",
    "export",
    "other",
]

FAMILY_COLORS = {
    "choose": "#1D4E89",
    "list_options": "#0F766E",
    "list_open_choices": "#A16207",
    "add_inventory": "#C2410C",
    "set_identity": "#6D28D9",
    "create": "#166534",
    "export": "#BE185D",
    "other": "#64748B",
}

THINKING_COLOR = "#F3D48A"
SERVER_COLOR = "#1D4E89"
OTHER_BAR_COLOR = "#94A3B8"
INK = "#1D2939"
MUTED = "#475467"


def tool_family(name: str) -> str:
    if name == "choose":
        return "choose"
    if name.startswith("list_options"):
        return "list_options"
    if name == "list_open_choices":
        return "list_open_choices"
    if name.startswith("add_inventory"):
        return "add_inventory"
    if name.startswith("set_identity"):
        return "set_identity"
    if name.startswith("create_"):
        return "create"
    if name.startswith("export_"):
        return "export"
    return "other"


def seconds_since_origin(values: pd.Series) -> np.ndarray:
    parsed = pd.to_datetime(values, format="%H:%M:%S.%f")
    return (parsed - ORIGIN).dt.total_seconds().to_numpy()


def parse_functions(cell: object) -> list[tuple[str, int]]:
    """Parse `namexN` entries joined by `|` into (function, call count)."""
    if cell is None or (isinstance(cell, float) and math.isnan(cell)):
        return []
    text = str(cell).strip()
    if not text or text.lower() == "nan":
        return []
    parsed: list[tuple[str, int]] = []
    for part in text.split("|"):
        name, raw_n = part.rsplit("x", 1)
        parsed.append((name, int(raw_n)))
    return parsed


def function_totals(df: pd.DataFrame) -> Counter[str]:
    totals: Counter[str] = Counter()
    for cell in df["functions"]:
        for name, count in parse_functions(cell):
            totals[name] += count
    return totals


def clock_label(elapsed_s: float, _pos: object = None) -> str:
    total = (16 * 3600) + (57 * 60) + 35.765 + float(elapsed_s)
    total %= 24 * 3600
    hours = int(total // 3600)
    minutes = int((total % 3600) // 60)
    seconds = int(total % 60)
    return f"{hours:02d}:{minutes:02d}:{seconds:02d}"


def draw_timeline(ax: plt.Axes, df: pd.DataFrame, families: list[str]) -> None:
    start = seconds_since_origin(df["first_completed_pt"])
    end = seconds_since_origin(df["last_completed_pt"])
    width = np.maximum(end - start, MIN_BAR_S)
    y = np.arange(len(df))
    colors = [FAMILY_COLORS[family] for family in families]

    ax.barh(
        y,
        width,
        left=start,
        height=0.78,
        color=colors,
        edgecolor="none",
        zorder=3,
    )
    ax.set_ylim(len(df) - 0.5, -0.5)
    labels = [
        f"{int(burst):02d}  {tool}"
        for burst, tool in zip(df["inferred_burst_id"], df["inferred_tool"], strict=True)
    ]
    ax.set_yticks(y)
    ax.set_yticklabels(labels, fontsize=7.5)
    for tick, family in zip(ax.get_yticklabels(), families, strict=True):
        tick.set_color(FAMILY_COLORS[family])

    xmax = max(float(start.max() + width.max()) + 8.0, 400.0)
    ax.set_xlim(-2, xmax)
    ax.set_xticks(np.arange(0, 391, 30))
    ax.set_xlabel(
        "Seconds since 16:57:35.765\n"
        "Each bar runs from the first backend completion to the last "
        f"(minimum {MIN_BAR_S:.1f} s). White space is client/model thinking."
    )
    ax.set_ylabel("Inferred tool, in burst order")
    ax.xaxis.grid(True, color="#EAECF0", linewidth=0.8, zorder=0)
    ax.set_axisbelow(True)
    ax.tick_params(axis="x", labelsize=8, colors=MUTED)
    ax.spines["top"].set_visible(False)
    ax.spines["right"].set_visible(False)
    ax.spines["left"].set_color("#D0D5DD")
    ax.spines["bottom"].set_color("#D0D5DD")

    clock = ax.secondary_xaxis("top", functions=(lambda value: value, lambda value: value))
    clock.set_xticks(np.arange(0, 391, 60))
    clock.xaxis.set_major_formatter(plt.FuncFormatter(clock_label))
    clock.set_xlabel("Clock time (PT)", fontsize=9, color=MUTED, labelpad=6)
    clock.tick_params(labelsize=8, colors=MUTED)
    clock.spines["top"].set_color("#D0D5DD")


def draw_donut(ax: plt.Axes, thinking_s: float, server_s: float) -> None:
    total = thinking_s + server_s
    thinking_pct = int(round(100 * thinking_s / total))
    server_pct = int(round(100 * server_s / total))
    sizes = [thinking_s, server_s]
    colors = [THINKING_COLOR, SERVER_COLOR]

    ax.pie(
        sizes,
        startangle=90,
        colors=colors,
        wedgeprops=dict(width=0.46, edgecolor="white", linewidth=2),
    )
    ax.set_aspect("equal")

    # Both labels sit outside the ring. The thinking line is long enough
    # that a label centered in the wedge spills past the gold edge.
    thinking_extent = 360 * thinking_s / total
    thinking_mid = math.radians(90 + thinking_extent / 2)
    tip_r = 0.78
    ax.annotate(
        f"Client/model thinking\n{thinking_s:.1f} s ({thinking_pct}%)",
        xy=(tip_r * math.cos(thinking_mid), tip_r * math.sin(thinking_mid)),
        xytext=(-1.55, -0.95),
        ha="right",
        va="center",
        fontsize=10,
        color=INK,
        arrowprops=dict(arrowstyle="-", color="#98A2B3", lw=0.8),
        annotation_clip=False,
    )

    server_start = 90 + thinking_extent
    server_extent = 360 * server_s / total
    server_mid = math.radians(server_start + server_extent / 2)
    ax.annotate(
        f"Server work\n{server_s:.1f} s ({server_pct}%)",
        xy=(tip_r * math.cos(server_mid), tip_r * math.sin(server_mid)),
        xytext=(1.35, 0.85),
        ha="left",
        va="center",
        fontsize=10,
        color=INK,
        arrowprops=dict(arrowstyle="-", color="#98A2B3", lw=0.8),
        annotation_clip=False,
    )
    ax.set_xlim(-2.55, 2.35)
    ax.set_ylim(-1.35, 1.35)
    ax.text(
        0,
        0.06,
        f"{thinking_s + server_s:.1f} s",
        ha="center",
        va="center",
        fontsize=14,
        color=INK,
        fontweight="bold",
    )
    ax.text(
        0,
        -0.16,
        "session",
        ha="center",
        va="center",
        fontsize=8,
        color=MUTED,
    )
    ax.set_title(
        "(b)  Where the session went",
        loc="left",
        fontsize=12,
        color=INK,
        pad=10,
    )


def draw_functions(ax: plt.Axes, totals: Counter[str]) -> None:
    ranked = sorted(totals.items(), key=lambda item: (-item[1], item[0]))
    top = ranked[:8]
    other = sum(count for _name, count in ranked[8:])
    # barh draws the first row at the bottom; reverse so the largest is on top
    # and the residual "other" bar stays last.
    rows = list(reversed(top + [("other", other)]))
    names = [name for name, _count in rows]
    values = [count for _name, count in rows]
    colors = [OTHER_BAR_COLOR if name == "other" else SERVER_COLOR for name in names]

    positions = np.arange(len(rows))
    bars = ax.barh(positions, values, color=colors, height=0.72, zorder=3)
    ax.set_yticks(positions)
    ax.set_yticklabels(names, fontsize=9)
    ax.set_xlabel("Backend calls")
    ax.set_xlim(0, max(values) * 1.16)
    ax.xaxis.grid(True, color="#EAECF0", linewidth=0.8, zorder=0)
    ax.set_axisbelow(True)
    ax.tick_params(axis="x", labelsize=8, colors=MUTED)
    ax.tick_params(axis="y", length=0)
    ax.spines["top"].set_visible(False)
    ax.spines["right"].set_visible(False)
    ax.spines["left"].set_color("#D0D5DD")
    ax.spines["bottom"].set_color("#D0D5DD")
    for bar, value in zip(bars, values, strict=True):
        ax.text(
            value + max(values) * 0.015,
            bar.get_y() + bar.get_height() / 2,
            str(value),
            va="center",
            ha="left",
            fontsize=9,
            color=INK,
        )
    call_total = sum(totals.values())
    ax.set_title(
        f"(c)  Backend calls by Supabase function  ({call_total})",
        loc="left",
        fontsize=12,
        color=INK,
        pad=10,
    )


def main() -> None:
    df = pd.read_csv(CSV_PATH)
    if len(df) != 57:
        raise SystemExit(f"expected 57 tool rows, found {len(df)}")

    families = [tool_family(name) for name in df["inferred_tool"]]
    totals = function_totals(df)
    parsed_calls = sum(totals.values())
    stated_calls = int(df["backend_calls"].sum())
    if parsed_calls != stated_calls:
        raise SystemExit(
            f"parsed function calls ({parsed_calls}) != backend_calls ({stated_calls})"
        )

    thinking_s = float(df["gap_before_ms"].sum(skipna=True)) / 1000
    server_s = float(df["burst_ms"].sum(skipna=True)) / 1000

    plt.rcParams.update(
        {
            "font.family": "DejaVu Sans",
            "axes.titleweight": "bold",
            "figure.facecolor": "white",
            "axes.facecolor": "white",
            "text.color": INK,
            "axes.labelcolor": INK,
        }
    )

    fig = plt.figure(figsize=(15.5, 19.4))
    grid = fig.add_gridspec(
        2,
        2,
        height_ratios=[3.35, 1.22],
        hspace=0.34,
        wspace=0.30,
        left=0.22,
        right=0.97,
        top=0.84,
        bottom=0.05,
    )
    ax_timeline = fig.add_subplot(grid[0, :])
    ax_donut = fig.add_subplot(grid[1, 0])
    ax_functions = fig.add_subplot(grid[1, 1])

    draw_timeline(ax_timeline, df, families)
    draw_donut(ax_donut, thinking_s, server_s)
    draw_functions(ax_functions, totals)

    fig.suptitle(
        "Aragorn MCP session  ·  2 Nov 2026  ·  level-5 Human Ranger",
        fontsize=16,
        fontweight="bold",
        color=INK,
        x=0.22,
        ha="left",
        y=0.975,
    )
    fig.text(
        0.22,
        0.942,
        "(a)  Timeline — one bar per inferred tool, first completion to last",
        fontsize=12,
        fontweight="bold",
        color=INK,
        ha="left",
        va="center",
    )
    legend_handles = [
        Patch(facecolor=FAMILY_COLORS[family], edgecolor="none", label=family)
        for family in FAMILY_ORDER
    ]
    legend_handles.append(
        Patch(
            facecolor="white",
            edgecolor="#98A2B3",
            label="white gap: client/model thinking",
        )
    )
    fig.legend(
        handles=legend_handles,
        loc="upper left",
        bbox_to_anchor=(0.22, 0.922),
        ncol=5,
        frameon=False,
        fontsize=8.5,
        handlelength=1.4,
        columnspacing=1.2,
        borderaxespad=0,
    )

    fig.savefig(PNG_PATH, dpi=150, facecolor="white")
    print(f"wrote {PNG_PATH}")
    print(f"tools={len(df)} backend_calls={stated_calls} functions={len(totals)}")
    print(f"thinking_s={thinking_s:.3f} server_s={server_s:.3f}")
    for name, count in sorted(totals.items(), key=lambda item: (-item[1], item[0])):
        print(f"  {count:4d}  {name}")


if __name__ == "__main__":
    main()
