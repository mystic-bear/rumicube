const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const ROOT_DIR = path.resolve(__dirname, "..");
const CURRENT_SOURCES = [
  "shared/constants.js",
  "shared/rules-core.js",
  "shared/utils.js",
  "worker/ai-utils.js",
  "worker/ai-base.js",
  "worker/ai-levels.js",
  "worker/ai-dispatcher.js",
  "worker/hint-engine.js"
];
const LEGACY_HTML_PATH = path.join(ROOT_DIR, "legacy", "animal_rummikub_starter ver10.html");
const LEGACY_INIT_MARKER = "const game = new Game();";
const COLOR_KEYS = ["red", "blue", "yellow", "black"];
const IGNORED_FIELDS = new Set([
  "type",
  "summary",
  "actions",
  "stats",
  "jokerNotes",
  "moveType",
  "openingScore",
  "openingDetails",
  "openingBreakdown",
  "leadText",
  "reason",
  "shortText",
  "steps",
  "tableTileIds",
  "preservedGroupsSummary",
  "touchedGroupLabels",
  "futureBenefit",
  "score",
  "drawScore",
  "engineLevel",
  "selectedLevel",
  "previewScore",
  "finalScore",
  "searchStateKey",
  "tieBreakData"
]);

function createSeededMath(seed) {
  let state = seed >>> 0;
  const seededMath = Object.create(Math);
  seededMath.random = () => {
    state = (state + 0x6D2B79F5) | 0;
    let value = Math.imul(state ^ (state >>> 15), 1 | state);
    value ^= value + Math.imul(value ^ (value >>> 7), 61 | value);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
  return seededMath;
}

function createDomStub() {
  const noop = () => {};
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
    disabled: false
  };

  const document = {
    body: { classList: { add: noop, remove: noop, toggle: noop } },
    getElementById: () => dummy,
    querySelector: () => dummy,
    querySelectorAll: () => [],
    createElement: () => dummy,
    addEventListener: noop,
    removeEventListener: noop
  };

  const window = {
    document,
    addEventListener: noop,
    removeEventListener: noop
  };

  return { document, window };
}

function createBaseContext(seed) {
  const { document, window } = createDomStub();
  return vm.createContext({
    console,
    Math: createSeededMath(seed),
    document,
    window,
    setTimeout: () => 0,
    clearTimeout: () => {},
    performance: { now: () => 0 }
  });
}

function loadCurrentContext(seed) {
  const context = createBaseContext(seed);
  CURRENT_SOURCES.forEach((relativePath) => {
    const absolutePath = path.join(ROOT_DIR, relativePath);
    const source = fs.readFileSync(absolutePath, "utf8");
    vm.runInContext(source, context, { filename: relativePath });
  });
  return context;
}

function loadLegacyContext(seed) {
  const context = createBaseContext(seed);
  const html = fs.readFileSync(LEGACY_HTML_PATH, "utf8");
  const match = html.match(/<script>([\s\S]*?)<\/script>/);
  if (!match) {
    throw new Error("Legacy HTML script block not found");
  }

  const legacySource = match[1];
  const cutIndex = legacySource.indexOf(LEGACY_INIT_MARKER);
  if (cutIndex < 0) {
    throw new Error("Legacy init marker not found");
  }

  vm.runInContext(legacySource.slice(0, cutIndex), context, {
    filename: path.relative(ROOT_DIR, LEGACY_HTML_PATH)
  });
  return context;
}

function deepClone(value) {
  return JSON.parse(JSON.stringify(value));
}

function canonicalize(value, parentKey = "") {
  if (Array.isArray(value)) {
    const normalized = value.map(item => canonicalize(item, parentKey));

    if (
      parentKey === "rack"
      && normalized.every(item => item && typeof item === "object" && typeof item.id === "number")
    ) {
      return normalized.sort((a, b) => a.id - b.id);
    }

    if (
      parentKey === "table"
      && normalized.every(group => Array.isArray(group))
    ) {
      return normalized
        .map(group => group.sort((a, b) => a.id - b.id))
        .sort((a, b) =>
          a.map(tile => tile.id).join("-").localeCompare(b.map(tile => tile.id).join("-"))
        );
    }

    if (parentKey === "openingDetails") {
      return normalized.sort((a, b) =>
        (a.ids || []).join("-").localeCompare((b.ids || []).join("-"))
      );
    }

    if (
      ["rackTileIds", "tableTileIds", "targetGroupIndices"].includes(parentKey)
      && normalized.every(item => typeof item === "number")
    ) {
      return normalized.sort((a, b) => a - b);
    }

    return normalized;
  }

  if (value && typeof value === "object") {
    return Object.keys(value)
      .filter(key => !IGNORED_FIELDS.has(key))
      .sort()
      .reduce((acc, key) => {
        acc[key] = canonicalize(value[key], key);
        return acc;
      }, {});
  }

  return value;
}

function stableStringify(value) {
  return JSON.stringify(canonicalize(value));
}

function tile(id, color, number) {
  return { id, color, number };
}

function joker(id) {
  return { id, joker: true, color: "joker" };
}

function buildTileTracker(gameState) {
  const pool = {};
  const known = {};

  COLOR_KEYS.forEach((color) => {
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

  const allKnownTiles = [...gameState.currentPlayer.rack, ...gameState.table.flat()];
  allKnownTiles.forEach((currentTile) => {
    const key = currentTile.joker ? "joker" : `${currentTile.color}-${currentTile.number}`;
    known[key] = (known[key] || 0) + 1;
  });

  const uncertain = {};
  let uncertainTotal = 0;

  Object.entries(pool).forEach(([key, total]) => {
    const remaining = Math.max(0, total - (known[key] || 0));
    uncertain[key] = remaining;
    uncertainTotal += remaining;
  });

  const opponentTotalCards = gameState.playersMeta
    .filter((_, index) => index !== gameState.turnIndex)
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

function createGameState(options) {
  const rack = deepClone(options.rack);
  const table = deepClone(options.table || []);
  const ruleOptions = {
    jokers: Boolean(options.ruleOptions?.jokers),
    initial30: Boolean(options.ruleOptions?.initial30),
    hintLimit: null
  };
  const turnIndex = options.turnIndex || 0;
  const playersMeta = deepClone(options.playersMeta || [
    {
      index: 0,
      rackCount: rack.length,
      opened: options.opened !== false,
      type: "HUMAN",
      aiLevel: options.aiLevel || 6
    },
    {
      index: 1,
      rackCount: 11,
      opened: true,
      type: "AI",
      aiLevel: 4
    }
  ]);

  const gameState = {
    currentPlayer: {
      rack,
      opened: options.opened !== false,
      aiLevel: options.aiLevel || 6
    },
    table,
    baseTableCount: typeof options.baseTableCount === "number" ? options.baseTableCount : table.length,
    bagCount: typeof options.bagCount === "number" ? options.bagCount : 24,
    ruleOptions,
    playersMeta,
    turnIndex,
    consecutiveStrategicDrawsByPlayer: deepClone(
      options.consecutiveStrategicDrawsByPlayer || playersMeta.map(() => 0)
    ),
    openingHoldDrawUsed: deepClone(options.openingHoldDrawUsed || playersMeta.map(() => 0))
  };

  if (options.hintMode) {
    gameState.hintMode = true;
    gameState.turnStartRackSize = typeof options.turnStartRackSize === "number"
      ? options.turnStartRackSize
      : rack.length;
    gameState.alreadyReducedRackThisTurn = Boolean(options.alreadyReducedRackThisTurn);
  }

  if (options.includeTileTracker !== false) {
    gameState.tileTracker = buildTileTracker(gameState);
  }

  return gameState;
}

function createHintStateFromGameState(gameState) {
  const hintState = deepClone(gameState);
  hintState.hintMode = true;
  hintState.turnStartRackSize = gameState.currentPlayer.rack.length;
  hintState.alreadyReducedRackThisTurn = false;
  if (!hintState.tileTracker) {
    hintState.tileTracker = buildTileTracker(hintState);
  }
  return hintState;
}

const CASES = [
  {
    name: "new-group-basic",
    state: createGameState({
      aiLevel: 6,
      rack: [
        tile(1, "red", 1),
        tile(2, "blue", 1),
        tile(3, "yellow", 1),
        tile(4, "black", 8),
        tile(5, "black", 9),
        tile(6, "black", 10),
        tile(7, "red", 5),
        tile(8, "yellow", 9)
      ],
      table: [],
      bagCount: 30
    })
  },
  {
    name: "append-existing-group",
    state: createGameState({
      aiLevel: 6,
      rack: [
        tile(11, "blue", 7),
        tile(12, "black", 9),
        tile(13, "red", 1),
        tile(14, "red", 2),
        tile(15, "red", 3),
        tile(16, "yellow", 12)
      ],
      table: [
        [tile(101, "blue", 4), tile(102, "blue", 5), tile(103, "blue", 6)],
        [tile(104, "red", 9), tile(105, "blue", 9), tile(106, "yellow", 9)]
      ],
      bagCount: 22
    })
  },
  {
    name: "rearrange-table",
    state: createGameState({
      aiLevel: 6,
      rack: [
        tile(21, "red", 6),
        tile(22, "blue", 12),
        tile(23, "yellow", 3),
        tile(24, "black", 11)
      ],
      table: [
        [tile(201, "red", 7), tile(202, "blue", 7), tile(203, "yellow", 7), tile(204, "black", 7)],
        [tile(205, "red", 8), tile(206, "red", 9), tile(207, "red", 10)]
      ],
      bagCount: 18
    })
  },
  {
    name: "initial30-opening",
    state: createGameState({
      aiLevel: 6,
      opened: false,
      ruleOptions: { initial30: true, jokers: false },
      rack: [
        tile(31, "red", 10),
        tile(32, "red", 11),
        tile(33, "red", 12),
        tile(34, "black", 8),
        tile(35, "blue", 8),
        tile(36, "yellow", 8),
        tile(37, "black", 2)
      ],
      table: [
        [tile(301, "red", 4), tile(302, "blue", 4), tile(303, "yellow", 4)]
      ],
      baseTableCount: 1,
      bagCount: 20
    })
  },
  {
    name: "strategic-draw",
    state: createGameState({
      aiLevel: 6,
      rack: [
        tile(41, "red", 10),
        tile(42, "red", 11),
        tile(43, "blue", 5),
        tile(44, "yellow", 5),
        tile(45, "red", 7),
        tile(46, "red", 8),
        tile(47, "black", 3),
        tile(48, "yellow", 9),
        tile(49, "blue", 1),
        tile(50, "black", 13)
      ],
      table: [],
      bagCount: 26,
      playersMeta: [
        { index: 0, rackCount: 10, opened: true, type: "HUMAN", aiLevel: 6 },
        { index: 1, rackCount: 9, opened: true, type: "AI", aiLevel: 5 },
        { index: 2, rackCount: 11, opened: true, type: "AI", aiLevel: 3 }
      ]
    }),
    hintState: createGameState({
      aiLevel: 6,
      hintMode: true,
      rack: [
        tile(41, "red", 10),
        tile(42, "red", 11),
        tile(43, "blue", 5),
        tile(44, "yellow", 5),
        tile(45, "red", 7),
        tile(46, "red", 8),
        tile(47, "black", 3),
        tile(48, "yellow", 9),
        tile(49, "blue", 1),
        tile(50, "black", 13)
      ],
      table: [],
      bagCount: 26,
      playersMeta: [
        { index: 0, rackCount: 10, opened: true, type: "HUMAN", aiLevel: 6 },
        { index: 1, rackCount: 9, opened: true, type: "AI", aiLevel: 5 },
        { index: 2, rackCount: 11, opened: true, type: "AI", aiLevel: 3 }
      ]
    })
  },
  {
    name: "joker-meld",
    state: createGameState({
      aiLevel: 6,
      ruleOptions: { jokers: true, initial30: false },
      rack: [
        joker(61),
        tile(62, "red", 12),
        tile(63, "red", 13),
        tile(64, "blue", 9),
        tile(65, "yellow", 9),
        tile(66, "black", 9),
        tile(67, "black", 4)
      ],
      table: [
        [tile(401, "blue", 2), tile(402, "blue", 3), tile(403, "blue", 4)]
      ],
      bagCount: 16
    })
  }
];

function evaluateChoice(context, gameState, level) {
  const stateJson = JSON.stringify(gameState);
  return vm.runInContext(
    `RummyAI.chooseMove(${stateJson}, ${level})`,
    context
  );
}

function evaluateHint(context, gameState) {
  const stateJson = JSON.stringify(gameState);
  return vm.runInContext(
    `RummyHintEngine.getHint(${stateJson})`,
    context
  );
}

function compareOutputs(label, currentValue, legacyValue) {
  assert.equal(
    stableStringify(currentValue),
    stableStringify(legacyValue),
    `${label} mismatch`
  );
}

function run() {
  let checkCount = 0;

  CASES.forEach((testCase, caseIndex) => {
    for (let level = 1; level <= 6; level += 1) {
      const seed = 1000 + (caseIndex * 100) + level;
      const currentContext = loadCurrentContext(seed);
      const legacyContext = loadLegacyContext(seed);
      const moveState = deepClone(testCase.state);
      const currentMove = evaluateChoice(currentContext, moveState, level);
      const legacyMove = evaluateChoice(legacyContext, moveState, level);
      compareOutputs(`${testCase.name} chooseMove level ${level}`, currentMove, legacyMove);
      checkCount += 1;
    }

    const hintSeed = 9000 + caseIndex;
    const currentHintContext = loadCurrentContext(hintSeed);
    const legacyHintContext = loadLegacyContext(hintSeed);
    const hintState = deepClone(testCase.hintState || createHintStateFromGameState(testCase.state));
    const currentHint = evaluateHint(currentHintContext, hintState);
    const legacyHint = evaluateHint(legacyHintContext, hintState);
    compareOutputs(`${testCase.name} getHint`, currentHint, legacyHint);
    checkCount += 1;
  });

  console.log(`Parity smoke passed: ${checkCount} checks across ${CASES.length} cases.`);
}

try {
  run();
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
