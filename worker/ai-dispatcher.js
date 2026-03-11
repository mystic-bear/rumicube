class RummyAI {
  static annotatePartialMove(move, phase = "search") {
    if (!move) return null;
    const annotated = deepCopy(move);
    annotated.searchTruncated = true;
    annotated.partial = true;
    annotated.partialReason = annotated.partialReason || "soft-deadline";
    if (phase && !annotated.searchPhase) annotated.searchPhase = phase;
    return annotated;
  }

  static isDeadlineReached(options = {}) {
    return typeof options.softDeadlineAt === "number" && Date.now() >= options.softDeadlineAt;
  }

  static createReporterProxy(options = {}, handlers = {}) {
    const parentReporter = options.reporter || null;
    return {
      ...options,
      reporter: {
        onProgress(payload) {
          let nextPayload = payload;
          if (typeof handlers.onProgress === "function") {
            nextPayload = handlers.onProgress(payload);
          }
          if (nextPayload && parentReporter?.onProgress) {
            parentReporter.onProgress(nextPayload);
          }
        },
        onMeta(payload) {
          if (typeof handlers.onMeta === "function") {
            handlers.onMeta(payload);
          }
          if (parentReporter?.onMeta) {
            parentReporter.onMeta(payload);
          }
        }
      }
    };
  }

  static chooseMove(gameState, level, options = {}) {
    const targetLevel = Math.max(1, Math.min(6, Number(level) || 1));
    let chosen = null;
    if (targetLevel < 6) {
      chosen = this.chooseLegacy(gameState, targetLevel, options);
    } else {
      let bestLegacySoFar = null;
      let bestExpertSoFar = null;
      let bestChosenSoFar = null;
      let bestFinalSoFar = null;
      const floorMove = this.chooseLegacy(
        gameState,
        5,
        this.createReporterProxy(options, {
          onProgress: (payload) => {
            if (payload?.kind === "move" && payload.move) {
              bestLegacySoFar = payload.move;
            }
            return payload;
          }
        })
      );
      if (floorMove) bestLegacySoFar = floorMove;
      if (this.isDeadlineReached(options)) {
        return this.annotatePartialMove(bestLegacySoFar, floorMove?.searchPhase || "legacy-5");
      }

      const expertMove = this.getStrategy(6).chooseMove(
        gameState,
        this.createReporterProxy(options, {
          onProgress: (payload) => {
            if (payload?.kind !== "move" || !payload.move) return payload;
            bestExpertSoFar = payload.move;
            const candidate = !floorMove || this.passesLevel6Floor(payload.move, floorMove, gameState)
              ? payload.move
              : floorMove;
            bestChosenSoFar = candidate;
            return {
              ...payload,
              move: this.annotatePartialMove(candidate, payload.move.searchPhase || payload.searchPhase || "expert-6"),
              searchPhase: payload.move.searchPhase || payload.searchPhase || "expert-6"
            };
          }
        })
      );
      if (expertMove) {
        expertMove.engineLevel = 6;
        expertMove.selectedLevel = targetLevel;
        bestExpertSoFar = expertMove;
      }

      if (!expertMove) {
        chosen = floorMove;
      } else if (!floorMove) {
        chosen = expertMove;
      } else {
        chosen = this.passesLevel6Floor(expertMove, floorMove, gameState) ? expertMove : floorMove;
      }
      bestChosenSoFar = chosen;
      if (this.isDeadlineReached(options)) {
        return this.annotatePartialMove(
          bestChosenSoFar || bestLegacySoFar || bestExpertSoFar,
          chosen?.searchPhase || expertMove?.searchPhase || floorMove?.searchPhase || "dispatcher-l6"
        );
      }

      if (targetLevel >= 5) {
        const drawMove = this.chooseStrategicDraw(gameState, chosen, targetLevel);
        if (drawMove) {
          drawMove.engineLevel = targetLevel;
          drawMove.selectedLevel = targetLevel;
          bestFinalSoFar = drawMove;
        } else {
          bestFinalSoFar = chosen;
        }
      }

      if (bestFinalSoFar) {
        chosen = bestFinalSoFar;
      } else if (this.isDeadlineReached(options)) {
        return this.annotatePartialMove(
          bestFinalSoFar || bestChosenSoFar || bestLegacySoFar || bestExpertSoFar,
          chosen?.searchPhase || "dispatcher-l6"
        );
      }
    }
    if (chosen) chosen.selectedLevel = targetLevel;

    if (targetLevel >= 5 && targetLevel < 6) {
      if (this.isDeadlineReached(options)) {
        return this.annotatePartialMove(chosen, chosen?.searchPhase || `legacy-${targetLevel}`);
      }
      const drawMove = this.chooseStrategicDraw(gameState, chosen, targetLevel);
      if (drawMove) {
        drawMove.engineLevel = targetLevel;
        drawMove.selectedLevel = targetLevel;
        return drawMove;
      }
    }
    return chosen;
  }

  static chooseLegacy(gameState, targetLevel, options = {}) {
    let bestMove = null;
    let bestLevel = 0;

    for (let currentLevel = 1; currentLevel <= targetLevel; currentLevel += 1) {
      if (this.isDeadlineReached(options)) break;
      const strategy = this.getStrategy(currentLevel);
      const moveOptions = currentLevel === 1 && targetLevel > 1
        ? { applyBlunder: false }
        : undefined;
      const move = strategy.chooseMove(gameState, { ...options, ...(moveOptions || {}) });
      if (move) move.engineLevel = currentLevel;
      if (
        move
        && currentLevel >= 3
        && currentLevel <= 5
        && bestMove
        && !this.passesLegacyFloor(move, bestMove, gameState, currentLevel)
      ) {
        continue;
      }
      const comparison = this.compareMovePriority(move, bestMove, gameState);
      if (comparison > 0 || (comparison === 0 && move && currentLevel > bestLevel)) {
        bestMove = move;
        bestLevel = currentLevel;
      }
      if (bestMove) {
        options.reporter?.onProgress?.({
          kind: "move",
          move: this.annotatePartialMove(bestMove, `legacy-${currentLevel}`),
          searchPhase: `legacy-${currentLevel}`,
          partialReason: "soft-deadline"
        });
      }
      options.reporter?.onMeta?.({
        stage: "legacy",
        level: currentLevel,
        bestLevel
      });
    }

    if (bestMove) {
      bestMove.selectedLevel = targetLevel;
      bestMove.engineLevel = bestLevel;
      if (this.isDeadlineReached(options)) {
        return this.annotatePartialMove(bestMove, `legacy-${bestLevel}`);
      }
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
          safeAppendLike: 0,
          jokerPreserve: 0,
          stability: -999,
          actionValue: -Infinity,
          futureMobility: -Infinity,
          openingScore: -Infinity
        };
      }

      const profile = this.getMoveProfile(move, gameState);
      return {
        valid: 1,
        openingReady: openingRequired ? Number(profile.openingReady) : 1,
        rackReduction: profile.rackReduction,
        safeAppendLike: profile.safeAppendLike,
        jokerPreserve: Number(!profile.usesRackJoker),
        stability: profile.stability,
        actionValue: profile.actionValue,
        futureMobility: profile.futureMobility,
        openingScore: profile.openingScore
      };
    };

    const a = normalize(candidate);
    const b = normalize(current);
    const keys = [
      "valid",
      "openingReady",
      "rackReduction",
      "safeAppendLike",
      "jokerPreserve",
      "stability",
      "actionValue",
      "futureMobility",
      "openingScore"
    ];
    for (const key of keys) {
      if (a[key] !== b[key]) return a[key] > b[key] ? 1 : -1;
    }
    return 0;
  }

  static isBetterMove(candidate, current, gameState) {
    return this.compareMovePriority(candidate, current, gameState) > 0;
  }

  static getMoveProfile(move, gameState) {
    if (!move) {
      return {
        openingReady: false,
        rackReduction: -1,
        openingScore: 0,
        futureMobility: 0,
        actionValue: 0,
        touchedGroups: Infinity,
        rearrangeCount: Infinity,
        stableGroups: 0,
        fragileGroups: Infinity,
        stability: -999,
        usesRackJoker: true,
        safeAppendLike: 0
      };
    }

    const currentRackJokers = gameState.currentPlayer.rack.filter(tile => tile.joker).length;
    const nextRackJokers = (move.rack || []).filter(tile => tile.joker).length;
    const touchedGroups = move.stats?.touchedGroups || 0;
    const rearrangeCount = move.stats?.rearrangeCount || 0;
    const stableGroups = move.stableGroups || 0;
    const fragileGroups = move.fragileGroups || 0;
    const usesRackJoker = nextRackJokers < currentRackJokers;
    const safeAppendLike = Number(
      rearrangeCount === 0
      && touchedGroups <= 1
      && !usesRackJoker
      && (move.type === "append" || move.type === "new-group")
    );

    return {
      openingReady: (move.openingScore || 0) >= 30,
      rackReduction: move.rackReduction || 0,
      openingScore: move.openingScore || 0,
      futureMobility: move.futureMobility || 0,
      actionValue: move.stats?.actionScore || 0,
      touchedGroups,
      rearrangeCount,
      stableGroups,
      fragileGroups,
      stability: stableGroups - fragileGroups - (touchedGroups * 0.25),
      usesRackJoker,
      safeAppendLike
    };
  }

  static passesLegacyFloor(candidate, floor, gameState, level) {
    if (!candidate) return false;
    if (!floor) return true;

    const openingRequired = gameState.ruleOptions.initial30 && !gameState.currentPlayer.opened;
    const candidateProfile = this.getMoveProfile(candidate, gameState);
    const floorProfile = this.getMoveProfile(floor, gameState);
    const rackGain = candidateProfile.rackReduction - floorProfile.rackReduction;
    const openingGain = candidateProfile.openingScore - floorProfile.openingScore;
    const mobilityGain = candidateProfile.futureMobility - floorProfile.futureMobility;
    const stabilityGain = candidateProfile.stability - floorProfile.stability;
    const overrideAllowed = (
      rackGain >= 1
      || openingGain >= 4
      || mobilityGain >= 3
      || stabilityGain >= 2
    );

    if (openingRequired && floorProfile.openingReady && !candidateProfile.openingReady) {
      return false;
    }
    if (candidateProfile.rackReduction < floorProfile.rackReduction) {
      return false;
    }
    if (
      floorProfile.safeAppendLike
      && (candidateProfile.rearrangeCount > 0 || candidateProfile.usesRackJoker)
      && rackGain <= 0
      && openingGain <= 0
    ) {
      return false;
    }
    if (
      candidateProfile.fragileGroups > floorProfile.fragileGroups
      && rackGain <= 0
      && !overrideAllowed
    ) {
      return false;
    }
    if (
      !floorProfile.usesRackJoker
      && candidateProfile.usesRackJoker
      && openingGain <= 0
      && rackGain <= 0
      && !overrideAllowed
    ) {
      return false;
    }

    return true;
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

  static classifyUsefulDrawKeys(state) {
    const nonJokers = state.rack.filter(tile => !tile.joker);
    const exactCompletionKeys = new Set();
    const extensionKeys = new Set();
    const setCompletionKeys = new Set();
    const runCompletionKeys = new Set();
    const duplicateOnlyKeys = new Set();
    const rackKeyCounts = new Map();
    let nearCompleteCount = 0;

    const addExtensionKey = (key) => {
      if (!exactCompletionKeys.has(key)) {
        extensionKeys.add(key);
      }
    };

    nonJokers.forEach(tile => {
      const tileKey = `${tile.color}-${tile.number}`;
      rackKeyCounts.set(tileKey, (rackKeyCounts.get(tileKey) || 0) + 1);
    });

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
          neededKeys.forEach(key => {
            exactCompletionKeys.add(key);
            setCompletionKeys.add(key);
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
          } else if (hi - lo === 3) {
            neededKeys.push(`${a.color}-${lo + 1}`);
            neededKeys.push(`${a.color}-${hi - 1}`);
          }
          neededKeys.forEach(key => {
            if (hi - lo <= 2) {
              exactCompletionKeys.add(key);
              runCompletionKeys.add(key);
            } else {
              addExtensionKey(key);
            }
          });
        }

        if (neededKeys.length > 0) {
          nearCompleteCount += 1;
        }
      }
    }

    nonJokers.forEach(tile => {
      COLORS.forEach(color => {
        if (color.key !== tile.color) addExtensionKey(`${color.key}-${tile.number}`);
      });
      if (tile.number > 1) addExtensionKey(`${tile.color}-${tile.number - 1}`);
      if (tile.number < 13) addExtensionKey(`${tile.color}-${tile.number + 1}`);
    });

    extensionKeys.forEach(key => {
      if (exactCompletionKeys.has(key)) return;
      if (rackKeyCounts.has(key)) {
        duplicateOnlyKeys.add(key);
      }
    });

    return {
      nearCompleteCount,
      exactCompletionKeys: [...exactCompletionKeys],
      extensionKeys: [...extensionKeys],
      setCompletionKeys: [...setCompletionKeys],
      runCompletionKeys: [...runCompletionKeys],
      duplicateOnlyKeys: [...duplicateOnlyKeys]
    };
  }

  static computeDrawAwarenessForDecision(state, gameState) {
    const tracker = gameState.tileTracker;
    const classification = this.classifyUsefulDrawKeys(state);
    const exactKeySet = new Set(classification.exactCompletionKeys);
    const extensionKeySet = new Set(classification.extensionKeys);
    const setKeySet = new Set(classification.setCompletionKeys);
    const runKeySet = new Set(classification.runCompletionKeys);
    const duplicateKeySet = new Set(classification.duplicateOnlyKeys);
    const usefulKeySet = new Set([...exactKeySet, ...extensionKeySet]);
    const keyMetrics = [];
    let usefulRemaining = 0;
    let deadKeys = 0;
    let weightedHitMass = 0;

    usefulKeySet.forEach(key => {
      const remaining = tracker?.uncertain?.[key] || 0;
      const weight = (
        (exactKeySet.has(key) ? 3.8 : 0)
        + (setKeySet.has(key) ? 0.8 : 0)
        + (runKeySet.has(key) ? 0.9 : 0)
        + (extensionKeySet.has(key) ? 1.4 : 0)
        - (duplicateKeySet.has(key) ? 0.35 : 0)
      );
      usefulRemaining += remaining;
      if (remaining === 0) deadKeys += 1;
      weightedHitMass += remaining * Math.max(0.5, weight);
      keyMetrics.push({
        key,
        remaining,
        weight: Math.max(0.5, weight),
        isExact: exactKeySet.has(key),
        isExtension: extensionKeySet.has(key),
        isSetCompletion: setKeySet.has(key),
        isRunCompletion: runKeySet.has(key),
        isDuplicateOnly: duplicateKeySet.has(key)
      });
    });

    return {
      nearCompleteCount: classification.nearCompleteCount,
      usefulKeysCount: usefulKeySet.size,
      usefulRemaining,
      deadKeys,
      hitRate: tracker && tracker.uncertainTotal > 0
        ? usefulRemaining / tracker.uncertainTotal
        : 0,
      weightedHitMass: tracker && tracker.uncertainTotal > 0
        ? weightedHitMass / tracker.uncertainTotal
        : weightedHitMass,
      exactCompletionKeys: classification.exactCompletionKeys,
      extensionKeys: classification.extensionKeys,
      setCompletionKeys: classification.setCompletionKeys,
      runCompletionKeys: classification.runCompletionKeys,
      duplicateOnlyKeys: classification.duplicateOnlyKeys,
      keyMetrics
    };
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

RummyAI.getStrategicDrawThreshold = function(reasonCode, level) {
  if (reasonCode === "hold-opening") return 112;
  if (reasonCode === "preserve-shape") return 88;
  if (reasonCode === "fish-completion") return level >= 6 ? 78 : Number.POSITIVE_INFINITY;
  return 90;
};

RummyAI.estimateDrawEV = function(beforeDraw, gameState, bestMove, metrics, reasonCode, level) {
  const keyMetrics = beforeDraw.keyMetrics || [];
  const weightedMassValues = [];
  let completionEV = 0;
  let extensionEV = 0;

  keyMetrics.forEach(entry => {
    const mass = entry.remaining * entry.weight;
    if (mass <= 0) return;
    weightedMassValues.push(mass);

    if (entry.isExact) {
      completionEV += mass * (entry.isSetCompletion ? 11 : 12);
    } else if (entry.isSetCompletion || entry.isRunCompletion) {
      completionEV += mass * 8;
    }

    if (entry.isExtension) {
      extensionEV += mass * (entry.isDuplicateOnly ? 2.5 : 5.5);
    }
  });

  const weightedHitMass = Number((beforeDraw.weightedHitMass || 0).toFixed(4));
  const totalMass = weightedMassValues.reduce((sum, value) => sum + value, 0);
  const sortedMass = weightedMassValues.sort((a, b) => b - a);
  const topOneShare = totalMass > 0 ? (sortedMass[0] || 0) / totalMass : 0;
  const topTwoShare = totalMass > 0 ? ((sortedMass[0] || 0) + (sortedMass[1] || 0)) / totalMass : 0;
  const concentrationRisk = Math.round(topOneShare * 24 + topTwoShare * 12);
  const deadKeyPenalty = beforeDraw.usefulKeysCount > 0
    ? Math.round((beforeDraw.deadKeys / beforeDraw.usefulKeysCount) * 28)
    : 0;
  const strategicDrawCountBefore = gameState.consecutiveStrategicDrawsByPlayer?.[gameState.turnIndex] || 0;
  const openingHoldUsedBefore = gameState.openingHoldDrawUsed?.[gameState.turnIndex] || 0;

  let tempoPenalty = Math.max(0, 12 - gameState.bagCount) * 5
    + Math.max(0, 8 - metrics.opponentMinRack) * 14
    + strategicDrawCountBefore * 18
    + openingHoldUsedBefore * 10;
  if (reasonCode === "hold-opening") {
    tempoPenalty += 18;
  } else if (reasonCode === "fish-completion" && level >= 6) {
    tempoPenalty = Math.max(0, tempoPenalty - 8);
  }

  let abandonCost = (bestMove.rackReduction || 0) * 22
    + metrics.futureLoss * 16
    + metrics.appendLoss * 10
    + metrics.nearLoss * 14
    + (metrics.usesRackJoker ? 22 : 0)
    + Math.max(0, metrics.touchedGroups - 1) * 8
    + metrics.fragileIncrease * 20
    + metrics.futureMobilityLoss * 12;

  if (reasonCode === "hold-opening") {
    abandonCost += Math.max(0, (bestMove.openingScore || 0) - 30) * 10;
  } else if (reasonCode === "preserve-shape") {
    abandonCost += Math.max(0, bestMove.futureMobility || 0) * 3;
  } else if (reasonCode === "fish-completion") {
    abandonCost += Math.max(0, bestMove.futureMobility || 0) * 2;
  }

  const reasonBonus = reasonCode === "hold-opening"
    ? 10
    : reasonCode === "fish-completion" && level >= 6
      ? 6
      : 0;
  const thresholdUsed = this.getStrategicDrawThreshold(reasonCode, level);
  const totalEV = Math.round(
    completionEV
      + extensionEV
      + (weightedHitMass * 42)
      + reasonBonus
      - tempoPenalty
      - abandonCost
      - concentrationRisk
      - deadKeyPenalty
  );

  return {
    completionEV: Math.round(completionEV),
    extensionEV: Math.round(extensionEV),
    weightedHitMass,
    tempoPenalty,
    abandonCost,
    concentrationRisk,
    deadKeyPenalty,
    thresholdUsed,
    strategicDrawCountBefore,
    openingHoldUsedBefore,
    totalEV
  };
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
    futureMobilityLoss,
    opponentMinRack: smallestOpponentRack
  };
  if (this.isCleanStrategicDrawBan(bestMove, metrics)) return null;

  if ((bestMove.rackReduction || 0) !== 1) return null;
  if (gameState.bagCount < 8) return null;
  if (smallestOpponentRack < 6) return null;
  if (currentRackCount < 6) return null;

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
    futureMobilityLoss,
    hitRate: beforeDraw.hitRate,
    usefulKeysCount: beforeDraw.usefulKeysCount,
    usefulRemaining: beforeDraw.usefulRemaining,
    exactCompletionKeys: beforeDraw.exactCompletionKeys,
    extensionKeys: beforeDraw.extensionKeys,
    setCompletionKeys: beforeDraw.setCompletionKeys,
    runCompletionKeys: beforeDraw.runCompletionKeys,
    duplicateOnlyKeys: beforeDraw.duplicateOnlyKeys
  };
  const chooseIfStrongEnough = (reasonCode, meta = {}) => {
    const estimate = this.estimateDrawEV(beforeDraw, gameState, bestMove, metrics, reasonCode, level);
    if (estimate.totalEV < estimate.thresholdUsed) return null;
    return this.makeStrategicDrawMove(reasonCode, estimate.totalEV, level, {
      ...baseMeta,
      ...estimate,
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
      const move = chooseIfStrongEnough("hold-opening", {
        openingHoldUsedBefore: gameState.openingHoldDrawUsed?.[gameState.turnIndex] || 0
      });
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
    const move = chooseIfStrongEnough("preserve-shape");
    if (move) return move;
  }

  if (
    level >= 6
    && beforeDraw.exactCompletionKeys.length > 0
    && beforeDraw.usefulRemaining > 0
    && beforeDraw.deadKeys < beforeDraw.usefulKeysCount
  ) {
    const move = chooseIfStrongEnough("fish-completion", {
      deadKeys: beforeDraw.deadKeys
    });
    if (move) return move;
  }

  return null;
};
