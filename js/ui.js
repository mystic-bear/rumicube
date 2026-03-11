const ui = {
  showScreen(id) {
    document.querySelectorAll(".screen").forEach(screen => screen.classList.add("hidden"));
    document.getElementById(id).classList.remove("hidden");
  },

  showSetup() {
    document.getElementById("menu-main").style.display = "none";
    document.getElementById("menu-setup").style.display = "flex";
    this.renderSetup();
    this.renderRuleOptions();
    this.renderQuickStartMixedLevel();
  },

  hideSetup() {
    document.getElementById("menu-setup").style.display = "none";
    document.getElementById("menu-main").style.display = "flex";
    this.renderQuickStartMixedLevel();
  },

  renderQuickStartMixedLevel() {
    const chip = document.getElementById("quick-mixed-level");
    if (!chip) return;
    const info = AI_LEVEL_INFO[game.quickStartMixedLevel];
    chip.innerText = info ? info.label : `AI-${game.quickStartMixedLevel}`;
  },

  renderSetup() {
    const container = document.getElementById("setup-container");
    container.innerHTML = "";
    const compactLabel = window.innerWidth < 620;
    PLAYER_PRESETS.forEach((preset, idx) => {
      const row = document.createElement("div");
      row.className = "setup-row";
      const state = game.setupState[idx];
      const animal = ANIMAL_OPTIONS[game.playerAnimalIndices[idx]] || ANIMAL_OPTIONS[0];
      const btnClass = state === "HUMAN"
        ? "state-human"
        : state === "OFF"
          ? "state-off"
          : state === "AI-6"
            ? "state-ai-6"
            : "state-ai";
      row.innerHTML = `
        <div class="setup-player">
          <div class="setup-icon">${animal.icon}</div>
          <div>
            <div style="font-size:1rem;">${animal.name}</div>
            <div style="font-size:0.82rem; color:#7a6e63;">P${idx + 1}</div>
          </div>
        </div>
        <div class="setup-actions">
          <button class="state-btn animal-btn">${animal.icon} 동물 변경</button>
          <button class="state-btn ${btnClass}">${getSetupStateLabel(state, compactLabel)}</button>
        </div>
      `;
      const buttons = row.querySelectorAll("button");
      buttons[0].onclick = () => game.cyclePlayerAnimal(idx);
      buttons[1].onclick = () => game.cycleSetupState(idx);
      container.appendChild(row);
    });
  },

  renderRuleOptions() {
    const renderTo = (containerId) => {
      const container = document.getElementById(containerId);
      if (!container) return;
      container.innerHTML = "";

      const options = [
        {
          key: "jokers",
          icon: "🃏",
          name: "조커 2장 사용",
          desc: "가방에 조커 2장을 추가합니다.",
          value: game.ruleOptions.jokers
        },
        {
          key: "initial30",
          icon: "30",
          name: "초기 30점 등록",
          desc: "첫 성공 턴에는 자기 손패만으로 30점 이상을 내려야 합니다.",
          value: game.ruleOptions.initial30
        },
        {
          key: "hintLimit",
          icon: "💡",
          name: "힌트 횟수 제한",
          desc: "0개, 3개, 5개, 무제한 중에서 선택합니다.",
          valueLabel: getHintLimitLabel(game.ruleOptions.hintLimit),
          cycle: true
        }
      ];

      options.forEach(option => {
        const row = document.createElement("div");
        row.className = "setup-row";
        row.innerHTML = `
          <div class="setup-player">
            <div class="setup-icon">${option.icon}</div>
            <div>
              <div style="font-size:1rem;">${option.name}</div>
              <div style="font-size:0.82rem; color:#7a6e63;">${option.desc}</div>
            </div>
          </div>
          <button class="state-btn ${option.cycle ? "state-ai" : (option.value ? "state-on" : "state-off-option")}">${option.cycle ? option.valueLabel : (option.value ? "ON" : "OFF")}</button>
        `;
        row.querySelector("button").onclick = () => option.cycle
          ? game.cycleHintLimit()
          : game.toggleRuleOption(option.key);
        container.appendChild(row);
      });
    };

    renderTo("rule-options-main");
    renderTo("rule-options-setup");
  },

  tileHtml(tile, small = false, selected = false, drawn = false, extraClasses = "") {
    const isJoker = !!tile.joker;
    const colorClass = isJoker ? "joker" : tile.color;
    const numText = isJoker ? "J" : tile.number;
    const icon = isJoker ? "🃏" : (COLORS.find(color => color.key === tile.color)?.icon || "");
    return `
      <div class="tile ${colorClass} ${small ? "small" : ""} ${selected ? "selected" : ""} ${drawn ? "drawn" : ""} ${extraClasses}">
        <div class="tile-num">${numText}</div>
        <div class="tile-icon">${icon}</div>
      </div>
    `;
  },

  renderPlayers() {
    const list = document.getElementById("player-list");
    list.innerHTML = "";
    game.players.forEach((player, idx) => {
      const card = document.createElement("div");
      card.className = `player-card ${idx === game.turn ? "active" : ""}`;
      const badgeText = player.type === "HUMAN" ? "HUMAN" : getSetupStateLabel(`AI-${player.aiLevel}`, window.innerWidth < 620);
      const lastLog = player.logs[0] || "아직 행동 기록 없음";
      const openText = game.ruleOptions.initial30
        ? (player.opened ? "30 등록 완료" : "30 등록 전")
        : "기본 룰";

      card.innerHTML = `
        <div class="p-top">
          <div class="p-left">
            <div class="p-icon">${player.icon}</div>
            <div>
              <div class="p-name">${player.name}</div>
              <div class="p-sub">P${player.slot + 1}</div>
            </div>
          </div>
          <div class="p-badge">${badgeText}</div>
        </div>
        <div class="p-stats">
          <div class="mini-chip">손패 ${player.rack.length}장</div>
          <div class="mini-chip">${idx === game.turn ? "현재 턴" : "대기 중"}</div>
          <div class="mini-chip">${openText}</div>
        </div>
        <div class="mini-log">${lastLog}</div>
      `;
      card.style.borderLeftColor = idx === game.turn ? "var(--accent)" : player.accent;
      list.appendChild(card);
    });
  },

  renderTable() {
    const tableArea = document.getElementById("table-area");
    tableArea.innerHTML = "";

    if (game.workingTable.length === 0) {
      const empty = document.createElement("div");
      empty.className = "empty-table";
      empty.innerHTML = "중앙 테이블이 비어 있어요.<br />손패나 테이블 타일을 선택한 뒤 <strong>새 줄</strong> / <strong>줄에 추가</strong>로 조합을 만들어 보세요.";
      tableArea.appendChild(empty);
      return;
    }

    game.workingTable.forEach((group, index) => {
      const result = RummyRules.analyzeGroup(group);
      const badgeClass = result.valid ? "badge-ok" : result.ready ? "badge-bad" : "badge-warn";
      const stateClass = result.valid ? "valid" : result.ready ? "invalid" : "";
      const hintTarget = game.lastHint?.targetGroupIndices?.includes(index) ? "hint-target" : "";
      const card = document.createElement("div");
      card.className = `group-card ${stateClass} ${game.selectedGroupIndex === index ? "selected" : ""} ${hintTarget}`;
      card.onclick = () => game.selectGroup(index);

      const meta = document.createElement("div");
      meta.className = "group-meta";
      meta.innerHTML = `<strong>줄 ${index + 1}</strong><span class="group-badge ${badgeClass}">${result.label}</span>`;

      const row = document.createElement("div");
      row.className = "tile-row";
      group.forEach(tile => {
        const wrapper = document.createElement("div");
        const hintClass = game.lastHint?.tableTileIds?.includes(tile.id) ? "hint-source" : "";
        wrapper.innerHTML = this.tileHtml(tile, true, game.selectedTableIds.has(tile.id), false, hintClass);
        const tileEl = wrapper.firstElementChild;
        tileEl.onclick = (event) => {
          event.stopPropagation();
          game.toggleTableTile(tile.id, index);
        };
        row.appendChild(tileEl);
      });

      card.appendChild(meta);
      card.appendChild(row);
      tableArea.appendChild(card);
    });
  },

  renderRack() {
    const rackRow = document.getElementById("rack-row");
    rackRow.innerHTML = "";
    if (!game.currentPlayer) return;

    const isAI = game.currentPlayer.type === "AI";
    game.currentPlayer.rack.forEach(tile => {
      const wrapper = document.createElement("div");
      if (isAI) {
        wrapper.innerHTML = `
          <div class="tile facedown ${game.currentPlayer.rack.length > 10 ? "small" : ""}">
            <div class="tile-num">?</div>
            <div class="tile-icon">🂠</div>
          </div>
        `;
        rackRow.appendChild(wrapper.firstElementChild);
        return;
      }

      const hintClass = game.lastHint?.rackTileIds?.includes(tile.id) ? "hint" : "";
      wrapper.innerHTML = this.tileHtml(tile, false, game.selectedRackIds.has(tile.id), game.drawnTileId === tile.id, hintClass);
      const tileEl = wrapper.firstElementChild;
      tileEl.onclick = () => game.toggleRackTile(tile.id);
      rackRow.appendChild(tileEl);
    });

    if (game.currentPlayer.rack.length === 0) {
      const empty = document.createElement("div");
      empty.className = "chip";
      empty.innerText = "손패가 비었습니다.";
      rackRow.appendChild(empty);
    }
  },

  setInfo(title, text, allowHtml = false) {
    document.getElementById("info-title").innerText = title;
    document.getElementById("info-text")[allowHtml ? "innerHTML" : "innerText"] = text;
  },
  showHint(hint) {
    const parts = [];
    const labelParts = [hint.shortText, hint.summary]
      .filter(Boolean)
      .filter((value, index, list) => list.indexOf(value) === index);

    if (labelParts.length > 0) {
      parts.push(`<div class="hint-summary">${labelParts.join(" · ")}</div>`);
    }
    if (hint.leadText) {
      parts.push(`<div class="hint-summary">${hint.leadText}</div>`);
    }
    if (hint.reason) {
      parts.push(`<div class="hint-reason">${hint.reason}</div>`);
    }
    if (hint.openingBreakdown && hint.openingBreakdown.length > 0) {
      parts.push(`<div class="hint-reason">${hint.openingBreakdown.join("<br>")}</div>`);
    }
    if (hint.futureBenefit) {
      parts.push(`<div class="hint-reason">${hint.futureBenefit}</div>`);
    }
    hint.steps.forEach((step, index) => {
      parts.push(`<div class="hint-step">${index + 1}. ${step}</div>`);
    });
    this.setInfo(hint.title, parts.join(""), true);
  },

  updateButtons() {
    const ids = [
      "btn-sort-color",
      "btn-sort-number",
      "btn-new-group",
      "btn-append-group",
      "btn-clear-select",
      "btn-undo-action",
      "btn-request-hint",
      "btn-draw-tile",
      "btn-end-turn"
    ];

    ids.forEach(id => {
      const el = document.getElementById(id);
      if (el) el.disabled = false;
    });

    if (game.inputLocked) {
      ids.forEach(id => {
        const el = document.getElementById(id);
        if (el) el.disabled = true;
      });
      return;
    }

    if (!game.currentPlayer || game.gameOver || game.currentPlayer.type !== "HUMAN") {
      ids.forEach(id => {
        const el = document.getElementById(id);
        if (el) el.disabled = true;
      });
      return;
    }

    const hasSelection = game.getTotalSelectedCount() > 0;
    const hasGroup = game.selectedGroupIndex !== null;
    const hasAction = game.actionHistory.length > 0;
    const canAutoRestoreDraw = hasAction && !game.hasReducedRackThisTurn();
    const hintButton = document.getElementById("btn-request-hint");
    if (hintButton) {
      const hintLimit = game.ruleOptions.hintLimit;
      const hintRemaining = game.currentPlayer?.hintsRemaining;
      hintButton.innerText = hintLimit === null
        ? "💡 힌트"
        : `💡 힌트 ${hintRemaining}/${hintLimit}`;
    }

    if (game.drewTileThisTurn) {
      [
        "btn-sort-color",
        "btn-sort-number",
        "btn-new-group",
        "btn-append-group",
        "btn-clear-select",
        "btn-undo-action",
        "btn-request-hint",
        "btn-draw-tile"
      ].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.disabled = true;
      });
      document.getElementById("btn-end-turn").disabled = false;
      return;
    }

    document.getElementById("btn-new-group").disabled = !hasSelection;
    document.getElementById("btn-append-group").disabled = !(hasSelection && hasGroup);
    document.getElementById("btn-clear-select").disabled = !(hasSelection || hasGroup);
    document.getElementById("btn-undo-action").disabled = !hasAction;
    document.getElementById("btn-request-hint").disabled = !game.canUseHint();
    document.getElementById("btn-draw-tile").disabled = (hasAction && !canAutoRestoreDraw) || game.bag.length === 0;
    document.getElementById("btn-end-turn").disabled = !hasAction;
  },

  updateAll() {
    if (!game.currentPlayer) return;

    document.getElementById("bag-count").innerText = game.bag.length;
    document.getElementById("turn-label").innerText = `${game.currentPlayer.icon} ${game.currentPlayer.name}`;
    document.getElementById("rack-owner").innerText = game.currentPlayer.name;
    document.getElementById("selected-count").innerText = game.getTotalSelectedCount();
    document.getElementById("selection-label").innerText = game.getTotalSelectedCount() > 0
      ? `${game.getTotalSelectedCount()}장 선택 중`
      : "선택 없음";
    document.getElementById("group-label").innerText = game.selectedGroupIndex !== null
      ? `줄 ${game.selectedGroupIndex + 1}`
      : "선택 줄 없음";
    document.getElementById("rule-joker-chip").innerText = game.ruleOptions.jokers ? "조커 ON" : "조커 OFF";
    document.getElementById("rule-open-chip").innerText = game.ruleOptions.initial30 ? "30룰 ON" : "30룰 OFF";

    this.renderPlayers();
    this.renderTable();
    this.renderRack();
    this.updateButtons();
  },

  toast(message) {
    const el = document.getElementById("toast");
    el.innerText = message;
    el.classList.add("show");
    clearTimeout(this.toastTimer);
    this.toastTimer = setTimeout(() => el.classList.remove("show"), 1500);
  }
};
