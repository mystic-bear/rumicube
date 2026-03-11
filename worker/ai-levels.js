class AILevel1Strategy extends AIBaseStrategy {
  constructor() {
    super(1, {
      maxDepth: 1,
      beamWidth: 1,
      maxBranchesPerState: 8,
      maxRackGroupBranches: 8,
      maxAppendBranches: 0,
      maxOpeningGroups: 1,
      maxOpeningSolutions: 6,
      openingQuota: 4,
      newGroupQuota: 4,
      safeAppendQuota: 0,
      appendQuota: 0,
      rearrangeQuota: 0,
      allowRearrange: false,
      blunderRate: 0.30,
      timeLimitMs: 20,
      weights: {
        rackReduction: 80,
        actionScore: 0.8,
        newGroup: 16,
        append: 0,
        rearrange: 0,
        groupDelta: 2,
        coverage: 0,
        jokerKeep: 0,
        jokerSpend: 0,
        orphan: 0,
        tableRisk: 0,
        race: 0,
        openingProgress: 1,
        openingComplete: 320,
        jokerRelocation: 0,
        jokerEfficiency: 0,
        jokerTrap: 0
      }
    });
  }

  chooseMove(gameState, options = {}) {
    const move = super.chooseMove(gameState);
    if (!move) return null;
    if ((move.rackReduction || 0) >= gameState.currentPlayer.rack.length) return move;
    if (options.applyBlunder !== false && Math.random() < (this.config.blunderRate || 0)) return null;
    return move;
  }
}

class AILevel2Strategy extends AIBaseStrategy {
  constructor() {
    super(2, {
      maxDepth: 3,
      beamWidth: 12,
      maxBranchesPerState: 16,
      maxRackGroupBranches: 16,
      maxAppendBranches: 14,
      maxOpeningGroups: 4,
      maxOpeningSolutions: 20,
      openingQuota: 10,
      newGroupQuota: 8,
      safeAppendQuota: 3,
      appendQuota: 8,
      rearrangeQuota: 0,
      allowRearrange: false,
      timeLimitMs: 60,
      weights: {
        rackReduction: 116,
        actionScore: 1.16,
        newGroup: 30,
        append: 24,
        rearrange: 0,
        groupDelta: 8,
        coverage: 5,
        jokerKeep: 10,
        jokerSpend: 8,
        orphan: 6,
        tableRisk: 0,
        race: 2,
        openingProgress: 1.2,
        openingComplete: 440,
        futureMobility: 4,
        stableSplit: 0,
        bridge: 0,
        fragile: 0,
        entropy: 0,
        jokerRelocation: 0,
        jokerEfficiency: 0,
        jokerTrap: 0
      }
    });
  }
}

class AILevel3Strategy extends AIBaseStrategy {
  constructor() {
    super(3, {
      maxDepth: 4,
      beamWidth: 18,
      maxBranchesPerState: 20,
      maxRackGroupBranches: 16,
      maxAppendBranches: 14,
      maxOpeningGroups: 4,
      maxOpeningSolutions: 22,
      openingQuota: 12,
      newGroupQuota: 8,
      safeAppendQuota: 3,
      appendQuota: 8,
      rearrangeQuota: 6,
      allowRearrange: true,
      rearrangeMode: "single",
      maxTouchedGroups: 1,
      maxRackTilesForRearrange: 3,
      maxPoolTiles: 10,
      maxGroupComboBranches: 6,
      maxRackSubsetBranches: 20,
      maxPartitionSolutions: 4,
      maxPartitionSolutionsBridge: 2,
      maxRearrangeBranches: 14,
      maxRemovedPerGroup: 2,
      maxRemovedTableTiles: 2,
      maxSplitGroupSize: 10,
      maxRemovalPlanBranches: 10,
      allowJokerRemoval: false,
      protectedRackSubsetReserve: 3,
      singleQuota: 6,
      protectedRackSubsets: true,
      timeLimitMs: 160,
      weights: {
        rackReduction: 125,
        actionScore: 1.28,
        newGroup: 32,
        append: 22,
        rearrange: 84,
        groupDelta: 10,
        coverage: 8,
        jokerKeep: 14,
        jokerSpend: 18,
        orphan: 15,
        tableRisk: 8,
        race: 5,
        openingProgress: 1.3,
        openingComplete: 470,
        futureMobility: 12,
        stableSplit: 14,
        bridge: 22,
        fragile: 8,
        entropy: 10,
        jokerRelocation: 0,
        jokerEfficiency: 0,
        jokerTrap: 0
      }
    });
  }
}

class AILevel4Strategy extends AIBaseStrategy {
  constructor() {
    super(4, {
      maxDepth: 4,
      beamWidth: 20,
      maxBranchesPerState: 22,
      maxRackGroupBranches: 16,
      maxAppendBranches: 14,
      maxOpeningGroups: 5,
      maxOpeningSolutions: 28,
      openingQuota: 12,
      newGroupQuota: 6,
      safeAppendQuota: 3,
      appendQuota: 5,
      rearrangeQuota: 9,
      allowRearrange: true,
      rearrangeMode: "single+bridge+joker-gap+joker",
      maxTouchedGroups: 2,
      maxRackTilesForRearrange: 3,
      maxPoolTiles: 10,
      maxGroupComboBranches: 8,
      maxRackSubsetBranches: 24,
      maxPartitionSolutions: 6,
      maxPartitionSolutionsBridge: 5,
      maxRearrangeBranches: 16,
      maxRemovedPerGroup: 2,
      maxRemovedTableTiles: 3,
      maxSplitGroupSize: 10,
      maxRemovalPlanBranches: 10,
      allowJokerRemoval: true,
      protectedRackSubsetReserve: 5,
      singleQuota: 4,
      bridgeQuota: 4,
      jokerQuota: 4,
      jokerSubstitutionQuota: 4,
      jokerGapQuota: 4,
      jokerRelocationQuota: 4,
      protectedRackSubsets: true,
      timeLimitMs: 240,
      weights: {
        rackReduction: 135,
        actionScore: 1.35,
        newGroup: 34,
        append: 20,
        rearrange: 104,
        groupDelta: 12,
        coverage: 12,
        jokerKeep: 22,
        jokerSpend: 24,
        orphan: 20,
        tableRisk: 6,
        race: 8,
        openingProgress: 1.35,
        openingComplete: 520,
        futureMobility: 16,
        stableSplit: 18,
        bridge: 28,
        fragile: 10,
        entropy: 8,
        jokerRelocation: 34,
        jokerEfficiency: 18,
        jokerTrap: 12
      }
    });
  }
}

class AILevel5Strategy extends AIBaseStrategy {
  constructor() {
    super(5, {
      maxDepth: 5,
      beamWidth: 30,
      maxBranchesPerState: 26,
      maxRackGroupBranches: 18,
      maxAppendBranches: 16,
      maxOpeningGroups: 6,
      maxOpeningSolutions: 36,
      openingQuota: 14,
      newGroupQuota: 6,
      safeAppendQuota: 4,
      appendQuota: 4,
      rearrangeQuota: 12,
      allowRearrange: true,
      rearrangeMode: "single+bridge+joker-gap+joker+exact",
      maxTouchedGroups: 3,
      maxRackTilesForRearrange: 4,
      maxPoolTiles: 12,
      maxGroupComboBranches: 10,
      maxRackSubsetBranches: 32,
      maxPartitionSolutions: 8,
      maxPartitionSolutionsBridge: 6,
      maxRearrangeBranches: 20,
      maxRemovedPerGroup: 2,
      maxRemovedTableTiles: 4,
      maxSplitGroupSize: 12,
      maxRemovalPlanBranches: 12,
      allowJokerRemoval: true,
      protectedRackSubsetReserve: 6,
      singleQuota: 4,
      bridgeQuota: 4,
      jokerQuota: 6,
      jokerSubstitutionQuota: 4,
      jokerGapQuota: 6,
      jokerRelocationQuota: 4,
      exactQuota: 3,
      protectedRackSubsets: true,
      conditionalSubsetExhaustive: true,
      exhaustiveRackThreshold: 10,
      exhaustivePoolThreshold: 10,
      timeLimitMs: 500,
      weights: {
        rackReduction: 150,
        actionScore: 1.45,
        newGroup: 36,
        append: 22,
        rearrange: 122,
        groupDelta: 14,
        coverage: 16,
        jokerKeep: 30,
        jokerSpend: 30,
        orphan: 24,
        tableRisk: 5,
        race: 12,
        openingProgress: 1.4,
        openingComplete: 580,
        futureMobility: 22,
        stableSplit: 22,
        bridge: 34,
        fragile: 12,
        entropy: 8,
        jokerRelocation: 44,
        jokerEfficiency: 22,
        jokerTrap: 14,
        racePressure: 40,
        emergencyPressure: 80,
        alertPressure: 15,
        finishBonus: 600,
        closingBonus: 10,
        winBonus: 2000,
        futureRackReduction: 18,
        futureAppendDensity: 3,
        nearComplete: 8
      }
    });
  }

  computeFuturePotential(state, ctx) {
    const rackGroups = RummyAIUtils.getValidGroupsFromTiles(
      state.rack,
      ctx.rackGroupCache,
      state.rack.length
    );
    const usedIds = new Set();
    let futureRackReduction = 0;
    for (const group of rackGroups.slice(0, 20)) {
      if (group.ids.every(id => !usedIds.has(id))) {
        group.ids.forEach(id => usedIds.add(id));
        futureRackReduction += group.size;
      }
    }

    let futureAppendDensity = 0;
    outer: for (const tile of state.rack) {
      for (const group of state.table) {
        if (RummyRules.analyzeGroup([...group, tile]).valid) {
          futureAppendDensity += 1;
          if (futureAppendDensity >= 15) break outer;
        }
      }
    }

    let nearCompleteCount = 0;
    const nonJokers = state.rack.filter(tile => !tile.joker);
    for (let i = 0; i < nonJokers.length; i += 1) {
      for (let j = i + 1; j < nonJokers.length; j += 1) {
        const a = nonJokers[i];
        const b = nonJokers[j];
        if (a.number === b.number && a.color !== b.color) {
          nearCompleteCount += 1;
        }
        if (a.color === b.color) {
          const diff = Math.abs(a.number - b.number);
          if (diff === 1 || diff === 2) nearCompleteCount += 1;
        }
      }
    }

    return {
      futureRackReduction,
      futureAppendDensity: Math.min(futureAppendDensity, 15),
      nearCompleteCount: Math.min(nearCompleteCount, 12)
    };
  }

  evaluateState(state, ctx, terminal) {
    let score = super.evaluateState(state, ctx, terminal);
    const w = this.config.weights;
    const rackReduction = ctx.initialRackSize - state.rack.length;
    const opponentRacks = ctx.gameState.playersMeta
      .filter((_, index) => index !== ctx.gameState.turnIndex)
      .map(player => player.rackCount);
    const smallestOpponentRack = opponentRacks.length > 0 ? Math.min(...opponentRacks) : Infinity;

    if (smallestOpponentRack <= 1) {
      score += rackReduction * (w.emergencyPressure || 0);
    } else if (smallestOpponentRack <= 3) {
      score += rackReduction * (w.racePressure || 0);
    } else if (smallestOpponentRack <= 5) {
      score += rackReduction * (w.alertPressure || 0);
    }

    if (state.rack.length === 0) {
      score += w.winBonus || 0;
    } else if (state.rack.length <= 2) {
      score += w.finishBonus || 0;
    } else if (state.rack.length <= 4) {
      score += rackReduction * (w.closingBonus || 0);
    }

    if (terminal && state.rack.length > 0) {
      const potential = this.computeFuturePotential(state, ctx);
      score += potential.futureRackReduction * (w.futureRackReduction || 0);
      score += potential.futureAppendDensity * (w.futureAppendDensity || 0);
      score += potential.nearCompleteCount * (w.nearComplete || 0);
    }

    return score;
  }
}

class AILevel6Strategy extends AIBaseStrategy {
  constructor() {
    super(6, {
      maxDepth: 5,
      beamWidth: 32,
      maxBranchesPerState: 28,
      maxRackGroupBranches: 18,
      maxAppendBranches: 16,
      maxOpeningGroups: 6,
      maxOpeningSolutions: 36,
      openingQuota: 14,
      newGroupQuota: 6,
      safeAppendQuota: 4,
      appendQuota: 4,
      rearrangeQuota: 14,
      allowRearrange: true,
      rearrangeMode: "single+bridge+joker-gap+joker+exact",
      maxTouchedGroups: 3,
      maxRackTilesForRearrange: 4,
      maxPoolTiles: 12,
      maxGroupComboBranches: 10,
      maxRackSubsetBranches: 32,
      maxPartitionSolutions: 8,
      maxPartitionSolutionsBridge: 6,
      maxRearrangeBranches: 22,
      maxRemovedPerGroup: 2,
      maxRemovedTableTiles: 4,
      maxSplitGroupSize: 12,
      maxRemovalPlanBranches: 12,
      allowJokerRemoval: true,
      protectedRackSubsetReserve: 6,
      singleQuota: 4,
      bridgeQuota: 4,
      jokerQuota: 6,
      jokerSubstitutionQuota: 4,
      jokerGapQuota: 6,
      jokerRelocationQuota: 4,
      exactQuota: 4,
      protectedRackSubsets: true,
      conditionalSubsetExhaustive: true,
      exhaustiveRackThreshold: 10,
      exhaustivePoolThreshold: 10,
      timeLimitMs: 600,
      weights: {
        rackReduction: 150,
        actionScore: 1.45,
        newGroup: 36,
        append: 22,
        rearrange: 122,
        groupDelta: 14,
        coverage: 16,
        jokerKeep: 30,
        jokerSpend: 30,
        orphan: 24,
        tableRisk: 5,
        race: 12,
        openingProgress: 1.4,
        openingComplete: 580,
        futureMobility: 22,
        stableSplit: 22,
        bridge: 34,
        fragile: 12,
        entropy: 8,
        jokerRelocation: 44,
        jokerEfficiency: 22,
        jokerTrap: 14,
        racePressure: 90,
        emergencyPressure: 150,
        alertPressure: 30,
        finishBonus: 950,
        closingBonus: 24,
        winBonus: 2000,
        futureRackReduction: 18,
        futureAppendDensity: 3,
        nearComplete: 0,
        drawWeightedNearComplete: 120,
        tileScarcity: 14,
        drawFutility: 20
      }
    });
  }

  chooseMove(gameState) {
    const rackCount = gameState.currentPlayer.rack.length;
    const opponentRacks = gameState.playersMeta
      .filter((_, index) => index !== gameState.turnIndex)
      .map(player => player.rackCount);
    const smallestOpponentRack = opponentRacks.length > 0 ? Math.min(...opponentRacks) : Infinity;
    const shouldBoostEndgame = rackCount <= 7 || smallestOpponentRack <= 4;
    if (!shouldBoostEndgame) return super.chooseMove(gameState);
    const shouldUseEmergencyBoost = rackCount <= 4 || smallestOpponentRack <= 2;

    const previousConfig = this.config;
    this.config = {
      ...previousConfig,
      exactQuota: Math.max(previousConfig.exactQuota || 0, shouldUseEmergencyBoost ? 8 : 7),
      maxRearrangeBranches: Math.max(previousConfig.maxRearrangeBranches || 0, shouldUseEmergencyBoost ? 32 : 30),
      timeLimitMs: Math.max(previousConfig.timeLimitMs || 0, shouldUseEmergencyBoost ? 900 : 850),
      maxPoolTiles: Math.max(previousConfig.maxPoolTiles || 0, 14)
    };

    try {
      return super.chooseMove(gameState);
    } finally {
      this.config = previousConfig;
    }
  }

  computeFuturePotential(state, ctx) {
    const rackGroups = RummyAIUtils.getValidGroupsFromTiles(
      state.rack,
      ctx.rackGroupCache,
      state.rack.length
    );
    const usedIds = new Set();
    let futureRackReduction = 0;
    for (const group of rackGroups.slice(0, 20)) {
      if (group.ids.every(id => !usedIds.has(id))) {
        group.ids.forEach(id => usedIds.add(id));
        futureRackReduction += group.size;
      }
    }

    let futureAppendDensity = 0;
    outer: for (const tile of state.rack) {
      for (const group of state.table) {
        if (RummyRules.analyzeGroup([...group, tile]).valid) {
          futureAppendDensity += 1;
          if (futureAppendDensity >= 15) break outer;
        }
      }
    }

    return {
      futureRackReduction,
      futureAppendDensity: Math.min(futureAppendDensity, 15)
    };
  }

  computeDrawAwareness(state, ctx) {
    const tracker = ctx.gameState.tileTracker;
    const result = { drawWeightedScore: 0, scarcityBonus: 0, futileWaits: 0 };
    if (!tracker || tracker.uncertainTotal <= 0) return result;

    const nonJokers = state.rack.filter(tile => !tile.joker);
    const colorKeys = COLORS.map(color => color.key);

    for (let i = 0; i < nonJokers.length; i += 1) {
      for (let j = i + 1; j < nonJokers.length; j += 1) {
        const a = nonJokers[i];
        const b = nonJokers[j];
        const neededKeys = [];

        if (a.number === b.number && a.color !== b.color) {
          const usedColors = new Set([a.color, b.color]);
          colorKeys.forEach(colorKey => {
            if (!usedColors.has(colorKey)) neededKeys.push(`${colorKey}-${a.number}`);
          });
        }

        if (a.color === b.color) {
          const lo = Math.min(a.number, b.number);
          const hi = Math.max(a.number, b.number);
          if (hi - lo === 1) {
            if (lo > 1) neededKeys.push(`${a.color}-${lo - 1}`);
            if (hi < 13) neededKeys.push(`${a.color}-${hi + 1}`);
          } else if (hi - lo === 2) {
            neededKeys.push(`${a.color}-${lo + 1}`);
          }
        }

        if (neededKeys.length === 0) continue;

        let pairProb = 0;
        let anyAvailable = false;
        neededKeys.forEach(key => {
          const remaining = tracker.uncertain[key] || 0;
          if (remaining > 0) anyAvailable = true;
          pairProb += remaining / tracker.uncertainTotal;
        });
        result.drawWeightedScore += pairProb;
        if (!anyAvailable) result.futileWaits += 1;
      }
    }

    state.rack.forEach(tile => {
      const key = tile.joker ? "joker" : `${tile.color}-${tile.number}`;
      if ((tracker.uncertain[key] || 0) === 0) {
        result.scarcityBonus += 1;
      }
    });

    return result;
  }

  computeGiveawayRisk(table) {
    let endpointRisk = 0;
    let risk = 0;

    table.forEach(group => {
      const info = RummyRules.explainGroup(group);
      if (!info.valid) return;

      const hasJoker = group.some(tile => tile.joker);
      const len = group.length;

      if ((info.kind === "run" || info.kind === "wild") && info.canonicalNumbers.length === len) {
        const first = info.canonicalNumbers[0];
        const last = info.canonicalNumbers[info.canonicalNumbers.length - 1];
        endpointRisk += (first > 1 ? 1 : 0) + (last < 13 ? 1 : 0);
      }

      if (len === 3) {
        risk += 1;
      }

      if (info.kind === "set" && len === 3 && !hasJoker) {
        risk += 1;
      }

      if (hasJoker) {
        risk += len === 3 ? 2 : 1;
      }
    });

    return risk + Math.min(endpointRisk, 6);
  }

  evaluateState(state, ctx, terminal) {
    let score = super.evaluateState(state, ctx, terminal);
    const w = this.config.weights;
    const rackReduction = ctx.initialRackSize - state.rack.length;
    const opponentRacks = ctx.gameState.playersMeta
      .filter((_, index) => index !== ctx.gameState.turnIndex)
      .map(player => player.rackCount);
    const smallestOpponentRack = opponentRacks.length > 0 ? Math.min(...opponentRacks) : Infinity;

    if (smallestOpponentRack <= 1) {
      score += rackReduction * (w.emergencyPressure || 0);
    } else if (smallestOpponentRack <= 3) {
      score += rackReduction * (w.racePressure || 0);
    } else if (smallestOpponentRack <= 5) {
      score += rackReduction * (w.alertPressure || 0);
    }

    if (state.rack.length === 0) {
      score += w.winBonus || 0;
    } else if (state.rack.length <= 2) {
      score += w.finishBonus || 0;
    } else if (state.rack.length <= 4) {
      score += rackReduction * (w.closingBonus || 0);
    }

    if (terminal && state.rack.length > 0) {
      const potential = this.computeFuturePotential(state, ctx);
      score += potential.futureRackReduction * (w.futureRackReduction || 0);
      score += potential.futureAppendDensity * (w.futureAppendDensity || 0);

      const draw = this.computeDrawAwareness(state, ctx);
      score += draw.drawWeightedScore * (w.drawWeightedNearComplete || 0);
      score += draw.scarcityBonus * (w.tileScarcity || 0);
      score -= draw.futileWaits * (w.drawFutility || 0);

      if (smallestOpponentRack <= 4 && rackReduction === 0) {
        score -= 90;
      }
      if (smallestOpponentRack <= 3 && rackReduction === 1) {
        score -= 35;
      }

      const baseGiveawayRisk = ctx.baseGiveawayRisk ?? (ctx.baseGiveawayRisk = this.computeGiveawayRisk(ctx.gameState.table));
      const giveawayDelta = Math.max(0, this.computeGiveawayRisk(state.table) - baseGiveawayRisk);
      if (giveawayDelta > 0) {
        if (smallestOpponentRack <= 6) {
          score -= giveawayDelta * 14;
        } else if (ctx.gameState.bagCount <= 14) {
          score -= giveawayDelta * 8;
        }
      }
    }

    return score;
  }
}


AILevel6Strategy.prototype.ensureAdvancedJokerChainConfig = function() {
  this.config = {
    ...this.config,
    advancedJokerChainQuota: this.config.advancedJokerChainQuota ?? 2,
    advancedJokerChainMaxSupportPlans: this.config.advancedJokerChainMaxSupportPlans ?? 3,
    advancedJokerChainMaxRackSubsetSize: this.config.advancedJokerChainMaxRackSubsetSize ?? 2,
    advancedJokerChainMaxPoolTiles: this.config.advancedJokerChainMaxPoolTiles ?? 5,
    advancedJokerChainMaxSolutions: this.config.advancedJokerChainMaxSolutions ?? 2,
    advancedJokerChainMinRackCount: this.config.advancedJokerChainMinRackCount ?? 0,
    advancedJokerChainOnlyWhenBoosted: this.config.advancedJokerChainOnlyWhenBoosted ?? false
  };
};

AILevel6Strategy.prototype.shouldUseAdvancedJokerChain = function(state, ctx) {
  this.ensureAdvancedJokerChainConfig();
  if (this.isTimedOut(ctx)) return false;
  if ((this.config.maxTouchedGroups || 0) < 3) return false;
  if (!state.opened) return false;
  if (state.table.length < 3) return false;
  if (state.rack.length < (this.config.advancedJokerChainMinRackCount || 0)) return false;

  const hasSingleJokerSource = state.table.some(group => {
    const jokerCount = group.filter(tile => tile.joker).length;
    const analysis = RummyRules.explainGroup(group);
    return jokerCount === 1 && analysis.valid && (analysis.jokerAssignments || []).length > 0;
  });
  if (!hasSingleJokerSource) return false;

  if (!this.config.advancedJokerChainOnlyWhenBoosted) return true;

  const opponentRacks = ctx.gameState.playersMeta
    .filter((_, index) => index !== ctx.gameState.turnIndex)
    .map(player => player.rackCount);
  const smallestOpponentRack = opponentRacks.length > 0 ? Math.min(...opponentRacks) : Infinity;
  return state.rack.length <= 8 || smallestOpponentRack <= 5 || (ctx.gameState.bagCount || 0) <= 18;
};

AILevel6Strategy.prototype.generateAdvancedJokerChainMoves = function(state, ctx) {
  this.ensureAdvancedJokerChainConfig();
  const candidates = [];
  const maxSupportPlans = this.config.advancedJokerChainMaxSupportPlans || 3;
  const maxRackSubsetSize = this.config.advancedJokerChainMaxRackSubsetSize || 2;
  const maxPoolTiles = this.config.advancedJokerChainMaxPoolTiles || 5;
  const maxSolutions = this.config.advancedJokerChainMaxSolutions || 2;

  for (let sourceIndex = 0; sourceIndex < state.table.length; sourceIndex += 1) {
    if (this.isTimedOut(ctx)) break;
    const sourceGroup = state.table[sourceIndex];
    const sourceJokers = sourceGroup.filter(tile => tile.joker);
    if (sourceJokers.length !== 1) continue;

    const sourceAnalysis = RummyRules.explainGroup(sourceGroup);
    if (!sourceAnalysis.valid || !sourceAnalysis.jokerAssignments || sourceAnalysis.jokerAssignments.length === 0) continue;

    const jokerTile = sourceJokers[0];
    const assignments = sourceAnalysis.jokerAssignments.filter(assignment => assignment.tileId === jokerTile.id);
    for (const assignment of assignments) {
      if (this.isTimedOut(ctx)) break;
      const isExactReplacementTile = tile =>
        !tile.joker
        && tile.number === assignment.actsAsNumber
        && (!assignment.actsAsColor || tile.color === assignment.actsAsColor);

      for (let replacementIndex = 0; replacementIndex < state.table.length; replacementIndex += 1) {
        if (this.isTimedOut(ctx)) break;
        if (replacementIndex === sourceIndex) continue;

        const replacementPlans = this.getRemovalPlans(state.table[replacementIndex], ctx, {
          maxRemove: 1,
          maxSolutions: 3,
          allowZero: false
        });

        for (const replacementPlan of replacementPlans) {
          if (this.isTimedOut(ctx)) break;
          if (replacementPlan.removedTiles.length !== 1) continue;
          const replacementDonorTile = replacementPlan.removedTiles[0];
          if (!isExactReplacementTile(replacementDonorTile)) continue;

          const substitutedGroup = normalizeGroupTiles(
            sourceGroup
              .filter(tile => tile.id !== jokerTile.id)
              .concat(replacementDonorTile)
          );
          if (!RummyRules.explainGroup(substitutedGroup).valid) continue;

          for (let supportIndex = 0; supportIndex < state.table.length; supportIndex += 1) {
            if (this.isTimedOut(ctx)) break;
            if (supportIndex === sourceIndex || supportIndex === replacementIndex) continue;

            const supportPlans = this.getRemovalPlans(state.table[supportIndex], ctx, {
              maxRemove: 1,
              maxSolutions: maxSupportPlans,
              allowZero: false
            });

            for (const supportPlan of supportPlans) {
              if (this.isTimedOut(ctx)) break;
              if (supportPlan.removedTiles.length !== 1) continue;
              const supportTile = supportPlan.removedTiles[0];
              if (!supportTile || supportTile.joker) continue;

              const rackSubsets = this.getRearrangementRackSubsets(state, ctx, [jokerTile, supportTile])
                .filter(subset =>
                  subset.size >= 1
                  && subset.size <= maxRackSubsetSize
                  && !subset.ids.includes(replacementDonorTile.id)
                );

              for (const subset of rackSubsets) {
                if (this.isTimedOut(ctx)) break;
                const pool = [jokerTile, supportTile, ...subset.tiles];
                if (pool.length < 3 || pool.length > maxPoolTiles) continue;

                const partitions = RummyAIUtils.findExactCoverPartitions(pool, ctx.poolGroupCache, {
                  maxSolutions
                });

                partitions.slice(0, maxSolutions).forEach(partition => {
                  const chainGroup = partition.groups.find(createdGroup =>
                    createdGroup.some(tile => tile.id === jokerTile.id)
                    && createdGroup.some(tile => tile.id === supportTile.id)
                  );
                  if (!chainGroup) return;

                  const detailText = `${sourceIndex + 1}번 줄의 조커를 ${replacementIndex + 1}번 줄의 ${formatTileText(replacementDonorTile)}로 대체하고, 해방된 조커를 ${supportIndex + 1}번 줄의 ${formatTileText(supportTile)}와 다시 묶으세요.`;
                  const jokerNote = `${sourceIndex + 1}번 줄 조커를 ${replacementIndex + 1}번 줄 타일로 치환한 뒤, ${supportIndex + 1}번 줄 타일과 함께 재활용하세요.`;

                  const candidate = this.createRearrangedState(state, ctx, {
                    mode: "joker-chain",
                    sourceGroupIndices: [sourceIndex, replacementIndex, supportIndex],
                    sourceTableIds: [jokerTile.id, replacementDonorTile.id, supportTile.id],
                    sourceRackIds: subset.ids,
                    retainedGroups: [
                      substitutedGroup,
                      ...deepCopy(replacementPlan.remainingGroups),
                      ...deepCopy(supportPlan.remainingGroups)
                    ],
                    createdGroups: partition.groups,
                    detailText,
                    jokerAssignments: partition.groups.flatMap(createdGroup => RummyRules.explainGroup(createdGroup).jokerAssignments || []),
                    jokerNote,
                    statBoost: {
                      jokerRelocationCount: 1,
                      jokerEfficiency: 3,
                      jokerTrap: partition.groups.some(createdGroup => createdGroup.length === 3) ? 1 : 0
                    }
                  });
                  if (candidate) candidates.push(candidate);
                });
              }
            }
          }
        }
      }
    }
  }

  return candidates;
};

AILevel6Strategy.prototype.generateRearrangementMoves = function(state, ctx) {
  this.ensureAdvancedJokerChainConfig();
  const baseMoves = AIBaseStrategy.prototype.generateRearrangementMoves.call(this, state, ctx);
  if (!this.shouldUseAdvancedJokerChain(state, ctx)) {
    return baseMoves;
  }

  const chainMoves = this.pickQuota(
    this.generateAdvancedJokerChainMoves(state, ctx),
    ctx,
    this.config.advancedJokerChainQuota || 0
  );

  return this.dedupeAndSortCandidates(
    [...baseMoves, ...chainMoves],
    ctx,
    this.config.maxRearrangeBranches
  );
};
