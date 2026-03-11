class Game {
  constructor() {
    this.setupState = ["HUMAN", "HUMAN", "OFF", "OFF"];
    this.playerAnimalIndices = [0, 1, 2, 3];
    this.quickStartMixedLevel = 3;
    this.ruleOptions = {
      jokers: false,
      initial30: false,
      hintLimit: null
    };
    this.modeKey = "custom";
    this.stateVersion = 0;
    this.asyncEpoch = 0;
    this.inputLocked = false;
    this.inputLockToken = 0;
    this.resetRound();
  }

  resetRound() {
    this.clearScheduledTurnTimers();
    this.players = [];
    this.turn = 0;
    this.bag = [];
    this.tilePool = null;
    this.table = [];
    this.workingTable = [];
    this.baseTableCount = 0;
    this.selectedRackIds = new Set();
    this.selectedTableIds = new Set();
    this.selectedGroupIndex = null;
    this.actionHistory = [];
    this.drewTileThisTurn = false;
    this.drawnTileId = null;
    this.gameOver = false;
    this.aiTimer = null;
    this.turnAdvanceTimer = null;
    this.lastHint = null;
    this.consecutiveStrategicDrawsByPlayer = [];
    this.openingHoldDrawUsed = [];
  }

  get currentPlayer() {
    return this.players[this.turn];
  }

  getTotalSelectedCount() {
    return this.selectedRackIds.size + this.selectedTableIds.size;
  }

  ensureActiveSetupState(index, fallback = "HUMAN") {
    if (this.setupState[index] === "OFF") {
      this.setupState[index] = fallback;
    }
  }

  initTileTracker() {
    this.tilePool = {};
    COLORS.forEach(color => {
      for (let num = 1; num <= 13; num += 1) {
        this.tilePool[`${color.key}-${num}`] = 2;
      }
    });
    if (this.ruleOptions.jokers) {
      this.tilePool.joker = 2;
    }
  }

  buildTileTracker(forPlayerIndex) {
    if (!this.tilePool) this.initTileTracker();
    const pool = {};
    const known = {};
    Object.entries(this.tilePool).forEach(([key, count]) => {
      pool[key] = count;
      known[key] = 0;
    });

    const tileKey = (tile) => tile.joker ? "joker" : `${tile.color}-${tile.number}`;
    const myRack = this.players[forPlayerIndex]?.rack || [];
    myRack.forEach(tile => {
      const key = tileKey(tile);
      known[key] = (known[key] || 0) + 1;
    });
    this.workingTable.flat().forEach(tile => {
      const key = tileKey(tile);
      known[key] = (known[key] || 0) + 1;
    });

    const uncertain = {};
    let uncertainTotal = 0;
    Object.entries(pool).forEach(([key, total]) => {
      const remaining = Math.max(0, total - (known[key] || 0));
      uncertain[key] = remaining;
      uncertainTotal += remaining;
    });

    const bagSize = this.bag.length;
    const opponentTotalCards = this.players
      .filter((_, index) => index !== forPlayerIndex)
      .reduce((sum, player) => sum + player.rack.length, 0);

    return {
      pool,
      known,
      uncertain,
      uncertainTotal,
      bagSize,
      opponentTotalCards
    };
  }

  buildGameStateForAI(options = {}) {
    const state = {
      currentPlayer: {
        rack: deepCopy(this.currentPlayer.rack),
        opened: this.currentPlayer.opened,
        aiLevel: this.currentPlayer.aiLevel
      },
      table: deepCopy(this.workingTable),
      baseTableCount: this.baseTableCount,
      bagCount: this.bag.length,
      ruleOptions: deepCopy(this.ruleOptions),
      playersMeta: this.players.map((player, index) => ({
        index,
        rackCount: player.rack.length,
        opened: player.opened,
        type: player.type,
        aiLevel: player.aiLevel
      })),
      stateVersion: this.stateVersion,
      turnIndex: this.turn,
      consecutiveStrategicDrawsByPlayer: [...this.consecutiveStrategicDrawsByPlayer],
      openingHoldDrawUsed: [...this.openingHoldDrawUsed]
    };
    if (options.hintMode) {
      state.hintMode = true;
      state.turnStartRackSize = this.getTurnStartRackSize();
      state.alreadyReducedRackThisTurn = this.hasReducedRackThisTurn();
    }
    if (this.currentPlayer.aiLevel === 6 || options.hintMode) {
      state.tileTracker = this.buildTileTracker(this.turn);
    }
    return state;
  }

  clearHint() {
    this.lastHint = null;
  }

  getInitialHintCount() {
    return this.ruleOptions.hintLimit === null ? null : Number(this.ruleOptions.hintLimit) || 0;
  }

  canUseHint() {
    if (!this.currentPlayer || this.currentPlayer.type !== "HUMAN") return false;
    return this.currentPlayer.hintsRemaining === null || this.currentPlayer.hintsRemaining > 0;
  }

  quickStart(count) {
    this.setupState = this.setupState.map((state, index) => (index < count ? state : "OFF"));
    this.ensureActiveSetupState(0, "HUMAN");
    if (count >= 2) this.ensureActiveSetupState(1, "HUMAN");
    if (count >= 3) this.ensureActiveSetupState(2, "HUMAN");
    if (count >= 4) this.ensureActiveSetupState(3, "HUMAN");
    this.modeKey = count === 4 ? "4p" : "2p";
    this.startFromSetup();
  }

  quickStartMixed() {
    const mixedAiState = `AI-${this.quickStartMixedLevel}`;
    this.setupState = this.setupState.map((state, index) => {
      if (index >= 4) return "OFF";
      if (index === 0) return "HUMAN";
      return mixedAiState;
    });
    this.modeKey = "mixed";
    this.startFromSetup();
  }

  startCustom() {
    this.modeKey = "custom";
    this.startFromSetup();
  }

  toggleRuleOption(key) {
    this.ruleOptions[key] = !this.ruleOptions[key];
    ui.renderRuleOptions();
  }

  cycleHintLimit() {
    const current = this.ruleOptions.hintLimit === undefined ? null : this.ruleOptions.hintLimit;
    const currentIndex = HINT_LIMIT_OPTIONS.findIndex(value => value === current);
    const nextIndex = currentIndex >= 0 ? (currentIndex + 1) % HINT_LIMIT_OPTIONS.length : 0;
    this.ruleOptions.hintLimit = HINT_LIMIT_OPTIONS[nextIndex];
    ui.renderRuleOptions();
  }

  cycleQuickStartMixedLevel() {
    this.quickStartMixedLevel = this.quickStartMixedLevel >= 6 ? 1 : this.quickStartMixedLevel + 1;
    ui.renderQuickStartMixedLevel();
  }

  cyclePlayerAnimal(index) {
    this.playerAnimalIndices[index] = (this.playerAnimalIndices[index] + 1) % ANIMAL_OPTIONS.length;
    ui.renderSetup();
  }

  cycleSetupState(index) {
    const current = this.setupState[index];
    const currentIdx = SETUP_STATES.indexOf(current);
    this.setupState[index] = SETUP_STATES[(currentIdx + 1) % SETUP_STATES.length];
    ui.renderSetup();
  }

  startFromSetup() {
    this.resetRound();
    const players = [];

    PLAYER_PRESETS.forEach((preset, idx) => {
      const state = this.setupState[idx];
      if (state === "OFF") return;
      const animal = ANIMAL_OPTIONS[this.playerAnimalIndices[idx]] || ANIMAL_OPTIONS[0];
      players.push({
        id: idx,
        slot: idx,
        name: animal.name,
        icon: animal.icon,
        accent: preset.accent,
        type: state === "HUMAN" ? "HUMAN" : "AI",
        aiLevel: state.startsWith("AI-") ? Number(state.split("-")[1]) : null,
        hintsRemaining: this.getInitialHintCount(),
        rack: [],
        logs: [],
        opened: !this.ruleOptions.initial30
      });
    });

    if (players.length < 2) {
      ui.toast("최소 2명은 있어야 시작할 수 있어요.");
      return;
    }

    this.players = players;
    this.consecutiveStrategicDrawsByPlayer = this.players.map(() => 0);
    this.openingHoldDrawUsed = this.players.map(() => 0);
    this.initTileTracker();
    this.bag = this.createBag();
    this.players.forEach(player => {
      player.rack = this.bag.splice(0, 14);
      this.addLog(player, this.ruleOptions.initial30 ? "30 등록 전" : "준비 완료");
    });

    const hasChallenge = this.players.some(player => player.aiLevel === 6);
    document.body.classList.toggle("night-mode", hasChallenge);

    this.beginTurn();
    ui.showScreen("game-screen");
    ui.updateAll();
    this.openTurn();
  }

  createBag() {
    const bag = [];
    let id = 1;
    for (let copy = 0; copy < 2; copy += 1) {
      COLORS.forEach(color => {
        for (let num = 1; num <= 13; num += 1) {
          bag.push({ id: id++, number: num, color: color.key });
        }
      });
    }
    if (this.ruleOptions.jokers) {
      bag.push({ id: id++, joker: true, color: "joker" });
      bag.push({ id: id++, joker: true, color: "joker" });
    }
    return this.shuffle(bag);
  }

  shuffle(list) {
    const arr = [...list];
    for (let i = arr.length - 1; i > 0; i -= 1) {
      const j = Math.floor(Math.random() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  }

  beginTurn() {
    this.clearScheduledTurnTimers();
    this.workingTable = deepCopy(this.table);
    this.baseTableCount = this.table.length;
    this.selectedRackIds = new Set();
    this.selectedTableIds = new Set();
    this.selectedGroupIndex = null;
    this.actionHistory = [];
    this.drewTileThisTurn = false;
    this.drawnTileId = null;
    this.clearHint();
  }

  openTurn() {
    if (this.gameOver || !this.currentPlayer) return;

    if (this.currentPlayer.type === "AI") {
      if (this.ruleOptions.initial30 && !this.currentPlayer.opened) {
        ui.setInfo("AI 개시 등록", `${this.currentPlayer.icon} ${this.currentPlayer.name}가 30점 이상 개시 멜드를 찾는 중입니다.`);
      } else {
        ui.setInfo("AI 행동", `${this.currentPlayer.icon} ${this.currentPlayer.name}가 조합을 찾는 중입니다.`);
      }
      ui.toast(`${this.currentPlayer.icon} ${this.currentPlayer.name} 차례`);
      this.aiTimer = setTimeout(() => this.performAiTurn(), 800);
      return;
    }

    if (this.ruleOptions.initial30 && !this.currentPlayer.opened) {
      ui.setInfo(
        "30점 등록 전",
        `${this.currentPlayer.icon} ${this.currentPlayer.name}는 이번 턴에 자기 손패만으로 30점 이상 새 줄을 등록해야 합니다. 기존 테이블은 아직 건드릴 수 없습니다.`
      );
    } else {
      ui.setInfo(
        "플레이 가이드",
        `${this.currentPlayer.icon} ${this.currentPlayer.name}의 손패와 테이블을 바로 확인하고 플레이하세요.`
      );
    }
    ui.toast(`${this.currentPlayer.icon} ${this.currentPlayer.name} 차례입니다.`);
  }
  addLog(player, message) {
    player.logs.unshift(message);
    if (player.logs.length > 3) player.logs.pop();
  }

  canHumanAct(action = "general") {
    if (this.gameOver) return false;
    if (!this.currentPlayer) return false;
    if (this.currentPlayer.type !== "HUMAN") return false;
    if (this.drewTileThisTurn && action !== "endTurn") {
      ui.toast("방금 뽑은 타일을 확인한 뒤 턴 종료를 눌러주세요.");
      return false;
    }
    return true;
  }

  snapshotAction() {
    return {
      rack: deepCopy(this.currentPlayer.rack),
      workingTable: deepCopy(this.workingTable),
      selectedRackIds: [...this.selectedRackIds],
      selectedTableIds: [...this.selectedTableIds],
      selectedGroupIndex: this.selectedGroupIndex
    };
  }

  restoreAction(snapshot) {
    this.currentPlayer.rack = snapshot.rack;
    this.workingTable = snapshot.workingTable;
    this.selectedRackIds = new Set(snapshot.selectedRackIds);
    this.selectedTableIds = new Set(snapshot.selectedTableIds);
    this.selectedGroupIndex = snapshot.selectedGroupIndex;
  }

  getTurnStartRackSize() {
    return this.actionHistory.length > 0
      ? this.actionHistory[0].rack.length
      : this.currentPlayer.rack.length;
  }

  hasReducedRackThisTurn() {
    return this.currentPlayer.rack.length < this.getTurnStartRackSize();
  }

  getSelectedRackTilesInOrder() {
    return this.currentPlayer.rack.filter(tile => this.selectedRackIds.has(tile.id));
  }

  removeSelectedRackTiles() {
    const ids = new Set(this.selectedRackIds);
    const taken = [];
    const remain = [];
    this.currentPlayer.rack.forEach(tile => {
      if (ids.has(tile.id)) taken.push(tile);
      else remain.push(tile);
    });
    this.currentPlayer.rack = remain;
    return taken;
  }

  removeSelectedTableTiles() {
    const ids = new Set(this.selectedTableIds);
    const taken = [];
    this.workingTable.forEach(group => {
      const remain = [];
      group.forEach(tile => {
        if (ids.has(tile.id)) taken.push(tile);
        else remain.push(tile);
      });
      group.splice(0, group.length, ...remain);
    });
    return taken;
  }

  normalizeGroup(group) {
    return normalizeGroupTiles(group);
  }

  normalizeWorkingTable() {
    this.workingTable = normalizeTableGroups(this.workingTable);
  }

  sortRack(type) {
    if (!this.canHumanAct("sort")) return;
    const colorOrder = { red: 0, blue: 1, yellow: 2, black: 3, joker: 4 };
    this.currentPlayer.rack.sort((a, b) => {
      if (a.joker && b.joker) return a.id - b.id;
      if (a.joker) return 1;
      if (b.joker) return -1;
      if (type === "color") {
        return colorOrder[a.color] - colorOrder[b.color] || a.number - b.number || a.id - b.id;
      }
      return a.number - b.number || colorOrder[a.color] - colorOrder[b.color] || a.id - b.id;
    });
    ui.updateAll();
  }

  toggleRackTile(tileId) {
    if (!this.canHumanAct("select")) return;
    if (this.selectedRackIds.has(tileId)) this.selectedRackIds.delete(tileId);
    else this.selectedRackIds.add(tileId);
    ui.updateAll();
  }

  toggleTableTile(tileId, groupIndex) {
    if (!this.canHumanAct("selectTable")) return;
    if (this.ruleOptions.initial30 && !this.currentPlayer.opened) {
      ui.toast("30점 등록 전에는 기존 테이블 타일을 움직일 수 없어요.");
      return;
    }
    if (this.selectedTableIds.has(tileId)) this.selectedTableIds.delete(tileId);
    else this.selectedTableIds.add(tileId);
    ui.updateAll();
  }

  selectGroup(index) {
    if (!this.canHumanAct("groupTarget")) return;
    if (this.ruleOptions.initial30 && !this.currentPlayer.opened && index < this.baseTableCount) {
      ui.toast("30점 등록 전에는 기존 테이블 줄에 붙일 수 없어요.");
      return;
    }
    this.selectedGroupIndex = this.selectedGroupIndex === index ? null : index;
    ui.updateAll();
  }

  clearSelections() {
    if (!this.canHumanAct("clear")) return;
    this.selectedRackIds.clear();
    this.selectedTableIds.clear();
    this.selectedGroupIndex = null;
    ui.updateAll();
  }

  createGroupFromSelection() {
    if (!this.canHumanAct("build")) return;
    if (this.getTotalSelectedCount() === 0) {
      ui.toast("손패나 테이블에서 타일을 먼저 선택하세요.");
      return;
    }
    if (this.ruleOptions.initial30 && !this.currentPlayer.opened && this.selectedTableIds.size > 0) {
      ui.toast("30점 등록 전에는 기존 테이블 타일을 사용할 수 없어요.");
      return;
    }

    this.actionHistory.push(this.snapshotAction());
    this.clearHint();
    const movedTable = this.removeSelectedTableTiles();
    const movedRack = this.removeSelectedRackTiles();
    this.normalizeWorkingTable();
    this.workingTable.push(this.normalizeGroup([...movedTable, ...movedRack]));
    this.selectedRackIds.clear();
    this.selectedTableIds.clear();
    this.selectedGroupIndex = this.workingTable.length - 1;
    ui.setInfo("새 줄 생성", "선택한 타일로 새 줄을 만들었습니다. 턴 종료 전 모든 줄이 유효한지 확인하세요.");
    ui.updateAll();
  }

  appendSelectionToSelectedGroup() {
    if (!this.canHumanAct("build")) return;
    if (this.selectedGroupIndex === null || !this.workingTable[this.selectedGroupIndex]) {
      ui.toast("먼저 추가할 줄을 선택하세요.");
      return;
    }
    if (this.getTotalSelectedCount() === 0) {
      ui.toast("손패나 테이블에서 타일을 선택하세요.");
      return;
    }
    if (this.ruleOptions.initial30 && !this.currentPlayer.opened && this.selectedGroupIndex < this.baseTableCount) {
      ui.toast("30점 등록 전에는 기존 테이블 줄에 추가할 수 없어요.");
      return;
    }
    if (this.ruleOptions.initial30 && !this.currentPlayer.opened && this.selectedTableIds.size > 0) {
      ui.toast("30점 등록 전에는 기존 테이블 타일을 사용할 수 없어요.");
      return;
    }

    this.actionHistory.push(this.snapshotAction());
    this.clearHint();
    const targetGroup = this.workingTable[this.selectedGroupIndex];
    const movedTable = this.removeSelectedTableTiles();
    const movedRack = this.removeSelectedRackTiles();
    targetGroup.push(...movedTable, ...movedRack);
    this.normalizeWorkingTable();
    this.selectedGroupIndex = this.workingTable.indexOf(targetGroup);
    this.selectedRackIds.clear();
    this.selectedTableIds.clear();
    ui.setInfo("줄에 추가", "선택한 타일을 해당 줄로 이동했습니다. 필요하면 다른 줄도 계속 정리하세요.");
    ui.updateAll();
  }

  undoTurnAction() {
    if (!this.canHumanAct("undo")) return;
    const snapshot = this.actionHistory.pop();
    if (!snapshot) {
      ui.toast("되돌릴 이번 턴 동작이 없어요.");
      return;
    }
    this.clearHint();
    this.restoreAction(snapshot);
    ui.setInfo("무르기", "이번 턴 직전 상태로 되돌렸습니다.");
    ui.updateAll();
  }

  drawTile() {
    if (!this.canHumanAct("draw")) return;
    if (this.actionHistory.length > 0) {
      if (!this.hasReducedRackThisTurn()) {
        while (this.actionHistory.length > 0) {
          this.restoreAction(this.actionHistory.pop());
        }
      } else {
        ui.toast("이미 타일을 냈다면 이번 턴에는 뽑을 수 없어요.");
        return;
      }
    }
    if (this.bag.length === 0) {
      ui.toast("가방이 비어 있어요.");
      return;
    }

    this.clearHint();
    const drawn = this.bag.pop();
    this.currentPlayer.rack.push(drawn);
    this.drewTileThisTurn = true;
    this.drawnTileId = drawn.id;
    this.selectedRackIds = new Set([drawn.id]);
    this.selectedTableIds.clear();
    this.selectedGroupIndex = null;

    ui.setInfo("1장 뽑기", "방금 뽑은 타일을 확인한 뒤 턴 종료만 눌러주세요. 다른 버튼은 잠시 비활성화됩니다.");
    ui.updateAll();
    ui.toast(`${this.currentPlayer.icon} ${this.currentPlayer.name}가 1장을 뽑았어요.`);

    const rackScroller = document.querySelector(".rack-scroller");
    if (rackScroller) {
      requestAnimationFrame(() => {
        rackScroller.scrollTop = rackScroller.scrollHeight;
      });
    }
  }
  getOpeningScore() {
    return calculateInitialOpenScore(this.workingTable.slice(this.baseTableCount));
  }

  endTurn() {
    if (!this.canHumanAct("endTurn")) return;

    if (this.drewTileThisTurn) {
      this.addLog(this.currentPlayer, "1장 뽑고 종료");
      this.passTurn();
      return;
    }

    if (this.actionHistory.length === 0) {
      ui.toast("타일을 내지 않았다면 1장 뽑기를 사용하세요.");
      return;
    }

    if (!this.hasReducedRackThisTurn()) {
      ui.toast("자기 손패를 최소 1장은 내려놓아야 턴을 종료할 수 있어요. 무르기로 정리하거나 1장 뽑기를 사용하세요.");
      return;
    }

    const groups = this.workingTable.filter(group => group.length > 0);
    for (const group of groups) {
      const result = RummyRules.analyzeGroup(group);
      if (!result.valid) {
        ui.toast(`유효하지 않은 줄이 있습니다: ${result.label}`);
        return;
      }
    }

    if (this.ruleOptions.initial30 && !this.currentPlayer.opened) {
      const openingGroups = groups.slice(this.baseTableCount);
      if (openingGroups.length === 0) {
        ui.toast("30점 등록 전에는 자기 손패로만 새 줄을 만들어야 해요.");
        return;
      }
      const openingScore = calculateInitialOpenScore(openingGroups);
      if (!isInitialOpenSatisfied(openingGroups)) {
        ui.toast(`초기 등록은 30점 이상이어야 합니다. 현재 ${openingScore}점`);
        return;
      }
      this.currentPlayer.opened = true;
      this.addLog(this.currentPlayer, `30 등록 완료 (${openingScore}점)`);
    } else {
      this.addLog(this.currentPlayer, `줄 배치 완료 · 손패 ${this.currentPlayer.rack.length}장`);
    }

    this.table = deepCopy(groups);

    if (this.currentPlayer.rack.length === 0) {
      this.win(this.currentPlayer);
      return;
    }

    this.passTurn();
  }
  passTurn() {
    if (this.gameOver) return;
    this.clearScheduledTurnTimers();
    this.turn = (this.turn + 1) % this.players.length;
    this.beginTurn();
    ui.updateAll();
    this.openTurn();
  }

  win(player) {
    this.gameOver = true;
    this.clearScheduledTurnTimers();
    document.getElementById("win-emoji").innerText = player.icon;
    document.getElementById("win-title").innerText = `${player.name} 승리!`;
    document.getElementById("win-text").innerText = `${player.icon} ${player.name}가 손패를 모두 비웠습니다.`;
    document.getElementById("modal").classList.add("show");
    ui.updateAll();
  }
  restart() {
    document.getElementById("modal").classList.remove("show");
    this.startFromSetup();
  }

  toMenu() {
    this.clearScheduledTurnTimers();
    document.getElementById("modal").classList.remove("show");
    document.body.classList.remove("night-mode");
    ui.showScreen("start-screen");
    ui.hideSetup();
    ui.renderSetup();
    ui.renderRuleOptions();
    ui.renderQuickStartMixedLevel();
  }
}

Game.prototype.bumpStateVersion = function() {
  this.stateVersion = (this.stateVersion || 0) + 1;
};

Game.prototype.computeStateMutationFingerprint = function() {
  const tableSignature = typeof serializeTableState === "function"
    ? serializeTableState(this.workingTable || [])
    : JSON.stringify(this.workingTable || []);
  const currentRackIds = (this.currentPlayer?.rack || [])
    .map(tile => tile.id)
    .sort((a, b) => a - b)
    .join(",");
  return [
    tableSignature,
    currentRackIds,
    this.turn ?? 0,
    this.currentPlayer?.opened ? 1 : 0,
    this.actionHistory?.length || 0,
    this.bag?.length || 0,
    this.drewTileThisTurn ? 1 : 0
  ].join("|");
};

Game.prototype.setInputLock = function(locked, token = null) {
  if (locked) {
    if (token !== null) this.inputLockToken = token;
    this.inputLocked = true;
  } else {
    if (token !== null && token !== this.inputLockToken) return false;
    this.inputLocked = false;
  }

  if (typeof ui !== "undefined" && typeof window !== "undefined" && window.game) {
    ui.updateButtons();
  }

  return true;
};

Game.prototype.invalidateAsyncState = function() {
  this.clearScheduledTurnTimers();
  this.asyncEpoch = (this.asyncEpoch || 0) + 1;
  this.inputLockToken = (this.inputLockToken || 0) + 1;
  this.setInputLock(false);
};

Game.prototype.clearScheduledTurnTimers = function() {
  clearTimeout(this.aiTimer);
  clearTimeout(this.turnAdvanceTimer);
  this.aiTimer = null;
  this.turnAdvanceTimer = null;
};

Game.prototype.startInputLockSession = function() {
  const session = {
    epoch: this.asyncEpoch || 0,
    lockToken: (this.inputLockToken || 0) + 1
  };
  this.setInputLock(true, session.lockToken);
  return session;
};

Game.prototype.finishInputLockSession = function(session) {
  if (!session) return false;
  if ((this.asyncEpoch || 0) !== session.epoch) return false;
  return this.setInputLock(false, session.lockToken);
};

Game.prototype.scheduleTurnAdvance = function(delayMs) {
  clearTimeout(this.turnAdvanceTimer);

  const scheduledEpoch = this.asyncEpoch || 0;
  const scheduledVersion = this.stateVersion;

  this.turnAdvanceTimer = setTimeout(() => {
    this.turnAdvanceTimer = null;

    if (this.gameOver) return;
    if ((this.asyncEpoch || 0) !== scheduledEpoch) return;
    if (this.stateVersion !== scheduledVersion) return;

    this.passTurn();
  }, delayMs);
};

Game.prototype.fallbackAiDraw = function(playerIndex) {
  this.consecutiveStrategicDrawsByPlayer[playerIndex] = 0;
  if (this.bag.length > 0) {
    this.currentPlayer.rack.push(this.bag.pop());
    this.addLog(this.currentPlayer, `AI-${this.currentPlayer.aiLevel} · 1장 드로우`);
    ui.toast(`${this.currentPlayer.icon} ${this.currentPlayer.name}님이 1장을 뽑았습니다.`);
  } else {
    this.addLog(this.currentPlayer, `AI-${this.currentPlayer.aiLevel} · 패스`);
    ui.toast(`${this.currentPlayer.icon} ${this.currentPlayer.name}님이 둘 수를 찾지 못했습니다.`);
  }
  ui.updateAll();
  this.scheduleTurnAdvance(650);
};

Game.prototype.applyAiMove = function(move, playerIndex) {
  if (!move) {
    this.fallbackAiDraw(playerIndex);
    return;
  }

  if (move.type === "draw") {
    const drawLabel = move.drawReasonCode === "hold-opening"
      ? "전략 드로우(등록 보류)"
      : move.drawReasonCode === "preserve-shape"
        ? "전략 드로우(구조 보존)"
        : (move.summary || "전략 드로우");

    if (this.bag.length > 0) {
      this.currentPlayer.rack.push(this.bag.pop());
      this.consecutiveStrategicDrawsByPlayer[playerIndex] =
        (this.consecutiveStrategicDrawsByPlayer[playerIndex] || 0) + 1;
      if (!this.currentPlayer.opened && move.drawReasonCode === "hold-opening") {
        this.openingHoldDrawUsed[playerIndex] = (this.openingHoldDrawUsed[playerIndex] || 0) + 1;
      }
      this.addLog(this.currentPlayer, `AI-${this.currentPlayer.aiLevel} · ${drawLabel}`);
      ui.toast(`${this.currentPlayer.icon} ${this.currentPlayer.name}님이 ${drawLabel}를 선택했습니다.`);
    } else {
      this.consecutiveStrategicDrawsByPlayer[playerIndex] = 0;
      this.addLog(this.currentPlayer, `AI-${this.currentPlayer.aiLevel} · 패스`);
      ui.toast(`${this.currentPlayer.icon} ${this.currentPlayer.name}님이 더 이상 뽑을 수 없습니다.`);
    }
    ui.updateAll();
    this.scheduleTurnAdvance(650);
    return;
  }

  this.consecutiveStrategicDrawsByPlayer[playerIndex] = 0;
  const wasOpened = this.currentPlayer.opened;
  this.currentPlayer.rack = deepCopy(move.rack);
  this.workingTable = normalizeTableGroups(deepCopy(move.table));
  this.table = deepCopy(this.workingTable);
  this.currentPlayer.opened = move.opened;

  if (!wasOpened && move.opened) {
    const openingScore = calculateInitialOpenScore(this.workingTable.slice(this.baseTableCount));
    this.addLog(this.currentPlayer, `AI-${this.currentPlayer.aiLevel} · 30 등록 완료 (${openingScore}점)`);
  } else {
    this.addLog(this.currentPlayer, `AI-${this.currentPlayer.aiLevel} · ${move.summary}`);
  }
  ui.toast(`${this.currentPlayer.icon} ${this.currentPlayer.name}님이 ${move.summary} 플레이를 했습니다.`);

  ui.updateAll();

  if (this.currentPlayer.rack.length === 0) {
    this.win(this.currentPlayer);
    return;
  }

  this.scheduleTurnAdvance(700);
};

Game.prototype.presentHint = function(hint, toastMessage, consumeHint = true) {
  if (consumeHint && this.currentPlayer.hintsRemaining !== null) {
    this.currentPlayer.hintsRemaining = Math.max(0, this.currentPlayer.hintsRemaining - 1);
  }

  this.lastHint = hint;
  ui.showHint(hint);
  ui.updateAll();

  if (toastMessage) {
    ui.toast(toastMessage);
  }
};

Game.prototype.getHintToastMessage = function(hint) {
  if (hint.systemUnavailable) {
    return hint.toastMessage || "AI 워커 연결이 없어 힌트를 만들 수 없습니다.";
  }

  if (hint.hintSource === "no-move") {
    if (hint.moveType === "draw") return "둘 수 있는 유효한 수가 없어 1장 드로우를 권장합니다.";
    if (hint.moveType === "end-turn") return "추가 유효 수가 없어 현재 배치 확정을 권장합니다.";
    if (hint.moveType === "undo") return "추가 유효 수가 없어 되돌린 뒤 다시 정리가 필요합니다.";
  }

  if (hint.hintSource === "strategic-draw") {
    if (hint.moveType === "draw") return `${hint.shortText || hint.summary || "전략 드로우"}를 권장합니다.`;
    if (hint.moveType === "undo-draw") return "전략 드로우를 위해 되돌린 뒤 드로우를 권장합니다.";
    if (hint.moveType === "end-turn") return "전략 드로우 차선으로 현재 배치 확정을 권장합니다.";
    if (hint.moveType === "undo") return "전략 드로우를 위해 되돌린 뒤 다시 판단하세요.";
  }

  if (hint.engineMissFallback) return "현재 탐색 범위에서는 추가 수를 찾지 못했습니다.";
  if (hint.moveType === "draw") return "이번 턴 추천은 드로우입니다.";
  if (hint.moveType === "undo-draw") return "되돌린 뒤 드로우를 권장합니다.";
  if (hint.moveType === "end-turn") return "턴 종료를 권장합니다.";
  if (hint.moveType === "undo") return "무르기나 추가 배치가 필요합니다.";
  return "추천 대상과 줄을 강조했습니다.";
};

Game.prototype.buildHintUnavailableHint = function(error) {
  const code = error?.code || "worker-unavailable";
  const reason = code === "hint-timeout"
    ? "힌트 계산이 시간 초과되어 AI 워커를 다시 시작했습니다."
    : code === "worker-crashed"
      ? "AI 워커가 중단되어 이번 힌트를 계산할 수 없습니다."
      : code === "worker-init-failed"
        ? "AI 워커를 시작하지 못해 힌트 엔진을 사용할 수 없습니다."
        : "AI 워커와 연결되지 않아 이번 힌트를 계산할 수 없습니다.";

  return {
    title: "힌트 생성 실패",
    summary: "워커 연결 실패",
    shortText: "힌트 엔진 오프라인",
    leadText: "AI 워커 연결 문제로 힌트를 생성할 수 없습니다.",
    reason,
    moveType: "unavailable",
    score: 0,
    rackTileIds: [],
    tableTileIds: [],
    targetGroupIndices: [],
    steps: [
      "잠시 뒤 힌트 버튼을 다시 눌러보세요.",
      "문제가 반복되면 메뉴로 나갔다가 다시 시작하세요."
    ],
    openingScore: 0,
    hintSource: "worker-unavailable",
    engineMissFallback: false,
    systemUnavailable: true,
    toastMessage: code === "hint-timeout"
      ? "힌트 요청이 오래 걸려 AI 워커를 다시 시작했습니다."
      : "AI 워커 연결이 없어 힌트를 만들 수 없습니다."
  };
};

const wrapStateMutation = (methodName, options = {}) => {
  const original = Game.prototype[methodName];
  if (typeof original !== "function") return;

  Game.prototype[methodName] = function(...args) {
    const beforeFingerprint = this.computeStateMutationFingerprint();

    if (options.cancelPending && typeof window !== "undefined" && window.aiBridge) {
      window.aiBridge.cancelPending();
    }

    if (options.invalidateAsyncState) {
      this.invalidateAsyncState();
    }

    const result = original.apply(this, args);
    const afterFingerprint = this.computeStateMutationFingerprint();
    if (beforeFingerprint !== afterFingerprint) {
      this.bumpStateVersion();
    }
    return result;
  };
};

[
  "createGroupFromSelection",
  "appendSelectionToSelectedGroup",
  "undoTurnAction",
  "drawTile",
  "endTurn"
].forEach(methodName => wrapStateMutation(methodName));

wrapStateMutation("startFromSetup", { cancelPending: true, invalidateAsyncState: true });
wrapStateMutation("toMenu", { cancelPending: true, invalidateAsyncState: true });

const originalCanHumanAct = Game.prototype.canHumanAct;
Game.prototype.canHumanAct = function(action = "general") {
  if (this.inputLocked) return false;
  return originalCanHumanAct.call(this, action);
};

Game.prototype.performAiTurn = async function() {
  if (this.gameOver || !this.currentPlayer || this.currentPlayer.type !== "AI") return;

  const playerIndex = this.turn;
  const currentVersion = this.stateVersion;
  const gameState = this.buildGameStateForAI();
  const aiLevel = this.currentPlayer.aiLevel;
  const bridge = typeof window !== "undefined" ? window.aiBridge : null;
  const session = this.startInputLockSession();

  if (!bridge) {
    this.finishInputLockSession(session);
    this.fallbackAiDraw(playerIndex);
    return;
  }

  ui.setInfo("AI 턴", `${this.currentPlayer.icon} ${this.currentPlayer.name} 생각 중...`);

  try {
    const result = await bridge.chooseMove(gameState, aiLevel, currentVersion);

    if (session.epoch !== this.asyncEpoch) return;
    if (result.stateVersion !== this.stateVersion) return;
    if (this.turn !== playerIndex || this.gameOver) return;
    if (result.move) {
      this.applyAiMove(result.move, playerIndex);
      return;
    }
    this.fallbackAiDraw(playerIndex);
  } catch (error) {
    if (error.message === "Cancelled") return;
    console.error("AI worker error:", error);
    if (session.epoch === this.asyncEpoch && this.turn === playerIndex && !this.gameOver) {
      if (error.partialMove) {
        this.applyAiMove(error.partialMove, playerIndex);
      } else {
        this.fallbackAiDraw(playerIndex);
      }
    }
  } finally {
    this.finishInputLockSession(session);
  }
};

Game.prototype.applyHint = function(hint) {
  if (hint.searchTruncated && !hint.truncationNote) {
    hint.truncationNote = "현재 탐색 범위 기준 최선안입니다.";
  }
  const hasAction = this.actionHistory.length > 0;

  if (hasAction && hint.moveType === "draw" && hint.hintSource === "strategic-draw" && !this.hasReducedRackThisTurn()) {
    hint.title = hint.title || "AI-6 힌트";
    hint.rackTileIds = [];
    hint.tableTileIds = [];
    hint.targetGroupIndices = [];
    hint.summary = "되돌린 뒤 1장 뽑기";
    hint.shortText = "되돌린 뒤 드로우";
    hint.leadText = "추천: 지금 배치를 유지하기보다 되돌린 뒤 1장을 뽑는 편이 낫습니다.";
    hint.reason = `${hint.reason || "현재 배치보다 드로우 선택이 더 낫습니다."} 이번 배치를 되돌린 뒤 1장을 뽑으세요.`;
    hint.steps = [
      "무르기 버튼으로 현재 배치를 되돌리세요.",
      "1장 뽑기 버튼을 눌러 턴을 진행하세요."
    ];
    hint.moveType = "undo-draw";
  } else if (hasAction && hint.moveType === "draw" && hint.hintSource === "strategic-draw") {
    const allValid = this.workingTable.every(group =>
      group.length === 0 || RummyRules.analyzeGroup(group).valid
    );
    hint.title = hint.title || "AI-6 힌트";
    hint.rackTileIds = [];
    hint.tableTileIds = [];
    hint.targetGroupIndices = [];
    if (allValid) {
      hint.summary = "현재 배치 확정";
      hint.shortText = "전략 드로우 차선";
      hint.leadText = "추천: 원래는 드로우 판단이 더 좋았지만, 지금은 현재 배치를 확정하는 편이 낫습니다.";
      hint.reason = "이번 턴 초반에는 드로우가 더 좋았지만 이미 손패를 줄여 드로우로 되돌리기 어렵습니다. 현재 배치를 확정하세요.";
      hint.steps = ["턴 종료 버튼을 눌러 현재 배치를 확정하세요."];
      hint.moveType = "end-turn";
    } else {
      hint.summary = "되돌리기";
      hint.shortText = "전략 드로우 재선택";
      hint.leadText = "추천: 현재 배치가 유효하지 않습니다. 되돌린 뒤 다시 판단하세요.";
      hint.reason = "이 상황은 전략 드로우가 더 나았지만 현재 배치가 유효하지 않아 그대로 끝낼 수 없습니다. 되돌린 뒤 다시 선택하세요.";
      hint.steps = [
        "무르기 버튼으로 현재 배치를 되돌리세요.",
        "다시 손을 보고 턴을 정리하세요."
      ];
      hint.moveType = "undo";
    }
  } else if (hasAction && hint.moveType === "draw" && hint.hintSource === "no-move") {
    const allValid = this.workingTable.every(group =>
      group.length === 0 || RummyRules.analyzeGroup(group).valid
    );
    hint.title = hint.title || "AI-6 힌트";
    hint.rackTileIds = [];
    hint.tableTileIds = [];
    hint.targetGroupIndices = [];
    hint.engineMissFallback = true;
    if (allValid) {
      hint.summary = "유효 수 없음";
      hint.shortText = "유효 수 없음 · 현재 배치 확정";
      hint.leadText = "현재 배치는 유효합니다. 추가로 둘 수 있는 유효한 수를 찾지 못했습니다.";
      hint.reason = "현재 탐색 범위에서는 추가 유효 수를 찾지 못해 현재 배치 확정을 권장합니다.";
      hint.steps = ["턴 종료 버튼을 눌러 현재 배치를 확정하세요."];
      hint.moveType = "end-turn";
    } else {
      hint.summary = "유효 수 없음";
      hint.shortText = "유효 수 없음 · 되돌리기";
      hint.leadText = "추가로 둘 수 있는 유효한 수를 찾지 못했고, 현재 배치에는 유효하지 않은 줄이 남아 있습니다.";
      hint.reason = "현재 탐색 범위에서는 추가 유효 수를 찾지 못했습니다. 지금 배치를 그대로 둘 수 없으니 되돌린 뒤 다시 정리하세요.";
      hint.steps = [
        "무르기 버튼으로 현재 배치를 되돌리세요.",
        "직접 추가 수를 배치해 모든 줄을 유효하게 만드세요."
      ];
      hint.moveType = "undo";
    }
  } else if (!hasAction && hint.moveType === "draw" && hint.hintSource === "no-move") {
    hint.title = hint.title || "AI-6 힌트";
    hint.summary = "유효 수 없음";
    hint.shortText = "유효 수 없음 · 1장 드로우";
    hint.leadText = "추천: 지금은 둘 수 있는 유효한 수가 없어 1장을 뽑는 편이 낫습니다.";
    hint.engineMissFallback = true;
  }

  if (hint.searchTruncated && !hint.truncationNote) {
    hint.truncationNote = "현재 탐색 범위 기준 최선안입니다.";
  }
  if (!Array.isArray(hint.steps)) {
    hint.steps = [];
  }

  this.presentHint(hint, this.getHintToastMessage(hint), true);
};

Game.prototype.requestHint = async function() {
  if (this.gameOver || !this.currentPlayer || this.currentPlayer.type !== "HUMAN") return;
  if (this.drewTileThisTurn) {
    ui.toast("1장을 뽑은 뒤에는 힌트 대신 턴 종료만 할 수 있습니다.");
    return;
  }
  if (!this.canUseHint()) {
    ui.toast("사용 가능한 힌트가 없습니다.");
    return;
  }

  const currentVersion = this.stateVersion;
  const gameState = this.buildGameStateForAI({ hintMode: true });
  const bridge = typeof window !== "undefined" ? window.aiBridge : null;
  const session = this.startInputLockSession();

  if (!gameState.tileTracker) {
    gameState.tileTracker = this.buildTileTracker(this.turn);
  }

  if (!bridge) {
    this.finishInputLockSession(session);
    const unavailableHint = this.buildHintUnavailableHint(null);
    this.presentHint(unavailableHint, this.getHintToastMessage(unavailableHint), false);
    return;
  }

  ui.setInfo("힌트 분석 중", "AI가 현재 상황을 분석하고 있습니다...");

  try {
    const result = await bridge.getHint(gameState, currentVersion);

    if (session.epoch !== this.asyncEpoch) return;
    if (result.stateVersion !== this.stateVersion) return;

    if (result.hint) {
      this.applyHint(result.hint);
      return;
    }
    const unavailableHint = this.buildHintUnavailableHint(null);
    this.presentHint(unavailableHint, this.getHintToastMessage(unavailableHint), false);
  } catch (error) {
    if (error.message === "Cancelled") return;
    console.error("Hint worker error:", error);
    if (error.partialHint) {
      this.applyHint(error.partialHint);
      return;
    }
    const unavailableHint = this.buildHintUnavailableHint(error);
    this.presentHint(unavailableHint, this.getHintToastMessage(unavailableHint), false);
  } finally {
    this.finishInputLockSession(session);
  }
};
