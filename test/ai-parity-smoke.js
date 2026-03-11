"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const ROOT = path.resolve(__dirname, "..");
const IGNORED_FIELDS = new Set([
  "title",
  "leadText",
  "reason",
  "shortText",
  "steps",
  "futureBenefit",
  "openingBreakdown",
  "partial",
  "partialReason",
  "searchPhase",
  "searchTruncated",
  "truncationNote"
]);

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function toPlain(value) {
  if (Array.isArray(value)) {
    return value.map(toPlain);
  }

  if (typeof value === "number" && Number.isFinite(value)) {
    return Number(value.toFixed(6));
  }

  if (value && typeof value === "object") {
    const plain = {};
    Object.keys(value).sort().forEach((key) => {
      if (IGNORED_FIELDS.has(key)) return;
      plain[key] = toPlain(value[key]);
    });
    return plain;
  }

  return value;
}

function toCanonicalJson(value) {
  return JSON.stringify(toPlain(value));
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

function loadLegacyContext() {
  const legacyHtml = fs.readFileSync(path.join(ROOT, "legacy", "animal_rummikub_starter ver10.html"), "utf8");
  const match = legacyHtml.match(/<script>([\s\S]*?)<\/script>/i);
  if (!match) {
    throw new Error("Legacy script block not found.");
  }

  const bootstrapIndex = match[1].lastIndexOf("const game = new Game();");
  if (bootstrapIndex === -1) {
    throw new Error("Legacy bootstrap marker not found.");
  }

  const context = createContext();
  vm.runInContext(match[1].slice(0, bootstrapIndex), context, {
    filename: "legacy/animal_rummikub_starter ver10.html"
  });
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
    const filePath = path.join(ROOT, relativePath);
    const source = fs.readFileSync(filePath, "utf8");
    vm.runInContext(source, context, { filename: relativePath });
  });

  return context;
}

function runChooseMove(context, gameState, aiLevel) {
  context.__parityInput = { gameState: clone(gameState), aiLevel };
  const result = vm.runInContext(
    "RummyAI.chooseMove(__parityInput.gameState, __parityInput.aiLevel)",
    context
  );
  delete context.__parityInput;
  return result;
}

function runGetHint(context, gameState) {
  context.__parityInput = { gameState: clone(gameState) };
  const result = vm.runInContext(
    "RummyHintEngine.getHint(__parityInput.gameState)",
    context
  );
  delete context.__parityInput;
  return result;
}

function tile(id, color, number) {
  return { id, color, number };
}

function joker(id) {
  return { id, joker: true, color: "joker" };
}

function makeTileTracker(gameState) {
  const colors = ["red", "blue", "yellow", "black"];
  const pool = {};
  const known = {};

  colors.forEach((color) => {
    for (let number = 1; number <= 13; number += 1) {
      const key = `${color}-${number}`;
      pool[key] = 2;
      known[key] = 0;
    }
  });

  if (gameState.ruleOptions.jokers) {
    pool.joker = 2;
    known.joker = 0;
  }

  const addKnownTile = (currentTile) => {
    const key = currentTile.joker ? "joker" : `${currentTile.color}-${currentTile.number}`;
    known[key] = (known[key] || 0) + 1;
  };

  gameState.currentPlayer.rack.forEach(addKnownTile);
  gameState.table.flat().forEach(addKnownTile);

  const uncertain = {};
  let uncertainTotal = 0;

  Object.entries(pool).forEach(([key, total]) => {
    const remaining = Math.max(0, total - (known[key] || 0));
    uncertain[key] = remaining;
    uncertainTotal += remaining;
  });

  const opponentTotalCards = gameState.playersMeta
    .filter((player) => player.index !== gameState.turnIndex)
    .reduce((sum, player) => sum + player.rackCount, 0);

  return {
    pool,
    known,
    uncertain,
    uncertainTotal,
    bagSize: gameState.bagCount,
    opponentTotalCards
  };
}

function addTracker(gameState) {
  const state = clone(gameState);
  state.tileTracker = makeTileTracker(state);
  return state;
}

function makePlayersMeta(currentRackCount, currentType, currentAiLevel, currentOpened, others) {
  return [
    {
      index: 0,
      rackCount: currentRackCount,
      opened: currentOpened,
      type: currentType,
      aiLevel: currentAiLevel
    },
    ...others.map((player, index) => ({
      index: index + 1,
      rackCount: player.rackCount,
      opened: player.opened,
      type: player.type,
      aiLevel: player.aiLevel
    }))
  ];
}

function createCases() {
  const aiBasic = {
    currentPlayer: {
      rack: [
        tile(1, "red", 7),
        tile(2, "blue", 7),
        tile(3, "yellow", 7),
        tile(4, "black", 11)
      ],
      opened: true,
      aiLevel: 3
    },
    table: [],
    baseTableCount: 0,
    bagCount: 34,
    ruleOptions: { jokers: false, initial30: false, hintLimit: null },
    playersMeta: makePlayersMeta(4, "AI", 3, true, [
      { rackCount: 14, opened: true, type: "AI", aiLevel: 2 }
    ]),
    turnIndex: 0,
    consecutiveStrategicDrawsByPlayer: [0, 0],
    openingHoldDrawUsed: [0, 0]
  };

  const aiStrategicDraw = addTracker({
    currentPlayer: {
      rack: [
        tile(10, "red", 1),
        tile(11, "red", 2),
        tile(12, "red", 4),
        tile(13, "blue", 8),
        tile(14, "black", 8),
        tile(15, "yellow", 11),
        tile(16, "black", 12)
      ],
      opened: false,
      aiLevel: 5
    },
    table: [
      [tile(17, "red", 9), tile(18, "blue", 9), tile(19, "yellow", 9)]
    ],
    baseTableCount: 1,
    bagCount: 29,
    ruleOptions: { jokers: false, initial30: true, hintLimit: null },
    playersMeta: makePlayersMeta(7, "AI", 5, false, [
      { rackCount: 11, opened: true, type: "AI", aiLevel: 4 },
      { rackCount: 9, opened: false, type: "AI", aiLevel: 2 }
    ]),
    turnIndex: 0,
    consecutiveStrategicDrawsByPlayer: [0, 0, 0],
    openingHoldDrawUsed: [0, 0, 0]
  });

  const hintBasic = addTracker({
    currentPlayer: {
      rack: [
        tile(30, "red", 5),
        tile(31, "blue", 5),
        tile(32, "yellow", 5),
        tile(33, "black", 11)
      ],
      opened: true,
      aiLevel: null
    },
    table: [],
    baseTableCount: 0,
    bagCount: 41,
    ruleOptions: { jokers: false, initial30: false, hintLimit: 3 },
    playersMeta: makePlayersMeta(4, "HUMAN", null, true, [
      { rackCount: 12, opened: true, type: "AI", aiLevel: 4 }
    ]),
    turnIndex: 0,
    consecutiveStrategicDrawsByPlayer: [0, 0],
    openingHoldDrawUsed: [0, 0],
    hintMode: true,
    turnStartRackSize: 4,
    alreadyReducedRackThisTurn: false
  });

  const hintStrategicDraw = addTracker({
    currentPlayer: {
      rack: [
        tile(40, "red", 1),
        tile(41, "red", 2),
        tile(42, "blue", 4),
        tile(43, "blue", 6),
        tile(44, "yellow", 8),
        tile(45, "black", 10),
        joker(46)
      ],
      opened: false,
      aiLevel: null
    },
    table: [],
    baseTableCount: 0,
    bagCount: 33,
    ruleOptions: { jokers: true, initial30: true, hintLimit: null },
    playersMeta: makePlayersMeta(7, "HUMAN", null, false, [
      { rackCount: 10, opened: true, type: "AI", aiLevel: 6 },
      { rackCount: 8, opened: false, type: "AI", aiLevel: 3 }
    ]),
    turnIndex: 0,
    consecutiveStrategicDrawsByPlayer: [0, 0, 0],
    openingHoldDrawUsed: [0, 0, 0],
    hintMode: true,
    turnStartRackSize: 7,
    alreadyReducedRackThisTurn: false
  });

  return [
    {
      name: "ai-basic-level3",
      run(legacyContext, splitContext) {
        return {
          legacy: runChooseMove(legacyContext, aiBasic, 3),
          split: runChooseMove(splitContext, aiBasic, 3)
        };
      }
    },
    {
      name: "ai-level5-no-move",
      run(legacyContext, splitContext) {
        return {
          legacy: runChooseMove(legacyContext, aiStrategicDraw, 5),
          split: runChooseMove(splitContext, aiStrategicDraw, 5)
        };
      }
    },
    {
      name: "hint-basic",
      run(legacyContext, splitContext) {
        return {
          legacy: runGetHint(legacyContext, hintBasic),
          split: runGetHint(splitContext, hintBasic)
        };
      }
    },
    {
      name: "hint-strategic-draw",
      run(legacyContext, splitContext) {
        return {
          legacy: runGetHint(legacyContext, hintStrategicDraw),
          split: runGetHint(splitContext, hintStrategicDraw)
        };
      }
    }
  ];
}

function main() {
  const legacyContext = loadLegacyContext();
  const splitContext = loadSplitContext();
  const cases = createCases();

  cases.forEach((testCase) => {
    const { legacy, split } = testCase.run(legacyContext, splitContext);
    assert.notStrictEqual(typeof legacy, "undefined", `${testCase.name}: legacy returned undefined`);
    assert.notStrictEqual(typeof split, "undefined", `${testCase.name}: split returned undefined`);
    assert.strictEqual(toCanonicalJson(split), toCanonicalJson(legacy), `${testCase.name}: split output diverged from legacy`);
    console.log(`PASS ${testCase.name}`);
  });
}

main();
