"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const ROOT = path.resolve(__dirname, "..");

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function createContext() {
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
    setTimeout,
    clearTimeout
  });

  context.globalThis = context;
  context.window = context;
  context.self = context;
  return context;
}

function loadSplitContext() {
  const context = createContext();
  const files = [
    "shared/constants.js",
    "shared/rules-core.js",
    "shared/utils.js",
    "worker/ai-utils.js",
    "worker/ai-base.js",
    "worker/ai-levels.js",
    "worker/ai-dispatcher.js",
    "worker/hint-engine.js"
  ];

  files.forEach((relativePath) => {
    const source = fs.readFileSync(path.join(ROOT, relativePath), "utf8");
    vm.runInContext(source, context, { filename: relativePath });
  });

  return context;
}

function tile(id, color, number) {
  return { id, color, number };
}

function joker(id) {
  return { id, joker: true, color: "joker" };
}

function makeGameState(currentPlayer, table, extras = {}) {
  return {
    currentPlayer,
    table,
    baseTableCount: typeof extras.baseTableCount === "number" ? extras.baseTableCount : table.length,
    bagCount: extras.bagCount ?? 18,
    ruleOptions: {
      jokers: Boolean(extras.ruleOptions?.jokers),
      initial30: Boolean(extras.ruleOptions?.initial30),
      hintLimit: null
    },
    playersMeta: extras.playersMeta || [
      { index: 0, rackCount: currentPlayer.rack.length, opened: currentPlayer.opened, type: "AI", aiLevel: currentPlayer.aiLevel },
      { index: 1, rackCount: 8, opened: true, type: "AI", aiLevel: 4 },
      { index: 2, rackCount: 6, opened: true, type: "AI", aiLevel: 5 }
    ],
    turnIndex: 0,
    consecutiveStrategicDrawsByPlayer: extras.consecutiveStrategicDrawsByPlayer || [0, 0, 0],
    openingHoldDrawUsed: extras.openingHoldDrawUsed || [0, 0, 0],
    tileTracker: extras.tileTracker
  };
}

function runStrategyMove(context, className, gameState, overrides = {}) {
  context.__hardeningInput = {
    gameState: clone(gameState),
    overrides: clone(overrides)
  };

  const result = vm.runInContext(`
    (() => {
      const strategy = new ${className}();
      Object.assign(strategy.config, __hardeningInput.overrides);
      return {
        schedule: Array.isArray(strategy.config.searchSchedule) ? strategy.config.searchSchedule : [],
        move: strategy.chooseMove(__hardeningInput.gameState)
      };
    })()
  `, context);

  delete context.__hardeningInput;
  return result;
}

function assertValidMove(context, result, initialRackLength, label) {
  assert.ok(result.move, `${label}: move should not be null`);
  assert.ok(result.move.rack.length < initialRackLength, `${label}: rack should be reduced`);

  context.__validationMove = clone(result.move);
  const valid = vm.runInContext(`
    __validationMove.table.every(group => RummyRules.analyzeGroup(group).valid)
  `, context);
  delete context.__validationMove;

  assert.ok(valid, `${label}: resulting table must remain valid`);
}

function main() {
  const context = loadSplitContext();

  const level5State = makeGameState(
    {
      rack: [
        tile(1, "red", 4),
        tile(2, "red", 5),
        tile(3, "red", 6),
        tile(4, "blue", 9),
        tile(5, "yellow", 9),
        tile(6, "black", 9),
        tile(7, "red", 11)
      ],
      opened: true,
      aiLevel: 5
    },
    [
      [tile(101, "blue", 3), tile(102, "blue", 4), tile(103, "blue", 5)]
    ],
    { bagCount: 14 }
  );

  const level6State = makeGameState(
    {
      rack: [
        tile(11, "red", 9),
        tile(12, "red", 10),
        tile(13, "black", 6),
        tile(14, "yellow", 6),
        joker(15),
        tile(16, "blue", 12)
      ],
      opened: true,
      aiLevel: 6
    },
    [
      [tile(201, "red", 6), tile(202, "blue", 6), tile(203, "black", 6)],
      [tile(204, "red", 7), tile(205, "red", 8), joker(206)],
      [tile(207, "blue", 9), tile(208, "yellow", 9), tile(209, "black", 9)],
      [tile(210, "yellow", 10), tile(211, "yellow", 11), tile(212, "yellow", 12)]
    ],
    {
      bagCount: 12,
      ruleOptions: { jokers: true, initial30: false }
    }
  );

  const level5Result = runStrategyMove(context, "AILevel5Strategy", level5State, { timeLimitMs: 60 });
  const level6Result = runStrategyMove(context, "AILevel6Strategy", level6State, { timeLimitMs: 80 });

  assert.ok(level5Result.schedule.length >= 3, "level5: progressive search schedule should exist");
  assert.ok(level6Result.schedule.length >= 3, "level6: progressive search schedule should exist");
  assertValidMove(context, level5Result, level5State.currentPlayer.rack.length, "level5");
  assertValidMove(context, level6Result, level6State.currentPlayer.rack.length, "level6");

  console.log("PASS search-hardening-smoke");
}

main();
