class AIBaseStrategy {
  constructor(level, config) {
    this.level = level;
    this.config = config;
  }

  chooseMove(gameState) {
    const initialState = {
      rack: deepCopy(gameState.currentPlayer.rack),
      table: normalizeTableGroups(deepCopy(gameState.table)),
      opened: gameState.currentPlayer.opened,
      baseTableCount: typeof gameState.baseTableCount === "number"
        ? gameState.baseTableCount
        : gameState.table.length,
      actions: [],
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
      meta: {
        openingGroups: [],
        openingSummaries: [],
        jokerNotes: []
      }
    };

    const ctx = {
      gameState,
      startedAt: Date.now(),
      rackGroupCache: new Map(),
      poolGroupCache: new Map(),
      initialRackSize: initialState.rack.length,
      initialTableSize: initialState.table.length,
      initialJokerCount: initialState.rack.filter(tile => tile.joker).length
    };

    let best = null;
    let frontier = [initialState];
    const seen = new Map();

    for (let depth = 1; depth <= this.config.maxDepth; depth += 1) {
      if (this.isTimedOut(ctx)) break;
      const nextFrontier = [];

      for (const state of frontier) {
        const candidates = this.generateCandidates(state, ctx);
        for (const candidate of candidates) {
          if (this.isTimedOut(ctx)) break;
          const key = RummyAIUtils.serializeState(candidate);
          const value = this.scoreCandidate(candidate, ctx);
          if (seen.has(key) && seen.get(key) >= value) continue;
          seen.set(key, value);
          candidate.evalScore = value;

          if (this.canFinishTurn(candidate, ctx)) {
            candidate.finalScore = this.evaluateState(candidate, ctx, true);
            if (!best || candidate.finalScore > best.finalScore) {
              best = candidate;
            }
          }
          nextFrontier.push(candidate);
        }
        if (this.isTimedOut(ctx)) break;
      }

      if (nextFrontier.length === 0) break;
      nextFrontier.sort((a, b) => b.evalScore - a.evalScore);
      frontier = nextFrontier.slice(0, this.config.beamWidth);
    }

    if (!best) return null;
    return this.buildMove(best, ctx);
  }

  isTimedOut(ctx) {
    return this.config.timeLimitMs && (Date.now() - ctx.startedAt) >= this.config.timeLimitMs;
  }

  modeEnabled(mode) {
    const current = this.config.rearrangeMode || "";
    return current.split("+").includes(mode);
  }

  updateOpenedState(state, ctx) {
    if (state.opened || !ctx.gameState.ruleOptions.initial30) return;
    const openingGroups = state.table.slice(state.baseTableCount);
    if (isInitialOpenSatisfied(openingGroups)) {
      state.opened = true;
    }
  }

  countAppendableRackTiles(state) {
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
  }

  isOpeningPending(ctx) {
    return ctx.gameState.ruleOptions.initial30 && !ctx.gameState.currentPlayer.opened;
  }

  describeGroups(groups) {
    return groups.map(group => {
      const normalized = normalizeGroupTiles(deepCopy(group));
      const analysis = RummyRules.explainGroup(normalized);
      return {
        ids: normalized.map(tile => tile.id),
        tiles: normalized,
        score: analysis.score || 0,
        kind: analysis.kind || null,
        jokerAssignments: deepCopy(analysis.jokerAssignments || []),
        canonicalNumbers: deepCopy(analysis.canonicalNumbers || [])
      };
    });
  }

  createRackOnlyState(state, ctx, groups, options = {}) {
    if (!groups || groups.length === 0) return null;

    const next = RummyAIUtils.cloneState(state);
    const descriptions = this.describeGroups(groups);
    const rackIds = new Set(descriptions.flatMap(group => group.ids));
    next.rack = next.rack.filter(tile => !rackIds.has(tile.id));
    next.table.push(...descriptions.map(group => deepCopy(group.tiles)));
    next.table = normalizeTableGroups(next.table);

    descriptions.forEach(group => {
      next.actions.push({
        type: "new-group",
        sourceRackIds: [...group.ids],
        createdGroupIds: [...group.ids],
        groupScore: group.score,
        kind: group.kind,
        jokerAssignments: deepCopy(group.jokerAssignments),
        canonicalNumbers: deepCopy(group.canonicalNumbers)
      });
    });

    next.stats.actionScore += descriptions.reduce((sum, group) => sum + group.score, 0);
    next.stats.newGroupCount += descriptions.length;
    if (options.recordOpening) {
      const previousGroups = deepCopy(next.meta.openingGroups || []);
      const previousSummaries = deepCopy(next.meta.openingSummaries || []);
      next.meta.openingGroups = [
        ...previousGroups,
        ...descriptions.map(group => deepCopy(group.tiles))
      ];
      next.meta.openingSummaries = [
        ...previousSummaries,
        ...descriptions.map(group => ({
          ids: [...group.ids],
          score: group.score,
          kind: group.kind,
          jokerAssignments: deepCopy(group.jokerAssignments),
          canonicalNumbers: deepCopy(group.canonicalNumbers)
        }))
      ];
    }
    this.updateOpenedState(next, ctx);
    return next;
  }

  getCandidateSortValue(candidate, ctx) {
    return this.scoreCandidate(candidate, ctx);
  }

  dedupeAndSortCandidates(candidates, ctx, limit) {
    const deduped = new Map();
    candidates.forEach(candidate => {
      const key = RummyAIUtils.serializeState(candidate);
      const current = deduped.get(key);
      const value = this.getCandidateSortValue(candidate, ctx);
      if (!current || value > this.getCandidateSortValue(current, ctx)) {
        deduped.set(key, candidate);
      }
    });
    const ordered = [...deduped.values()].sort((a, b) =>
      this.getCandidateSortValue(b, ctx) - this.getCandidateSortValue(a, ctx) ||
      (b.stats.actionScore || 0) - (a.stats.actionScore || 0)
    );
    return typeof limit === "number" ? ordered.slice(0, limit) : ordered;
  }

  isSafeAppendCandidate(candidate) {
    const lastAction = candidate.actions[candidate.actions.length - 1];
    if (!lastAction || lastAction.type !== "append") return false;
    const targetIds = new Set(lastAction.resultGroupIds || []);
    const targetGroup = candidate.table.find(group =>
      group.length === targetIds.size && group.every(tile => targetIds.has(tile.id))
    );
    return !!targetGroup && targetGroup.length >= 4;
  }

  scoreCandidate(state, ctx) {
    if (state.previewScore === undefined) {
      state.previewScore = this.evaluateState(state, ctx, false);
    }
    if (this.isOpeningPending(ctx)) {
      const openingGroups = state.table.slice(state.baseTableCount);
      const openingScore = calculateInitialOpenScore(openingGroups);
      const openingSatisfied = isInitialOpenSatisfied(openingGroups);
      const rackReduction = ctx.initialRackSize - state.rack.length;
      return state.previewScore
        + openingScore * 220
        + rackReduction * 160
        + (openingSatisfied ? 100000 : 0);
    }
    return state.previewScore;
  }

  pickQuota(moves, ctx, quota) {
    if (!moves || moves.length === 0 || quota <= 0) return [];
    moves.forEach(move => {
      move.previewScore = this.scoreCandidate(move, ctx);
    });
    moves.sort((a, b) =>
      (b.previewScore || 0) - (a.previewScore || 0) ||
      (b.stats.actionScore || 0) - (a.stats.actionScore || 0)
    );
    return moves.slice(0, quota);
  }

  getProtectedRackSubsets(state, ctx, tableTiles = []) {
    const all = RummyAIUtils.enumerateRackSubsets(state.rack, this.config.maxRackTilesForRearrange || 0);
    if (!this.config.protectedRackSubsets) return all;

    const tableIds = new Set(tableTiles.map(tile => tile.id));
    const hasTableJoker = tableTiles.some(tile => tile.joker);
    return all.flatMap(subset => {
      const nonJokers = subset.tiles.filter(tile => !tile.joker);
      const sameNumber = nonJokers.length > 1 && new Set(nonJokers.map(tile => tile.number)).size < nonJokers.length;
      const nearRun = nonJokers.length > 1
        && nonJokers.every(tile => tile.color === nonJokers[0].color)
        && (Math.max(...nonJokers.map(tile => tile.number)) - Math.min(...nonJokers.map(tile => tile.number))) <= nonJokers.length + 1;
      const jokerReadyRun = nonJokers.length > 1
        && nonJokers.every(tile => tile.color === nonJokers[0].color)
        && (Math.max(...nonJokers.map(tile => tile.number)) - Math.min(...nonJokers.map(tile => tile.number))) <= nonJokers.length + 2;
      const hasJoker = subset.tiles.some(tile => tile.joker);
      let bridgeable = false;
      let jokerCompletable = false;
      let jokerReplaceable = false;
      if (tableTiles.length > 0) {
        const pool = [...subset.tiles, ...tableTiles];
        const validGroups = RummyAIUtils.getValidGroupsFromTiles(pool, ctx.poolGroupCache, pool.length);
        bridgeable = validGroups.some(group =>
          subset.ids.every(id => group.ids.includes(id)) &&
          group.ids.some(id => tableIds.has(id))
        );
        if (hasTableJoker) {
          jokerCompletable = validGroups.some(group =>
            subset.ids.every(id => group.ids.includes(id)) &&
            group.ids.some(id => tableIds.has(id) && tableTiles.find(tile => tile.id === id)?.joker)
          );
        }
      }

      for (const group of state.table) {
        const analysis = RummyRules.explainGroup(group);
        if (!analysis.valid || !analysis.jokerAssignments || analysis.jokerAssignments.length === 0) continue;
        jokerReplaceable = analysis.jokerAssignments.some(assignment =>
          subset.tiles.some(tile =>
            !tile.joker
            && tile.number === assignment.actsAsNumber
            && (!assignment.actsAsColor || tile.color === assignment.actsAsColor)
          )
        );
        if (jokerReplaceable) break;
      }

      const shouldKeep = sameNumber || nearRun || jokerReadyRun || hasJoker || bridgeable || jokerCompletable || jokerReplaceable;
      if (!shouldKeep) return [];

      const scoreBoost = (jokerReplaceable ? 120 : 0) + (jokerCompletable ? 40 : 0);
      return [{ ...subset, score: subset.score + scoreBoost }];
    });
  }

  getRearrangementRackSubsets(state, ctx, tableTiles = []) {
    const allowExhaustive = this.config.conditionalSubsetExhaustive
      && state.rack.length <= (this.config.exhaustiveRackThreshold || 10)
      && tableTiles.length <= (this.config.exhaustivePoolThreshold || 8);
    const base = allowExhaustive
      ? RummyAIUtils.enumerateRackSubsets(state.rack, this.config.maxRackTilesForRearrange || 0)
      : RummyAIUtils.getRackSubsets(
          state.rack,
          this.config.maxRackTilesForRearrange || 0,
          this.config.maxRackSubsetBranches || 24
        );
    const protectedSubsets = this.getProtectedRackSubsets(state, ctx, tableTiles);
    const reserve = this.config.protectedRackSubsetReserve || 0;
    const protectedMap = new Map();
    protectedSubsets.forEach(subset => {
      protectedMap.set(subset.ids.join("-"), subset);
    });
    const merged = new Map();
    [...base, ...protectedSubsets].forEach(subset => {
      merged.set(subset.ids.join("-"), subset);
    });
    const protectedOrdered = [...protectedMap.values()].sort((a, b) => b.score - a.score || b.size - a.size);
    const selectedProtected = protectedOrdered.slice(0, reserve);
    const reservedKeys = new Set(selectedProtected.map(subset => subset.ids.join("-")));
    const ordered = [...merged.values()]
      .filter(subset => !reservedKeys.has(subset.ids.join("-")))
      .sort((a, b) => b.score - a.score || b.size - a.size);
    const limit = this.config.maxRackSubsetBranches || 24;
    return [
      { ids: [], tiles: [], size: 0, score: 0 },
      ...selectedProtected,
      ...ordered.slice(0, Math.max(0, limit - selectedProtected.length))
    ];
  }

  getRemovalPlans(group, ctx, options = {}) {
    const maxRemove = options.maxRemove ?? 1;
    const allowZero = options.allowZero || false;
    const maxSolutions = options.maxSolutions || 2;
    const plans = [];

    if (allowZero) {
      plans.push({
        removedTiles: [],
        remainingGroups: [normalizeGroupTiles(group)],
        score: RummyRules.analyzeGroup(group).score || 0
      });
    }

    const total = 1 << group.length;
    for (let mask = 1; mask < total; mask += 1) {
      const removedCount = RummyAIUtils.popcount(mask);
      if (removedCount === 0 || removedCount > maxRemove || removedCount >= group.length) continue;
      const removedTiles = [];
      const remainingTiles = [];
      for (let index = 0; index < group.length; index += 1) {
        if (mask & (1 << index)) removedTiles.push(group[index]);
        else remainingTiles.push(group[index]);
      }
      if (!this.config.allowJokerRemoval && removedTiles.some(tile => tile.joker)) continue;
      if (remainingTiles.length > 0 && remainingTiles.length < 3) continue;

      const partitions = remainingTiles.length === 0
        ? [{ groups: [], score: 0 }]
        : RummyAIUtils.findExactCoverPartitions(remainingTiles, ctx.poolGroupCache, { maxSolutions });
      if (partitions.length === 0) continue;

      partitions.slice(0, maxSolutions).forEach(partition => {
        plans.push({
          removedTiles,
          remainingGroups: partition.groups,
          score: (partition.score || 0) + removedTiles.length * 12
        });
      });
    }

    const seen = new Set();
    return plans
      .filter(plan => {
        const key = `${plan.removedTiles.map(tile => tile.id).sort((a, b) => a - b).join(",")}::${serializeTableState(plan.remainingGroups)}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      })
      .sort((a, b) => b.score - a.score || b.removedTiles.length - a.removedTiles.length)
      .slice(0, this.config.maxRemovalPlanBranches || 8);
  }

  createRearrangedState(state, ctx, options) {
    const next = RummyAIUtils.cloneState(state);
    const sourceGroupIndices = options.sourceGroupIndices || [];
    const retainedGroups = options.retainedGroups || [];
    const createdGroups = options.createdGroups || [];
    const sourceRackIds = options.sourceRackIds || [];
    const sourceTableIds = options.sourceTableIds || [];
    const statBoost = options.statBoost || {};

    const comboSet = new Set(sourceGroupIndices);
    next.table = next.table.filter((_, index) => !comboSet.has(index));
    next.table.push(...deepCopy(retainedGroups), ...deepCopy(createdGroups));
    next.table = normalizeTableGroups(next.table);

    if (sourceRackIds.length > 0) {
      const rackIdSet = new Set(sourceRackIds);
      next.rack = next.rack.filter(tile => !rackIdSet.has(tile.id));
    }

    const sameRack = next.rack.length === state.rack.length
      && next.rack.every((tile, index) => tile.id === state.rack[index].id);
    const sameTable = serializeTableState(next.table) === serializeTableState(state.table);
    if (sameRack && sameTable) return null;

    const resultGroups = [...retainedGroups, ...createdGroups].map(group => group.map(tile => tile.id));
    next.actions.push({
      type: "rearrange",
      mode: options.mode || "bridge",
      sourceRackIds: [...sourceRackIds],
      sourceTableIds: [...sourceTableIds],
      sourceGroupIndices: [...sourceGroupIndices],
      resultGroupIds: resultGroups,
      detailText: options.detailText || "",
      jokerAssignments: deepCopy(options.jokerAssignments || [])
    });
    next.stats.actionScore += [...retainedGroups, ...createdGroups]
      .reduce((sum, group) => sum + (RummyRules.explainGroup(group).score || 0), 0);
    next.stats.rearrangeCount += 1;
    next.stats.touchedGroups += sourceGroupIndices.length;
    next.stats.jokerRelocationCount += statBoost.jokerRelocationCount || 0;
    next.stats.jokerEfficiency += statBoost.jokerEfficiency || 0;
    next.stats.jokerTrap += statBoost.jokerTrap || 0;
    if (options.jokerNote) {
      next.meta.jokerNotes = [...(next.meta.jokerNotes || []), options.jokerNote];
    }
    this.updateOpenedState(next, ctx);
    return next;
  }

  canFinishTurn(state, ctx) {
    const reducedDuringSearch = state.rack.length < ctx.initialRackSize;
    const reducedEarlierThisTurn = !!(
      ctx.gameState.hintMode
      && (
        ctx.gameState.alreadyReducedRackThisTurn
        || (
          Number.isInteger(ctx.gameState.turnStartRackSize)
          && ctx.gameState.turnStartRackSize > ctx.initialRackSize
        )
      )
    );
    if (!reducedDuringSearch && !reducedEarlierThisTurn) return false;
    if (state.table.some(group => !RummyRules.analyzeGroup(group).valid)) return false;

    const { ruleOptions, currentPlayer } = ctx.gameState;
    if (!ruleOptions.initial30 || currentPlayer.opened) return true;

    const openingGroups = state.table.slice(state.baseTableCount);
    return isInitialOpenSatisfied(openingGroups);
  }

  evaluateState(state, ctx, terminal) {
    const rackReduction = ctx.initialRackSize - state.rack.length;
    const rackGroups = RummyAIUtils.getValidGroupsFromTiles(state.rack, ctx.rackGroupCache, state.rack.length);
    const coverableIds = new Set();
    rackGroups.slice(0, 24).forEach(group => group.ids.forEach(id => coverableIds.add(id)));
    const orphanCount = state.rack.length - coverableIds.size;
    const remainingJokers = state.rack.filter(tile => tile.joker).length;
    const usedJokers = ctx.initialJokerCount - remainingJokers;
    const groupDelta = state.table.length - ctx.initialTableSize;
    const smallestOpponentRack = Math.min(
      ...ctx.gameState.playersMeta
        .filter((_, index) => index !== ctx.gameState.turnIndex)
        .map(player => player.rackCount)
    );
    const raceAdvantage = smallestOpponentRack - state.rack.length;
    const appendableRackCount = this.countAppendableRackTiles(state);
    const stableGroups = state.table.filter(group => group.length >= 4 && RummyRules.analyzeGroup(group).valid).length;
    const fragileGroups = state.table.filter(group => group.length === 3 && RummyRules.analyzeGroup(group).valid).length;
    const bridgeCompletion = state.stats.rearrangeCount > 0 ? Math.max(0, rackReduction) : 0;
    const entropyPenalty = Math.max(0, state.stats.touchedGroups * 2 - rackReduction - Math.max(0, groupDelta));

    let score = 0;
    if (state.rack.length === 0) score += 10000;
    score += rackReduction * this.config.weights.rackReduction;
    score += state.stats.actionScore * this.config.weights.actionScore;
    score += state.stats.newGroupCount * this.config.weights.newGroup;
    score += state.stats.appendCount * this.config.weights.append;
    score += state.stats.rearrangeCount * this.config.weights.rearrange;
    score += groupDelta * this.config.weights.groupDelta;
    score += coverableIds.size * this.config.weights.coverage;
    score += remainingJokers * this.config.weights.jokerKeep;
    score -= usedJokers * this.config.weights.jokerSpend;
    score -= orphanCount * this.config.weights.orphan;
    score -= state.stats.touchedGroups * this.config.weights.tableRisk;
    score += raceAdvantage * this.config.weights.race;
    score += appendableRackCount * (this.config.weights.futureMobility || 0);
    score += stableGroups * (this.config.weights.stableSplit || 0);
    score += bridgeCompletion * (this.config.weights.bridge || 0);
    score += state.stats.jokerRelocationCount * (this.config.weights.jokerRelocation || 0);
    score += state.stats.jokerEfficiency * (this.config.weights.jokerEfficiency || 0);
    score -= fragileGroups * (this.config.weights.fragile || 0);
    score -= entropyPenalty * (this.config.weights.entropy || 0);
    score -= state.stats.jokerTrap * (this.config.weights.jokerTrap || 0);

    if (ctx.gameState.ruleOptions.initial30 && !ctx.gameState.currentPlayer.opened) {
      const openingGroups = state.table.slice(state.baseTableCount);
      const openingScore = calculateInitialOpenScore(openingGroups);
      score += Math.min(openingScore, 30) * this.config.weights.openingProgress;
      if (isInitialOpenSatisfied(openingGroups)) {
        score += this.config.weights.openingComplete;
      } else if (terminal) {
        score -= 5000;
      }
    }

    return score;
  }

  buildMove(state, ctx) {
    const { ruleOptions, currentPlayer } = ctx.gameState;
    const openingGroups = state.table.slice(state.baseTableCount);
    const openingDetails = (state.meta.openingSummaries && state.meta.openingSummaries.length > 0)
      ? state.meta.openingSummaries.map((group, index) => ({
          ...deepCopy(group),
          tiles: deepCopy(state.meta.openingGroups?.[index] || [])
        }))
      : this.describeGroups(openingGroups);
    const opened = currentPlayer.opened || !ruleOptions.initial30 || isInitialOpenSatisfied(openingGroups);
    const openingScore = calculateInitialOpenScore(openingGroups);
    const rackReduction = ctx.initialRackSize - state.rack.length;
    const futureMobility = this.countAppendableRackTiles(state);
    const stableGroups = state.table.filter(group => group.length >= 4 && RummyRules.analyzeGroup(group).valid).length;
    const fragileGroups = state.table.filter(group => group.length === 3 && RummyRules.analyzeGroup(group).valid).length;
    let summary = `손패 ${rackReduction}장`;
    if (state.stats.rearrangeCount > 0) summary = `재배열 ${rackReduction}장`;
    else if (state.stats.newGroupCount > 1) summary = `복수 새 줄 ${rackReduction}장`;
    else if (state.stats.appendCount > 0 && state.stats.newGroupCount === 0) summary = "줄 추가";
    else if (state.stats.newGroupCount > 0) summary = `새 줄 ${rackReduction}장`;

    return {
      type: state.stats.rearrangeCount > 0 ? "rearrange" : state.stats.newGroupCount > 0 ? "new-group" : "append",
      rack: deepCopy(state.rack),
      table: normalizeTableGroups(deepCopy(state.table)),
      opened,
      summary,
      score: state.finalScore || state.evalScore || 0,
      rackReduction,
      openingScore,
      openingDetails: deepCopy(openingDetails),
      futureMobility,
      stableGroups,
      fragileGroups,
      jokerNotes: deepCopy(state.meta.jokerNotes || []),
      actions: deepCopy(state.actions),
      stats: deepCopy(state.stats)
    };
  }

  generateCandidates(state, ctx) {
    if (this.isOpeningPending(ctx) && !state.opened) {
      const openingMoves = this.generateOpeningMoves(state, ctx);
      return this.pickQuota(
        openingMoves,
        ctx,
        this.config.openingQuota ?? this.config.maxBranchesPerState
      );
    }

    const rackMoves = this.generateRackGroupMoves(state, ctx);
    const appendMoves = this.generateAppendMoves(state, ctx);
    const safeAppendMoves = appendMoves.filter(candidate => this.isSafeAppendCandidate(candidate));
    const safeKeys = new Set(safeAppendMoves.map(candidate => RummyAIUtils.serializeState(candidate)));
    const regularAppendMoves = appendMoves.filter(candidate => !safeKeys.has(RummyAIUtils.serializeState(candidate)));

    const baselineMoves = this.dedupeAndSortCandidates([
      ...this.pickQuota(rackMoves, ctx, this.config.newGroupQuota ?? this.config.maxBranchesPerState),
      ...this.pickQuota(safeAppendMoves, ctx, this.config.safeAppendQuota ?? this.config.appendQuota ?? this.config.maxBranchesPerState),
      ...this.pickQuota(regularAppendMoves, ctx, this.config.appendQuota ?? this.config.maxBranchesPerState)
    ], ctx, this.config.maxBranchesPerState);

    if (!this.config.allowRearrange || !state.opened) {
      return baselineMoves;
    }

    const advancedMoves = this.generateRearrangementMoves(state, ctx);
    return this.dedupeAndSortCandidates([
      ...baselineMoves,
      ...this.pickQuota(advancedMoves, ctx, this.config.rearrangeQuota ?? this.config.maxBranchesPerState)
    ], ctx, this.config.maxBranchesPerState);
  }

  generateOpeningMoves(state, ctx) {
    const groups = RummyAIUtils.getValidGroupsFromTiles(
      state.rack,
      ctx.rackGroupCache,
      state.rack.length
    ).slice(0, this.config.maxOpeningGroupBranches || this.config.maxRackGroupBranches || 20);
    if (groups.length === 0) return [];

    const rackIndexById = new Map(state.rack.map((tile, index) => [tile.id, index]));
    const candidates = groups.map(group => {
      let mask = 0;
      group.ids.forEach(id => {
        mask |= 1 << rackIndexById.get(id);
      });
      return { ...group, mask };
    });
    const byIndex = Array.from({ length: state.rack.length }, () => []);
    candidates.forEach(candidate => {
      for (let index = 0; index < state.rack.length; index += 1) {
        if (candidate.mask & (1 << index)) byIndex[index].push(candidate);
      }
    });
    byIndex.forEach(list => list.sort((a, b) => b.score - a.score || b.size - a.size));

    const seen = new Set();
    const combos = [];
    const maxSolutions = this.config.maxOpeningSolutions || 24;

    const recordCombo = (selected) => {
      if (selected.length === 0) return;
      const groupsToCreate = selected.map(candidate => normalizeGroupTiles(deepCopy(candidate.tiles)));
      const signature = serializeTableState(groupsToCreate);
      if (seen.has(signature)) return;
      seen.add(signature);
      combos.push({
        groups: groupsToCreate,
        score: selected.reduce((sum, candidate) => sum + (candidate.score || 0), 0),
        rackReduction: selected.reduce((sum, candidate) => sum + candidate.size, 0),
        jokerCount: selected.reduce((sum, candidate) => sum + candidate.jokerCount, 0)
      });
    };

    const dfs = (usedMask, selected, depth) => {
      if (this.isTimedOut(ctx) || combos.length >= maxSolutions * 2) return;
      if (selected.length > 0) recordCombo(selected);
      if (depth >= (this.config.maxOpeningGroups || 1)) return;

      let firstOpen = -1;
      for (let index = 0; index < state.rack.length; index += 1) {
        if ((usedMask & (1 << index)) === 0) {
          firstOpen = index;
          break;
        }
      }
      if (firstOpen < 0) return;

      for (const candidate of byIndex[firstOpen]) {
        if ((candidate.mask & usedMask) !== 0) continue;
        selected.push(candidate);
        dfs(usedMask | candidate.mask, selected, depth + 1);
        selected.pop();
        if (this.isTimedOut(ctx) || combos.length >= maxSolutions * 2) return;
      }

      dfs(usedMask | (1 << firstOpen), selected, depth);
    };

    dfs(0, [], 0);

    const ordered = combos
      .sort((a, b) =>
        Number(b.score >= 30) - Number(a.score >= 30) ||
        b.rackReduction - a.rackReduction ||
        b.score - a.score ||
        a.jokerCount - b.jokerCount
      )
      .slice(0, maxSolutions);

    return ordered
      .map(combo => this.createRackOnlyState(state, ctx, combo.groups, { recordOpening: true }))
      .filter(Boolean);
  }

  generateRackGroupMoves(state, ctx) {
    const groups = RummyAIUtils.getValidGroupsFromTiles(state.rack, ctx.rackGroupCache, state.rack.length)
      .slice(0, this.config.maxRackGroupBranches);
    const moves = [];

    groups.forEach(group => {
      const next = this.createRackOnlyState(state, ctx, [group.tiles]);
      if (next) moves.push(next);
    });

    return moves;
  }

  generateAppendMoves(state, ctx) {
    const moves = [];
    const allowBaseTable = state.opened || !ctx.gameState.ruleOptions.initial30;

    for (let groupIndex = 0; groupIndex < state.table.length; groupIndex += 1) {
      if (!allowBaseTable && groupIndex < state.baseTableCount) continue;
      for (const tile of state.rack) {
        const candidate = [...state.table[groupIndex], tile];
        const result = RummyRules.analyzeGroup(candidate);
        if (!result.valid) continue;

        const next = RummyAIUtils.cloneState(state);
        const rackIndex = next.rack.findIndex(current => current.id === tile.id);
        if (rackIndex < 0) continue;
        const [movedTile] = next.rack.splice(rackIndex, 1);
        next.table[groupIndex].push(movedTile);
        next.table[groupIndex] = normalizeGroupTiles(next.table[groupIndex]);
        next.actions.push({
          type: "append",
          sourceRackIds: [tile.id],
          targetGroupIndex: groupIndex,
          resultGroupIds: next.table[groupIndex].map(current => current.id)
        });
        next.stats.actionScore += result.score || 0;
        next.stats.appendCount += 1;
        this.updateOpenedState(next, ctx);
        moves.push(next);
      }
    }

    return moves;
  }

  generateSingleGroupSplitMoves(state, ctx) {
    const candidates = [];
    const maxRemove = this.config.maxRemovedPerGroup || 1;

    for (let groupIndex = 0; groupIndex < state.table.length; groupIndex += 1) {
      const group = state.table[groupIndex];
      if (group.length < 4 || group.length > (this.config.maxSplitGroupSize || 8)) continue;
      const plans = this.getRemovalPlans(group, ctx, { maxRemove, maxSolutions: 2 });
      for (const plan of plans) {
        if (this.isTimedOut(ctx)) break;
        if (plan.removedTiles.length === 0) continue;
        const rackSubsets = this.getRearrangementRackSubsets(state, ctx, plan.removedTiles);
        for (const subset of rackSubsets) {
          if (this.isTimedOut(ctx)) break;
          if (subset.size === 0) continue;
          const pool = [...plan.removedTiles, ...subset.tiles];
          if (pool.length < 3 || pool.length > (this.config.maxPoolTiles || 8)) continue;
          const result = RummyRules.explainGroup(pool);
          if (!result.valid) continue;
          const sourceAnalysis = RummyRules.explainGroup(group);
          const removedJoker = plan.removedTiles.find(tile => tile.joker);
          const sourceRole = removedJoker
            ? (sourceAnalysis.jokerAssignments || []).find(entry => entry.tileId === removedJoker.id)
            : null;
          const targetRole = removedJoker
            ? (result.jokerAssignments || []).find(entry => entry.tileId === removedJoker.id)
            : null;
          const jokerNote = removedJoker
            ? (sourceRole && targetRole
                ? `${groupIndex + 1}번 줄의 조커를 ${sourceRole.actsAsNumber} 역할에서 빼서 ${targetRole.actsAsNumber} 역할 새 줄로 옮기세요.`
                : `${groupIndex + 1}번 줄의 조커를 꺼내 새 줄로 옮기세요.`)
            : "";
          const candidate = this.createRearrangedState(state, ctx, {
            mode: "single",
            sourceGroupIndices: [groupIndex],
            sourceTableIds: plan.removedTiles.map(tile => tile.id),
            sourceRackIds: subset.ids,
            retainedGroups: plan.remainingGroups,
            createdGroups: [normalizeGroupTiles(pool)],
            detailText: jokerNote,
            jokerAssignments: deepCopy(result.jokerAssignments || []),
            jokerNote,
            statBoost: removedJoker
              ? {
                  jokerRelocationCount: 1,
                  jokerEfficiency: Math.max(1, 5 - pool.length),
                  jokerTrap: pool.length === 3 ? 1 : 0
                }
              : {}
          });
          if (candidate) candidates.push(candidate);
        }
      }
    }

    return candidates;
  }

  generateDualGroupBridgeMoves(state, ctx) {
    const candidates = [];
    const combos = RummyAIUtils.getTableGroupCombos(
      state.table,
      Math.min(this.config.maxTouchedGroups || 2, 2),
      this.config.maxGroupComboBranches || 8
    ).filter(combo => combo.indices.length === 2);

    for (const combo of combos) {
      if (this.isTimedOut(ctx)) break;
      const [firstIndex, secondIndex] = combo.indices;
      const firstPlans = this.getRemovalPlans(state.table[firstIndex], ctx, {
        maxRemove: this.config.maxRemovedPerGroup || 1,
        maxSolutions: 2,
        allowZero: true
      });
      const secondPlans = this.getRemovalPlans(state.table[secondIndex], ctx, {
        maxRemove: this.config.maxRemovedPerGroup || 1,
        maxSolutions: 2,
        allowZero: true
      });

      for (const firstPlan of firstPlans) {
        if (this.isTimedOut(ctx)) break;
        for (const secondPlan of secondPlans) {
          if (this.isTimedOut(ctx)) break;
          const removedTiles = [...firstPlan.removedTiles, ...secondPlan.removedTiles];
          if (removedTiles.length === 0 || removedTiles.length > (this.config.maxRemovedTableTiles || 3)) continue;
          const rackSubsets = this.getRearrangementRackSubsets(state, ctx, removedTiles);
          for (const subset of rackSubsets) {
            if (this.isTimedOut(ctx)) break;
            const pool = [...removedTiles, ...subset.tiles];
            if (pool.length < 3 || pool.length > (this.config.maxPoolTiles || 10)) continue;
            const partitions = RummyAIUtils.findExactCoverPartitions(pool, ctx.poolGroupCache, {
              maxSolutions: this.config.maxPartitionSolutionsBridge || 4
            });
            const removedJoker = removedTiles.find(tile => tile.joker);
            partitions.slice(0, this.config.maxPartitionSolutionsBridge || 4).forEach(partition => {
              const targetWithJoker = removedJoker
                ? partition.groups.find(group => group.some(tile => tile.id === removedJoker.id))
                : null;
              const targetAnalysis = targetWithJoker ? RummyRules.explainGroup(targetWithJoker) : null;
              const targetRole = removedJoker && targetAnalysis
                ? (targetAnalysis.jokerAssignments || []).find(entry => entry.tileId === removedJoker.id)
                : null;
              const jokerNote = removedJoker
                ? `${combo.indices.map(index => `${index + 1}번 줄`).join(", ")}에서 뺀 조커를 ${targetRole?.actsAsNumber || "새"} 역할 줄로 재배치하세요.`
                : "";
              const candidate = this.createRearrangedState(state, ctx, {
                mode: "bridge",
                sourceGroupIndices: combo.indices,
                sourceTableIds: removedTiles.map(tile => tile.id),
                sourceRackIds: subset.ids,
                retainedGroups: [...firstPlan.remainingGroups, ...secondPlan.remainingGroups],
                createdGroups: partition.groups,
                detailText: jokerNote,
                jokerAssignments: deepCopy(targetAnalysis?.jokerAssignments || []),
                jokerNote,
                statBoost: removedJoker
                  ? {
                      jokerRelocationCount: 1,
                      jokerEfficiency: Math.max(1, 5 - (targetWithJoker?.length || 4)),
                      jokerTrap: targetWithJoker?.length === 3 ? 1 : 0
                    }
                  : {}
              });
              if (candidate) candidates.push(candidate);
            });
          }
        }
      }
    }

    return candidates;
  }

  generateJokerGapRunMoves(state, ctx) {
    const candidates = [];

    for (let groupIndex = 0; groupIndex < state.table.length; groupIndex += 1) {
      if (this.isTimedOut(ctx)) break;
      const group = state.table[groupIndex];
      const sourceAnalysis = RummyRules.explainGroup(group);
      const jokerTiles = group.filter(tile => tile.joker);
      if (jokerTiles.length === 0 || !sourceAnalysis.valid) continue;

      for (const jokerTile of jokerTiles) {
        const remainingTiles = group.filter(tile => tile.id !== jokerTile.id);
        if (remainingTiles.length < 3) continue;

        const retainedPartitions = RummyAIUtils.findExactCoverPartitions(remainingTiles, ctx.poolGroupCache, {
          maxSolutions: 2
        });
        if (retainedPartitions.length === 0) continue;

        const protectedSubsets = this.getProtectedRackSubsets(state, ctx, [jokerTile])
          .filter(subset => subset.size >= 2 && subset.size <= Math.max(3, this.config.maxRackTilesForRearrange || 3));

        for (const subset of protectedSubsets) {
          if (this.isTimedOut(ctx)) break;
          const nonJokers = subset.tiles.filter(tile => !tile.joker);
          if (nonJokers.length < 2) continue;

          const sameNumber = new Set(nonJokers.map(tile => tile.number)).size === 1;
          const sameColor = nonJokers.every(tile => tile.color === nonJokers[0].color);
          const numbers = nonJokers.map(tile => tile.number).sort((a, b) => a - b);
          const span = numbers[numbers.length - 1] - numbers[0];
          const gapRun = sameColor && (
            (nonJokers.length === 2 && (span === 1 || span === 2)) ||
            (nonJokers.length >= 3 && span <= nonJokers.length)
          );
          const gapSet = sameNumber && new Set(nonJokers.map(tile => tile.color)).size === nonJokers.length;
          if (!gapRun && !gapSet) continue;

          const targetGroup = normalizeGroupTiles([jokerTile, ...subset.tiles]);
          const targetAnalysis = RummyRules.explainGroup(targetGroup);
          if (!targetAnalysis.valid) continue;

          const targetRole = (targetAnalysis.jokerAssignments || []).find(entry => entry.tileId === jokerTile.id);
          if (!targetRole) continue;

          retainedPartitions.slice(0, 2).forEach(partition => {
            const detailText = gapRun
              ? `${formatTileList(nonJokers)} 사이의 빈 칸을 조커로 메워 새 런을 만드세요.`
              : `${formatTileList(nonJokers)}에 조커를 더해 새 세트를 만드세요.`;
            const candidate = this.createRearrangedState(state, ctx, {
              mode: "joker-gap",
              sourceGroupIndices: [groupIndex],
              sourceTableIds: [jokerTile.id],
              sourceRackIds: subset.ids,
              retainedGroups: partition.groups,
              createdGroups: [targetGroup],
              detailText,
              jokerAssignments: deepCopy(targetAnalysis.jokerAssignments || []),
              jokerNote: `${groupIndex + 1}번 줄의 조커를 ${targetRole.actsAsNumber} 역할 gap 완성용으로 옮기세요.`,
              statBoost: {
                jokerRelocationCount: 1,
                jokerEfficiency: 2 + Math.max(0, 3 - subset.size),
                jokerTrap: targetGroup.length === 3 ? 1 : 0
              }
            });
            if (candidate) candidates.push(candidate);
          });
        }
      }
    }

    return candidates;
  }

  generateJokerSubstitutionMoves(state, ctx) {
    const candidates = [];
    const maxSolutions = this.config.maxPartitionSolutionsBridge || this.config.maxPartitionSolutions || 4;

    for (let groupIndex = 0; groupIndex < state.table.length; groupIndex += 1) {
      if (this.isTimedOut(ctx)) break;
      const group = state.table[groupIndex];
      const sourceAnalysis = RummyRules.explainGroup(group);
      if (!sourceAnalysis.valid || !sourceAnalysis.jokerAssignments || sourceAnalysis.jokerAssignments.length === 0) continue;

      for (const assignment of sourceAnalysis.jokerAssignments) {
        if (this.isTimedOut(ctx)) break;
        const jokerTile = group.find(tile => tile.id === assignment.tileId);
        if (!jokerTile) continue;

        const replacements = state.rack.filter(tile =>
          !tile.joker
          && tile.number === assignment.actsAsNumber
          && (!assignment.actsAsColor || tile.color === assignment.actsAsColor)
        );

        for (const replacement of replacements) {
          if (this.isTimedOut(ctx)) break;

          const substitutedGroup = normalizeGroupTiles(
            group
              .filter(tile => tile.id !== jokerTile.id)
              .concat(replacement)
          );
          const substitutedAnalysis = RummyRules.explainGroup(substitutedGroup);
          if (!substitutedAnalysis.valid) continue;

          const externalPlans = [{
            groupIndex: null,
            removedTiles: [],
            remainingGroups: []
          }];

          if ((this.config.maxTouchedGroups || 1) >= 2) {
            for (let otherIndex = 0; otherIndex < state.table.length; otherIndex += 1) {
              if (otherIndex === groupIndex) continue;
              const plans = this.getRemovalPlans(state.table[otherIndex], ctx, {
                maxRemove: this.config.maxRemovedPerGroup || 1,
                maxSolutions: 2,
                allowZero: false
              });
              plans.forEach(plan => {
                if (plan.removedTiles.length === 0) return;
                externalPlans.push({
                  groupIndex: otherIndex,
                  removedTiles: plan.removedTiles,
                  remainingGroups: plan.remainingGroups
                });
              });
            }
          }

          for (const plan of externalPlans) {
            if (this.isTimedOut(ctx)) break;
            const rackSubsets = this.getRearrangementRackSubsets(state, ctx, [jokerTile, ...plan.removedTiles])
              .filter(subset => !subset.ids.includes(replacement.id));

            for (const subset of rackSubsets) {
              if (this.isTimedOut(ctx)) break;
              const pool = [jokerTile, ...plan.removedTiles, ...subset.tiles];
              if (pool.length < 3 || pool.length > (this.config.maxPoolTiles || 10)) continue;

              const partitions = RummyAIUtils.findExactCoverPartitions(pool, ctx.poolGroupCache, {
                maxSolutions
              });

              partitions.slice(0, maxSolutions).forEach(partition => {
                if (!partition.groups.some(createdGroup => createdGroup.some(tile => tile.id === jokerTile.id))) return;

                const sourceGroupIndices = plan.groupIndex === null
                  ? [groupIndex]
                  : [groupIndex, plan.groupIndex];
                const detailText = `${groupIndex + 1}번 줄의 조커를 손패 ${formatTileText(replacement)}로 대체하고, 해방된 조커로 새 줄을 만드세요.`;
                const jokerRoleText = assignment.actsAsColor
                  ? `${assignment.actsAsNumber}${getColorIcon(assignment.actsAsColor)}`
                  : `${assignment.actsAsNumber}`;

                const candidate = this.createRearrangedState(state, ctx, {
                  mode: "joker-sub",
                  sourceGroupIndices,
                  sourceTableIds: [jokerTile.id, ...plan.removedTiles.map(tile => tile.id)],
                  sourceRackIds: [replacement.id, ...subset.ids],
                  retainedGroups: [substitutedGroup, ...plan.remainingGroups],
                  createdGroups: partition.groups,
                  detailText,
                  jokerAssignments: partition.groups.flatMap(createdGroup => RummyRules.explainGroup(createdGroup).jokerAssignments || []),
                  jokerNote: `${groupIndex + 1}번 줄의 조커 ${jokerRoleText} 역할을 ${formatTileText(replacement)}로 치환하고 다른 줄에 재활용하세요.`,
                  statBoost: {
                    jokerRelocationCount: 1,
                    jokerEfficiency: Math.max(2, 6 - (subset.size + plan.removedTiles.length)),
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

    return candidates;
  }

  generateJokerRelocationMoves(state, ctx) {
    const candidates = [];

    for (let groupIndex = 0; groupIndex < state.table.length; groupIndex += 1) {
      if (this.isTimedOut(ctx)) break;
      const group = state.table[groupIndex];
      const sourceAnalysis = RummyRules.explainGroup(group);
      const jokerTiles = group.filter(tile => tile.joker);
      if (jokerTiles.length === 0 || !sourceAnalysis.valid) continue;

      for (const jokerTile of jokerTiles) {
        const remainingTiles = group.filter(tile => tile.id !== jokerTile.id);
        if (remainingTiles.length < 3) continue;

        const remainingPartitions = RummyAIUtils.findExactCoverPartitions(remainingTiles, ctx.poolGroupCache, {
          maxSolutions: 2
        });
        if (remainingPartitions.length === 0) continue;

        const rackSubsets = this.getRearrangementRackSubsets(state, ctx, [jokerTile])
          .filter(subset => subset.size >= 2);

        for (const subset of rackSubsets) {
          if (this.isTimedOut(ctx)) break;
          const targetGroup = normalizeGroupTiles([jokerTile, ...subset.tiles]);
          const targetAnalysis = RummyRules.explainGroup(targetGroup);
          if (!targetAnalysis.valid) continue;

          const sourceRole = (sourceAnalysis.jokerAssignments || []).find(entry => entry.tileId === jokerTile.id);
          const targetRole = (targetAnalysis.jokerAssignments || []).find(entry => entry.tileId === jokerTile.id);
          const createdFragile = targetGroup.length === 3 ? 1 : 0;

          remainingPartitions.slice(0, 2).forEach(partition => {
            const retainedGroups = partition.groups;
            const detailText = sourceRole && targetRole
              ? `${groupIndex + 1}번 줄의 조커를 ${sourceRole.actsAsNumber} 역할에서 빼서 ${targetRole.actsAsNumber} 역할 새 줄로 옮기세요.`
              : `${groupIndex + 1}번 줄의 조커를 꺼내 ${formatTileList(targetGroup)} 형태의 새 줄로 만드세요.`;

            const candidate = this.createRearrangedState(state, ctx, {
              mode: "joker",
              sourceGroupIndices: [groupIndex],
              sourceTableIds: [jokerTile.id],
              sourceRackIds: subset.ids,
              retainedGroups,
              createdGroups: [targetGroup],
              detailText,
              jokerAssignments: deepCopy(targetAnalysis.jokerAssignments || []),
              jokerNote: detailText,
              statBoost: {
                jokerRelocationCount: 1,
                jokerEfficiency: Math.max(1, 5 - targetGroup.length),
                jokerTrap: createdFragile
              }
            });
            if (candidate) candidates.push(candidate);
          });
        }
      }
    }

    return candidates;
  }

  generateExactCoverRearrangementMoves(state, ctx) {
    const groupCombos = RummyAIUtils.getTableGroupCombos(
      state.table,
      this.config.maxTouchedGroups,
      this.config.maxGroupComboBranches
    );
    const candidates = [];

    for (const combo of groupCombos) {
      if (this.isTimedOut(ctx)) break;
      const selectedGroups = combo.indices.map(index => state.table[index]);
      const selectedTiles = selectedGroups.flat();
      const rackSubsets = this.getRearrangementRackSubsets(state, ctx, selectedTiles);

      for (const subset of rackSubsets) {
        if (this.isTimedOut(ctx)) break;
        const pool = [...selectedTiles, ...subset.tiles];
        if (pool.length > (this.config.maxPoolTiles || 12)) continue;

        const partitions = RummyAIUtils.findExactCoverPartitions(pool, ctx.poolGroupCache, {
          maxSolutions: this.config.maxPartitionSolutions
        });

        partitions.slice(0, this.config.maxPartitionSolutions || 6).forEach(partition => {
          const candidate = this.createRearrangedState(state, ctx, {
            mode: "exact",
            sourceGroupIndices: combo.indices,
            sourceTableIds: selectedTiles.map(tile => tile.id),
            sourceRackIds: subset.ids,
            retainedGroups: [],
            createdGroups: partition.groups
          });
          if (candidate) candidates.push(candidate);
        });
      }
    }

    return candidates;
  }

  generateRearrangementMoves(state, ctx) {
    const buckets = [];
    if (this.modeEnabled("single")) {
      buckets.push(...this.pickQuota(
        this.generateSingleGroupSplitMoves(state, ctx),
        ctx,
        this.config.singleQuota ?? this.config.maxRearrangeBranches
      ));
    }
    if (this.modeEnabled("bridge")) {
      buckets.push(...this.pickQuota(
        this.generateDualGroupBridgeMoves(state, ctx),
        ctx,
        this.config.bridgeQuota ?? this.config.maxRearrangeBranches
      ));
    }
    if (this.modeEnabled("joker-gap")) {
      buckets.push(...this.pickQuota(
        this.generateJokerGapRunMoves(state, ctx),
        ctx,
        this.config.jokerGapQuota ?? this.config.jokerQuota ?? this.config.maxRearrangeBranches
      ));
    }
    if (this.modeEnabled("joker")) {
      buckets.push(...this.pickQuota(
        this.generateJokerSubstitutionMoves(state, ctx),
        ctx,
        this.config.jokerSubstitutionQuota ?? this.config.jokerQuota ?? this.config.maxRearrangeBranches
      ));
      buckets.push(...this.pickQuota(
        this.generateJokerRelocationMoves(state, ctx),
        ctx,
        this.config.jokerRelocationQuota ?? this.config.jokerQuota ?? this.config.maxRearrangeBranches
      ));
    }
    if (this.modeEnabled("exact")) {
      buckets.push(...this.pickQuota(
        this.generateExactCoverRearrangementMoves(state, ctx),
        ctx,
        this.config.exactQuota ?? this.config.maxRearrangeBranches
      ));
    }

    return this.dedupeAndSortCandidates(buckets, ctx, this.config.maxRearrangeBranches);
  }
}

AIBaseStrategy.prototype.canFinishTurn = function(state, ctx) {
  const reducedDuringSearch = state.rack.length < ctx.initialRackSize;
  const reducedEarlierThisTurn = !!(
    ctx.gameState.hintMode
    && (
      ctx.gameState.alreadyReducedRackThisTurn
      || (
        Number.isInteger(ctx.gameState.turnStartRackSize)
        && ctx.gameState.turnStartRackSize > ctx.initialRackSize
      )
    )
  );
  if (!reducedDuringSearch && !reducedEarlierThisTurn) return false;
  if (state.table.some(group => !RummyRules.analyzeGroup(group).valid)) return false;

  const { ruleOptions, currentPlayer } = ctx.gameState;
  if (!ruleOptions.initial30 || currentPlayer.opened) return true;

  const openingGroups = state.table.slice(state.baseTableCount);
  return isInitialOpenSatisfied(openingGroups);
};

AIBaseStrategy.prototype.generateJokerSubstitutionMoves = function(state, ctx) {
  const candidates = [];
  const maxSolutions = this.config.maxPartitionSolutionsBridge || this.config.maxPartitionSolutions || 4;

  for (let groupIndex = 0; groupIndex < state.table.length; groupIndex += 1) {
    if (this.isTimedOut(ctx)) break;
    const group = state.table[groupIndex];
    const sourceAnalysis = RummyRules.explainGroup(group);
    if (!sourceAnalysis.valid || !sourceAnalysis.jokerAssignments || sourceAnalysis.jokerAssignments.length === 0) continue;

    for (const assignment of sourceAnalysis.jokerAssignments) {
      if (this.isTimedOut(ctx)) break;
      const jokerTile = group.find(tile => tile.id === assignment.tileId);
      if (!jokerTile) continue;

      const isExactReplacementTile = tile =>
        !tile.joker
        && tile.number === assignment.actsAsNumber
        && (!assignment.actsAsColor || tile.color === assignment.actsAsColor);
      const replacementOptions = state.rack
        .filter(isExactReplacementTile)
        .map(tile => ({
          source: "rack",
          tile,
          donorGroupIndex: null,
          donorRemainingGroups: []
        }));

      if ((this.config.maxTouchedGroups || 1) >= 2) {
        for (let otherIndex = 0; otherIndex < state.table.length; otherIndex += 1) {
          if (otherIndex === groupIndex) continue;
          const donorPlans = this.getRemovalPlans(state.table[otherIndex], ctx, {
            maxRemove: 1,
            maxSolutions: 4,
            allowZero: false
          });
          donorPlans.forEach(plan => {
            if (plan.removedTiles.length !== 1) return;
            const donorTile = plan.removedTiles[0];
            if (!isExactReplacementTile(donorTile)) return;
            replacementOptions.push({
              source: "table",
              tile: donorTile,
              donorGroupIndex: otherIndex,
              donorRemainingGroups: deepCopy(plan.remainingGroups)
            });
          });
        }
      }

      for (const option of replacementOptions) {
        if (this.isTimedOut(ctx)) break;
        const replacement = option.tile;
        const substitutedGroup = normalizeGroupTiles(
          group
            .filter(tile => tile.id !== jokerTile.id)
            .concat(replacement)
        );
        const substitutedAnalysis = RummyRules.explainGroup(substitutedGroup);
        if (!substitutedAnalysis.valid) continue;

        const externalPlans = [{
          groupIndex: null,
          removedTiles: [],
          remainingGroups: []
        }];
        if (option.source === "rack" && (this.config.maxTouchedGroups || 1) >= 2) {
          for (let otherIndex = 0; otherIndex < state.table.length; otherIndex += 1) {
            if (otherIndex === groupIndex) continue;
            const plans = this.getRemovalPlans(state.table[otherIndex], ctx, {
              maxRemove: this.config.maxRemovedPerGroup || 1,
              maxSolutions: 2,
              allowZero: false
            });
            plans.forEach(plan => {
              if (plan.removedTiles.length === 0) return;
              externalPlans.push({
                groupIndex: otherIndex,
                removedTiles: plan.removedTiles,
                remainingGroups: plan.remainingGroups
              });
            });
          }
        }

        for (const plan of externalPlans) {
          if (this.isTimedOut(ctx)) break;
          const seedTableTiles = [jokerTile, ...plan.removedTiles];
          const rackSubsets = this.getRearrangementRackSubsets(state, ctx, seedTableTiles)
            .filter(subset => !subset.ids.includes(replacement.id));

          for (const subset of rackSubsets) {
            if (this.isTimedOut(ctx)) break;
            const pool = [jokerTile, ...plan.removedTiles, ...subset.tiles];
            if (pool.length < 3 || pool.length > (this.config.maxPoolTiles || 10)) continue;

            const partitions = RummyAIUtils.findExactCoverPartitions(pool, ctx.poolGroupCache, {
              maxSolutions
            });

            partitions.slice(0, maxSolutions).forEach(partition => {
              if (!partition.groups.some(createdGroup => createdGroup.some(tile => tile.id === jokerTile.id))) return;

              const replacementLabel = option.source === "table"
                ? `${(option.donorGroupIndex || 0) + 1}번 줄의 ${formatTileText(replacement)}`
                : `손패 ${formatTileText(replacement)}`;
              const sourceGroupIndices = option.source === "table"
                ? [groupIndex, option.donorGroupIndex]
                : (plan.groupIndex === null ? [groupIndex] : [groupIndex, plan.groupIndex]);
              const sourceTableIds = option.source === "table"
                ? [jokerTile.id, replacement.id]
                : [jokerTile.id, ...plan.removedTiles.map(tile => tile.id)];
              const sourceRackIds = option.source === "table"
                ? [...subset.ids]
                : [replacement.id, ...subset.ids];
              const retainedGroups = option.source === "table"
                ? [substitutedGroup, ...deepCopy(option.donorRemainingGroups)]
                : [substitutedGroup, ...plan.remainingGroups];
              const detailText = option.source === "table"
                ? `${groupIndex + 1}번 줄의 조커를 ${replacementLabel}로 대체하고, 해방된 조커를 다시 활용하세요.`
                : `${groupIndex + 1}번 줄의 조커를 ${replacementLabel}로 대체하고, 해방된 조커로 새 줄을 만드세요.`;
              const jokerRoleText = assignment.actsAsColor
                ? `${assignment.actsAsNumber}${getColorIcon(assignment.actsAsColor)}`
                : `${assignment.actsAsNumber}`;
              const jokerNote = option.source === "table"
                ? `${groupIndex + 1}번 줄의 조커 ${jokerRoleText} 역할을 ${replacementLabel}로 치환해 다른 줄에 재활용하세요.`
                : `${groupIndex + 1}번 줄의 조커 ${jokerRoleText} 역할을 ${replacementLabel}로 대체하고 다른 줄에 재사용하세요.`;

              const candidate = this.createRearrangedState(state, ctx, {
                mode: "joker-sub",
                sourceGroupIndices,
                sourceTableIds,
                sourceRackIds,
                retainedGroups,
                createdGroups: partition.groups,
                detailText,
                jokerAssignments: partition.groups.flatMap(createdGroup => RummyRules.explainGroup(createdGroup).jokerAssignments || []),
                jokerNote,
                statBoost: {
                  jokerRelocationCount: 1,
                  jokerEfficiency: Math.max(2, 6 - (subset.size + plan.removedTiles.length)),
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

  return candidates;
};
