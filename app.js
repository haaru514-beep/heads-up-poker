let currentUser = null;
let currentRoom = null;
let currentRoomState = null;
let pollTimer = null;

const $ = (selector) => document.querySelector(selector);
const api = async (path, options = {}) => {
  const response = await fetch(path, {
    headers: { "content-type": "application/json" },
    credentials: "same-origin",
    ...options,
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || "通信に失敗しました");
  return data;
};

const els = {
  loginView: $("#loginView"),
  mainView: $("#mainView"),
  loginForm: $("#loginForm"),
  loginIdInput: $("#loginIdInput"),
  nameInput: $("#nameInput"),
  passwordInput: $("#passwordInput"),
  userName: $("#userName"),
  profileIconInput: $("#profileIconInput"),
  profileIconPreview: $("#profileIconPreview"),
  logoutButton: $("#logoutButton"),
  lobbyView: $("#lobbyView"),
  roomView: $("#roomView"),
  createPvpButton: $("#createPvpButton"),
  createCpuButton: $("#createCpuButton"),
  casualStackInput: $("#casualStackInput"),
  casualSmallBlindInput: $("#casualSmallBlindInput"),
  casualBigBlindInput: $("#casualBigBlindInput"),
  casualLevelMinutesInput: $("#casualLevelMinutesInput"),
  casualTimerInput: $("#casualTimerInput"),
  joinForm: $("#joinForm"),
  roomCodeInput: $("#roomCodeInput"),
  historyList: $("#historyList"),
  backButton: $("#backButton"),
  copyButton: $("#copyButton"),
  roomCode: $("#roomCode"),
  p1Name: $("#p1Name"),
  p2Name: $("#p2Name"),
  p1Icon: $("#p1Icon"),
  p2Icon: $("#p2Icon"),
  p1UserId: $("#p1UserId"),
  p2UserId: $("#p2UserId"),
  p1Role: $("#p1Role"),
  p2Role: $("#p2Role"),
  p1Stack: $("#p1Stack"),
  p2Stack: $("#p2Stack"),
  p1Cards: $("#p1Cards"),
  p2Cards: $("#p2Cards"),
  p1Bet: $("#p1Bet"),
  p2Bet: $("#p2Bet"),
  communityCards: $("#communityCards"),
  messageText: $("#messageText"),
  actionText: $("#actionText"),
  blindText: $("#blindText"),
  potText: $("#potText"),
  dealButton: $("#dealButton"),
  callButton: $("#callButton"),
  raiseButton: $("#raiseButton"),
  allInButton: $("#allInButton"),
  foldButton: $("#foldButton"),
  potSizeButtons: document.querySelectorAll(".pot-size-button"),
  raiseInput: $("#raiseInput"),
  raiseValue: $("#raiseValue"),
  adminLoginForm: $("#adminLoginForm"),
  adminPasscodeInput: $("#adminPasscodeInput"),
  adminRoomForm: $("#adminRoomForm"),
  tournamentTitleInput: $("#tournamentTitleInput"),
  tournamentStackInput: $("#tournamentStackInput"),
  tournamentTimerInput: $("#tournamentTimerInput"),
  structureInput: $("#structureInput"),
  adminRoomList: $("#adminRoomList"),
};

function cardLabel(card) {
  const suits = { S: "♠", H: "♥", D: "♦", C: "♣" };
  const rank = card.rank === "T" ? "10" : card.rank;
  return `${rank}${suits[card.suit]}`;
}

function cardHtml(card) {
  if (!card || card.hidden) return `<div class="card back${card && card.mucked ? " mucked" : ""}">${card && card.mucked ? "<span>MUCK</span>" : ""}</div>`;
  const label = cardLabel(card);
  const rank = card.rank === "T" ? "10" : card.rank;
  const red = card.suit === "H" || card.suit === "D" ? " red" : "";
  return `<div class="card${red}" aria-label="${label}"><span class="rank">${rank}</span><span class="suit">${label.replace(rank, "")}</span><span class="corner">${rank}</span></div>`;
}

function showLoggedIn(user) {
  currentUser = user;
  els.userName.textContent = `${user.name} / ${user.login_id}`;
  setIcon(els.profileIconPreview, user.icon_data);
  els.loginView.classList.add("hidden");
  els.mainView.classList.remove("hidden");
  showLobby();
}

function setIcon(element, iconData) {
  element.classList.toggle("default-cat", !iconData);
  element.style.backgroundImage = iconData ? `url("${iconData}")` : "";
}

function fileToIconData(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("画像を読み込めませんでした"));
    reader.onload = () => {
      const image = new Image();
      image.onerror = () => reject(new Error("画像形式を確認してください"));
      image.onload = () => {
        const canvas = document.createElement("canvas");
        const size = 192;
        canvas.width = size;
        canvas.height = size;
        const ctx = canvas.getContext("2d");
        const scale = Math.max(size / image.width, size / image.height);
        const width = image.width * scale;
        const height = image.height * scale;
        ctx.drawImage(image, (size - width) / 2, (size - height) / 2, width, height);
        resolve(canvas.toDataURL("image/jpeg", 0.82));
      };
      image.src = reader.result;
    };
    reader.readAsDataURL(file);
  });
}

function casualSettings(mode) {
  return {
    mode,
    initial_stack: Number(els.casualStackInput.value) || 1000,
    small_blind: Number(els.casualSmallBlindInput.value) || 10,
    big_blind: Number(els.casualBigBlindInput.value) || 20,
    level_minutes: Number(els.casualLevelMinutesInput.value) || 15,
    hand_timer_enabled: els.casualTimerInput.checked,
    hand_seconds: 30,
  };
}

function formatClock(totalSeconds) {
  const seconds = Math.max(0, Number(totalSeconds) || 0);
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  return `${minutes}:${String(rest).padStart(2, "0")}`;
}

function showLobby() {
  currentRoom = null;
  clearInterval(pollTimer);
  els.lobbyView.classList.remove("hidden");
  els.roomView.classList.add("hidden");
  loadHistory();
}

function showRoom(code) {
  currentRoom = code;
  els.lobbyView.classList.add("hidden");
  els.roomView.classList.remove("hidden");
  pollRoom();
  clearInterval(pollTimer);
  pollTimer = setInterval(pollRoom, 1400);
}

async function loadHistory() {
  const data = await api("/api/history");
  els.historyList.innerHTML = data.history.length
    ? historyByDateHtml(data.history)
    : "<li>まだ履歴がありません</li>";
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  }[char]));
}

function historyItemHtml(row) {
  const actions = Array.isArray(row.action_log) ? row.action_log : [];
  const hand = row.hand_detail || {};
  const handDetail = hand.p1 || hand.p2 ? `
    <div class="history-hand-detail">
      <div><strong>Board</strong><span>${escapeHtml(hand.board || "-")}</span></div>
      ${historyHandSeatHtml(hand.p1)}
      ${historyHandSeatHtml(hand.p2)}
    </div>
  ` : "";
  const detail = actions.length
    ? actions.map((action) => `
        <li>
          <span>${escapeHtml(action.text)}</span>
          <small>ポット ${escapeHtml(action.pot)} / P1 ${escapeHtml(action.p1_stack)}点 / P2 ${escapeHtml(action.p2_stack)}点</small>
        </li>
      `).join("")
    : "<li><span>この履歴には詳細がありません</span></li>";
  return `
    <li class="history-entry">
      <details>
        <summary>
          <strong>${escapeHtml(row.result)}</strong>
          <span>${historyTimeLabel(row.created_at)} / ${escapeHtml(row.mode).toUpperCase()} / 部屋 ${escapeHtml(row.room_code)} / Hand ${escapeHtml(row.hand_number)}</span>
        </summary>
        ${handDetail}
        <ol class="history-actions">${detail}</ol>
      </details>
    </li>
  `;
}

function historyHandSeatHtml(seat) {
  if (!seat) return "";
  const status = seat.mucked ? "マック" : (seat.shown ? "公開" : "非公開");
  return `
    <div>
      <strong>${escapeHtml(seat.name)}</strong>
      <span>${escapeHtml(seat.cards || "-")} <em>${escapeHtml(status)}</em></span>
    </div>
  `;
}

function historyDateLabel(timestamp) {
  const date = new Date(Number(timestamp) * 1000);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}/${month}/${day}`;
}

function historyTimeLabel(timestamp) {
  const date = new Date(Number(timestamp) * 1000);
  const hours = String(date.getHours()).padStart(2, "0");
  const minutes = String(date.getMinutes()).padStart(2, "0");
  return `${hours}:${minutes}`;
}

function historyByDateHtml(history) {
  let currentDate = "";
  return history.map((row) => {
    const dateLabel = historyDateLabel(row.created_at);
    const header = dateLabel === currentDate ? "" : `<li class="history-date">${escapeHtml(dateLabel)}</li>`;
    currentDate = dateLabel;
    return `${header}${historyItemHtml(row)}`;
  }).join("");
}

async function pollRoom() {
  if (!currentRoom) return;
  const data = await api(`/api/rooms/${currentRoom}`);
  renderRoom(data.room);
}

function renderRoom(room) {
  currentRoomState = room;
  els.roomCode.textContent = room.code;
  els.p1Stack.textContent = room.p1.stack;
  els.p2Stack.textContent = room.p2.stack;
  els.p1Bet.textContent = `ベット ${room.p1.bet}`;
  els.p2Bet.textContent = `ベット ${room.p2.bet}`;
  els.p1Name.textContent = room.p1.user ? room.p1.user.name : "Player 1";
  els.p2Name.textContent = room.mode === "cpu" ? "CPU" : (room.p2.user ? room.p2.user.name : "Player 2");
  setIcon(els.p1Icon, room.p1.user ? room.p1.user.icon_data : "");
  setIcon(els.p2Icon, room.p2.user ? room.p2.user.icon_data : "");
  els.p1UserId.textContent = room.p1.user ? room.p1.user.login_id : "";
  els.p2UserId.textContent = room.p2.user ? room.p2.user.login_id : "";
  els.p1Role.textContent = roleText(room, "p1");
  els.p2Role.textContent = roleText(room, "p2");
  els.p1Cards.innerHTML = room.p1.cards.map(cardHtml).join("");
  els.p2Cards.innerHTML = room.p2.cards.map(cardHtml).join("");
  const board = [...room.community];
  while (board.length < 5 && room.phase !== "idle" && room.phase !== "waiting") board.push(null);
  els.communityCards.innerHTML = board.map(cardHtml).join("");
  els.messageText.textContent = room.message;
  els.actionText.textContent = actionText(room);
  els.blindText.textContent = room.blinds
    ? `Level ${room.blinds.level} / ${room.blinds.small_blind}-${room.blinds.big_blind} / ${formatClock(room.blinds.remaining_seconds)}${room.action_timer ? ` / 手番 ${room.action_timer.remaining_seconds}秒` : ""}`
    : "";
  els.potText.textContent = `ポット ${room.pot}`;

  const toCall = Math.max(0, room.current_bet - room[room.viewer_seat].bet);
  const viewer = room[room.viewer_seat];
  const bigBlind = room.blinds ? room.blinds.big_blind : 20;
  const minRaiseTo = room.current_bet ? room.current_bet + bigBlind : bigBlind;
  const maxRaiseTo = viewer.stack + viewer.bet;
  const canRaise = room.can_act && viewer.stack > 0 && maxRaiseTo >= minRaiseTo;
  const sliderStep = Math.max(1, Math.min(bigBlind, 100));
  els.raiseInput.min = minRaiseTo;
  els.raiseInput.max = Math.max(minRaiseTo, maxRaiseTo);
  els.raiseInput.step = sliderStep;
  if (Number(els.raiseInput.value) < minRaiseTo || Number(els.raiseInput.value) > Math.max(minRaiseTo, maxRaiseTo)) {
    els.raiseInput.value = Math.min(Math.max(minRaiseTo, maxRaiseTo), minRaiseTo);
  }
  els.raiseValue.textContent = els.raiseInput.value;
  els.dealButton.disabled = !["idle", "showdown_wait", "complete"].includes(room.phase);
  els.dealButton.dataset.action = room.phase === "showdown_wait" ? "showdown" : "deal";
  els.dealButton.textContent = room.phase === "waiting" ? "参加待ち" : (room.phase === "showdown_wait" ? "ショーダウン" : (room.phase === "complete" ? "次のハンド" : "始める"));
  els.callButton.disabled = !room.can_act;
  els.raiseButton.disabled = !canRaise;
  els.allInButton.disabled = !room.can_act || viewer.stack <= 0;
  els.foldButton.disabled = !room.can_act || !toCall;
  els.raiseInput.disabled = !canRaise;
  els.potSizeButtons.forEach((button) => {
    button.disabled = !canRaise;
  });
  els.callButton.textContent = toCall ? `コール ${toCall}` : "チェック";
  els.raiseButton.textContent = room.current_bet ? `レイズ ${els.raiseInput.value}` : `ベット ${els.raiseInput.value}`;
  els.allInButton.textContent = `オールイン ${viewer.stack + viewer.bet}`;
  els.foldButton.textContent = "フォールド";
}

function roleText(room, seat) {
  if (!room.roles) return "";
  const labels = [];
  if (room.roles.dealer === seat) labels.push("D");
  if (room.roles.small_blind === seat) labels.push("SB");
  if (room.roles.big_blind === seat) labels.push("BB");
  return labels.join(" / ");
}

function actionText(room) {
  if (room.phase === "showdown_wait") return "ショーダウン待ち";
  if (!room.actor_name) return "";
  const timer = room.action_timer ? ` / 残り${room.action_timer.remaining_seconds}秒` : "";
  return `現在の手番: ${room.actor_name}${timer}`;
}

function setRaiseAmount(amount) {
  const min = Number(els.raiseInput.min) || 0;
  const max = Number(els.raiseInput.max) || min;
  const step = Number(els.raiseInput.step) || 1;
  const clamped = Math.max(min, Math.min(max, Math.round(amount / step) * step));
  els.raiseInput.value = clamped;
  els.raiseValue.textContent = clamped;
  els.raiseButton.textContent = els.raiseButton.textContent.startsWith("レイズ") ? `レイズ ${clamped}` : `ベット ${clamped}`;
}

async function roomAction(name, body = {}) {
  try {
    const data = await api(`/api/rooms/${currentRoom}/${name}`, { method: "POST", body });
    renderRoom(data.room);
  } catch (error) {
    alert(error.message);
    pollRoom();
  }
}

els.loginForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  try {
    const data = await api("/api/login", {
      method: "POST",
      body: { login_id: els.loginIdInput.value, name: els.nameInput.value, password: els.passwordInput.value },
    });
    showLoggedIn(data.user);
  } catch (error) {
    alert(error.message);
  }
});

els.logoutButton.addEventListener("click", async () => {
  await api("/api/logout", { method: "POST" });
  location.reload();
});

els.profileIconInput.addEventListener("change", async () => {
  const file = els.profileIconInput.files && els.profileIconInput.files[0];
  if (!file) return;
  try {
    const iconData = await fileToIconData(file);
    const data = await api("/api/profile/icon", { method: "POST", body: { icon_data: iconData } });
    currentUser = data.user;
    els.userName.textContent = `${data.user.name} / ${data.user.login_id}`;
    setIcon(els.profileIconPreview, data.user.icon_data);
    if (currentRoom) pollRoom();
  } catch (error) {
    alert(error.message);
  } finally {
    els.profileIconInput.value = "";
  }
});

els.createPvpButton.addEventListener("click", async () => {
  const data = await api("/api/rooms", { method: "POST", body: casualSettings("pvp") });
  showRoom(data.code);
});

els.createCpuButton.addEventListener("click", async () => {
  const data = await api("/api/rooms", { method: "POST", body: casualSettings("cpu") });
  showRoom(data.code);
});

els.joinForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  try {
    const data = await api("/api/join", { method: "POST", body: { code: els.roomCodeInput.value } });
    showRoom(data.code);
  } catch (error) {
    alert(error.message);
  }
});

els.backButton.addEventListener("click", showLobby);
els.copyButton.addEventListener("click", async () => {
  await navigator.clipboard.writeText(`${location.origin}\n部屋コード: ${currentRoom}`);
});
els.dealButton.addEventListener("click", () => roomAction(els.dealButton.dataset.action || "deal"));
els.callButton.addEventListener("click", () => roomAction("call"));
els.raiseButton.addEventListener("click", () => roomAction("raise", { amount: Number(els.raiseInput.value) || 40 }));
els.allInButton.addEventListener("click", () => roomAction("allin"));
els.foldButton.addEventListener("click", () => roomAction("fold"));
els.raiseInput.addEventListener("input", () => {
  els.raiseValue.textContent = els.raiseInput.value;
  els.raiseButton.textContent = els.raiseButton.textContent.startsWith("レイズ") ? `レイズ ${els.raiseInput.value}` : `ベット ${els.raiseInput.value}`;
});
els.potSizeButtons.forEach((button) => {
  button.addEventListener("click", () => {
    if (!currentRoomState) return;
    const percent = Number(button.dataset.potSize) || 0;
    const viewer = currentRoomState[currentRoomState.viewer_seat];
    const toCall = Math.max(0, currentRoomState.current_bet - viewer.bet);
    const target = viewer.bet + toCall + (currentRoomState.pot + toCall) * percent;
    setRaiseAmount(target);
  });
});

els.adminLoginForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  try {
    await api("/api/admin/login", { method: "POST", body: { passcode: els.adminPasscodeInput.value } });
    els.adminRoomForm.classList.remove("hidden");
    loadAdminRooms();
  } catch (error) {
    alert(error.message);
  }
});

async function loadAdminRooms() {
  const data = await api("/api/admin/rooms");
  els.adminRoomList.innerHTML = data.rooms.map((room) => {
    const title = room.settings.title || room.code;
    return `<li>${title} / ${room.code} / ${room.phase} / ${room.settings.initial_stack}</li>`;
  }).join("");
}

els.adminRoomForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  try {
    const data = await api("/api/admin/rooms", {
      method: "POST",
      body: {
        title: els.tournamentTitleInput.value,
        initial_stack: Number(els.tournamentStackInput.value) || 1000,
        hand_timer_enabled: els.tournamentTimerInput.checked,
        hand_seconds: 30,
        structure: els.structureInput.value,
      },
    });
    await loadAdminRooms();
    showRoom(data.code);
  } catch (error) {
    alert(error.message);
  }
});

api("/api/me").then((data) => {
  if (data.user) showLoggedIn(data.user);
}).catch(() => {});
