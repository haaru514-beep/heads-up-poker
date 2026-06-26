let currentUser = null;
let currentRoom = null;
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
  logoutButton: $("#logoutButton"),
  lobbyView: $("#lobbyView"),
  roomView: $("#roomView"),
  createPvpButton: $("#createPvpButton"),
  createCpuButton: $("#createCpuButton"),
  casualStackInput: $("#casualStackInput"),
  casualSmallBlindInput: $("#casualSmallBlindInput"),
  casualBigBlindInput: $("#casualBigBlindInput"),
  joinForm: $("#joinForm"),
  roomCodeInput: $("#roomCodeInput"),
  historyList: $("#historyList"),
  backButton: $("#backButton"),
  copyButton: $("#copyButton"),
  roomCode: $("#roomCode"),
  p1Name: $("#p1Name"),
  p2Name: $("#p2Name"),
  p1UserId: $("#p1UserId"),
  p2UserId: $("#p2UserId"),
  p1Stack: $("#p1Stack"),
  p2Stack: $("#p2Stack"),
  p1Cards: $("#p1Cards"),
  p2Cards: $("#p2Cards"),
  p1Bet: $("#p1Bet"),
  p2Bet: $("#p2Bet"),
  communityCards: $("#communityCards"),
  messageText: $("#messageText"),
  blindText: $("#blindText"),
  potText: $("#potText"),
  dealButton: $("#dealButton"),
  callButton: $("#callButton"),
  raiseButton: $("#raiseButton"),
  foldButton: $("#foldButton"),
  raiseInput: $("#raiseInput"),
  adminLoginForm: $("#adminLoginForm"),
  adminPasscodeInput: $("#adminPasscodeInput"),
  adminRoomForm: $("#adminRoomForm"),
  tournamentTitleInput: $("#tournamentTitleInput"),
  tournamentStackInput: $("#tournamentStackInput"),
  structureInput: $("#structureInput"),
  adminRoomList: $("#adminRoomList"),
};

function cardLabel(card) {
  const suits = { S: "♠", H: "♥", D: "♦", C: "♣" };
  return `${card.rank}${suits[card.suit]}`;
}

function cardHtml(card) {
  if (!card || card.hidden) return '<div class="card back"></div>';
  const label = cardLabel(card);
  const red = card.suit === "H" || card.suit === "D" ? " red" : "";
  return `<div class="card${red}" aria-label="${label}"><span class="rank">${card.rank}</span><span class="suit">${label.slice(1)}</span><span class="corner">${card.rank}</span></div>`;
}

function showLoggedIn(user) {
  currentUser = user;
  els.userName.textContent = `${user.name} / ${user.login_id}`;
  els.loginView.classList.add("hidden");
  els.mainView.classList.remove("hidden");
  showLobby();
}

function casualSettings(mode) {
  return {
    mode,
    initial_stack: Number(els.casualStackInput.value) || 1000,
    small_blind: Number(els.casualSmallBlindInput.value) || 10,
    big_blind: Number(els.casualBigBlindInput.value) || 20,
  };
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
    ? data.history.map((row) => `<li>${row.result} / ${row.mode.toUpperCase()} / Room ${row.room_code}</li>`).join("")
    : "<li>まだ履歴がありません</li>";
}

async function pollRoom() {
  if (!currentRoom) return;
  const data = await api(`/api/rooms/${currentRoom}`);
  renderRoom(data.room);
}

function renderRoom(room) {
  els.roomCode.textContent = room.code;
  els.p1Stack.textContent = room.p1.stack;
  els.p2Stack.textContent = room.p2.stack;
  els.p1Bet.textContent = `Bet ${room.p1.bet}`;
  els.p2Bet.textContent = `Bet ${room.p2.bet}`;
  els.p1Name.textContent = room.p1.user ? room.p1.user.name : "Player 1";
  els.p2Name.textContent = room.mode === "cpu" ? "CPU" : (room.p2.user ? room.p2.user.name : "Player 2");
  els.p1UserId.textContent = room.p1.user ? room.p1.user.login_id : "";
  els.p2UserId.textContent = room.p2.user ? room.p2.user.login_id : "";
  els.p1Cards.innerHTML = room.p1.cards.map(cardHtml).join("");
  els.p2Cards.innerHTML = room.p2.cards.map(cardHtml).join("");
  const board = [...room.community];
  while (board.length < 5 && room.phase !== "idle" && room.phase !== "waiting") board.push(null);
  els.communityCards.innerHTML = board.map(cardHtml).join("");
  els.messageText.textContent = room.message;
  els.blindText.textContent = room.blinds ? `Level ${room.blinds.level} / ${room.blinds.small_blind}-${room.blinds.big_blind}` : "";
  els.potText.textContent = `Pot ${room.pot}`;

  const toCall = Math.max(0, room.current_bet - room[room.viewer_seat].bet);
  els.dealButton.disabled = !["idle", "complete"].includes(room.phase);
  els.callButton.disabled = !room.can_act;
  els.raiseButton.disabled = !room.can_act;
  els.foldButton.disabled = !room.can_act || !toCall;
  els.callButton.textContent = toCall ? `Call ${toCall}` : "Check";
  els.raiseButton.textContent = room.current_bet ? "Raise" : "Bet";
}

async function roomAction(name, body = {}) {
  const data = await api(`/api/rooms/${currentRoom}/${name}`, { method: "POST", body });
  renderRoom(data.room);
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
  await navigator.clipboard.writeText(`${location.origin}\nRoom: ${currentRoom}`);
});
els.dealButton.addEventListener("click", () => roomAction("deal"));
els.callButton.addEventListener("click", () => roomAction("call"));
els.raiseButton.addEventListener("click", () => roomAction("raise", { amount: Number(els.raiseInput.value) || 40 }));
els.foldButton.addEventListener("click", () => roomAction("fold"));

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
