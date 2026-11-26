#!/usr/bin/env python3
"""Read-only 3 x 2 x lane-category evidence report for Nexus border sources.

The matrix describes what the *normalized official feeds* contain, NOT a claim
that a crossing supports a specific lane, that a lane is physically operating,
or that a published schedule proves live access. The intended UI comparison
remains passenger/commercial Regular plus applicable NEXUS/Ready/FAST.

The report never reads API credentials, makes network requests or changes JSON.
"""
from datetime import datetime, timezone
import math
import re

CROSSINGS = ("ambassador", "tunnel", "gordie")
CROSSING_LABELS = {
    "ambassador": "Ambassador",
    "tunnel": "Tunnel",
    "gordie": "Gordie Howe",
}
CATEGORIES = (
    ("Passenger Regular", "standard"),
    ("Passenger NEXUS", "nexus"),
    ("Passenger Ready", "ready"),
    ("Commercial Regular", "commercial"),
    ("Commercial FAST", "fast"),
)
NOT_PUBLISHED_CA = frozenset(("nexus", "ready", "fast"))

# Nexus engineering display policy, not a CBP/CBSA agency update guarantee.
SOURCE_RECENT_MINUTES = 20
OBSERVATION_RECENT_MINUTES = 20


def age_minutes(stamp, now):
    if not isinstance(stamp, str) or not re.fullmatch(r"\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})", stamp.strip(), flags=re.IGNORECASE):
        return None
    try:
        dt = datetime.fromisoformat(stamp.replace("Z", "+00:00"))
        if dt.tzinfo is None:
            return None
        value = (now.astimezone(timezone.utc) -
                 dt.astimezone(timezone.utc)).total_seconds() / 60
        # Match the decision engine's two-minute clock-skew tolerance.
        if not math.isfinite(value) or value < -2:
            return None
        return max(0, value)
    except (ValueError, OverflowError, TypeError):
        return None


def known_port_closed(port):
    return (isinstance(port, dict) and isinstance(port.get("port_status"), str)
            and bool(re.match(r"^\s*(temporarily\s+)?closed\b",
                              port["port_status"], flags=re.IGNORECASE)))


def cell(data, direction, crossing, category, now):
    """Return a safe, compact *evidence* label, not a route recommendation.

    Allowed category/side pairs are fixed by publisher schemas, not by assumed
    physical lane support. Canada-bound NEXUS/Ready/FAST lack separate CBSA
    inspection-wait observations; report 'not published' even when a published
    schedule or DWT operator count exists elsewhere in the snapshot.
    """
    if direction not in ("ca", "us") or crossing not in CROSSINGS or category not in dict(
        (field, field) for _, field in CATEGORIES
    ):
        raise ValueError("Unexpected matrix coordinate")

    if direction == "ca" and category in NOT_PUBLISHED_CA:
        return "Not published"

    sources = data.get("sources") if isinstance(data, dict) else {}
    sources = sources if isinstance(sources, dict) else {}
    directions = data.get("directions") if isinstance(data, dict) else {}
    directions = directions if isinstance(directions, dict) else {}
    source_name = "cbp" if direction == "us" else "cbsa"
    src = sources.get(source_name)
    if not isinstance(src, dict):
        return "Source unavailable"

    retained = src.get("retained_previous") is True
    src_age = age_minutes(src.get("retrieved_at"), now)
    success = src.get("last_success_at")
    if success is None and not retained and src.get("status") == "ok":
        success = src.get("retrieved_at")
    success_age = age_minutes(success, now)
    snap_age = age_minutes(data.get("generated_at"), now)
    clocks = (src_age, success_age, snap_age)
    valid = (src.get("status") == "ok" or
             (src.get("status") == "error" and retained)) and all(a is not None for a in clocks)
    recent_source = valid and src.get("status") == "ok" and not retained and max(clocks) <= 20
    historical = valid and max(clocks) < 120

    ports = directions.get(direction)
    port = ports.get(crossing) if isinstance(ports, dict) else None
    if not isinstance(port, dict):
        return "No port record"

    if known_port_closed(port):
        return "Port closure reported; currency unverified"

    reading = port.get(category)
    if not isinstance(reading, dict):
        return "Wait not reported"

    status = reading.get("status")
    observed = age_minutes(reading.get("observation_at"), now)

    if status == "closed":
        if recent_source and observed is not None and observed <= OBSERVATION_RECENT_MINUTES:
            return "Lane closure reported"
        return "Closure reported; currency unverified"

    if not historical:
        return "Source unavailable" if not valid else "Source/snapshot expired"

    if status == "not_applicable":
        return ("Agency field N/A" if recent_source and
                (not reading.get("observation_at") or (observed is not None and observed <= 20))
                else "Earlier agency N/A; applicability unverified")

    if not recent_source:
        return "Historical retained observation" if retained and observed is not None and observed < 120 else "Source/snapshot old"

    if status != "reported":
        return "Wait unavailable"

    minutes = reading.get("minutes")
    if (type(minutes) is not int or not 0 <= minutes <= 720):
        return "Invalid wait field"
    if observed is None:
        return "Wait has no timestamp"
    if observed >= 120:
        return "Observation expired"
    if observed > OBSERVATION_RECENT_MINUTES:
        return "Older observation (" + str(round(observed)) + "m)"

    # A lane count only belongs to the *exact* CBP direction/category record.
    # Neither CBSA commercial/traveller flow nor operator schedule counts
    # may be substituted for a specific current booth count.
    count = reading.get("lanes_open") if direction == "us" else None
    if type(count) is int and 0 <= count <= 100:
        return "Recent (" + str(round(observed)) + "m); " + str(count) + " lanes reported"
    return "Recent (" + str(round(observed)) + "m); count unavailable"


def rows(data, now):
    result = []
    for crossing in CROSSINGS:
        for direction in ("ca", "us"):
            result.append(
                (CROSSING_LABELS[crossing], "Canada" if direction == "ca" else "USA",
                 [cell(data, direction, crossing, cat, now) for _, cat in CATEGORIES])
            )
    return result


def markdown(data, now):
    headings = ("Crossing", "Into") + tuple(label for label, _ in CATEGORIES)
    lines = [
        "### Official inspection-field coverage (3 crossings × 2 directions)",
        "",
        "| " + " | ".join(headings) + " |",
        "|" + "|".join("---" for _ in headings) + "|",
    ]
    for crossing, direction, entries in rows(data, now):
        lines.append("| " + " | ".join((crossing, direction, *entries)) + " |")
    lines.extend([
        "",
        "**Interpretation:** Recent = agency observation ≤20 min old, source retrieval and "
        "last successful retrieval and snapshot ≤20 min old. Historical expiry ≥120m; thresholds are Nexus policy, **not** agency "
        "publication guarantees. Older observation is not a current wait.",
        "",
        "**Not published** = separate Canada-bound category-specific inspection waits "
        "are absent from the CBSA source used by Nexus. It does **not** mean the lane "
        "does not exist, is closed or is ineligible. **Agency field N/A** preserves "
        "the source's wording; it is not independently verified physical eligibility. "
        "**Lane/port closure reported** describes source status, not confirmed live "
        "gate operation. A published schedule or operator lane count does not "
        "substitute for a current lane-category wait.",
        "",
    ])
    return "\n".join(lines)
