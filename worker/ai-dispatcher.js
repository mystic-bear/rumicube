class RummyAI {
  static chooseMove(gameState, level) {
    const targetLevel = Math.max(1, Math.min(6, Number(level) || 1));
    let chosen = null;
    if (targetLevel < 6) {
      chosen = this.chooseLegacy(gameState, targetLevel);
    } else {
      const floorMove = this.chooseLegacy(gameState, 5);
      const expertMove = this.getStrategy(6).chooseMove(gameState);
      if (expertMove) {
        expertMove.engineLevel = 6;
        expertMove.selectedLevel = targetLevel;
      }

      if (!expertMove) {
        chosen = floorMove;
      } else if (!floorMove) {
        chosen = expertMove;
      } else {
        chosen = this.passesLevel6Floor(expertMove, floorMove, gameState) ? expertMove : floorMove;
      }
    }
    if (chosen) chosen.selectedLevel = targetLevel;

    if (targetLevel >= 5) {
      const drawMove = this.chooseStrategicDraw(gameState, chosen, targetLevel);
      if (drawMove) {
        drawMove.engineLevel = targetLevel;
        drawMove.selectedLevel = targetLevel;
        return drawMove;
      }
    }
    return chosen;
  }

  static chooseLegacy(gameState, targetLevel) {
    let bestMove = null;
    let bestLevel = 0;

    for (let currentLevel = 1; currentLevel <= targetLevel; currentLevel += 1) {
      const strategy = this.getStrategy(currentLevel);
      const moveOptions = currentLevel === 1 && targetLevel > 1
        ? { applyBlunder: false }
        : undefined;
      const move = strategy.chooseMove(gameState, moveOptions);
      if (move) move.engineLevel = currentLevel;
      const comparison = this.compareMovePriority(move, bestMove, gameState);
      if (comparison > 0 || (comparison === 0 && move && currentLevel > bestLevel)) {
        bestMove = move;
        bestLevel = currentLevel;
      }
    }

    if (bestMove) {
      bestMove.selectedLevel = targetLevel;
      bestMove.engineLevel = bestLevel;
    }
    return bestMove;
  }

  static getStrategy(level) {
    switch (level) {
      case 1: return new AILevel1Strategy();
      case 2: return new AILevel2Strategy();
      case 3: return new AILevel3Strategy();
      case 4: return new AILevel4Strategy();
      case 5: return new AILevel5Strategy();
      case 6: return new AILevel6Strategy();
      default: return new AILevel1Strategy();
    }
  }

  static compareMovePriority(candidate, current, gameState) {
    const openingRequired = gameState.ruleOptions.initial30 && !gameState.currentPlayer.opened;
    const normalize = (move) => {
      if (!move) {
        return {
          valid: 0,
          openingReady: 0,
          rackReduction: -1,
          stability: -999,
          safeAppend: 0,
          score: -Infinity
        };
      }
      return {
        valid: 1,
        openingReady: openingRequired ? Number((move.openingScore || 0) >= 30) : 1,
        rackReduction: move.rackReduction || 0,
        stability: (move.stableGroups || 0) - (move.fragileGroups || 0) - ((move.stats?.touchedGroups || 0) * 0.25),
        safeAppend: Number(move.type === "append" && (move.stats?.rearrangeCount || 0) === 0),
        actionValue: move.stats?.actionScore || 0
      };
    };

    const a = normalize(candidate);
    const b = normalize(current);
    const keys = ["valid", "openingReady", "rackReduction", "safeAppend", "stability", "actionValue"];
    for (const key of keys) {
      if (a[key] !== b[key]) return a[key] > b[key] ? 1 : -1;
    }
    return 0;
  }

  static isBetterMove(candidate, current, gameState) {
    return this.compareMovePriority(candidate, current, gameState) > 0;
  }

  static passesLevel6Floor(expert, floor, gameState) {
    if (!expert) return false;
    if (!floor) return true;

    const openingRequired = gameState.ruleOptions.initial30 && !gameState.currentPlayer.opened;
    const expertOpeningReady = (expert.openingScore || 0) >= 30;
    const floorOpeningReady = (floor.openingScore || 0) >= 30;
    if (openingRequired && !expertOpeningReady && floorOpeningReady) return false;

    const opponentRacks = gameState.playersMeta
      .filter((_, index) => index !== gameState.turnIndex)
      .map(player => player.rackCount);
    const smallestOpponentRack = opponentRacks.length > 0 ? Math.min(...opponentRacks) : Infinity;

    const stability = (move) =>
      (move.stableGroups || 0) -
      (move.fragileGroups || 0) -
      ((move.stats?.touchedGroups || 0) * 0.25);

    const rackGap = (expert.rackReduction || 0) - (floor.rackReduction || 0);
    const stabilityGap = stability(expert) - stability(floor);
    const touchGap = (expert.stats?.touchedGroups || 0) - (floor.stats?.touchedGroups || 0);
    const mobilityGap = (expert.futureMobility || 0) - (floor.futureMobility || 0);

    if (smallestOpponentRack <= 3 && rackGap < 0) return false;
    if (rackGap <= -2) return false;
    if (stabilityGap < -2) return false;
    if (touchGap > 2 && mobilityGap <= 0) return false;

    return true;
  }

  static buildStrategicState(gameState, move = null) {
    return {
      rack: deepCopy(move ? move.rack : gameState.currentPlayer.rack),
      table: normalizeTableGroups(deepCopy(move ? move.table : gameState.table))
    };
  }

  static computeFuturePotentialForDraw(state) {
    const cache = new Map();
    const rackGroups = RummyAIUtils.getValidGroupsFromTiles(
      state.rack,
      cache,
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

  static collectUsefulDrawKeys(state) {
    const nonJokers = state.rack.filter(tile => !tile.joker);
    const usefulKeys = new Set();
    let nearCompleteCount = 0;

    for (let i = 0; i < nonJokers.length; i += 1) {
      for (let j = i + 1; j < nonJokers.length; j += 1) {
        const a = nonJokers[i];
        const b = nonJokers[j];
        const neededKeys = [];

        if (a.number === b.number && a.color !== b.color) {
          const usedColors = new Set([a.color, b.color]);
          COLORS.forEach(color => {
            if (!usedColors.has(color.key)) neededKeys.push(`${color.key}-${a.number}`);
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
        nearCompleteCount += 1;
        neededKeys.forEach(key => usefulKeys.add(key));
      }
    }

    return {
      nearCompleteCount,
      usefulKeys: [...usefulKeys]
    };
  }

  static computeDrawAwarenessForDecision(state, gameState) {
    const tracker = gameState.tileTracker;
    const pairInfo = this.collectUsefulDrawKeys(state);
    let usefulRemaining = 0;
    let deadKeys = 0;

    if (tracker && tracker.uncertainTotal > 0) {
      pairInfo.usefulKeys.forEach(key => {
        const remaining = tracker.uncertain[key] || 0;
        usefulRemaining += remaining;
        if (remaining === 0) deadKeys += 1;
      });
    }

    return {
      nearCompleteCount: pairInfo.nearCompleteCount,
      usefulKeysCount: pairInfo.usefulKeys.length,
      usefulRemaining,
      deadKeys,
      hitRate: tracker && tracker.uncertainTotal > 0
        ? usefulRemaining / tracker.uncertainTotal
        : 0
    };
  }

  static makeStrategicDrawMove(reasonCode, score, level, meta = {}) {
    const labels = {
      "hold-opening": "등록 보류 드로우",
      "preserve-shape": "구조 보존 드로우",
      "fish-completion": "완성 대기 드로우"
    };
    return {
      type: "draw",
      summary: labels[reasonCode] || "전략 드로우",
      score,
      openingScore: 0,
      rackReduction: 0,
      futureMobility: 0,
      stableGroups: 0,
      fragileGroups: 0,
      stats: {
        actionScore: 0,
        newGroupCount: 0,
        appendCount: 0,
        rearrangeCount: 0,
        touchedGroups: 0,
        jokerRelocationCount: 0,
        jokerEfficiency: 0,
        jokerTrap: 0
      },
      actions: [],
      drawReasonCode: reasonCode,
      drawMeta: meta,
      engineLevel: level
    };
  }

  static chooseStrategicDraw(gameState, bestMove, level) {
    if (level < 5) return null;
    if (!bestMove || bestMove.type === "draw") return null;
    if ((bestMove.rackReduction || 0) >= 3) return null;
    if (gameState.bagCount <= 4) return null;
    if (gameState.currentPlayer.rack.length <= 4) return null;

    const opponentRacks = gameState.playersMeta
      .filter((_, index) => index !== gameState.turnIndex)
      .map(player => player.rackCount);
    const smallestOpponentRack = opponentRacks.length > 0 ? Math.min(...opponentRacks) : Infinity;
    if (smallestOpponentRack <= 3) return null;

    const beforeState = this.buildStrategicState(gameState);
    const afterState = this.buildStrategicState(gameState, bestMove);
    const beforeFuture = this.computeFuturePotentialForDraw(beforeState);
    const afterFuture = this.computeFuturePotentialForDraw(afterState);
    const beforeDraw = this.computeDrawAwarenessForDecision(beforeState, gameState);
    const afterDraw = this.computeDrawAwarenessForDecision(afterState, gameState);
    const futureLoss = Math.max(0, beforeFuture.futureRackReduction - afterFuture.futureRackReduction);
    const appendLoss = Math.max(0, beforeFuture.futureAppendDensity - afterFuture.futureAppendDensity);
    const nearLoss = Math.max(0, beforeDraw.nearCompleteCount - afterDraw.nearCompleteCount);
    const currentRackJokers = gameState.currentPlayer.rack.filter(tile => tile.joker).length;
    const nextRackJokers = (bestMove.rack || []).filter(tile => tile.joker).length;
    const usesRackJoker = nextRackJokers < currentRackJokers;
    const touchedGroups = bestMove.stats?.touchedGroups || 0;

    const chooseIfStrongEnough = (reasonCode, score, meta) =>
      score >= 45 ? this.makeStrategicDrawMove(reasonCode, score, level, {
        ...meta,
        opponentMinRack: smallestOpponentRack,
        bagCount: gameState.bagCount,
        futureLoss,
        appendLoss,
        nearLoss,
        hitRate: beforeDraw.hitRate,
        usefulKeysCount: beforeDraw.usefulKeysCount,
        usefulRemaining: beforeDraw.usefulRemaining
      }) : null;

    if (!gameState.currentPlayer.opened && (bestMove.openingScore || 0) >= 30) {
      const weakOpening = (bestMove.openingScore || 0) <= 33 && (bestMove.rackReduction || 0) <= 2;
      const costlyOpening = usesRackJoker || futureLoss >= 2 || nearLoss >= 2 || touchedGroups >= 2;
      const safeToWait = smallestOpponentRack >= 7 && gameState.bagCount >= 10;
      if (weakOpening && costlyOpening && safeToWait) {
        const score = 25
          + futureLoss * 15
          + nearLoss * 10
          + (usesRackJoker ? 30 : 0)
          + (touchedGroups >= 2 ? 20 : 0)
          + (level >= 6 ? beforeDraw.hitRate * 180 : beforeDraw.nearCompleteCount * 6);
        const move = chooseIfStrongEnough("hold-opening", score, {
          openingScore: bestMove.openingScore || 0,
          usesRackJoker,
          touchedGroups
        });
        if (move) return move;
      }
    }

    if ((bestMove.rackReduction || 0) <= 1 && gameState.bagCount >= 8 && smallestOpponentRack >= 6) {
      const score = 10
        + futureLoss * 15
        + nearLoss * 10
        + appendLoss * 3
        + (usesRackJoker ? 25 : 0)
        + Math.max(0, touchedGroups - 1) * 8;
      const move = chooseIfStrongEnough("preserve-shape", score, {
        usesRackJoker,
        touchedGroups
      });
      if (move) return move;
    }

    if ((bestMove.rackReduction || 0) <= 1 && gameState.bagCount >= 8 && smallestOpponentRack >= 6) {
      const score = level >= 6
        ? beforeDraw.hitRate * 180 + beforeDraw.usefulRemaining * 8 + beforeFuture.futureRackReduction * 6 - beforeDraw.deadKeys * 6
        : beforeDraw.nearCompleteCount * 8 + beforeFuture.futureRackReduction * 10 + beforeFuture.futureAppendDensity * 2;
      const move = chooseIfStrongEnough("fish-completion", score, {
        deadKeys: beforeDraw.deadKeys
      });
      if (move) return move;
    }

    return null;
  }
}

RummyAI.makeStrategicDrawMove = function(reasonCode, score, level, meta = {}) {
  return {
    type: "draw",
    summary: "전략 드로우",
    score,
    drawScore: score,
    openingScore: 0,
    rackReduction: 0,
    futureMobility: 0,
    stableGroups: 0,
    fragileGroups: 0,
    stats: {
      actionScore: 0,
      newGroupCount: 0,
      appendCount: 0,
      rearrangeCount: 0,
      touchedGroups: 0,
      jokerRelocationCount: 0,
      jokerEfficiency: 0,
      jokerTrap: 0
    },
    actions: [],
    drawReasonCode: reasonCode,
    drawMeta: meta,
    engineLevel: level
  };
};

RummyAI.countAppendableRackTilesForDrawState = function(state) {
  const appendable = new Set();
  state.rack.forEach(tile => {
    for (const group of state.table) {
      if (RummyRules.analyzeGroup([...group, tile]).valid) {
        appendable.add(tile.id);
        break;
      }
    }
  });
  return appendable.size;
};

RummyAI.countFragileGroupsForDrawState = function(state) {
  return state.table.filter(group => group.length === 3 && RummyRules.analyzeGroup(group).valid).length;
};

RummyAI.isCleanStrategicDrawBan = function(move, metrics) {
  if ((move.rackReduction || 0) >= 2) return true;

  const safeAppend = move.type === "append" && (move.stats?.rearrangeCount || 0) === 0;
  const appendLike = safeAppend || (
    move.type !== "rearrange"
    && (move.stats?.rearrangeCount || 0) === 0
    && metrics.touchedGroups <= 1
  );

  return appendLike
    && !metrics.usesRackJoker
    && metrics.touchedGroups <= 1
    && metrics.fragileIncrease <= 0;
};

RummyAI.chooseStrategicDraw = function(gameState, bestMove, level) {
  if (level < 5) return null;
  if (!bestMove || bestMove.type === "draw") return null;

  const currentRackCount = gameState.currentPlayer.rack.length;
  if ((bestMove.rack || []).length === 0 || (bestMove.rackReduction || 0) >= currentRackCount) return null;
  if ((bestMove.rackReduction || 0) >= 2) return null;
  if (gameState.bagCount <= 6) return null;
  if (currentRackCount <= 5) return null;

  const opponentRacks = gameState.playersMeta
    .filter((_, index) => index !== gameState.turnIndex)
    .map(player => player.rackCount);
  const smallestOpponentRack = opponentRacks.length > 0 ? Math.min(...opponentRacks) : Infinity;
  if (smallestOpponentRack <= 5) return null;

  const currentStrategicDraws = gameState.consecutiveStrategicDrawsByPlayer?.[gameState.turnIndex] || 0;
  const strategicDrawLimit = level >= 6 ? 2 : 1;
  if (currentStrategicDraws >= strategicDrawLimit) return null;

  const beforeState = this.buildStrategicState(gameState);
  const afterState = this.buildStrategicState(gameState, bestMove);
  const beforeFuture = this.computeFuturePotentialForDraw(beforeState);
  const afterFuture = this.computeFuturePotentialForDraw(afterState);
  const beforeDraw = this.computeDrawAwarenessForDecision(beforeState, gameState);
  const afterDraw = this.computeDrawAwarenessForDecision(afterState, gameState);
  const futureLoss = Math.max(0, beforeFuture.futureRackReduction - afterFuture.futureRackReduction);
  const appendLoss = Math.max(0, beforeFuture.futureAppendDensity - afterFuture.futureAppendDensity);
  const nearLoss = Math.max(0, beforeDraw.nearCompleteCount - afterDraw.nearCompleteCount);
  const currentRackJokers = gameState.currentPlayer.rack.filter(tile => tile.joker).length;
  const nextRackJokers = (bestMove.rack || []).filter(tile => tile.joker).length;
  const usesRackJoker = nextRackJokers < currentRackJokers;
  const touchedGroups = bestMove.stats?.touchedGroups || 0;
  const beforeFragileGroups = this.countFragileGroupsForDrawState(beforeState);
  const afterFragileGroups = this.countFragileGroupsForDrawState(afterState);
  const fragileIncrease = Math.max(0, afterFragileGroups - beforeFragileGroups);
  const beforeFutureMobility = this.countAppendableRackTilesForDrawState(beforeState);
  const futureMobilityLoss = Math.max(0, beforeFutureMobility - (bestMove.futureMobility || 0));

  const metrics = {
    futureLoss,
    appendLoss,
    nearLoss,
    usesRackJoker,
    touchedGroups,
    fragileIncrease,
    futureMobilityLoss
  };
  if (this.isCleanStrategicDrawBan(bestMove, metrics)) return null;

  if ((bestMove.rackReduction || 0) !== 1) return null;
  if (gameState.bagCount < 8) return null;
  if (smallestOpponentRack < 6) return null;
  if (currentRackCount < 6) return null;

  const drawOpportunityBonus = level >= 6
    ? Math.round((beforeDraw.hitRate || 0) * 20)
    : Math.min(12, (beforeDraw.usefulKeysCount || 0) * 2);
  const urgencyPenalty = Math.max(0, 8 - smallestOpponentRack) * 12
    + Math.max(0, 12 - gameState.bagCount) * 6
    + Math.max(0, 7 - currentRackCount) * 4;
  const threshold = 80;
  const baseMeta = {
    openingScore: bestMove.openingScore || 0,
    usesRackJoker,
    touchedGroups,
    futureLoss,
    nearLoss,
    appendLoss,
    opponentMinRack: smallestOpponentRack,
    bagCount: gameState.bagCount,
    fragileIncrease,
    futureMobilityLoss
  };
  const chooseIfStrongEnough = (reasonCode, structuralCost, playAbandonPenalty, meta = {}) => {
    const drawScore = Math.round(structuralCost + drawOpportunityBonus - playAbandonPenalty - urgencyPenalty);
    if (drawScore < threshold) return null;
    return this.makeStrategicDrawMove(reasonCode, drawScore, level, {
      ...baseMeta,
      ...meta
    });
  };

  if (!gameState.currentPlayer.opened) {
    const openingHoldUsed = gameState.openingHoldDrawUsed?.[gameState.turnIndex] || 0;
    const openingScore = bestMove.openingScore || 0;
    const holdSignals = [
      usesRackJoker,
      futureLoss >= 2,
      nearLoss >= 1,
      touchedGroups >= 2,
      fragileIncrease > 0
    ].filter(Boolean).length;
    if (
      openingHoldUsed < 1
      && openingScore >= 30
      && openingScore <= 33
      && (bestMove.rackReduction || 0) <= 2
      && gameState.bagCount >= 10
      && smallestOpponentRack >= 7
      && holdSignals >= 1
    ) {
      const structuralCost = (34 - openingScore) * 12
        + (usesRackJoker ? 28 : 0)
        + futureLoss * 20
        + nearLoss * 18
        + appendLoss * 8
        + Math.max(0, touchedGroups - 1) * 10
        + fragileIncrease * 24
        + futureMobilityLoss * 12
        + 20;
      const playAbandonPenalty = 26
        + Math.max(0, bestMove.futureMobility || 0) * 2
        + Math.max(0, bestMove.stableGroups || 0) * 4
        + Math.max(0, openingScore - 30) * 4;
      const move = chooseIfStrongEnough("hold-opening", structuralCost, playAbandonPenalty);
      if (move) return move;
    }
  }

  const preserveSignals = [
    usesRackJoker,
    futureLoss >= 2,
    nearLoss >= 1,
    appendLoss >= 2,
    touchedGroups >= 2,
    fragileIncrease > 0,
    futureMobilityLoss > 0
  ].filter(Boolean).length;
  if (preserveSignals >= 2) {
    const structuralCost = (usesRackJoker ? 28 : 0)
      + futureLoss * 20
      + nearLoss * 18
      + appendLoss * 10
      + Math.max(0, touchedGroups - 1) * 10
      + fragileIncrease * 24
      + futureMobilityLoss * 12;
    const playAbandonPenalty = 26
      + Math.max(0, bestMove.futureMobility || 0) * 3
      + Math.max(0, bestMove.stableGroups || 0) * 4
      + ((bestMove.type === "append" && (bestMove.stats?.rearrangeCount || 0) === 0) ? 14 : 0);
    const move = chooseIfStrongEnough("preserve-shape", structuralCost, playAbandonPenalty);
    if (move) return move;
  }

  return null;
};
