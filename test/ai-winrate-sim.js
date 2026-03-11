"use strict";

const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const ROOT = path.resolve(__dirname, "..");
const AI_LEVELS = [1, 2, 3, 4, 5, 6];
const DEFAULT_GAMES_PER_PAIR = 40;
const MAX_TURNS_PER_GAME = 500;
const STALE_TURNS_LIMIT = 8;

function parseArgs(argv) {
  const options = {
    gamesPerPair: DEFAULT_GAMES_PER_PAIR,
    rules: "default"
  };

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === "--games" && argv[index + 1]) {
      options.gamesPerPair = Math.max(2, Number(argv[index + 1]) || DEFAULT_GAMES_PER_PAIR);
      index += 1;
    } else if (token === "--rules" && argv[index + 1]) {
      options.rules = argv[index + 1];
      index += 1;
    }
  }

  return options;
}

function buildRuleOptions(mode) {
  if (mode === "hard") {
    return { jokers: true, initial30: true, hintLimit: null };
  }
  return { jokers: false, initial30: false, hintLimit: null };
}

function createContext() {
  const noop = () => {};
  const context = vm.createContext({
    console,
    Date,
    Math,
    JSON,
    Error,
    Set,
    Map,
    Array,
    Object,
    Number,
    String,
    Boolean,
    RegExp,
    setTimeout: () => 0,
    clearTimeout: noop,
    requestAnimationFrame: () => 0
  });

  const dummy = {
    classList: { add: noop, remove: noop, toggle: noop },
    style: {},
    appendChild: noop,
    removeChild: noop,
    addEventListener: noop,
    removeEventListener: noop,
    setAttribute: noop,
    removeAttribute: noop,
    querySelector: () => dummy,
    querySelectorAll: () => [],
    getContext: () => ({}),
    focus: noop,
    blur: noop,
    innerText: "",
    innerHTML: "",
    textContent: "",
    value: "",
    disabled: false,
    scrollTop: 0,
    scrollHeight: 0
  };

  context.document = {
    body: { classList: { add: noop, remove: noop, toggle: noop } },
    getElementById: () => dummy,
    querySelector: () => dummy,
    querySelectorAll: () => [],
    createElement: () => dummy,
    addEventListener: noop,
    removeEventListener: noop
  };

  context.ui = {
    renderSetup: noop,
    renderRuleOptions: noop,
    renderQuickStartMixedLevel: noop,
    showScreen: noop,
    updateAll: noop,
    hideSetup: noop,
    setInfo: noop,
    toast: noop,
    updateButtons: noop,
    showHint: noop,
    renderPlayers: noop,
    renderTable: noop,
    renderRack: noop
  };

  context.globalThis = context;
  context.window = context;
  context.self = context;
  return context;
}

function loadContext() {
  const context = createContext();
  const files = [
    "shared/constants.js",
    "shared/rules-core.js",
    "shared/utils.js",
    "worker/ai-utils.js",
    "worker/ai-base.js",
    "worker/ai-levels.js",
    "worker/ai-dispatcher.js",
    "worker/hint-engine.js",
    "js/game.js"
  ];

  files.forEach((relativePath) => {
    const source = fs.readFileSync(path.join(ROOT, relativePath), "utf8");
    vm.runInContext(source, context, { filename: relativePath });
  });

  return context;
}

function createGame(context, leftLevel, rightLevel, ruleOptions) {
  context.__simInput = {
    leftLevel,
    rightLevel,
    ruleOptions
  };

  const game = vm.runInContext(`
    (() => {
      const game = new Game();
      game.setupState = ["AI-" + __simInput.leftLevel, "AI-" + __simInput.rightLevel, "OFF", "OFF"];
      game.ruleOptions = JSON.parse(JSON.stringify(__simInput.ruleOptions));
      game.startFromSetup();
      game.winnerIndex = null;
      const originalWin = game.win.bind(game);
      game.win = function(player) {
        this.winnerIndex = this.players.findIndex(current => current.id === player.id);
        return originalWin(player);
      };
      window.game = game;
      return game;
    })()
  `, context);

  delete context.__simInput;
  return game;
}

function runAIMove(context, game) {
  const playerIndex = game.turn;
  const beforeRackCounts = game.players.map(player => player.rack.length);
  const beforeBag = game.bag.length;
  const beforeTable = JSON.stringify(game.table);

  context.__simGame = game;
  vm.runInContext(`
    (() => {
      const playerIndex = __simGame.turn;
      const gameState = __simGame.buildGameStateForAI();
      const aiLevel = __simGame.currentPlayer.aiLevel;
      const move = RummyAI.chooseMove(gameState, aiLevel);
      if (move) {
        __simGame.applyAiMove(move, playerIndex);
      } else {
        __simGame.fallbackAiDraw(playerIndex);
      }
    })()
  `, context);
  delete context.__simGame;

  if (!game.gameOver && game.turn === playerIndex) {
    game.passTurn();
  }

  const afterRackCounts = game.players.map(player => player.rack.length);
  const progress = (
    beforeBag !== game.bag.length
    || beforeTable !== JSON.stringify(game.table)
    || beforeRackCounts.some((count, index) => count !== afterRackCounts[index])
  );

  return { progress };
}

function resolveDeadlock(game) {
  const rackCounts = game.players.map(player => player.rack.length);
  const bestCount = Math.min(...rackCounts);
  const winners = rackCounts
    .map((count, index) => ({ count, index }))
    .filter(entry => entry.count === bestCount)
    .map(entry => entry.index);

  return winners.length === 1
    ? { type: "winner", winnerIndex: winners[0], rackCounts }
    : { type: "tie", winnerIndex: null, rackCounts };
}

function simulateGame(context, leftLevel, rightLevel, ruleOptions) {
  const game = createGame(context, leftLevel, rightLevel, ruleOptions);
  let staleTurns = 0;

  for (let turnCount = 0; turnCount < MAX_TURNS_PER_GAME; turnCount += 1) {
    if (game.gameOver) {
      return {
        type: "winner",
        winnerIndex: game.winnerIndex,
        turns: turnCount,
        rackCounts: game.players.map(player => player.rack.length)
      };
    }

    const { progress } = runAIMove(context, game);
    if (!progress && game.bag.length === 0) {
      staleTurns += 1;
    } else {
      staleTurns = 0;
    }

    if (staleTurns >= STALE_TURNS_LIMIT) {
      return {
        ...resolveDeadlock(game),
        turns: turnCount + 1
      };
    }
  }

  return {
    ...resolveDeadlock(game),
    turns: MAX_TURNS_PER_GAME
  };
}

function initializeMatrix() {
  const matrix = {};
  AI_LEVELS.forEach(level => {
    matrix[level] = {};
    AI_LEVELS.forEach(other => {
      matrix[level][other] = null;
    });
  });
  return matrix;
}

function runRoundRobin(options) {
  const context = loadContext();
  const ruleOptions = buildRuleOptions(options.rules);
  const gamesPerPair = options.gamesPerPair % 2 === 0 ? options.gamesPerPair : options.gamesPerPair + 1;
  const matrix = initializeMatrix();
  const overall = {};
  let totalTurns = 0;
  let totalGames = 0;

  AI_LEVELS.forEach(level => {
    overall[level] = { wins: 0, losses: 0, ties: 0, games: 0 };
  });

  for (let i = 0; i < AI_LEVELS.length; i += 1) {
    for (let j = i + 1; j < AI_LEVELS.length; j += 1) {
      const left = AI_LEVELS[i];
      const right = AI_LEVELS[j];
      let leftWins = 0;
      let rightWins = 0;
      let ties = 0;

      for (let gameIndex = 0; gameIndex < gamesPerPair; gameIndex += 1) {
        const swapSeats = gameIndex % 2 === 1;
        const seatLeft = swapSeats ? right : left;
        const seatRight = swapSeats ? left : right;
        const result = simulateGame(context, seatLeft, seatRight, ruleOptions);
        totalTurns += result.turns;
        totalGames += 1;

        if (result.type === "winner") {
          const winningLevel = result.winnerIndex === 0 ? seatLeft : seatRight;
          if (winningLevel === left) leftWins += 1;
          else rightWins += 1;
        } else {
          ties += 1;
        }
      }

      const decidedGames = gamesPerPair - ties;
      matrix[left][right] = {
        wins: leftWins,
        losses: rightWins,
        ties,
        winRate: decidedGames > 0 ? leftWins / decidedGames : 0.5,
        decidedGames
      };
      matrix[right][left] = {
        wins: rightWins,
        losses: leftWins,
        ties,
        winRate: decidedGames > 0 ? rightWins / decidedGames : 0.5,
        decidedGames
      };

      overall[left].wins += leftWins;
      overall[left].losses += rightWins;
      overall[left].ties += ties;
      overall[left].games += gamesPerPair;

      overall[right].wins += rightWins;
      overall[right].losses += leftWins;
      overall[right].ties += ties;
      overall[right].games += gamesPerPair;
    }
  }

  return {
    rules: options.rules,
    gamesPerPair,
    matrix,
    overall,
    averageTurns: totalGames > 0 ? totalTurns / totalGames : 0
  };
}

function formatPct(value) {
  return `${(value * 100).toFixed(1)}%`;
}

function printReport(report) {
  console.log(`rules=${report.rules} games_per_pair=${report.gamesPerPair} avg_turns=${report.averageTurns.toFixed(1)}`);
  console.log("");
  console.log("pairwise_winrate(row_vs_col)");

  const header = ["AI"].concat(AI_LEVELS.map(level => `AI-${level}`));
  console.log(header.join("\t"));

  AI_LEVELS.forEach(level => {
    const row = [`AI-${level}`];
    AI_LEVELS.forEach(other => {
      if (level === other) {
        row.push("-");
        return;
      }
      row.push(formatPct(report.matrix[level][other].winRate));
    });
    console.log(row.join("\t"));
  });

  console.log("");
  console.log("overall");
  AI_LEVELS.forEach(level => {
    const stats = report.overall[level];
    const decidedGames = stats.games - stats.ties;
    const winRate = decidedGames > 0 ? stats.wins / decidedGames : 0.5;
    const tieRate = stats.games > 0 ? stats.ties / stats.games : 0;
    console.log(
      `AI-${level}\twin=${formatPct(winRate)}\ttie=${formatPct(tieRate)}\tW-L-T=${stats.wins}-${stats.losses}-${stats.ties}`
    );
  });
}

const report = runRoundRobin(parseArgs(process.argv.slice(2)));
printReport(report);
