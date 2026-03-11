"use strict";

const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const ROOT = path.resolve(__dirname, "..");
const AI_LEVELS = [1, 2, 3, 4, 5, 6];
const DEFAULT_GAMES_PER_PAIR = 12;
const DEFAULT_MAX_TURNS = 300;
const DEFAULT_STALE_TURNS = 6;
const DEFAULT_TIME_SCALE = 1;

function parseArgs(argv) {
  const options = {
    gamesPerPair: DEFAULT_GAMES_PER_PAIR,
    rules: "default",
    levels: [...AI_LEVELS],
    maxTurns: DEFAULT_MAX_TURNS,
    staleTurns: DEFAULT_STALE_TURNS,
    timeScale: DEFAULT_TIME_SCALE
  };

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === "--games" && argv[index + 1]) {
      options.gamesPerPair = Math.max(1, Number(argv[index + 1]) || DEFAULT_GAMES_PER_PAIR);
      index += 1;
    } else if (token === "--rules" && argv[index + 1]) {
      options.rules = argv[index + 1];
      index += 1;
    } else if (token === "--levels" && argv[index + 1]) {
      options.levels = argv[index + 1]
        .split(",")
        .map(value => Number(value.trim()))
        .filter(value => AI_LEVELS.includes(value));
      index += 1;
    } else if (token === "--max-turns" && argv[index + 1]) {
      options.maxTurns = Math.max(50, Number(argv[index + 1]) || DEFAULT_MAX_TURNS);
      index += 1;
    } else if (token === "--stale-turns" && argv[index + 1]) {
      options.staleTurns = Math.max(2, Number(argv[index + 1]) || DEFAULT_STALE_TURNS);
      index += 1;
    } else if (token === "--time-scale" && argv[index + 1]) {
      options.timeScale = Math.max(0.05, Number(argv[index + 1]) || DEFAULT_TIME_SCALE);
      index += 1;
    }
  }

  if (options.levels.length < 2) {
    options.levels = [...AI_LEVELS];
  }

  options.levels = Array.from(new Set(options.levels)).sort((a, b) => a - b);
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

  vm.runInContext(`
    Game.prototype.addLog = function() {};
    Game.prototype.openTurn = function() {};
    Game.prototype.win = function(player) {
      this.gameOver = true;
      this.clearScheduledTurnTimers();
      this.winnerIndex = this.players.findIndex(current => current.id === player.id);
    };
  `, context);

  return context;
}

function initializeMatrix(levels) {
  const matrix = {};
  levels.forEach(level => {
    matrix[level] = {};
    levels.forEach(other => {
      matrix[level][other] = null;
    });
  });
  return matrix;
}

function runRoundRobin(options) {
  const context = loadContext();
  const levels = options.levels;
  const ruleOptions = buildRuleOptions(options.rules);
  const gamesPerPair = options.gamesPerPair;
  context.__simOptions = {
    levels,
    ruleOptions,
    gamesPerPair,
    maxTurns: options.maxTurns,
    staleTurns: options.staleTurns,
    timeScale: options.timeScale
  };

  const summary = vm.runInContext(`
    (() => {
      const clone = (value) => JSON.parse(JSON.stringify(value));
      const levels = __simOptions.levels;
      const ruleOptions = clone(__simOptions.ruleOptions);
      const gamesPerPair = __simOptions.gamesPerPair;
      const maxTurns = __simOptions.maxTurns;
      const staleTurnsLimit = __simOptions.staleTurns;
      const timeScale = __simOptions.timeScale;

      if (timeScale !== 1) {
        const originalGetStrategy = RummyAI.getStrategy.bind(RummyAI);
        RummyAI.getStrategy = function(level) {
          const strategy = originalGetStrategy(level);
          if (strategy && strategy.config && typeof strategy.config.timeLimitMs === "number") {
            strategy.config.timeLimitMs = Math.max(5, Math.round(strategy.config.timeLimitMs * timeScale));
          }
          return strategy;
        };
      }

      const initializeMatrix = () => {
        const matrix = {};
        levels.forEach(level => {
          matrix[level] = {};
          levels.forEach(other => {
            matrix[level][other] = null;
          });
        });
        return matrix;
      };

      const createGame = (leftLevel, rightLevel) => {
        const game = new Game();
        game.setupState = ["AI-" + leftLevel, "AI-" + rightLevel, "OFF", "OFF"];
        game.ruleOptions = clone(ruleOptions);
        game.startFromSetup();
        game.winnerIndex = null;
        return game;
      };

      const resolveDeadlock = (game) => {
        const rackCounts = game.players.map(player => player.rack.length);
        const bestCount = Math.min(...rackCounts);
        const winners = rackCounts
          .map((count, index) => ({ count, index }))
          .filter(entry => entry.count === bestCount)
          .map(entry => entry.index);

        return winners.length === 1
          ? { type: "winner", winnerIndex: winners[0], rackCounts }
          : { type: "tie", winnerIndex: null, rackCounts };
      };

      const runAIMove = (game) => {
        const playerIndex = game.turn;
        const beforeRackCounts = game.players.map(player => player.rack.length);
        const beforeBag = game.bag.length;
        const beforeTableSize = game.table.length;
        const beforeWorkingTableSize = game.workingTable.length;

        const gameState = game.buildGameStateForAI();
        const aiLevel = game.currentPlayer.aiLevel;
        const move = RummyAI.chooseMove(gameState, aiLevel);
        if (move) {
          game.applyAiMove(move, playerIndex);
        } else {
          game.fallbackAiDraw(playerIndex);
        }

        if (!game.gameOver && game.turn === playerIndex) {
          game.passTurn();
        }

        const afterRackCounts = game.players.map(player => player.rack.length);
        return (
          beforeBag !== game.bag.length
          || beforeTableSize !== game.table.length
          || beforeWorkingTableSize !== game.workingTable.length
          || beforeRackCounts.some((count, index) => count !== afterRackCounts[index])
        );
      };

      const simulateGame = (leftLevel, rightLevel) => {
        const game = createGame(leftLevel, rightLevel);
        let staleTurns = 0;

        for (let turnCount = 0; turnCount < maxTurns; turnCount += 1) {
          if (game.gameOver) {
            return {
              type: "winner",
              winnerIndex: game.winnerIndex,
              turns: turnCount,
              rackCounts: game.players.map(player => player.rack.length)
            };
          }

          const progressed = runAIMove(game);
          if (!progressed && game.bag.length === 0) staleTurns += 1;
          else staleTurns = 0;

          if (staleTurns >= staleTurnsLimit) {
            return {
              ...resolveDeadlock(game),
              turns: turnCount + 1
            };
          }
        }

        return {
          ...resolveDeadlock(game),
          turns: maxTurns
        };
      };

      const matrix = initializeMatrix();
      const overall = {};
      const perPair = [];
      let totalTurns = 0;
      let totalGames = 0;

      levels.forEach(level => {
        overall[level] = { wins: 0, losses: 0, ties: 0, games: 0 };
      });

      for (let i = 0; i < levels.length; i += 1) {
        for (let j = i + 1; j < levels.length; j += 1) {
          const left = levels[i];
          const right = levels[j];
          let leftWins = 0;
          let rightWins = 0;
          let ties = 0;

          for (let gameIndex = 0; gameIndex < gamesPerPair; gameIndex += 1) {
            const swapSeats = gameIndex % 2 === 1;
            const seatLeft = swapSeats ? right : left;
            const seatRight = swapSeats ? left : right;
            const result = simulateGame(seatLeft, seatRight);
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
          const leftWinRate = decidedGames > 0 ? leftWins / decidedGames : 0.5;
          const rightWinRate = decidedGames > 0 ? rightWins / decidedGames : 0.5;

          matrix[left][right] = {
            wins: leftWins,
            losses: rightWins,
            ties,
            winRate: leftWinRate,
            decidedGames
          };
          matrix[right][left] = {
            wins: rightWins,
            losses: leftWins,
            ties,
            winRate: rightWinRate,
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

          perPair.push({
            left,
            right,
            leftWins,
            rightWins,
            ties,
            decidedGames,
            leftWinRate,
            rightWinRate
          });
        }
      }

      return {
        levels,
        gamesPerPair,
        matrix,
        overall,
        perPair,
        averageTurns: totalGames > 0 ? totalTurns / totalGames : 0,
        timeScale
      };
    })()
  `, context);

  delete context.__simOptions;

  return {
    rules: options.rules,
    gamesPerPair,
    levels,
    matrix: initializeMatrix(levels),
    overall: summary.overall,
    perPair: summary.perPair,
    averageTurns: summary.averageTurns,
    timeScale: summary.timeScale
  };
}

function hydrateReport(report) {
  report.perPair.forEach((pair) => {
    report.matrix[pair.left][pair.right] = {
      wins: pair.leftWins,
      losses: pair.rightWins,
      ties: pair.ties,
      winRate: pair.leftWinRate,
      decidedGames: pair.decidedGames
    };
    report.matrix[pair.right][pair.left] = {
      wins: pair.rightWins,
      losses: pair.leftWins,
      ties: pair.ties,
      winRate: pair.rightWinRate,
      decidedGames: pair.decidedGames
    };
  });
  return report;
}

function formatPct(value) {
  return `${(value * 100).toFixed(1)}%`;
}

function printReport(report) {
  console.log(
    `rules=${report.rules} levels=${report.levels.join(",")} games_per_pair=${report.gamesPerPair} time_scale=${report.timeScale} avg_turns=${report.averageTurns.toFixed(1)}`
  );
  console.log("");
  console.log("pairwise_winrate(row_vs_col)");

  const header = ["AI"].concat(report.levels.map(level => `AI-${level}`));
  console.log(header.join("\t"));

  report.levels.forEach((level) => {
    const row = [`AI-${level}`];
    report.levels.forEach((other) => {
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
  report.levels.forEach((level) => {
    const stats = report.overall[level];
    const decidedGames = stats.games - stats.ties;
    const winRate = decidedGames > 0 ? stats.wins / decidedGames : 0.5;
    const tieRate = stats.games > 0 ? stats.ties / stats.games : 0;
    console.log(
      `AI-${level}\twin=${formatPct(winRate)}\ttie=${formatPct(tieRate)}\tW-L-T=${stats.wins}-${stats.losses}-${stats.ties}`
    );
  });
}

const report = hydrateReport(runRoundRobin(parseArgs(process.argv.slice(2))));
printReport(report);
