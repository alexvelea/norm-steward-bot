#!/usr/bin/env python3
"""Norn Steward: the starter steward, in Python.

One file, standard library only, Python 3.10+. Copy it anywhere and change it:

    python bots/python/starter.py

Environment:
    STEWARD_URL      the server (default http://localhost:8787)
    STEWARD_KEY      your API key. Without one, STEWARD_NAME signs up and prints a new key once.
    STEWARD_NAME     the player name to sign up with (3-24 letters, digits, _ or -)
    STEWARD_WORLD    the world to play. Default: your first sandbox, else the first public world.
    STEWARD_SANDBOX  1 = create a fresh sandbox and play there.

What it does: joins, then loops on "act, then long-poll /events until something it cares about".
It goes straight for raiders and a first party, farms the cheapest nearby hamlets with standing raid
orders sized by the battle simulator, grows the economy from the build options the server computes,
keeps defence and offence in step with the farm, and answers incoming attacks by recalling raids
and sending support. Every rule number
comes from GET /worlds/{w}/rules; the numbers in STRATEGY below are this bot's taste, not rules.

It is the same bot as bots/typescript/starter.ts, function for function.
"""

from __future__ import annotations

import json
import math
import os
import random
import string
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any

# ---------------------------------------------------------------------------------------------
# This bot's taste. Change these first.

STRATEGY: dict[str, Any] = {
    # Seconds to hold each long-poll (the server caps it at LIMITS.maxEventWaitSeconds).
    "wait_seconds": 20,
    # A brand-new sandbox runs at this many ticks per real second.
    "sandbox_speed": 10,
    # Queue a farm when less than this share of the population limit is free.
    "farm_when_free_below": 0.12,
    # Queue a storehouse when any resource passes this share of storage.
    "storehouse_when_fuller_than": 0.8,
    # Keep the weakest resource building within this many levels above the hall before anything else.
    "economy_lead_over_hall": 2,
    # While raiders come first, still take every resource building to this level: each level pays for itself well within a round.
    "first_economy_level": 7,
    # Build items in the queue at once; the rest of the resources stay free for troops.
    "max_queued_builds": 2,
    # Hold resources for a wanted building when production covers it within this many ticks.
    "save_for_ticks": 90,
    # Training batches per building at once.
    "max_queued_batches": 2,
    # Spend at most this share of what a batch could buy, so the economy keeps growing.
    "train_spend_share": 0.5,
    # Population shares of the farm limit to keep in defensive and offensive troops.
    "defense_pop_share": 0.2,
    "offense_pop_share": 0.35,
    # Troops this far below their target (a share of it) are trained before anything is built.
    "troops_first_when_short": 0.5,
    # The defensive core (population) trained before anything else: enough to see off a stray party.
    "core_defense_pop": 5,
    # How many hamlets each village farms, how many of the nearest it sizes parties for, and how far it looks (fields).
    "raid_targets": 3,
    "raid_candidates": 5,
    "raid_radius": 12,
    # A raid party is the smallest the simulator says wins losing at most this share of its population,
    # and carries home more than its losses cost. The first raid on a hamlet may lose more and needn't
    # pay (its militia has grown since tick 0, and one win knocks it back to the base), but it must leave
    # a party that can keep farming it.
    "raid_max_loss": 0.2,
    "first_raid_max_loss": 0.4,
    "raid_replan_ticks": 600,
    # Once raids stand, re-plan them early when the raiding force has grown by this share since the last plan.
    "replan_after_growth": 0.25,
    "map_refresh_ticks": 900,
    # With no watchtower sighting, guess an attacker's army population from its village's points.
    "threat_pop_per_point": 0.5,
    # A "host" sighting has no upper bound: guess this many times the largest bounded bucket.
    "host_over_army": 2,
    # Act-then-reread passes per wake-up, so one wake can queue a build and then train.
    "passes_per_wake": 4,
    # Wake at least this often (ticks) even when nothing is due, so resources don't sit idle.
    "idle_wake_ticks": 60,
    # Real-time pauses (seconds).
    "paused_poll_s": 3,
    "round_poll_s": 15,
    "error_pause_s": 5,
    # Give up after this many failed wake-ups in a row (the server is gone, or the world was deleted).
    "max_consecutive_errors": 20,
}

RESOURCES = ["timber", "stone", "iron"]
RESOURCE_BUILDINGS = {"timber": "lumberyard", "stone": "quarry", "iron": "mine"}
DEFENSIVE_UNITS = ["pikeman", "shieldman", "archer"]
# Raiding units, best first.
RAID_UNITS = ["lancer", "raider"]

# The first raiding unit: a village with no raids going builds straight for it (see raiders_first).
FIRST_RAIDER: dict[str, Any] = {"unit": "raider"}
# What to work toward, in order, once the economy and storage are looked after.
GOALS: list[dict[str, Any]] = [
    {"unit": "pikeman"},
    {"unit": "raider"},
    {"unit": "shieldman"},
    {"building": "wall", "level": 3},
    {"building": "hall", "level": 8},
    {"unit": "lancer"},
    {"building": "watchtower", "level": 2},
    {"building": "wall", "level": 8},
    {"building": "market", "level": 3},
    {"unit": "archer"},
    {"building": "cellar", "level": 5},
    {"building": "wall", "level": 15},
    {"unit": "knight"},
]

Units = dict[str, int]
Json = dict[str, Any]

# ---------------------------------------------------------------------------------------------
# Small helpers


def log(tick: int | None, where: str, message: str) -> None:
    now = datetime.now(timezone.utc).strftime("%H:%M:%S")
    prefix = "" if tick is None else f"t{tick} "
    print(f"{now} {prefix}{where}: {message}", flush=True)


def distance(a: Json, b: Json) -> float:
    return math.hypot(a["x"] - b["x"], a["y"] - b["y"])


def add_units(*groups: Units | None) -> Units:
    total: Units = {}
    for group in groups:
        for unit, n in (group or {}).items():
            total[unit] = total.get(unit, 0) + n
    return total


def subtract_units(left: Units, take: Units) -> Units:
    out = dict(left)
    for unit, n in take.items():
        out[unit] = max(0, out.get(unit, 0) - n)
    return out


def pick(units: Units, keep: list[str]) -> Units:
    return {u: units[u] for u in keep if units.get(u)}


def omit(units: Units, drop: list[str]) -> Units:
    return {u: n for u, n in units.items() if n and u not in drop}


def fits_in(party: Units, pool: Units) -> bool:
    return all(n <= pool.get(u, 0) for u, n in party.items())


def describe_units(units: Units) -> str:
    parts = [f"{n} {u}" for u, n in units.items() if n]
    return ", ".join(parts) if parts else "nobody"


# ---------------------------------------------------------------------------------------------
# The HTTP client: auth, JSON, 429 Retry-After, and retries that are safe because of clientIds.


class ApiFailure(Exception):
    def __init__(self, status: int, code: str, message: str, details: Json | None = None):
        super().__init__(f"{status} {code}: {message}")
        self.status = status
        self.code = code
        self.details = details or {}


class Client:
    MAX_ATTEMPTS = 6
    # Waits shorter than this are the bucket refilling at full speed: normal, so not worth a log line.
    QUIET_RETRY_MS = 1000

    def __init__(self, base: str, key: str | None):
        self.base = base
        self.key = key

    def call(self, method: str, path: str, body: Any = None, query: dict[str, Any] | None = None,
             timeout: float = 30) -> Any:
        url = f"{self.base}/api/v1{path}"
        params = {k: v for k, v in (query or {}).items() if v is not None}
        if params:
            url += "?" + urllib.parse.urlencode(params)
        headers = {}
        if self.key:
            headers["Authorization"] = f"Bearer {self.key}"
        # Only send a content type with a body: an empty JSON body is a 400.
        # The same bytes go out on every retry, so a retried action batch carries the same clientIds.
        data = None
        if body is not None:
            headers["Content-Type"] = "application/json"
            data = json.dumps(body).encode("utf-8")

        attempt = 0
        while True:
            attempt += 1
            request = urllib.request.Request(url, data=data, method=method, headers=headers)
            try:
                with urllib.request.urlopen(request, timeout=timeout) as response:
                    raw = response.read()
                    return json.loads(raw) if raw else None
            except urllib.error.HTTPError as err:
                payload = _json_or_none(err.read())
                error = (payload or {}).get("error") or {"code": f"HTTP_{err.code}", "message": err.reason}
                details = error.get("details") or {}
                # A Council world's early batch carries nextActTick: that's a game wait, not a transport one.
                if err.code == 429 and "nextActTick" not in details and attempt < self.MAX_ATTEMPTS:
                    retry_ms = details.get("retryAfterMs")
                    if not isinstance(retry_ms, (int, float)):
                        retry_ms = _float_or(err.headers.get("Retry-After"), 1) * 1000
                    if retry_ms >= self.QUIET_RETRY_MS:
                        log(None, "http", f"rate limited; waiting {retry_ms:.0f} ms")
                    time.sleep(retry_ms / 1000)
                    continue
                if err.code >= 500 and attempt < self.MAX_ATTEMPTS:
                    time.sleep(2 ** (attempt - 1))
                    continue
                raise ApiFailure(err.code, error["code"], error["message"], details) from None
            except (urllib.error.URLError, TimeoutError, ConnectionError) as err:
                if attempt >= self.MAX_ATTEMPTS:
                    raise
                log(None, "http", f"{method} {path} failed ({err}); retrying")
                time.sleep(2 ** (attempt - 1))


def _json_or_none(raw: bytes) -> Any:
    try:
        return json.loads(raw)
    except ValueError:
        return None


def _float_or(value: str | None, default: float) -> float:
    try:
        return float(value) if value else default
    except ValueError:
        return default


# ---------------------------------------------------------------------------------------------
# Reading a village


def option(v: Json, building: str) -> Json:
    return next(o for o in v["options"]["build"] if o["building"] == building)


def train_option(v: Json, unit: str) -> Json:
    return next(o for o in v["options"]["train"] if o["unit"] == unit)


def planned_level(v: Json, building: str) -> int:
    """Built level plus the levels already queued."""
    return v["buildings"][building] + sum(1 for item in v["buildQueue"] if item["building"] == building)


def blocked_only_by_resources(o: Json) -> bool:
    return o["blockers"] == ["INSUFFICIENT_RESOURCES"]


def owned_units(v: Json) -> Units:
    """Every unit this village owns: home, away, and still in a training queue."""
    queued: Units = {}
    for batches in v["training"].values():
        for b in batches:
            queued[b["unit"]] = queued.get(b["unit"], 0) + b["remaining"]
    return add_units(v["units"]["home"], v["units"]["away"], queued)


def pop_of(units: Units, rules: Json) -> int:
    return sum(n * rules["UNITS"][u]["pop"] for u, n in units.items())


def carry_of(units: Units, rules: Json) -> int:
    """What a party can carry home."""
    return sum(n * rules["UNITS"][u]["carry"] for u, n in units.items())


def value_of(units: Units, rules: Json) -> int:
    """What the units cost to train, all resources together."""
    return sum(n * sum(rules["UNITS"][u]["cost"][r] for r in RESOURCES) for u, n in units.items())


def travel_ticks(origin: Json, target: Json, units: Units, rules: Json) -> int:
    slowest = max(rules["UNITS"][u]["speed"] for u, n in units.items() if n)
    return math.ceil(distance(origin, target) * slowest)


# ---------------------------------------------------------------------------------------------
# The build planner: one item per pass, chosen from the options the server computed.


def weakest_resource_building(v: Json, tables: Json) -> tuple[str, str]:
    """The resource building whose next level adds least, by production at its planned level."""
    def per_minute(resource: str) -> float:
        return tables["production"][planned_level(v, RESOURCE_BUILDINGS[resource])]["perMinute"]
    resource = min(RESOURCES, key=per_minute)
    return RESOURCE_BUILDINGS[resource], resource


def step_toward(v: Json, building: str, level: int, rules: Json) -> str | None:
    """The next building to queue toward `level` of `building`, its requirements first. None once planned."""
    rule = rules["BUILDINGS"][building]
    if planned_level(v, building) >= min(level, rule["maxLevel"]):
        return None
    for required, required_level in rule["requires"].items():
        step = step_toward(v, required, required_level, rules)
        if step:
            return step
    return building


def goal_step(v: Json, goal: dict[str, Any], rules: Json) -> dict[str, str] | None:
    """The next building toward one goal, or None once it's planned."""
    if "unit" in goal:
        unit = rules["UNITS"][goal["unit"]]
        step = (step_toward(v, unit["building"], unit["buildingLevel"], rules)
                or step_toward(v, "smithy", unit["smithyLevel"], rules))
        return {"building": step, "why": f"toward {goal['unit']}"} if step else None
    step = step_toward(v, goal["building"], goal["level"], rules)
    return {"building": step, "why": f"toward {goal['building']} {goal['level']}"} if step else None


def next_goal_step(v: Json, rules: Json) -> dict[str, str] | None:
    for goal in GOALS:
        step = goal_step(v, goal, rules)
        if step:
            return step
    return None


def build_wishes(v: Json, rules: Json, tables: Json, raiders_first: bool) -> list[dict[str, str]]:
    """What this village wants built, most urgent first. Raiders first: only the road to them."""
    wishes: list[dict[str, str]] = []
    used, cap = v["population"]["used"], v["population"]["max"]
    if cap - used < cap * STRATEGY["farm_when_free_below"] and planned_level(v, "farm") == v["buildings"]["farm"]:
        wishes.append({"building": "farm", "why": f"population {used}/{cap}"})
    fullest = max(v["resources"][r] for r in RESOURCES) / v["storage"]
    if (fullest > STRATEGY["storehouse_when_fuller_than"]
            and planned_level(v, "storehouse") == v["buildings"]["storehouse"]):
        wishes.append({"building": "storehouse", "why": f"stores {round(fullest * 100)}% full"})
    weakest, resource = weakest_resource_building(v, tables)
    economy_wish = {"building": weakest, "why": f"{resource} is the scarcest"}
    if raiders_first:
        # The first levels are cheap and pay for themselves: they barely delay the first party, and keep paying.
        if planned_level(v, weakest) < STRATEGY["first_economy_level"]:
            wishes.append(economy_wish)
        step = goal_step(v, FIRST_RAIDER, rules)
        if step:
            wishes.append(step)
        return wishes
    if planned_level(v, weakest) < planned_level(v, "hall") + STRATEGY["economy_lead_over_hall"]:
        wishes.append(economy_wish)
    goal = next_goal_step(v, rules)
    if goal:
        if "EXCEEDS_STORAGE" in option(v, goal["building"])["blockers"]:
            wishes.append({"building": "storehouse", "why": f"{goal['building']} costs more than storage holds"})
        wishes.append(goal)
    wishes += [{"building": "hall", "why": "faster building"}, economy_wish]
    return wishes


def plan_build(v: Json, rules: Json, tables: Json, tick: int,
               raiders_first: bool) -> tuple[dict[str, str] | None, int | None, bool]:
    """Returns (wish to queue now, tick to wake for a wanted build, whether to save resources for it)."""
    queue_room = min(STRATEGY["max_queued_builds"], rules["ECONOMY"]["buildQueueMax"]) - len(v["buildQueue"])
    if queue_room <= 0:
        return None, None, False
    wake_at = None
    for wish in build_wishes(v, rules, tables, raiders_first):
        o = option(v, wish["building"])
        if o["ok"]:
            return wish, None, False
        if blocked_only_by_resources(o) and o["affordableAtTick"] is not None:
            wake_at = min(wake_at if wake_at is not None else math.inf, o["affordableAtTick"])
            # Close enough to afford: keep the resources for it instead of buying something lesser.
            if o["affordableAtTick"] - tick <= STRATEGY["save_for_ticks"]:
                return None, wake_at, True
    return None, wake_at, False


# ---------------------------------------------------------------------------------------------
# The training planner: a small defensive core, then raiders first until raids are going, then defence
# and offence in step with the farm.


def batch_size(o: Json, missing_pop: float) -> int:
    wanted = math.ceil(missing_pop / o["pop"])
    return min(wanted, max(1, math.floor(o["maxCount"] * STRATEGY["train_spend_share"])))


def plan_training(v: Json, rules: Json, raiders_first: bool) -> dict[str, Any] | None:
    """What to train, and how far below its target that kind of troop is ("short", a share of the target)."""
    owned = owned_units(v)

    def trainable(unit: str) -> bool:
        o = train_option(v, unit)
        room = len(v["training"][rules["UNITS"][unit]["building"]]) < STRATEGY["max_queued_batches"]
        return o["ok"] and o["maxCount"] > 0 and room

    defense_pop = pop_of(pick(owned, DEFENSIVE_UNITS), rules)
    defense_target = v["population"]["max"] * STRATEGY["defense_pop_share"]
    offense_pop = pop_of(pick(owned, RAID_UNITS), rules)
    offense_target = v["population"]["max"] * STRATEGY["offense_pop_share"]

    def train_defence(target: float) -> dict[str, Any] | None:
        # The defensive unit we have least of, so the mix holds against every attack type.
        choices = sorted((u for u in DEFENSIVE_UNITS if trainable(u)), key=lambda u: owned.get(u, 0))
        if not choices or defense_pop >= target:
            return None
        return {"unit": choices[0], "count": batch_size(train_option(v, choices[0]), target - defense_pop),
                "why": f"defence {defense_pop}/{round(target)} pop", "short": 1 - defense_pop / target}

    def train_offence() -> dict[str, Any] | None:
        unit = next((u for u in RAID_UNITS if trainable(u)), None)
        if not unit or offense_pop >= offense_target:
            return None
        return {"unit": unit, "count": batch_size(train_option(v, unit), offense_target - offense_pop),
                "why": f"raiding force {offense_pop}/{round(offense_target)} pop", "short": 1 - offense_pop / offense_target}

    core = min(STRATEGY["core_defense_pop"], defense_target)
    if defense_pop < core:
        return train_defence(core)
    if raiders_first:
        return train_offence()
    # Whichever of defence and offence is further below its share of the farm.
    defence_short = 1 - defense_pop / defense_target
    offence_short = 1 - offense_pop / offense_target
    if defence_short >= offence_short:
        return train_defence(defense_target) or train_offence()
    return train_offence() or train_defence(defense_target)


def raiders_first(v: Json, rules: Json, raiding: bool) -> bool:
    """Raiders first: a village with no raids going trains raiders before it builds anything but a farm or
    a storehouse it needs, until a party is big enough to farm a hamlet (or its raiding force is full-size).
    That is the opening, straight to a first party whose loot and beaten-down hamlets pay for the rest,
    and the way back to farming whenever losses break up its parties."""
    offense_pop = pop_of(pick(owned_units(v), RAID_UNITS), rules)
    return not raiding and offense_pop < v["population"]["max"] * STRATEGY["offense_pop_share"]


# ---------------------------------------------------------------------------------------------
# Threats: who could be coming, and how big.


def slowest_candidates(inc: Json, rules: Json) -> list[str]:
    """Units whose travel time over this distance equals the attack's: the slowest unit is one of them."""
    d = distance(inc["from"], inc["to"])
    travel = inc["arrivalTick"] - inc["sentTick"]
    return [u for u, rule in rules["UNITS"].items() if math.ceil(d * rule["speed"]) == travel]


def sighted_pop(inc: Json, rules: Json) -> float | None:
    """Population guess from a watchtower's size bucket, or None without a sighting."""
    if not inc["sighted"]:
        return None
    buckets = rules["WATCHTOWER"]["sizeBuckets"]
    bucket = next((b for b in buckets if b["name"] == inc["sighted"]["size"]), None)
    if bucket and bucket["maxPop"] is not None:
        return bucket["maxPop"]
    largest_bounded = max(b["maxPop"] or 0 for b in buckets)
    return largest_bounded * STRATEGY["host_over_army"]


def guess_attacker(pop: float, candidates: list[str], rules: Json) -> Units:
    """The worst army that fits what we know: all of the hardest-hitting unit no slower than the slowest candidate."""
    units = rules["UNITS"]
    pace = max((units[u]["speed"] for u in candidates), default=math.inf)
    fits = [u for u, rule in units.items() if rule["speed"] <= pace and rule["attack"] > 0]
    best = max(fits, key=lambda u: units[u]["attack"] / units[u]["pop"])
    return {best: max(1, math.ceil(pop / units[best]["pop"]))}


# ---------------------------------------------------------------------------------------------
# The steward


@dataclass
class Hamlet:
    id: str
    name: str
    x: int
    y: int
    last_win_tick: int | None = None
    wall: int | None = None

    def __getitem__(self, key: str) -> int:  # so distance() reads it like a village
        return getattr(self, key)


class Steward:
    def __init__(self, client: Client, world_id: str):
        self.client = client
        self.world_id = world_id
        self.rules: Json = {}
        self.tables: Json = {}
        self.state: Json = {}
        self.cursor = 0
        self.epoch = ""
        self.round = 0
        self.client_seq = 0
        self.run_id = "".join(random.choices(string.ascii_lowercase + string.digits, k=8))
        self.reset_round_memory()

    def reset_round_memory(self) -> None:
        self.hamlets: dict[str, Hamlet] = {}
        self.map_tick = -math.inf
        self.raid_plan_tick: dict[str, int] = {}
        self.raid_replan: set[str] = set()
        self.raid_pool_at_plan: dict[str, int] = {}
        self.raids_suspended_until: dict[str, int] = {}
        self.handled_threats: set[str] = set()
        self.support_out: list[dict[str, Any]] = []
        self.build_wake_at: int | None = None

    @property
    def tick(self) -> int:
        return self.state["world"]["tick"]

    def path(self, rest: str) -> str:
        return f"/worlds/{urllib.parse.quote(self.world_id, safe='')}{rest}"

    def run(self) -> None:
        self.enter_world()
        consecutive_errors = 0
        while True:
            try:
                if self.state["world"]["status"] == "ended":
                    self.await_next_round()
                else:
                    self.turn()
                consecutive_errors = 0
            except ApiFailure as err:
                if err.code == "WORLD_NOT_RUNNING":
                    self.await_next_round()
                elif err.code == "NOT_IN_WORLD":
                    self.enter_world()
                else:
                    consecutive_errors = self.recover(err, consecutive_errors, fatal=err.status == 401)
            except (urllib.error.URLError, TimeoutError, ConnectionError, KeyError, ValueError) as err:
                consecutive_errors = self.recover(err, consecutive_errors, fatal=False)

    def recover(self, err: Exception, consecutive_errors: int, fatal: bool) -> int:
        consecutive_errors += 1
        if fatal or consecutive_errors >= STRATEGY["max_consecutive_errors"]:
            raise err
        log(self.tick, "steward", f"error: {err}; carrying on")
        time.sleep(STRATEGY["error_pause_s"])
        try:
            self.refresh_state()
        except Exception:  # the next wake-up will try again
            pass
        return consecutive_errors

    def enter_world(self) -> None:
        """Join (or rejoin after a round change), load the rules, forget last round."""
        self.state = self.client.call("POST", self.path("/join"))
        rules = self.client.call("GET", self.path("/rules"))
        self.rules, self.tables = rules["rules"], rules["tables"]
        self.cursor = self.state["eventsCursor"]
        self.epoch = self.state["world"]["epoch"]
        self.round = self.state["world"]["round"]
        self.reset_round_memory()
        world, player = self.state["world"], self.state["player"]
        homes = ", ".join(f"{v['name']} ({v['x']},{v['y']})" for v in self.state["villages"])
        shield = f", protected until t{player['protectedUntilTick']}" if player["protectedUntilTick"] else ""
        log(self.tick, "steward", f"{player['name']} in {world['name']} round {world['round']} "
                                  f"({world['kind']}, speed {world['speed']}): {homes}{shield}")

    def refresh_state(self) -> None:
        self.state = self.client.call("GET", self.path("/state"))

    def await_next_round(self) -> None:
        self.state["world"] = self.client.call("GET", self.path(""))
        if self.state["world"]["kind"] == "sandbox":
            log(self.tick, "steward", "the sandbox has ended; nothing more to play")
            sys.exit(0)
        log(self.tick, "steward", f"round {self.round} is over; waiting for the next one")
        while True:
            time.sleep(STRATEGY["round_poll_s"])
            world = self.client.call("GET", self.path(""))
            if world["status"] == "running" and world["round"] > self.round:
                break
        self.enter_world()

    def turn(self) -> None:
        """One wake-up: farm planning, then act until there's nothing to do, then wait for events."""
        if not self.state["villages"]:
            log(self.tick, "steward", "every village is lost; founding a new one")
            self.enter_world()
            return
        self.refresh_map_if_due()
        self.plan_raids_if_due()
        for _ in range(STRATEGY["passes_per_wake"]):
            if not self.can_act() or not self.act_once():
                break
        self.wait_for_events()

    def can_act(self) -> bool:
        """Council worlds take one batch per interval."""
        next_act = self.state["player"]["nextActTick"]
        return next_act is None or next_act <= self.tick

    def act_once(self) -> bool:
        planned = self.answer_threats() + self.recall_support()
        self.build_wake_at = None
        for v in self.state["villages"]:
            # Raids kept home by a threat still count as going.
            first = raiders_first(v, self.rules, bool(v["orders"]["raids"]) or v["id"] in self.raids_suspended_until)
            train = plan_training(v, self.rules, first)
            # Troops far below target come before more building; otherwise they get what building leaves.
            if train and not first and train["short"] >= STRATEGY["troops_first_when_short"]:
                planned.append(({"type": "train", "village": v["id"], "unit": train["unit"], "count": train["count"]},
                                f"{v['name']} train {train['count']} {train['unit']} ({train['why']})"))
                continue  # build next pass, against the resources left after paying for them
            wish, wake_at, saving = plan_build(v, self.rules, self.tables, self.tick, first)
            if wake_at is not None:
                self.build_wake_at = min(self.build_wake_at if self.build_wake_at is not None else math.inf, wake_at)
            if wish:
                level = option(v, wish["building"])["level"]
                planned.append(({"type": "build", "village": v["id"], "building": wish["building"]},
                                f"{v['name']} build {wish['building']} to {level} ({wish['why']})"))
                continue  # train next pass, against the resources left after paying for it
            if saving:
                continue
            if train:
                planned.append(({"type": "train", "village": v["id"], "unit": train["unit"], "count": train["count"]},
                                f"{v['name']} train {train['count']} {train['unit']} ({train['why']})"))
        if not planned:
            return False
        return self.apply(planned)

    def apply(self, planned: list[tuple[Json, str]]) -> bool:
        """Sends a batch, logs one line per action, and takes the fresh state back."""
        batch = planned[: self.rules["LIMITS"]["actionsPerBatch"]]
        actions = []
        for action, _ in batch:
            self.client_seq += 1
            actions.append({**action, "clientId": f"{self.run_id}-{self.client_seq}"})
        note = "; ".join(label for _, label in batch)[: self.rules["LIMITS"]["noteMaxChars"]]
        try:
            response = self.client.call("POST", self.path("/actions"),
                                        body={"actions": actions, "note": note, "returnState": True})
        except ApiFailure as err:
            if err.status == 429 and isinstance(err.details.get("nextActTick"), int):
                log(self.tick, "act", f"council: next batch at t{err.details['nextActTick']}")
                self.state["player"]["nextActTick"] = err.details["nextActTick"]
                return False
            raise
        for (_, label), result in zip(batch, response["results"]):
            if result["ok"]:
                log(response["tick"], "act", label)
            else:
                log(response["tick"], "act", f"{label} -> {result['error']['code']}: {result['error']['message']}")
        if response.get("state"):
            self.state = response["state"]
        return any(r["ok"] for r in response["results"])

    # ---- Waiting and events ------------------------------------------------------------------

    def wake_tick(self) -> int:
        """The next tick worth waking for even if no event comes."""
        candidates = [self.build_wake_at, self.state["player"]["nextActTick"]]
        candidates += [s["after_tick"] + 1 for s in self.support_out]
        candidates += [t + 1 for t in self.raids_suspended_until.values()]
        future = [t for t in candidates if t is not None and t > self.tick]
        return min([self.tick + STRATEGY["idle_wake_ticks"], *future])

    def wait_for_events(self) -> None:
        wait = min(STRATEGY["wait_seconds"], self.rules["LIMITS"]["maxEventWaitSeconds"])
        response = self.client.call("GET", self.path("/events"),
                                    query={"after": self.cursor, "wait": wait, "untilTick": self.wake_tick()},
                                    timeout=wait + 15)
        if response["epoch"] != self.epoch:
            new_round = response["round"] != self.round
            log(response["tick"], "steward",
                f"round {response['round']} has begun" if new_round else "the server restored the world; re-reading")
            if response["status"] == "ended":
                self.refresh_state()
            else:
                self.enter_world()
            return
        if response["gap"]:
            log(response["tick"], "steward", "missed events; re-reading the state")
            self.refresh_state()
            self.cursor = self.state["eventsCursor"]
            return
        self.cursor = response["cursor"]
        for event in response["events"]:
            self.on_event(event)
        if response["status"] == "paused":
            time.sleep(STRATEGY["paused_poll_s"])
        self.refresh_state()

    def village_name(self, village_id: str) -> str:
        return next((v["name"] for v in self.state["villages"] if v["id"] == village_id), village_id)

    def on_event(self, e: Json) -> None:
        kind = e["type"]
        if kind == "attack_incoming":
            inc = e["command"]
            log(e["tick"], inc["to"]["name"],
                f"attack from {inc['from']['name']} ({inc['from']['ownerName'] or 'hamlet'}) lands t{inc['arrivalTick']}")
        elif kind == "incoming_sighted":
            inc, seen = e["command"], e["command"]["sighted"] or {}
            envoy = " with an envoy" if seen.get("envoy") else ""
            log(e["tick"], inc["to"]["name"], f"watchtower: a {seen.get('size')}{envoy} from {inc['from']['name']}")
        elif kind == "incoming_cancelled":
            log(e["tick"], "steward", "an incoming attack turned back")
        elif kind == "report":
            self.read_report(e["report"])
        elif kind == "order_paused":
            log(e["tick"], self.village_name(e["village"]), f"{e['order']} order {e['index']} paused: {e['code']}")
            if e["order"] == "raid":
                self.raid_replan.add(e["village"])
        elif kind == "scheduled_applied":
            result = e["result"]
            if not result["ok"]:
                log(e["tick"], "steward", f"scheduled {result['type']} failed: {result['error']['code']}")
        elif kind in ("village_lost", "village_conquered"):
            log(e["tick"], e["village"]["name"], "LOST" if kind == "village_lost" else "conquered")
            self.map_tick = -math.inf
        elif kind == "protection_ended":
            log(e["tick"], "steward", "protection has ended")
        elif kind == "round_ended":
            top = ", ".join(f"{s['rank']}. {s['name']} {s['score']}" for s in e["standings"][:3])
            log(e["tick"], "steward", f"round over: {top}")

    def read_report(self, summary: Json) -> None:
        report = self.client.call("GET", self.path(f"/reports/{urllib.parse.quote(summary['id'], safe='')}"))
        sides = report["attackerUnits"] or {"sent": {}, "lost": {}}
        loot = f" loot {'/'.join(str(report['loot'][r]) for r in RESOURCES)}" if report["loot"] else ""
        attacking = report["role"] == "attacker"
        where = report["attacker"]["name"] if attacking else report["defender"]["name"]
        other = report["defender"]["name"] if attacking else report["attacker"]["name"]
        log(report["tick"], where, f"{report['kind']} {report['role']} vs {other}: {report['outcome']}, "
                                   f"lost {pop_of(sides['lost'], self.rules)}/{pop_of(sides['sent'], self.rules)} pop{loot}")

        hamlet = self.hamlets.get(report["defender"]["id"])
        if attacking and hamlet:
            if report["wall"]:
                hamlet.wall = report["wall"]["after"]
            first_win = report["outcome"] == "won" and hamlet.last_win_tick is None
            if report["outcome"] == "won":
                hamlet.last_win_tick = report["tick"]
            # A loss means the sizing was wrong; a first win resets the militia, so smaller parties will do.
            if report["outcome"] != "won" or first_win:
                self.raid_replan.add(report["attacker"]["id"])

    # ---- Farming hamlets ---------------------------------------------------------------------

    def refresh_map_if_due(self) -> None:
        if self.tick - self.map_tick < STRATEGY["map_refresh_ticks"]:
            return
        radius = min(self.rules["LIMITS"]["maxMapRadius"], STRATEGY["raid_radius"])
        for v in self.state["villages"]:
            world_map = self.client.call("GET", self.path("/map"), query={"x": v["x"], "y": v["y"], "r": radius})
            for mv in world_map["villages"]:
                if mv["ownerId"] is not None:
                    self.hamlets.pop(mv["id"], None)  # someone took it
                elif mv["id"] not in self.hamlets:
                    self.hamlets[mv["id"]] = Hamlet(mv["id"], mv["name"], mv["x"], mv["y"])
        self.map_tick = self.tick

    def plan_raids_if_due(self) -> None:
        for v in self.state["villages"]:
            suspended_until = self.raids_suspended_until.get(v["id"])
            if suspended_until is not None:
                if self.tick <= suspended_until:
                    continue
                del self.raids_suspended_until[v["id"]]
                self.raid_replan.add(v["id"])
            due = self.tick - self.raid_plan_tick.get(v["id"], -math.inf) >= STRATEGY["raid_replan_ticks"]
            pool = self.raid_pool(v)
            # With no raid going yet, any new raider may be the one that makes a winning party. Once raids
            # stand, one more at a time isn't worth a re-plan: wait until the force has grown by a share.
            growth = STRATEGY["replan_after_growth"] if v["orders"]["raids"] else 0
            grown = pop_of(pool, self.rules) > self.raid_pool_at_plan.get(v["id"], 0) * (1 + growth)
            # A raid that lost troops can't go again with the party it was sized for.
            stalled = any(not fits_in(r["units"], pool) for r in v["orders"]["raids"])
            if due or grown or stalled or v["id"] in self.raid_replan:
                self.plan_raids(v)

    def raid_pool(self, v: Json) -> Units:
        """Our raiding units, wherever they are, except those stationed abroad as support."""
        abroad = add_units(*(s["units"] for s in v["supportAbroad"]))
        return pick(subtract_units(add_units(v["units"]["home"], v["units"]["away"]), abroad), RAID_UNITS)

    def plan_raids(self, v: Json) -> None:
        self.raid_plan_tick[v["id"]] = self.tick
        self.raid_replan.discard(v["id"])
        pool = self.raid_pool(v)
        self.raid_pool_at_plan[v["id"]] = pop_of(pool, self.rules)
        if pop_of(pool, self.rules) < self.rules["COMBAT"]["minAttackPop"]:
            return

        nearby = [h for h in self.hamlets.values() if distance(v, h) <= STRATEGY["raid_radius"]]
        nearby.sort(key=lambda h: distance(v, h))
        nearest = nearby[: STRATEGY["raid_candidates"]]

        # Each raiding unit farms on its own: lancers first (fast, and they carry the most), then raiders
        # at the hamlets left. For each, size the smallest party that works at every hamlet, then farm the
        # cheapest ones the pool covers. Raiding a hamlet often keeps it cheap, so the same ones stay on top.
        raids: list[Json] = []
        max_raids = min(STRATEGY["raid_targets"], self.rules["ORDERS"]["maxRaids"])
        for unit in RAID_UNITS:
            sized = []
            for hamlet in nearest:
                if len(raids) >= max_raids or any(r["target"] == hamlet.id for r in raids):
                    continue
                raid = self.size_raid(v, hamlet, unit, pool.get(unit, 0))
                if raid:
                    sized.append((raid["units"][unit], distance(v, hamlet), raid))
            sized.sort(key=lambda s: (s[0], s[1]))
            for _, _, raid in sized:
                if len(raids) >= max_raids or not fits_in(raid["units"], pool):
                    continue
                raids.append(raid)
                pool = subtract_units(pool, raid["units"])
        # The rest of the pool joins the parties already using its units: a bigger party loses a smaller
        # share and carries more home.
        for unit in RAID_UNITS:
            takers = [r for r in raids if r["units"].get(unit)]
            left = pool.get(unit, 0)
            for i, r in enumerate(takers):
                extra = left // (len(takers) - i)
                r["units"][unit] += extra
                left -= extra
        if raids == v["orders"]["raids"]:
            return
        self.set_raids(v, raids)
        summary = "; ".join(f"{self.hamlets[r['target']].name}: {describe_units(r['units'])}" for r in raids)
        log(self.tick, v["name"], f"farming {summary}" if raids else "no hamlet worth raiding yet")

    def set_raids(self, v: Json, raids: list[Json]) -> None:
        body = {"build": v["orders"]["build"], "train": v["orders"]["train"], "raids": raids}
        village = urllib.parse.quote(v["id"], safe="")
        v["orders"] = self.client.call("PUT", self.path(f"/villages/{village}/orders"), body=body)

    def size_raid(self, v: Json, hamlet: Hamlet, unit: str, available: int) -> Json | None:
        """The smallest party of up to `available` of `unit` that raids the hamlet well (see raid_works), as
        a standing raid order that pauses if a raid ever loses more than the party was sized for."""
        if available == 0 or not self.raid_works(v, hamlet, {unit: available}):
            return None
        # All of them work. Halve the gap to the fewest that still do: a bigger party loses a smaller
        # share and carries more, so the answer only ever turns from no to yes as it grows.
        fails, works = 0, available
        while works - fails > 1:
            mid = (works + fails) // 2
            if self.raid_works(v, hamlet, {unit: mid}):
                works = mid
            else:
                fails = mid
        max_loss = STRATEGY["first_raid_max_loss"] if hamlet.last_win_tick is None else STRATEGY["raid_max_loss"]
        return {"target": hamlet.id, "units": {unit: works},
                "stopIfLoss": max(self.rules["ORDERS"]["raidStopLossDefault"], max_loss)}

    def raid_works(self, v: Json, hamlet: Hamlet, party: Units) -> bool:
        """A raid works when it wins losing at most raid_max_loss of the party and brings home more
        than the troops it loses are worth. The first raid on a hamlet is the price of knocking its
        militia back to the base, so it may lose more and needn't pay; but what it leaves must be a
        party whose next raid there works."""
        # A standing order may first wait for its party to come home: size for a round trip from now.
        arrival = self.tick + 2 * travel_ticks(v, hamlet, party, self.rules)
        if hamlet.last_win_tick is not None:
            return self.raid_outcome(hamlet, party, arrival - hamlet.last_win_tick,
                                     STRATEGY["raid_max_loss"], True) is not None
        # A hamlet nobody has beaten has grown its militia since tick 0.
        survivors = self.raid_outcome(hamlet, party, arrival, STRATEGY["first_raid_max_loss"], False)
        if not survivors:
            return False
        # They go again as soon as they're home: a round trip after the win.
        again = 2 * travel_ticks(v, hamlet, survivors, self.rules)
        return self.raid_outcome(hamlet, survivors, again, STRATEGY["raid_max_loss"], True) is not None

    def raid_outcome(self, hamlet: Hamlet, party: Units, militia_ticks: int, max_loss: float,
                     must_pay: bool) -> Units | None:
        """Simulates `party` against the hamlet with `militia_ticks` of militia grown. Its survivors if it
        wins losing at most `max_loss` of its population (and, if it `must_pay`, carries home more than
        its losses are worth), else None."""
        world_map, combat = self.rules["MAP"], self.rules["COMBAT"]
        pop = pop_of(party, self.rules)
        if pop < combat["minAttackPop"]:
            return None
        # The wall is in the first report; until then, the highest a hamlet is drawn with.
        wall_range = world_map["hamletLevels"].get("wall")
        wall = hamlet.wall if hamlet.wall is not None else (wall_range[1] if wall_range else 0)
        militia = min(world_map["hamletMilitiaCap"], world_map["hamletMilitiaPerTick"] * militia_ticks)
        sim = self.client.call("POST", self.path("/simulate/battle"), body={
            "attacker": party, "wall": wall, "baseDefense": world_map["hamletBaseDefense"] + militia})
        if sim["winner"] != "attacker" or pop_of(sim["attackerLost"], self.rules) > pop * max_loss:
            return None
        if must_pay and carry_of(sim["attackerSurvivors"], self.rules) < value_of(sim["attackerLost"], self.rules):
            return None
        return sim["attackerSurvivors"]

    # ---- Defence -----------------------------------------------------------------------------

    def holds(self, attacker: Units, defender: Units, wall: int) -> bool:
        sim = self.client.call("POST", self.path("/simulate/battle"),
                               body={"attacker": attacker, "defender": defender, "wall": wall})
        return sim["winner"] == "defender"

    def attacker_pop(self, inc: Json) -> float:
        sighted = sighted_pop(inc, self.rules)
        if sighted is not None:
            return sighted
        origin = self.client.call("GET", self.path(f"/villages/{urllib.parse.quote(inc['from']['id'], safe='')}"))
        return max(self.rules["COMBAT"]["minAttackPop"], round(origin["points"] * STRATEGY["threat_pop_per_point"]))

    def answer_threats(self) -> list[tuple[Json, str]]:
        """For each new or newly sighted attack: does the village hold? If not, recall raids, then call support."""
        planned: list[tuple[Json, str]] = []
        incoming = self.state["commands"]["incoming"]
        outgoing = self.state["commands"]["outgoing"]
        attacks = sorted((c for c in incoming if c["kind"] == "attack"), key=lambda c: c["arrivalTick"])
        for inc in attacks:
            key = f"{inc['id']}:{(inc['sighted'] or {}).get('size', 'unseen')}"
            if key in self.handled_threats:
                continue
            self.handled_threats.add(key)
            v = next((x for x in self.state["villages"] if x["id"] == inc["to"]["id"]), None)
            if v is None:
                continue

            candidates = slowest_candidates(inc, self.rules)
            if candidates == ["scout"]:
                log(self.tick, v["name"], f"scouts from {inc['from']['name']}; nothing to do")
                continue
            attacker = guess_attacker(self.attacker_pop(inc), candidates, self.rules)
            guess = f"~{describe_units(attacker)} (slowest: {'/'.join(candidates) or 'unknown'})"
            wall = v["buildings"]["wall"]
            lands = inc["arrivalTick"]

            # Support already on the road, or timed to land by then, and our own troops home by then.
            support = add_units(*(s["units"] for s in v["supportHere"]),
                                *(c["units"] for c in incoming
                                  if c["kind"] == "support" and c["to"]["id"] == v["id"] and c["arrivalTick"] <= lands),
                                *self.scheduled_sends(v["id"], lands))
            own_troops = add_units(v["units"]["home"],
                                   *(c["units"] for c in outgoing
                                     if c["from"]["id"] == v["id"] and c["returning"] and c["arrivalTick"] <= lands))
            # While raid orders stand, raiders ride out again as soon as they're home: don't count on them.
            staying = omit(own_troops, RAID_UNITS) if v["orders"]["raids"] else own_troops
            if self.holds(attacker, add_units(support, staying), wall):
                log(self.tick, v["name"], f"holds against {guess} at t{lands}")
                continue

            # Stop the raids, so everyone home stays home, and call back the raids still in their cancel
            # window that would be home before the attack lands.
            recalls = [c for c in outgoing
                       if c["from"]["id"] == v["id"] and c["kind"] == "attack" and not c["returning"]
                       and c["cancellableUntilTick"] is not None and c["cancellableUntilTick"] >= self.tick
                       and self.tick + (self.tick - c["sentTick"]) <= lands]
            defenders = add_units(support, own_troops, *(c["units"] for c in recalls))
            recall_actions = [({"type": "cancel_command", "command": c["id"]},
                               f"{v['name']} call back raid on {c['to']['name']}") for c in recalls]

            if self.holds(attacker, defenders, wall):
                self.suspend_raids(v, lands)
                log(self.tick, v["name"], f"holds against {guess} once raids are home")
                planned += recall_actions
                continue

            supports = self.support_for(v, inc)
            defenders = add_units(defenders, *(s["units"] for s in supports))
            if supports and self.holds(attacker, defenders, wall):
                self.suspend_raids(v, lands)
                log(self.tick, v["name"], f"needs help against {guess}: support from {len(supports)} village(s)")
                planned += recall_actions + [s["planned"] for s in supports]
                self.support_out += [{"at": v["id"], "home": s["home"], "after_tick": lands} for s in supports]
                continue
            log(self.tick, v["name"], f"can't hold against {guess}; troops out stay out")
        return planned

    def scheduled_sends(self, target: str, by_tick: int) -> list[Units]:
        """Units in our support sends to `target`, timed with arriveAtTick, that haven't left yet but land by `by_tick`."""
        return [s["action"]["units"] for s in self.state["scheduled"]
                if s["action"]["type"] == "send" and s["action"]["kind"] == "support"
                and s["action"]["target"] == target and s["action"].get("arriveAtTick") is not None
                and s["action"]["arriveAtTick"] <= by_tick]

    def support_for(self, v: Json, inc: Json) -> list[Json]:
        """Defensive troops from our other villages that can arrive in time, landing on the attack's tick."""
        threatened = {c["to"]["id"] for c in self.state["commands"]["incoming"]
                      if c["kind"] == "attack" and c["id"] != inc["id"]}
        supports = []
        for w in self.state["villages"]:
            if w["id"] == v["id"] or w["id"] in threatened:
                continue
            # Not the troops already timed to leave on another send.
            leaving = add_units(*(s["action"]["units"] for s in self.state["scheduled"]
                                  if s["action"]["type"] == "send" and s["action"]["village"] == w["id"]))
            units = pick(subtract_units(w["units"]["home"], leaving), DEFENSIVE_UNITS)
            if pop_of(units, self.rules) == 0:
                continue
            travel = travel_ticks(w, v, units, self.rules)
            if self.tick + travel > inc["arrivalTick"]:
                continue
            action = {"type": "send", "village": w["id"], "target": v["id"], "kind": "support", "units": units}
            # Support landing on the attack's tick arrives first (design: arrivals). Leave now if it's that tight.
            if inc["arrivalTick"] - travel > self.tick:
                action["arriveAtTick"] = inc["arrivalTick"]
            label = f"{w['name']} support {v['name']} with {describe_units(units)} by t{inc['arrivalTick']}"
            supports.append({"home": w["id"], "units": units, "planned": (action, label)})
        return supports

    def suspend_raids(self, v: Json, until_tick: int) -> None:
        """Keeps raiding troops home until the attack has landed."""
        self.raids_suspended_until[v["id"]] = max(until_tick, self.raids_suspended_until.get(v["id"], 0))
        if v["orders"]["raids"]:
            self.set_raids(v, [])

    def recall_support(self) -> list[tuple[Json, str]]:
        """Brings support home once the attack it went for has landed and nothing else is coming."""
        planned: list[tuple[Json, str]] = []
        still_out = []
        for s in self.support_out:
            under_attack = any(c["kind"] == "attack" and c["to"]["id"] == s["at"]
                               for c in self.state["commands"]["incoming"])
            if self.tick <= s["after_tick"] or under_attack:
                still_out.append(s)
                continue
            home = next((v for v in self.state["villages"] if v["id"] == s["home"]), None)
            if home and any(stack["at"]["id"] == s["at"] for stack in home["supportAbroad"]):
                planned.append(({"type": "recall", "village": s["at"], "home": s["home"]},
                                f"{home['name']} recall support from {self.village_name(s['at'])}"))
        self.support_out = still_out
        return planned


# ---------------------------------------------------------------------------------------------
# Getting started: a key, a world, then the steward.


def sign_up_if_needed(client: Client) -> None:
    if client.key:
        return
    name = os.environ.get("STEWARD_NAME")
    if not name:
        sys.exit("Set STEWARD_KEY, or STEWARD_NAME to sign up for a new key.")
    signup = client.call("POST", "/accounts", body={"name": name})
    client.key = signup["apiKey"]
    print(f"Signed up as {signup['account']['name']}. Your key, shown once; keep it:\n\n"
          f"  STEWARD_KEY={signup['apiKey']}\n", flush=True)


def choose_world(client: Client) -> str:
    if os.environ.get("STEWARD_WORLD"):
        return os.environ["STEWARD_WORLD"]
    if os.environ.get("STEWARD_SANDBOX") == "1":
        sandbox = client.call("POST", "/sandboxes", body={"speed": STRATEGY["sandbox_speed"]})
        log(sandbox["tick"], "steward", f"created sandbox {sandbox['id']} at speed {sandbox['speed']}")
        return sandbox["id"]
    # With a key, the list holds the public worlds plus your own sandboxes.
    worlds = client.call("GET", "/worlds")
    live = [w for w in worlds if w["status"] != "ended"]
    world = (next((w for w in live if w["kind"] == "sandbox"), None)
             or next((w for w in live if w["kind"] != "sandbox"), None)
             or (worlds[0] if worlds else None))
    if world is None:
        sys.exit("No worlds on this server. Set STEWARD_SANDBOX=1 to make one.")
    return world["id"]


def main() -> None:
    # Village names can be any letters; never let a console's code page stop the steward.
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(errors="replace")
    base = os.environ.get("STEWARD_URL", "http://localhost:8787").rstrip("/")
    client = Client(base, os.environ.get("STEWARD_KEY"))
    try:
        sign_up_if_needed(client)
        Steward(client, choose_world(client)).run()
    except ApiFailure as err:
        sys.exit(str(err))
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    main()
