#!/usr/bin/env python3
import hashlib
import hmac
import json
import os
import secrets
import sqlite3
import time
from http import cookies
from http.server import ThreadingHTTPServer, BaseHTTPRequestHandler
from pathlib import Path
from urllib.parse import urlparse

ROOT = Path(__file__).resolve().parent
DATA_DIR = Path(os.environ.get("DATA_DIR", str(ROOT)))
DB_PATH = Path(os.environ.get("DB_PATH", str(DATA_DIR / "poker.db")))
SESSION_COOKIE = "hu_poker_session"
SMALL_BLIND = 10
BIG_BLIND = 20
STARTING_STACK = 1000
RANKS = "23456789TJQKA"
SUITS = "SHDC"
RANK_VALUE = {rank: index + 2 for index, rank in enumerate(RANKS)}


def db():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn


def init_db():
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    with db() as conn:
        conn.executescript(
            """
            create table if not exists users (
              id integer primary key autoincrement,
              name text not null unique,
              password_hash text not null,
              created_at integer not null
            );

            create table if not exists sessions (
              token text primary key,
              user_id integer not null,
              created_at integer not null,
              foreign key(user_id) references users(id)
            );

            create table if not exists rooms (
              id integer primary key autoincrement,
              code text not null unique,
              mode text not null,
              status text not null,
              owner_id integer not null,
              player1_id integer not null,
              player2_id integer,
              state_json text not null,
              created_at integer not null,
              updated_at integer not null
            );

            create table if not exists matches (
              id integer primary key autoincrement,
              room_code text not null,
              mode text not null,
              player1_id integer not null,
              player2_id integer,
              winner_id integer,
              winner_name text not null,
              result text not null,
              hand_number integer not null,
              created_at integer not null
            );
            """
        )


def now():
    return int(time.time())


def password_hash(password):
    salt = secrets.token_hex(16)
    digest = hashlib.pbkdf2_hmac("sha256", password.encode(), salt.encode(), 120_000).hex()
    return f"{salt}:{digest}"


def verify_password(password, stored):
    salt, digest = stored.split(":", 1)
    check = hashlib.pbkdf2_hmac("sha256", password.encode(), salt.encode(), 120_000).hex()
    return hmac.compare_digest(check, digest)


def public_user(row):
    return {"id": row["id"], "name": row["name"]}


def make_deck():
    deck = [{"rank": rank, "suit": suit, "value": RANK_VALUE[rank]} for suit in SUITS for rank in RANKS]
    secrets.SystemRandom().shuffle(deck)
    return deck


def card_label(card):
    suit = {"S": "♠", "H": "♥", "D": "♦", "C": "♣"}[card["suit"]]
    return f'{card["rank"]}{suit}'


def fresh_state(mode, player1_id, player2_id=None):
    return {
        "mode": mode,
        "hand": 0,
        "dealer": "p1",
        "actor": "p1",
        "phase": "waiting" if mode == "pvp" and not player2_id else "idle",
        "deck": [],
        "community": [],
        "p1": {"user_id": player1_id, "stack": STARTING_STACK, "cards": [], "bet": 0, "folded": False},
        "p2": {"user_id": player2_id, "stack": STARTING_STACK, "cards": [], "bet": 0, "folded": False},
        "pot": 0,
        "current_bet": 0,
        "acted": {"p1": False, "p2": False},
        "showdown": False,
        "message": "対戦相手を待っています" if mode == "pvp" and not player2_id else "Dealで開始",
        "last_result": "",
    }


def clean_bets(state):
    state["p1"]["bet"] = 0
    state["p2"]["bet"] = 0
    state["current_bet"] = 0
    state["acted"] = {"p1": False, "p2": False}


def draw(state, count):
    cards = state["deck"][:count]
    state["deck"] = state["deck"][count:]
    return cards


def commit_bet(state, seat, amount):
    player = state[seat]
    paid = max(0, min(int(amount), player["stack"]))
    player["stack"] -= paid
    player["bet"] += paid
    state["pot"] += paid
    state["current_bet"] = max(state["current_bet"], player["bet"])


def other(seat):
    return "p2" if seat == "p1" else "p1"


def start_hand(state):
    if state["phase"] == "waiting":
        raise ValueError("まだ対戦相手が参加していません")
    if state["p1"]["stack"] <= 0 or state["p2"]["stack"] <= 0:
        state["p1"]["stack"] = STARTING_STACK
        state["p2"]["stack"] = STARTING_STACK
    state["hand"] += 1
    state["phase"] = "preflop"
    state["deck"] = make_deck()
    state["community"] = []
    state["p1"]["cards"] = draw(state, 2)
    state["p2"]["cards"] = draw(state, 2)
    state["p1"]["folded"] = False
    state["p2"]["folded"] = False
    state["pot"] = 0
    state["showdown"] = False
    state["last_result"] = ""
    clean_bets(state)
    if state["dealer"] == "p1":
        commit_bet(state, "p1", SMALL_BLIND)
        commit_bet(state, "p2", BIG_BLIND)
        state["actor"] = "p1"
    else:
        commit_bet(state, "p2", SMALL_BLIND)
        commit_bet(state, "p1", BIG_BLIND)
        state["actor"] = "p2"
    state["message"] = f'{seat_name(state, state["actor"])}のアクションです'


def next_street(state):
    clean_bets(state)
    state["actor"] = other(state["dealer"])
    if state["phase"] == "preflop":
        state["community"].extend(draw(state, 3))
        state["phase"] = "flop"
    elif state["phase"] == "flop":
        state["community"].extend(draw(state, 1))
        state["phase"] = "turn"
    elif state["phase"] == "turn":
        state["community"].extend(draw(state, 1))
        state["phase"] = "river"
    else:
        finish_showdown(state)
        return
    state["message"] = f'{seat_name(state, state["actor"])}のアクションです'


def can_close(state):
    return state["p1"]["bet"] == state["p2"]["bet"] and state["acted"]["p1"] and state["acted"]["p2"]


def seat_name(state, seat):
    if state["mode"] == "cpu" and seat == "p2":
        return "CPU"
    return "Player 1" if seat == "p1" else "Player 2"


def action(state, seat, kind, amount=0):
    if state["phase"] in ("idle", "waiting", "complete"):
        raise ValueError("今はアクションできません")
    if state["actor"] != seat:
        raise ValueError("相手の手番です")
    if kind == "fold":
        winner = other(seat)
        state[seat]["folded"] = True
        award_pot(state, winner, f'{seat_name(state, seat)}がフォールド。{seat_name(state, winner)}の勝ち')
        return
    if kind == "call":
        to_call = max(0, state["current_bet"] - state[seat]["bet"])
        commit_bet(state, seat, to_call)
        state["acted"][seat] = True
        state["message"] = f'{seat_name(state, seat)}が{"コール" if to_call else "チェック"}'
    if kind == "raise":
        was_open_bet = state["current_bet"] == 0
        target = max(state["current_bet"] + BIG_BLIND, int(amount))
        commit_bet(state, seat, target - state[seat]["bet"])
        state["acted"][seat] = True
        state["acted"][other(seat)] = False
        state["message"] = f'{seat_name(state, seat)}が{target}に{"ベット" if was_open_bet else "レイズ"}'
    if state["phase"] != "complete":
        state["actor"] = other(seat)
        if can_close(state):
            next_street(state)


def cpu_action(state):
    if state["mode"] != "cpu" or state["actor"] != "p2" or state["phase"] in ("idle", "complete"):
        return
    to_call = max(0, state["current_bet"] - state["p2"]["bet"])
    strength = estimate_strength(state["p2"]["cards"], state["community"])
    roll = secrets.randbelow(100) / 100
    if to_call and strength + roll * 0.35 < 0.34:
        award_pot(state, "p1", "CPUがフォールド。Player 1の勝ち")
    elif to_call:
        action(state, "p2", "call")
    elif strength > 0.58 and roll > 0.45:
        size = max(BIG_BLIND, round(max(state["pot"], BIG_BLIND) * 0.55 / 20) * 20)
        action(state, "p2", "raise", size)
    else:
        action(state, "p2", "call")


def estimate_strength(cards, community):
    if len(community) >= 3:
        scored = best_hand(cards + community)
        return min(0.98, 0.22 + scored["category"] * 0.105 + scored["kickers"][0] / 28)
    a, b = cards
    value = (a["value"] + b["value"]) / 30
    if a["value"] == b["value"]:
        value += 0.3
    if a["suit"] == b["suit"]:
        value += 0.08
    if abs(a["value"] - b["value"]) <= 2:
        value += 0.06
    return min(0.95, value)


def award_pot(state, winner, text):
    state[winner]["stack"] += state["pot"]
    state["phase"] = "complete"
    state["showdown"] = True
    state["last_result"] = text
    state["message"] = text
    state["dealer"] = other(state["dealer"])


def finish_showdown(state):
    p1 = best_hand(state["p1"]["cards"] + state["community"])
    p2 = best_hand(state["p2"]["cards"] + state["community"])
    comparison = compare_scores(p1, p2)
    state["phase"] = "complete"
    state["showdown"] = True
    if comparison > 0:
        state["p1"]["stack"] += state["pot"]
        state["last_result"] = f'Player 1の勝ち: {p1["name"]}'
    elif comparison < 0:
        state["p2"]["stack"] += state["pot"]
        state["last_result"] = f'{seat_name(state, "p2")}の勝ち: {p2["name"]}'
    else:
        half = state["pot"] // 2
        state["p1"]["stack"] += half
        state["p2"]["stack"] += state["pot"] - half
        state["last_result"] = f'チョップ: {p1["name"]}'
    state["message"] = state["last_result"]
    state["dealer"] = other(state["dealer"])


def best_hand(cards):
    import itertools

    return max((evaluate_five(list(combo)) for combo in itertools.combinations(cards, 5)), key=score_key)


def evaluate_five(cards):
    values = sorted((card["value"] for card in cards), reverse=True)
    counts = {}
    for value in values:
        counts[value] = counts.get(value, 0) + 1
    groups = sorted(counts.items(), key=lambda item: (-item[1], -item[0]))
    flush = all(card["suit"] == cards[0]["suit"] for card in cards)
    straight = straight_high(values)
    if flush and straight:
        return {"category": 8, "kickers": [straight], "name": "ストレートフラッシュ"}
    if groups[0][1] == 4:
        return {"category": 7, "kickers": [groups[0][0], groups[1][0]], "name": "フォーカード"}
    if groups[0][1] == 3 and groups[1][1] == 2:
        return {"category": 6, "kickers": [groups[0][0], groups[1][0]], "name": "フルハウス"}
    if flush:
        return {"category": 5, "kickers": values, "name": "フラッシュ"}
    if straight:
        return {"category": 4, "kickers": [straight], "name": "ストレート"}
    if groups[0][1] == 3:
        return {"category": 3, "kickers": [groups[0][0]] + [value for value, _ in groups[1:]], "name": "スリーカード"}
    if groups[0][1] == 2 and groups[1][1] == 2:
        return {"category": 2, "kickers": [groups[0][0], groups[1][0], groups[2][0]], "name": "ツーペア"}
    if groups[0][1] == 2:
        return {"category": 1, "kickers": [groups[0][0]] + [value for value, _ in groups[1:]], "name": "ワンペア"}
    return {"category": 0, "kickers": values, "name": "ハイカード"}


def straight_high(values):
    unique = sorted(set(values), reverse=True)
    if 14 in unique:
        unique.append(1)
    for index in range(len(unique) - 4):
        run = unique[index : index + 5]
        if run[0] - run[4] == 4:
            return run[0]
    return 0


def score_key(score):
    return [score["category"]] + score["kickers"]


def compare_scores(a, b):
    left = score_key(a)
    right = score_key(b)
    return (left > right) - (left < right)


class Handler(BaseHTTPRequestHandler):
    server_version = "HeadsUpPoker/0.1"

    def do_GET(self):
        parsed = urlparse(self.path)
        if parsed.path.startswith("/api/"):
            self.route_api("GET", parsed.path)
            return
        self.serve_file(parsed.path)

    def do_POST(self):
        parsed = urlparse(self.path)
        self.route_api("POST", parsed.path)

    def log_message(self, fmt, *args):
        return

    def read_json(self):
        length = int(self.headers.get("content-length", "0"))
        if not length:
            return {}
        return json.loads(self.rfile.read(length).decode())

    def write_json(self, data, status=200, extra_headers=None):
        body = json.dumps(data, ensure_ascii=False).encode()
        self.send_response(status)
        self.send_header("content-type", "application/json; charset=utf-8")
        self.send_header("content-length", str(len(body)))
        for key, value in (extra_headers or {}).items():
            self.send_header(key, value)
        self.end_headers()
        self.wfile.write(body)

    def error_json(self, message, status=400):
        self.write_json({"error": message}, status)

    def serve_file(self, path):
        target = ROOT / "index.html" if path in ("", "/") else ROOT / path.lstrip("/")
        if not target.exists() or not target.is_file() or ROOT not in target.resolve().parents and target.resolve() != ROOT:
            self.send_error(404)
            return
        content_type = "text/html"
        if target.suffix == ".css":
            content_type = "text/css"
        if target.suffix == ".js":
            content_type = "application/javascript"
        body = target.read_bytes()
        self.send_response(200)
        self.send_header("content-type", f"{content_type}; charset=utf-8")
        self.send_header("content-length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def current_user(self):
        raw = self.headers.get("cookie", "")
        jar = cookies.SimpleCookie(raw)
        token = jar.get(SESSION_COOKIE)
        if not token:
            return None
        with db() as conn:
            row = conn.execute(
                "select users.* from sessions join users on users.id = sessions.user_id where sessions.token = ?",
                (token.value,),
            ).fetchone()
        return row

    def require_user(self):
        user = self.current_user()
        if not user:
            raise PermissionError("ログインしてください")
        return user

    def route_api(self, method, path):
        try:
            if method == "POST" and path == "/api/login":
                self.login()
            elif method == "POST" and path == "/api/logout":
                self.logout()
            elif method == "GET" and path == "/api/me":
                user = self.current_user()
                self.write_json({"user": public_user(user) if user else None})
            elif method == "POST" and path == "/api/rooms":
                self.create_room()
            elif method == "POST" and path == "/api/join":
                self.join_room()
            elif method == "GET" and path.startswith("/api/rooms/"):
                self.get_room(path.rsplit("/", 1)[-1])
            elif method == "POST" and path.startswith("/api/rooms/"):
                parts = path.strip("/").split("/")
                self.room_action(parts[2], parts[3] if len(parts) > 3 else "")
            elif method == "GET" and path == "/api/history":
                self.history()
            else:
                self.error_json("not found", 404)
        except PermissionError as exc:
            self.error_json(str(exc), 401)
        except ValueError as exc:
            self.error_json(str(exc), 400)
        except Exception as exc:
            self.error_json(f"server error: {exc}", 500)

    def login(self):
        data = self.read_json()
        name = (data.get("name") or "").strip()[:24]
        password = data.get("password") or ""
        if len(name) < 2 or len(password) < 4:
            raise ValueError("名前は2文字以上、パスワードは4文字以上にしてください")
        with db() as conn:
            user = conn.execute("select * from users where name = ?", (name,)).fetchone()
            if user and not verify_password(password, user["password_hash"]):
                raise ValueError("パスワードが違います")
            if not user:
                conn.execute(
                    "insert into users(name, password_hash, created_at) values(?, ?, ?)",
                    (name, password_hash(password), now()),
                )
                user = conn.execute("select * from users where name = ?", (name,)).fetchone()
            token = secrets.token_urlsafe(32)
            conn.execute("insert into sessions(token, user_id, created_at) values(?, ?, ?)", (token, user["id"], now()))
        morsel = cookies.SimpleCookie()
        morsel[SESSION_COOKIE] = token
        morsel[SESSION_COOKIE]["path"] = "/"
        morsel[SESSION_COOKIE]["httponly"] = True
        morsel[SESSION_COOKIE]["samesite"] = "Lax"
        self.write_json({"user": public_user(user)}, extra_headers={"set-cookie": morsel.output(header="").strip()})

    def logout(self):
        user = self.current_user()
        if user:
            raw = self.headers.get("cookie", "")
            jar = cookies.SimpleCookie(raw)
            token = jar.get(SESSION_COOKIE)
            if token:
                with db() as conn:
                    conn.execute("delete from sessions where token = ?", (token.value,))
        self.write_json({"ok": True}, extra_headers={"set-cookie": f"{SESSION_COOKIE}=; Path=/; Max-Age=0"})

    def create_room(self):
        user = self.require_user()
        data = self.read_json()
        mode = data.get("mode") if data.get("mode") in ("pvp", "cpu") else "pvp"
        code = secrets.token_hex(3).upper()
        player2_id = None if mode == "pvp" else 0
        state = fresh_state(mode, user["id"], player2_id)
        with db() as conn:
            conn.execute(
                """
                insert into rooms(code, mode, status, owner_id, player1_id, player2_id, state_json, created_at, updated_at)
                values(?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (code, mode, "open", user["id"], user["id"], player2_id, json.dumps(state), now(), now()),
            )
        self.write_json({"code": code})

    def join_room(self):
        user = self.require_user()
        code = (self.read_json().get("code") or "").strip().upper()
        with db() as conn:
            room = conn.execute("select * from rooms where code = ?", (code,)).fetchone()
            if not room:
                raise ValueError("部屋が見つかりません")
            if room["mode"] != "pvp":
                raise ValueError("この部屋には参加できません")
            if room["player1_id"] == user["id"] or room["player2_id"] == user["id"]:
                self.write_json({"code": code})
                return
            if room["player2_id"]:
                raise ValueError("この部屋は満席です")
            state = json.loads(room["state_json"])
            state["p2"]["user_id"] = user["id"]
            state["phase"] = "idle"
            state["message"] = "Dealで開始"
            conn.execute(
                "update rooms set player2_id = ?, state_json = ?, updated_at = ? where code = ?",
                (user["id"], json.dumps(state), now(), code),
            )
        self.write_json({"code": code})

    def load_room_for_user(self, code):
        user = self.require_user()
        with db() as conn:
            room = conn.execute("select * from rooms where code = ?", (code.upper(),)).fetchone()
        if not room:
            raise ValueError("部屋が見つかりません")
        if room["mode"] == "cpu" and room["player1_id"] != user["id"]:
            raise PermissionError("この部屋には参加していません")
        if room["mode"] == "pvp" and room["player1_id"] != user["id"] and room["player2_id"] != user["id"]:
            raise PermissionError("この部屋には参加していません")
        return user, room, json.loads(room["state_json"])

    def get_room(self, code):
        user, room, state = self.load_room_for_user(code)
        self.write_json({"room": self.public_room(room, state, user["id"])})

    def room_action(self, code, action_name):
        user, room, state = self.load_room_for_user(code)
        seat = "p1" if room["player1_id"] == user["id"] else "p2"
        data = self.read_json()
        if action_name == "deal":
            if state["phase"] in ("idle", "complete"):
                start_hand(state)
                cpu_action(state)
        elif action_name in ("call", "raise", "fold"):
            action(state, seat, action_name, data.get("amount", 0))
            cpu_action(state)
        else:
            raise ValueError("不明なアクションです")
        self.persist_room(room, state)
        if state["phase"] == "complete":
            self.record_match(room, state)
        self.write_json({"room": self.public_room(room, state, user["id"])})

    def persist_room(self, room, state):
        with db() as conn:
            conn.execute(
                "update rooms set state_json = ?, updated_at = ? where code = ?",
                (json.dumps(state), now(), room["code"]),
            )

    def record_match(self, room, state):
        with db() as conn:
            exists = conn.execute(
                "select id from matches where room_code = ? and hand_number = ?",
                (room["code"], state["hand"]),
            ).fetchone()
            if exists:
                return
            winner_id = None
            winner_name = state["last_result"].split("の勝ち", 1)[0] if "の勝ち" in state["last_result"] else "チョップ"
            if winner_name == "Player 1":
                winner_id = room["player1_id"]
            if winner_name == "Player 2":
                winner_id = room["player2_id"]
            conn.execute(
                """
                insert into matches(room_code, mode, player1_id, player2_id, winner_id, winner_name, result, hand_number, created_at)
                values(?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (room["code"], room["mode"], room["player1_id"], room["player2_id"], winner_id, winner_name, state["last_result"], state["hand"], now()),
            )

    def public_room(self, room, state, viewer_id):
        visible = json.loads(json.dumps(state))
        viewer_seat = "p1" if room["player1_id"] == viewer_id else "p2"
        for seat in ("p1", "p2"):
            if not state["showdown"] and seat != viewer_seat and not (state["mode"] == "cpu" and seat == "p2"):
                visible[seat]["cards"] = [{"hidden": True}, {"hidden": True}] if state[seat]["cards"] else []
            if state["mode"] == "cpu" and seat == "p2" and not state["showdown"]:
                visible[seat]["cards"] = [{"hidden": True}, {"hidden": True}] if state[seat]["cards"] else []
        visible["viewer_seat"] = viewer_seat
        visible["can_act"] = state["actor"] == viewer_seat and state["phase"] not in ("idle", "waiting", "complete")
        visible["code"] = room["code"]
        return visible

    def history(self):
        user = self.require_user()
        with db() as conn:
            rows = conn.execute(
                """
                select * from matches
                where player1_id = ? or player2_id = ?
                order by created_at desc
                limit 50
                """,
                (user["id"], user["id"]),
            ).fetchall()
        self.write_json({"history": [dict(row) for row in rows]})


if __name__ == "__main__":
    init_db()
    host = os.environ.get("HOST", "0.0.0.0")
    port = int(os.environ.get("PORT", "8765"))
    print(f"Poker app: http://{host}:{port}")
    ThreadingHTTPServer((host, port), Handler).serve_forever()
