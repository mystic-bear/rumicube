class AIBaseStrategy {
  constructor(level, config) {
    this.level = level;
    this.config = config;
  }

  chooseMove(gameState, options = {}) {
    const initialState = this.createInitialState(gameState);
    const ctx = this.createSearchContext(gameState, initialState, options);
    const searchSchedule = this.buildSearchSchedule(gameState, ctx);
    let best = null;
    let emergencyBest = null;
    let completedAllPasses = true;

    for (const passConfig of searchSchedule) {
      if (this.isTimedOut(ctx)) break;
      ctx.searchPhase = `beam-d${passConfig.maxDepth}-b${passConfig.beamWidth}`;

      const passResult = this.runBeamPass(initialState, ctx, passConfig);
      if (!emergencyBest && passResult.best) {
        emergencyBest = passResult.best;
      }

      if (passResult.completed) {
        if (passResult.best && (!best || this.compareCandidateOrder(passResult.best, best, ctx, "finalScore") < 0)) {
          this.recordExactFinalLoss(ctx, best, passResult.best, "post-pass-choice");
          best = passResult.best;
        }
        if (best) {
          this.reportProgress(
            ctx,
            {
              kind: "move",
              move: this.buildProgressMove(best, ctx, `pass-d${passConfig.maxDepth}`),
              searchPhase: `pass-d${passConfig.maxDepth}`,
              partialReason: "soft-deadline"
            },
            true
          );
        }
        continue;
      }

      if (!best && passResult.best) {
        emergencyBest = passResult.best;
      }
      completedAllPasses = false;
      break;
    }

    const finalBest = best || emergencyBest;
    if (!completedAllPasses || ctx.truncatedReason) {
      this.markSoftDeadline(ctx);
    }
    if (!finalBest) return null;
    const move = this.buildMove(finalBest, ctx);
    if (!completedAllPasses || ctx.truncatedReason) {
      move.searchTruncated = true;
      move.partial = true;
      move.partialReason = ctx.truncatedReason || "soft-deadline";
      move.searchPhase = move.searchPhase || ctx.searchPhase || "beam-search";
    }
    return move;
  }

  createInitialState(gameState) {
    return {
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
        jokerTrap: 0,
        chainAppendCount: 0,
        chainAppendMultiRecipient: 0,
        chainAppendSameRecipientDouble: 0,
        chainAppendTailBuilt: 0,
        chainRepairFinishable: 0,
        chainRepairRollbackUsed: 0,
        chainRepairDonorClosed: 0,
        chainTailClosed: 0,
        chainTailClosedWithRack: 0,
        chainTailClosedAfterRollback: 0
      },
      meta: {
        openingGroups: [],
        openingSummaries: [],
        jokerNotes: []
      }
    };
  }

  createSearchContext(gameState, initialState, options = {}) {
    const startedAt = Date.now();
    const fallbackDeadline = this.config.timeLimitMs ? startedAt + this.config.timeLimitMs : Infinity;
    const crowdedThreshold = this.config.complexityCaps?.crowdedTableThreshold || 8;
    const debugEnabled = !!gameState?.aiDebug;
    const debugStats = options.debugStats || (debugEnabled ? {
      crowded: initialState.table.length >= crowdedThreshold,
      generated: { exact: 0, chain: 0 },
      afterQuota: { exact: 0, chain: 0 },
      afterReserve: { exact: 0, chain: 0 },
      finishableSeen: { exact: 0, chain: 0 },
      finalChosen: { exact: 0, chain: 0 },
      nullReason: { noCandidates: 0, noFinishable: 0, softDeadline: 0 },
      rejectReason: {
        legacyFloor_exact: 0,
        legacyFloor_chain: 0,
        level6Floor_exact: 0,
        level6Floor_chain: 0,
        strategicDraw_exact: 0,
        strategicDraw_chain: 0
      },
      topCandidateSeen: { exact: 0, chain: 0 },
      chainFinishReject: {
        tailMissing: 0,
        leftoverFreeTiles: 0,
        invalidRetained: 0,
        invalidRecipient: 0,
        noRepairFound: 0,
        tailClosureLowPotential: 0
      },
      chainRepair: {
        donorReclosed: 0,
        recipientRollback: 0,
        recipientRollbackTailAware: 0,
        microTailBuilt: 0,
        repairedFinishable: 0,
        retainedAssistTail: 0,
        freeOnlyTail: 0,
        freePlusRackTail: 0
      },
      exactFinalLoss: {
        lostToAppend: 0,
        lostToSingle: 0,
        lostToBridge: 0,
        lostToChain: 0,
        lostToJoker: 0,
        lostToNonExactSameScoreBand: 0
      },
      exactLastLoss: {
        seen: false,
        phase: null,
        exactScore: null,
        exactRackReduction: null,
        exactFutureMobility: null,
        exactTouchedGroups: null,
        exactActions: null,
        winnerMode: null,
        winnerScore: null,
        winnerRackReduction: null,
        winnerFutureMobility: null,
        winnerTouchedGroups: null,
        scoreGap: null
      },
      finalSelectionReason: {
        exactReachedDispatcher: 0,
        exactChosenAtDispatcher: 0,
        exactLostAtDispatcher: 0
      },
      nullDetail: {
        noGeneratedCandidates: 0,
        noRearrangementCandidates: 0,
        beamNoFinishable: 0,
        timeoutNoFinishableEver: 0,
        timeoutAfterSomeFinishable: 0,
        openingConstraint: 0
      },
      timing: {
        firstCandidateAtMs: null,
        firstFinishableAtMs: null,
        bestUpdateCount: 0,
        finishableCount: 0
      },
      _meta: {
        anyCandidates: false,
        anyFinishable: false,
        softDeadline: false,
        anyGeneratedCandidates: false,
        anyBaselineCandidates: false,
        anyRearrangementCandidates: false,
        openingPending: !!gameState?.ruleOptions?.initial30 && !gameState?.currentPlayer?.opened
      }
    } : null);
    const featureFlags = {
      chainRepair: options.featureFlags?.chainRepair !== false,
      exactSelectionTuning: options.featureFlags?.exactSelectionTuning !== false
    };
    return {
      gameState,
      startedAt,
      deadlineAt: typeof options.softDeadlineAt === "number" ? options.softDeadlineAt : fallbackDeadline,
      hardBudgetMs: options.budgetMs || null,
      allowPartial: options.allowPartial !== false,
      reporter: options.reporter || null,
      truncatedReason: null,
      debugEnabled,
      debugStats,
      featureFlags,
      progressThrottleAt: 0,
      searchPhase: null,
      rackGroupCache: new Map(),
      poolGroupCache: new Map(),
      protectedSubsetPoolCache: new Map(),
      transpositionTable: new Map(),
      finishableCache: new Map(),
      evalCache: new Map(),
      initialRackSize: initialState.rack.length,
      initialTableSize: initialState.table.length,
      initialJokerCount: initialState.rack.filter(tile => tile.joker).length
    };
  }

  markDebugCount(ctx, path, amount = 1) {
    if (!ctx?.debugEnabled || !ctx.debugStats || !path) return;
    const segments = Array.isArray(path) ? path : String(path).split(".");
    let current = ctx.debugStats;
    for (let index = 0; index < segments.length - 1; index += 1) {
      const key = segments[index];
      if (!current[key] || typeof current[key] !== "object") {
        current[key] = {};
      }
      current = current[key];
    }
    const lastKey = segments[segments.length - 1];
    current[lastKey] = (current[lastKey] || 0) + amount;
  }

  getCandidateDebugType(candidate) {
    if (!candidate?.actions?.length) return null;
    if (candidate.actions.some(action => action.mode === "chain-append")) return "chain";
    if (candidate.actions.some(action => action.mode === "exact")) return "exact";
    return null;
  }

  getPrimaryActionMode(candidate) {
    if (!candidate) return null;
    const actions = candidate.actions || [];
    if (actions.some(action => action.mode === "chain-append")) return "chain";
    if (actions.some(action => action.mode === "exact")) return "exact";
    if (actions.some(action => action.mode === "joker" || action.mode === "joker-gap")) return "joker";
    if (actions.some(action => action.mode === "bridge")) return "bridge";
    if (actions.some(action => action.mode === "single")) return "single";
    if (actions.some(action => action.type === "append")) return "append";
    if (actions.some(action => action.type === "new-group")) return "single";
    if (candidate.type === "append") return "append";
    if (candidate.type === "new-group") return "single";
    if (candidate.type === "draw") return "draw";
    return null;
  }

  markCandidateType(ctx, candidate, bucket) {
    const type = this.getCandidateDebugType(candidate);
    if (!type) return null;
    this.markDebugCount(ctx, `${bucket}.${type}`);
    return type;
  }

  markChainReject(ctx, reason) {
    if (!reason) return;
    this.markDebugCount(ctx, `chainFinishReject.${reason}`);
  }

  markChainRepair(ctx, reason) {
    if (!reason) return;
    this.markDebugCount(ctx, `chainRepair.${reason}`);
  }

  setExactLastLoss(ctx, previousBest, nextBest, phase = "beam-best-replace") {
    if (!ctx?.debugEnabled || !ctx.debugStats || !previousBest || !nextBest) return;
    if (this.getCandidateDebugType(previousBest) !== "exact") return;
    if (this.getCandidateDebugType(nextBest) === "exact") return;

    const exactTieBreak = this.getCandidateTieBreakData(previousBest, ctx);
    const winnerTieBreak = this.getCandidateTieBreakData(nextBest, ctx);
    const exactScore = previousBest.finalScore ?? previousBest.evalScore ?? null;
    const winnerScore = nextBest.finalScore ?? nextBest.evalScore ?? null;
    ctx.debugStats.exactLastLoss = {
      seen: true,
      phase,
      exactScore,
      exactRackReduction: exactTieBreak.rackReduction,
      exactFutureMobility: exactTieBreak.futureMobility,
      exactTouchedGroups: exactTieBreak.touchedGroups,
      exactActions: (previousBest.actions || []).map(action => action.mode || action.type || "unknown"),
      winnerMode: this.getPrimaryActionMode(nextBest) || "unknown",
      winnerScore,
      winnerRackReduction: winnerTieBreak.rackReduction,
      winnerFutureMobility: winnerTieBreak.futureMobility,
      winnerTouchedGroups: winnerTieBreak.touchedGroups,
      scoreGap: exactScore == null || winnerScore == null ? null : winnerScore - exactScore
    };
  }

  markSoftDeadline(ctx) {
    if (!ctx?.debugEnabled || !ctx.debugStats?._meta) return;
    ctx.debugStats._meta.softDeadline = true;
  }

  recordExactFinalLoss(ctx, previousBest, nextBest, phase = "beam-best-replace") {
    if (!ctx?.debugEnabled || !previousBest || !nextBest) return;
    if (this.getCandidateDebugType(previousBest) !== "exact") return;
    if (this.getCandidateDebugType(nextBest) === "exact") return;

    this.setExactLastLoss(ctx, previousBest, nextBest, phase);
    const nextMode = this.getPrimaryActionMode(nextBest);
    const lossKey = nextMode === "append"
      ? "lostToAppend"
      : nextMode === "single"
        ? "lostToSingle"
        : nextMode === "bridge"
          ? "lostToBridge"
          : nextMode === "chain"
            ? "lostToChain"
            : nextMode === "joker"
              ? "lostToJoker"
              : null;
    if (lossKey) {
      this.markDebugCount(ctx, `exactFinalLoss.${lossKey}`);
    }
    const previousScore = previousBest.finalScore ?? previousBest.evalScore ?? 0;
    const nextScore = nextBest.finalScore ?? nextBest.evalScore ?? 0;
    if (Math.abs(nextScore - previousScore) <= 8) {
      this.markDebugCount(ctx, "exactFinalLoss.lostToNonExactSameScoreBand");
    }
  }

  buildProgressMove(state, ctx, phase) {
    const move = this.buildMove(state, ctx);
    move.searchTruncated = true;
    move.partial = true;
    move.partialReason = ctx.truncatedReason || "soft-deadline";
    move.searchPhase = phase || ctx.searchPhase || "beam-search";
    return move;
  }

  reportProgress(ctx, payload, force = false) {
    if (!ctx.allowPartial || !ctx.reporter?.onProgress || !payload) return;
    const now = Date.now();
    if (!force && now < ctx.progressThrottleAt) return;
    ctx.progressThrottleAt = now + 80;
    ctx.reporter.onProgress(payload);
  }

  buildSearchSchedule(gameState, ctx) {
    const fallback = [{ maxDepth: this.config.maxDepth, beamWidth: this.config.beamWidth }];
    const rawSchedule = this.level >= 3
      && Array.isArray(this.config.searchSchedule)
      && this.config.searchSchedule.length > 0
      ? this.config.searchSchedule
      : fallback;

    const normalized = rawSchedule
      .map(pass => ({
        maxDepth: Math.max(1, Math.min(this.config.maxDepth, Number(pass?.maxDepth) || this.config.maxDepth)),
        beamWidth: Math.max(1, Math.min(this.config.beamWidth, Number(pass?.beamWidth) || this.config.beamWidth))
      }))
      .filter(pass => pass.maxDepth > 0 && pass.beamWidth > 0);

    const finalPass = {
      maxDepth: Math.max(1, this.config.maxDepth),
      beamWidth: Math.max(1, this.config.beamWidth)
    };
    const lastPass = normalized[normalized.length - 1];
    if (!lastPass || lastPass.maxDepth !== finalPass.maxDepth || lastPass.beamWidth !== finalPass.beamWidth) {
      normalized.push(finalPass);
    }

    return normalized;
  }

  runBeamPass(initialState, ctx, passConfig) {
    const seen = ctx.transpositionTable;
    let best = null;
    let frontier = [RummyAIUtils.cloneState(initialState)];
    let completed = true;
    let passLastExactBest = null;

    for (let depth = 1; depth <= passConfig.maxDepth; depth += 1) {
      if (this.isTimedOut(ctx)) {
        ctx.truncatedReason = ctx.truncatedReason || "soft-deadline";
        completed = false;
        break;
      }

      const nextFrontier = [];
      for (const state of frontier) {
        const candidates = this.generateCandidates(state, ctx);
        if (ctx.debugEnabled && candidates.length > 0 && ctx.debugStats?._meta) {
          ctx.debugStats._meta.anyCandidates = true;
          if (ctx.debugStats.timing.firstCandidateAtMs == null) {
            ctx.debugStats.timing.firstCandidateAtMs = Date.now() - ctx.startedAt;
          }
        }
        for (const candidate of candidates) {
          if (this.isTimedOut(ctx)) {
            ctx.truncatedReason = ctx.truncatedReason || "soft-deadline";
            this.markSoftDeadline(ctx);
            completed = false;
            break;
          }

          const remainingDepth = passConfig.maxDepth - depth;
          const key = `${this.getSearchStateKey(candidate)}|d=${remainingDepth}`;
          const value = this.scoreCandidate(candidate, ctx);
          const currentBest = seen.get(key);
          if (typeof currentBest === "number" && currentBest > value) continue;
          if (typeof currentBest !== "number" || value > currentBest) {
            seen.set(key, value);
          }

          candidate.evalScore = value;
          if (this.canFinishTurn(candidate, ctx)) {
            if (ctx.debugEnabled && ctx.debugStats?._meta) {
              ctx.debugStats._meta.anyFinishable = true;
              this.markCandidateType(ctx, candidate, "finishableSeen");
              ctx.debugStats.timing.finishableCount += 1;
              if (ctx.debugStats.timing.firstFinishableAtMs == null) {
                ctx.debugStats.timing.firstFinishableAtMs = Date.now() - ctx.startedAt;
              }
            }
            candidate.finalScore = this.evaluateState(candidate, ctx, true);
            if (!best || this.compareCandidateOrder(candidate, best, ctx, "finalScore") < 0) {
              this.recordExactFinalLoss(ctx, best, candidate, "beam-best-replace");
              best = candidate;
              if (this.getCandidateDebugType(candidate) === "exact") {
                passLastExactBest = candidate;
              }
              this.markCandidateType(ctx, candidate, "topCandidateSeen");
              if (ctx.debugEnabled) {
                ctx.debugStats.timing.bestUpdateCount += 1;
              }
              this.reportProgress(ctx, {
                kind: "move",
                move: this.buildProgressMove(candidate, ctx, `beam-d${depth}`),
                searchPhase: `beam-d${depth}`,
                partialReason: "soft-deadline"
              });
            }
          }
          nextFrontier.push(candidate);
        }
        if (!completed) break;
      }

      if (!completed) break;
      if (nextFrontier.length === 0) break;

      nextFrontier.sort((a, b) => this.compareCandidateOrder(a, b, ctx, "evalScore"));
      frontier = nextFrontier.slice(0, passConfig.beamWidth);
    }

    if (passLastExactBest && best && passLastExactBest !== best) {
      this.recordExactFinalLoss(ctx, passLastExactBest, best, "final-pass-best");
    }
    return { best, completed };
  }

  getPrimaryScore(candidate, ctx, scoreSource = "evalScore") {
    if (!candidate) return -Infinity;
    if (typeof scoreSource === "function") return scoreSource(candidate, ctx);
    return candidate[scoreSource] ?? -Infinity;
  }

  getSearchStateKey(state) {
    if (!state.searchStateKey) {
      state.searchStateKey = RummyAIUtils.serializeSearchState(state);
    }
    return state.searchStateKey;
  }

  getEvalCacheKey(state, terminal, namespace = "base") {
    return `${namespace}|${this.getSearchStateKey(state)}|terminal=${terminal ? 1 : 0}`;
  }

  getCandidateTieBreakData(state, ctx) {
    if (state.tieBreakData) return state.tieBreakData;

    const openingGroups = state.table.slice(state.baseTableCount);
    const primaryMode = this.getPrimaryActionMode(state);
    const touchedGroups = state.stats?.touchedGroups || 0;
    const effectiveTouchedGroups = ctx.featureFlags?.exactSelectionTuning && primaryMode === "exact"
      ? Math.max(0, touchedGroups - 1)
      : touchedGroups;
    state.tieBreakData = {
      rackReduction: ctx.initialRackSize - state.rack.length,
      openingScore: calculateInitialOpenScore(openingGroups),
      actionScore: state.stats?.actionScore || 0,
      futureMobility: this.countAppendableRackTiles(state),
      touchedGroups: effectiveTouchedGroups
    };
    return state.tieBreakData;
  }

  compareCandidateOrder(a, b, ctx, scoreSource = "evalScore") {
    const leftScore = this.getPrimaryScore(a, ctx, scoreSource);
    const rightScore = this.getPrimaryScore(b, ctx, scoreSource);
    const primaryGap = rightScore - leftScore;
    if (ctx.featureFlags?.exactSelectionTuning && this.config.exactNearTiePreferExact && scoreSource === "finalScore") {
      const leftMode = this.getCandidateDebugType(a);
      const rightMode = this.getCandidateDebugType(b);
      if (leftMode !== rightMode && (leftMode === "exact" || rightMode === "exact")) {
        const exactCandidate = leftMode === "exact" ? a : b;
        const otherCandidate = leftMode === "exact" ? b : a;
        const scoreGap = Math.abs(leftScore - rightScore);
        const threshold = 4;
        const exactTieBreak = this.getCandidateTieBreakData(exactCandidate, ctx);
        const otherTieBreak = this.getCandidateTieBreakData(otherCandidate, ctx);
        if (
          threshold > 0
          && scoreGap <= threshold
          && exactTieBreak.rackReduction >= otherTieBreak.rackReduction
          && exactTieBreak.futureMobility + 1 >= otherTieBreak.futureMobility
        ) {
          return leftMode === "exact" ? -1 : 1;
        }
      }
    }
    if (primaryGap !== 0) return primaryGap;

    const left = this.getCandidateTieBreakData(a, ctx);
    const right = this.getCandidateTieBreakData(b, ctx);
    const comparisons = [
      right.rackReduction - left.rackReduction,
      right.openingScore - left.openingScore,
      right.actionScore - left.actionScore,
      right.futureMobility - left.futureMobility,
      left.touchedGroups - right.touchedGroups
    ];

    for (const comparison of comparisons) {
      if (comparison !== 0) return comparison;
    }

    return this.getSearchStateKey(a).localeCompare(this.getSearchStateKey(b));
  }

  getRemainingTimeMs(ctx) {
    if (typeof ctx.deadlineAt !== "number") {
      if (!this.config.timeLimitMs) return Infinity;
      return Math.max(0, this.config.timeLimitMs - (Date.now() - ctx.startedAt));
    }
    return Math.max(0, ctx.deadlineAt - Date.now());
  }

  isTimedOut(ctx) {
    if (typeof ctx.deadlineAt === "number") {
      if (Date.now() >= ctx.deadlineAt) {
        ctx.truncatedReason = ctx.truncatedReason || "soft-deadline";
        return true;
      }
      return false;
    }
    if (!this.config.timeLimitMs) return false;
    const timedOut = (Date.now() - ctx.startedAt) >= this.config.timeLimitMs;
    if (timedOut) ctx.truncatedReason = ctx.truncatedReason || "soft-deadline";
    return timedOut;
  }

  buildEffectiveConfig(state, ctx) {
    const caps = this.config.complexityCaps || {};
    const baseConfig = this.config;
    const effective = { ...baseConfig };
    const strategyName = this.constructor?.name || "";
    const isLevel5 = strategyName === "AILevel5Strategy";
    const isLevel6 = strategyName === "AILevel6Strategy";
    const isHintMode = !!ctx.gameState?.hintMode;
    const largeRackThreshold = caps.largeRackThreshold || 16;
    const veryLargeRackThreshold = caps.veryLargeRackThreshold || 20;
    const crowdedTableThreshold = caps.crowdedTableThreshold || 8;
    const unopenedLargeRackThreshold = caps.unopenedLargeRackThreshold || 15;

    if (state.rack.length >= largeRackThreshold) {
      effective.maxRackTilesForRearrange = Math.min(effective.maxRackTilesForRearrange || 4, 3);
    }
    if (state.rack.length >= veryLargeRackThreshold) {
      effective.maxRackSubsetBranches = Math.max(6, Math.floor((effective.maxRackSubsetBranches || 24) * 0.7));
      const cappedPoolTiles = isLevel6 ? 12 : isLevel5 ? 11 : 10;
      effective.maxPoolTiles = Math.min(effective.maxPoolTiles || cappedPoolTiles, cappedPoolTiles);
    }
    if (this.isOpeningPending(ctx) && !state.opened && state.rack.length >= unopenedLargeRackThreshold) {
      const openingExactCap = isLevel5 || isLevel6 ? 2 : 1;
      if (typeof effective.exactQuota === "number") effective.exactQuota = Math.min(effective.exactQuota, openingExactCap);
      if (typeof effective.advancedJokerChainQuota === "number") effective.advancedJokerChainQuota = 0;
      if (typeof effective.advancedJokerChainDoubleSupportQuota === "number") effective.advancedJokerChainDoubleSupportQuota = 0;
    }
    const chainAppendDefaults = {
      maxTouchedGroups: baseConfig.chainAppendMaxTouchedGroups || baseConfig.maxTouchedGroups || 2,
      maxDonorGroups: baseConfig.chainAppendMaxDonorGroups || 1,
      maxRecipientGroups: baseConfig.chainAppendMaxRecipientGroups || 1,
      maxFreeTableTiles: baseConfig.chainAppendMaxFreeTableTiles || baseConfig.chainAppendMaxFreedTiles || 4,
      maxRackSubsetSize: baseConfig.chainAppendMaxRackSubsetSize || 0,
      directOnly: baseConfig.chainAppendDirectOnly !== false,
      allowGapFill: !!baseConfig.chainAppendAllowGapFill,
      allowTwoTileSameRecipient: baseConfig.chainAppendAllowTwoTileSameRecipient !== false,
      maxRecipientExtensionsPerGroup: baseConfig.chainAppendMaxRecipientExtensionsPerGroup || 2,
      minStructuralGain: baseConfig.chainAppendMinStructuralGain || 0,
      requireAllFreedTilesUsedOrRetained: !!baseConfig.chainAppendRequireAllFreedTilesUsedOrRetained
    };
    effective.generatorBudgets = {
      bridge: {
        maxTouchedGroups: Math.min(baseConfig.maxTouchedGroups || 2, 2),
        maxPartitionSolutions: baseConfig.maxPartitionSolutionsBridge || baseConfig.maxPartitionSolutions || 4
      },
      exact: {
        maxTouchedGroups: baseConfig.maxTouchedGroups || 2,
        maxPartitionSolutions: baseConfig.maxPartitionSolutions || 4
      },
      "chain-append": chainAppendDefaults
    };

    const isCrowded = state.table.length >= crowdedTableThreshold;
    if (isCrowded) {
      effective.maxTouchedGroups = Math.min(effective.maxTouchedGroups || 2, 2);
      effective.maxPartitionSolutions = Math.min(effective.maxPartitionSolutions || 4, 2);
      effective.maxPartitionSolutionsBridge = Math.min(
        effective.maxPartitionSolutionsBridge || effective.maxPartitionSolutions || 4,
        2
      );
      const crowdedBudgets = baseConfig.crowdedBudgets || {};
      const crowdedExactTouchedCap = isLevel6
        ? (isHintMode ? 4 : 3)
        : 2;
      const crowdedExactPartitionCap = isLevel6
        ? (isHintMode ? 4 : 3)
        : 2;
      effective.generatorBudgets.bridge = {
        ...effective.generatorBudgets.bridge,
        maxTouchedGroups: crowdedBudgets.bridgeMaxTouchedGroups || 2,
        maxPartitionSolutions: crowdedBudgets.bridgeMaxPartitionSolutions || 2
      };
      effective.generatorBudgets.exact = {
        ...effective.generatorBudgets.exact,
        maxTouchedGroups: Math.max(crowdedBudgets.exactMaxTouchedGroups || 0, crowdedExactTouchedCap),
        maxPartitionSolutions: Math.max(crowdedBudgets.exactMaxPartitionSolutions || 0, crowdedExactPartitionCap)
      };
      effective.generatorBudgets["chain-append"] = {
        ...effective.generatorBudgets["chain-append"],
        maxTouchedGroups: crowdedBudgets.chainAppendMaxTouchedGroups
          || effective.generatorBudgets["chain-append"].maxTouchedGroups,
        maxDonorGroups: crowdedBudgets.chainAppendMaxDonorGroups
          || effective.generatorBudgets["chain-append"].maxDonorGroups,
        maxRecipientGroups: crowdedBudgets.chainAppendMaxRecipientGroups
          || effective.generatorBudgets["chain-append"].maxRecipientGroups,
        maxFreeTableTiles: crowdedBudgets.chainAppendMaxFreeTableTiles
          || effective.generatorBudgets["chain-append"].maxFreeTableTiles,
        maxRackSubsetSize: crowdedBudgets.chainAppendMaxRackSubsetSize
          || effective.generatorBudgets["chain-append"].maxRackSubsetSize
      };
      if (isLevel6 && isHintMode) {
        effective.generatorBudgets["chain-append"] = {
          ...effective.generatorBudgets["chain-append"],
          maxTouchedGroups: Math.max(
            effective.generatorBudgets["chain-append"].maxTouchedGroups || 0,
            4
          ),
          maxFreeTableTiles: Math.max(
            effective.generatorBudgets["chain-append"].maxFreeTableTiles || 0,
            6
          ),
          maxRackSubsetSize: Math.max(
            effective.generatorBudgets["chain-append"].maxRackSubsetSize || 0,
            3
          )
        };
      }
    }
    return effective;
  }

  withEffectiveConfig(state, ctx, work) {
    const previousConfig = this.config;
    const nextConfig = this.buildEffectiveConfig(state, ctx);
    this.config = nextConfig;
    try {
      return work(nextConfig);
    } finally {
      this.config = previousConfig;
    }
  }

  modeEnabled(mode) {
    const current = this.config.rearrangeMode || "";
    return current.split("+").includes(mode);
  }

  getGeneratorBudget(mode) {
    return this.config.generatorBudgets?.[mode] || {};
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
      const key = this.getSearchStateKey(candidate);
      const current = deduped.get(key);
      const value = this.getCandidateSortValue(candidate, ctx);
      if (!current || value > this.getCandidateSortValue(current, ctx)) {
        deduped.set(key, candidate);
      }
    });
    const ordered = [...deduped.values()].sort((a, b) =>
      this.compareCandidateOrder(a, b, ctx, candidate => this.getCandidateSortValue(candidate, ctx))
    );
    return typeof limit === "number" ? ordered.slice(0, limit) : ordered;
  }

  dedupeAndSortCandidatesWithReserve(candidates, ctx, limit, reservedCandidates = []) {
    const selected = [];
    const selectedKeys = new Set();

    this.dedupeAndSortCandidates(reservedCandidates, ctx).forEach(candidate => {
      if (typeof limit === "number" && selected.length >= limit) return;
      const key = this.getSearchStateKey(candidate);
      if (selectedKeys.has(key)) return;
      selected.push(candidate);
      selectedKeys.add(key);
    });

    this.dedupeAndSortCandidates(candidates, ctx).forEach(candidate => {
      if (typeof limit === "number" && selected.length >= limit) return;
      const key = this.getSearchStateKey(candidate);
      if (selectedKeys.has(key)) return;
      selected.push(candidate);
      selectedKeys.add(key);
    });

    return selected;
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
    moves.sort((a, b) => this.compareCandidateOrder(a, b, ctx, "previewScore"));
    return moves.slice(0, quota);
  }

  getProtectedRackSubsets(state, ctx, tableTiles = []) {
    const all = RummyAIUtils.enumerateRackSubsets(state.rack, {
      maxSize: this.config.maxRackTilesForRearrange || 0,
      ctx
    });
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
      if (subset.size === 1 && !hasJoker && !sameNumber && !nearRun) {
        return [];
      }
      let bridgeable = false;
      let jokerCompletable = false;
      let jokerReplaceable = false;
      if (tableTiles.length > 0) {
        const poolCacheKey = `${subset.ids.join(",")}::${tableTiles.map(tile => tile.id).sort((a, b) => a - b).join(",")}::${tableTiles.length + subset.tiles.length}`;
        let poolMeta = ctx.protectedSubsetPoolCache.get(poolCacheKey);
        if (!poolMeta) {
          const pool = [...subset.tiles, ...tableTiles];
          const validGroups = RummyAIUtils.getValidGroupsFromTiles(pool, ctx.poolGroupCache, {
            maxSize: pool.length,
            ctx
          });
          poolMeta = {
            bridgeable: validGroups.some(group =>
              subset.ids.every(id => group.ids.includes(id)) &&
              group.ids.some(id => tableIds.has(id))
            ),
            jokerCompletable: hasTableJoker && validGroups.some(group =>
              subset.ids.every(id => group.ids.includes(id)) &&
              group.ids.some(id => tableIds.has(id) && tableTiles.find(tile => tile.id === id)?.joker)
            )
          };
          ctx.protectedSubsetPoolCache.set(poolCacheKey, poolMeta);
        }
        bridgeable = !!poolMeta.bridgeable;
        jokerCompletable = !!poolMeta.jokerCompletable;
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
      ? RummyAIUtils.enumerateRackSubsets(state.rack, {
          maxSize: this.config.maxRackTilesForRearrange || 0,
          ctx
        })
      : RummyAIUtils.getRackSubsets(
          state.rack,
          this.config.maxRackTilesForRearrange || 0,
          this.config.maxRackSubsetBranches || 24,
          { ctx }
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

    for (let removeCount = 1; removeCount <= Math.min(maxRemove, group.length - 1); removeCount += 1) {
      const completed = RummyAIUtils.generateKCombinations(group, removeCount, ctx, (removedTiles) => {
        if (!this.config.allowJokerRemoval && removedTiles.some(tile => tile.joker)) return true;
        const removedIdSet = new Set(removedTiles.map(tile => tile.id));
        const remainingTiles = group.filter(tile => !removedIdSet.has(tile.id));
        if (remainingTiles.length > 0 && remainingTiles.length < 3) return true;

        const partitions = remainingTiles.length === 0
          ? [{ groups: [], score: 0 }]
          : RummyAIUtils.findExactCoverPartitions(remainingTiles, ctx.poolGroupCache, {
              maxSolutions,
              ctx
            });
        if (partitions.length === 0) return true;

        partitions.slice(0, maxSolutions).forEach(partition => {
          plans.push({
            removedTiles,
            remainingGroups: partition.groups,
            score: (partition.score || 0) + removedTiles.length * 12
          });
        });
        return true;
      });
      if (completed === false || this.isTimedOut(ctx)) break;
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
    next.stats.chainAppendCount += statBoost.chainAppendCount || 0;
    next.stats.chainAppendMultiRecipient += statBoost.chainAppendMultiRecipient || 0;
    next.stats.chainAppendSameRecipientDouble += statBoost.chainAppendSameRecipientDouble || 0;
    next.stats.chainAppendTailBuilt += statBoost.chainAppendTailBuilt || 0;
    next.stats.chainRepairFinishable += statBoost.chainRepairFinishable || 0;
    next.stats.chainRepairRollbackUsed += statBoost.chainRepairRollbackUsed || 0;
    next.stats.chainRepairDonorClosed += statBoost.chainRepairDonorClosed || 0;
    next.stats.chainTailClosed += statBoost.chainTailClosed || 0;
    next.stats.chainTailClosedWithRack += statBoost.chainTailClosedWithRack || 0;
    next.stats.chainTailClosedAfterRollback += statBoost.chainTailClosedAfterRollback || 0;
    if (options.jokerNote) {
      next.meta.jokerNotes = [...(next.meta.jokerNotes || []), options.jokerNote];
    }
    this.updateOpenedState(next, ctx);
    return next;
  }

  canFinishTurn(state, ctx) {
    const cacheKey = this.getSearchStateKey(state);
    if (ctx.finishableCache.has(cacheKey)) {
      return ctx.finishableCache.get(cacheKey);
    }

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
    if (!reducedDuringSearch && !reducedEarlierThisTurn) {
      ctx.finishableCache.set(cacheKey, false);
      return false;
    }
    if (state.table.some(group => !RummyRules.analyzeGroup(group).valid)) {
      ctx.finishableCache.set(cacheKey, false);
      return false;
    }

    const { ruleOptions, currentPlayer } = ctx.gameState;
    if (!ruleOptions.initial30 || currentPlayer.opened) {
      ctx.finishableCache.set(cacheKey, true);
      return true;
    }

    const openingGroups = state.table.slice(state.baseTableCount);
    const finishable = isInitialOpenSatisfied(openingGroups);
    ctx.finishableCache.set(cacheKey, finishable);
    return finishable;
  }

  evaluateState(state, ctx, terminal) {
    const cacheKey = this.getEvalCacheKey(state, terminal, "base");
    if (ctx.evalCache.has(cacheKey)) {
      return ctx.evalCache.get(cacheKey);
    }

    const rackReduction = ctx.initialRackSize - state.rack.length;
    const rackGroups = RummyAIUtils.getValidGroupsFromTiles(state.rack, ctx.rackGroupCache, {
      maxSize: state.rack.length,
      ctx
    });
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
    score += state.stats.chainAppendCount * (this.config.weights.chainAppend || 0);
    score += state.stats.chainAppendMultiRecipient * (this.config.weights.chainAppendMultiRecipient || 0);
    score += state.stats.chainAppendSameRecipientDouble * (this.config.weights.chainAppendSameRecipientDouble || 0);
    score += state.stats.chainAppendTailBuilt * (this.config.weights.chainAppendTailBuilt || 0);
    score += state.stats.chainRepairFinishable * (this.config.weights.chainRepairFinishable || 0);
    score += state.stats.chainRepairDonorClosed * (this.config.weights.chainRepairDonorClosed || 0);
    score += state.stats.chainRepairRollbackUsed * (this.config.weights.chainRepairRollbackUsed || 0);
    score += state.stats.chainTailClosed * (this.config.weights.chainTailClosed || 0);
    score += state.stats.chainTailClosedWithRack * (this.config.weights.chainTailClosedWithRack || 0);
    score += state.stats.chainTailClosedAfterRollback * (this.config.weights.chainTailClosedAfterRollback || 0);
    score -= fragileGroups * (this.config.weights.fragile || 0);
    score -= entropyPenalty * (this.config.weights.entropy || 0);
    score -= state.stats.jokerTrap * (this.config.weights.jokerTrap || 0);

    const isExactCandidate = this.getCandidateDebugType(state) === "exact";
    const crowdedThreshold = this.config.complexityCaps?.crowdedTableThreshold || 8;
    const exactBonusEligible = terminal
      && ctx.featureFlags?.exactSelectionTuning
      && isExactCandidate
      && rackReduction >= 1
      && (
        state.opened
        || state.table.length >= crowdedThreshold
        || (state.stats?.touchedGroups || 0) >= 3
      );
    if (exactBonusEligible) {
      score += this.config.weights.exactFinishBonus || 0;
      if (state.table.length >= crowdedThreshold || (state.stats?.touchedGroups || 0) >= 3) {
        score += this.config.weights.exactCrowdedBonus || 0;
      }
    }

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

    ctx.evalCache.set(cacheKey, score);
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
    if (state.stats.chainAppendCount > 0) {
      summary = state.stats.chainAppendTailBuilt > 0
        ? `연쇄 확장+새 줄 ${rackReduction}장`
        : `연쇄 확장 ${rackReduction}장`;
    } else if (state.stats.rearrangeCount > 0) summary = `재배열 ${rackReduction}장`;
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
    return this.withEffectiveConfig(state, ctx, () => {
      if (this.isOpeningPending(ctx) && !state.opened) {
        const openingMoves = this.generateOpeningMoves(state, ctx);
        if (ctx.debugEnabled && ctx.debugStats?._meta && openingMoves.length > 0) {
          ctx.debugStats._meta.anyGeneratedCandidates = true;
          ctx.debugStats._meta.anyBaselineCandidates = true;
        }
        return this.pickQuota(
          openingMoves,
          ctx,
          this.config.openingQuota ?? this.config.maxBranchesPerState
        );
      }

      const rackMoves = this.generateRackGroupMoves(state, ctx);
      const appendMoves = this.generateAppendMoves(state, ctx);
      const safeAppendMoves = appendMoves.filter(candidate => this.isSafeAppendCandidate(candidate));
      const safeKeys = new Set(safeAppendMoves.map(candidate => this.getSearchStateKey(candidate)));
      const regularAppendMoves = appendMoves.filter(candidate => !safeKeys.has(this.getSearchStateKey(candidate)));

      const baselineMoves = this.dedupeAndSortCandidates([
        ...this.pickQuota(rackMoves, ctx, this.config.newGroupQuota ?? this.config.maxBranchesPerState),
        ...this.pickQuota(safeAppendMoves, ctx, this.config.safeAppendQuota ?? this.config.appendQuota ?? this.config.maxBranchesPerState),
        ...this.pickQuota(regularAppendMoves, ctx, this.config.appendQuota ?? this.config.maxBranchesPerState)
      ], ctx, this.config.maxBranchesPerState);
      if (ctx.debugEnabled && ctx.debugStats?._meta && baselineMoves.length > 0) {
        ctx.debugStats._meta.anyGeneratedCandidates = true;
        ctx.debugStats._meta.anyBaselineCandidates = true;
      }

      if (!this.config.allowRearrange || !state.opened) {
        return baselineMoves;
      }

      const advancedMoves = this.generateRearrangementMoves(state, ctx);
      if (ctx.debugEnabled && ctx.debugStats?._meta && advancedMoves.length > 0) {
        ctx.debugStats._meta.anyGeneratedCandidates = true;
        ctx.debugStats._meta.anyRearrangementCandidates = true;
      }
      return this.dedupeAndSortCandidates([
        ...baselineMoves,
        ...this.pickQuota(advancedMoves, ctx, this.config.rearrangeQuota ?? this.config.maxBranchesPerState)
      ], ctx, this.config.maxBranchesPerState);
    });
  }

  generateOpeningMoves(state, ctx) {
    const groups = RummyAIUtils.getValidGroupsFromTiles(
      state.rack,
      ctx.rackGroupCache,
      {
        maxSize: state.rack.length,
        ctx
      }
    )
      .sort((a, b) => b.score - a.score || b.size - a.size || a.jokerCount - b.jokerCount)
      .slice(0, this.config.maxOpeningGroupBranches || this.config.maxRackGroupBranches || 20);
    if (groups.length === 0) return [];

    const rackOrder = state.rack.map(tile => tile.id);
    const byTileId = new Map(rackOrder.map(id => [id, []]));
    groups.forEach(group => {
      group.idSet = new Set(group.ids);
      group.ids.forEach(id => {
        if (byTileId.has(id)) byTileId.get(id).push(group);
      });
    });
    byTileId.forEach(list => list.sort((a, b) => b.score - a.score || b.size - a.size || a.jokerCount - b.jokerCount));
    const seen = new Set();
    const combos = [];
    const maxSolutions = this.config.maxOpeningSolutions || 24;
    let bestOpeningScore = 0;

    const recordCombo = (selected) => {
      if (selected.length === 0) return;
      const groupsToCreate = selected.map(candidate => normalizeGroupTiles(deepCopy(candidate.tiles)));
      const signature = serializeTableState(groupsToCreate);
      if (seen.has(signature)) return;
      seen.add(signature);
      const combo = {
        groups: groupsToCreate,
        score: selected.reduce((sum, candidate) => sum + (candidate.score || 0), 0),
        rackReduction: selected.reduce((sum, candidate) => sum + candidate.size, 0),
        jokerCount: selected.reduce((sum, candidate) => sum + candidate.jokerCount, 0)
      };
      bestOpeningScore = Math.max(bestOpeningScore, combo.score);
      combos.push(combo);
    };

    const dfs = (usedTileIds, skippedTileIds, selected, depth) => {
      if (this.isTimedOut(ctx) || combos.length >= maxSolutions * 2) return;
      if (selected.length > 0) recordCombo(selected);
      if (depth >= (this.config.maxOpeningGroups || 1)) return;

      const optimisticGain = groups
        .slice(0, Math.max(0, (this.config.maxOpeningGroups || 1) - depth))
        .reduce((sum, candidate) => sum + (candidate.score || 0), 0);
      const currentScore = selected.reduce((sum, candidate) => sum + (candidate.score || 0), 0);
      if (currentScore < 30 && currentScore + optimisticGain < Math.max(30, bestOpeningScore)) {
        return;
      }

      let firstOpenId = null;
      for (const tileId of rackOrder) {
        if (!usedTileIds.has(tileId) && !skippedTileIds.has(tileId)) {
          firstOpenId = tileId;
          break;
        }
      }
      if (!firstOpenId) return;

      for (const candidate of byTileId.get(firstOpenId) || []) {
        if (candidate.ids.some(id => usedTileIds.has(id) || skippedTileIds.has(id))) continue;
        candidate.ids.forEach(id => usedTileIds.add(id));
        selected.push(candidate);
        dfs(usedTileIds, skippedTileIds, selected, depth + 1);
        selected.pop();
        candidate.ids.forEach(id => usedTileIds.delete(id));
        if (this.isTimedOut(ctx) || combos.length >= maxSolutions * 2) return;
      }

      skippedTileIds.add(firstOpenId);
      dfs(usedTileIds, skippedTileIds, selected, depth);
      skippedTileIds.delete(firstOpenId);
    };

    dfs(new Set(), new Set(), [], 0);

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
    const groups = RummyAIUtils.getValidGroupsFromTiles(state.rack, ctx.rackGroupCache, {
      maxSize: state.rack.length,
      ctx
    })
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
    const maxBranches = this.config.maxAppendBranches || Infinity;

    for (let groupIndex = 0; groupIndex < state.table.length; groupIndex += 1) {
      if (moves.length >= maxBranches || this.isTimedOut(ctx)) break;
      if (!allowBaseTable && groupIndex < state.baseTableCount) continue;
      for (const tile of state.rack) {
        if (moves.length >= maxBranches || this.isTimedOut(ctx)) break;
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

    if (ctx.debugEnabled) {
      candidates.forEach(candidate => this.markCandidateType(ctx, candidate, "generated"));
    }
    return candidates;
  }

  getFlexibleExtractionPlans(group, ctx, options = {}) {
    const maxRemove = Math.max(1, Math.min(options.maxRemove || 1, group.length - 1));
    const maxSolutions = options.maxSolutions || 2;
    const maxLooseTiles = options.maxLooseTiles ?? 2;
    const sourceKind = RummyRules.explainGroup(group).kind || null;
    const plans = [];

    for (let removeCount = 1; removeCount <= maxRemove; removeCount += 1) {
      const completed = RummyAIUtils.generateKCombinations(group, removeCount, ctx, (removedTiles) => {
        if (!this.config.allowJokerRemoval && removedTiles.some(tile => tile.joker)) return true;
        const removedIdSet = new Set(removedTiles.map(tile => tile.id));
        const remainingTiles = group.filter(tile => !removedIdSet.has(tile.id));
        if (remainingTiles.length === 0) return true;

        let partitioned = false;
        if (remainingTiles.length >= 3) {
          const partitions = RummyAIUtils.findExactCoverPartitions(remainingTiles, ctx.poolGroupCache, {
            maxSolutions,
            ctx
          });
          partitions.slice(0, maxSolutions).forEach(partition => {
            partitioned = true;
            plans.push({
              freedTiles: [...removedTiles],
              retainedGroups: deepCopy(partition.groups),
              looseTiles: [],
              sourceKind,
              touchedCount: 1,
              score: (partition.score || 0) + removedTiles.length * 18 + partition.groups.length * 28
            });
          });
        }

        if (!partitioned && remainingTiles.length <= maxLooseTiles) {
          plans.push({
            freedTiles: [...removedTiles],
            retainedGroups: [],
            looseTiles: [...remainingTiles],
            sourceKind,
            touchedCount: 1,
            score: removedTiles.length * 18 + remainingTiles.length * 10
          });
        }
        return true;
      });
      if (completed === false || this.isTimedOut(ctx)) break;
    }

    const seen = new Set();
    return plans
      .filter(plan => {
        const key = `${plan.freedTiles.map(tile => tile.id).sort((a, b) => a - b).join(",")}::${plan.looseTiles.map(tile => tile.id).sort((a, b) => a - b).join(",")}::${serializeTableState(plan.retainedGroups)}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      })
      .sort((a, b) => b.score - a.score || a.looseTiles.length - b.looseTiles.length || b.freedTiles.length - a.freedTiles.length)
      .slice(0, Math.min(this.config.maxRemovalPlanBranches || 8, 8));
  }

  getChainAppendRecipientCombos(indices, maxGroups) {
    const combos = indices.map(index => [index]);
    if (maxGroups >= 2) {
      for (let i = 0; i < indices.length; i += 1) {
        for (let j = i + 1; j < indices.length; j += 1) {
          combos.push([indices[i], indices[j]]);
        }
      }
    }
    return combos;
  }

  enumerateRecipientExtensions(group, freeTiles, options = {}) {
    if (!group || freeTiles.length === 0) return [];

    const analysis = RummyRules.explainGroup(group);
    if (!analysis.valid) return [];

    const nonJokers = group.filter(tile => !tile.joker);
    const isSetRecipient = analysis.kind === "set"
      || (analysis.kind === "wild" && nonJokers.length > 0 && nonJokers.every(tile => tile.number === nonJokers[0].number));
    const isRunRecipient = analysis.kind === "run"
      || (analysis.kind === "wild" && nonJokers.length > 0 && nonJokers.every(tile => tile.color === nonJokers[0].color));
    const maxConsume = options.allowTwoTileSameRecipient ? Math.min(2, freeTiles.length) : 1;
    const extensions = [];

    const pushExtension = (consumedTiles, resultGroup, resultAnalysis, extensionType = "append", appendedOneSide = true) => {
      const extensionBonus = extensionType === "gap-fill+append"
        ? 10
        : extensionType === "gap-fill"
          ? 8
          : appendedOneSide
            ? 6
            : 2;
      extensions.push({
        consumedTiles: deepCopy(consumedTiles),
        consumedIds: consumedTiles.map(tile => tile.id),
        resultGroup: normalizeGroupTiles(resultGroup),
        resultAnalysis,
        extensionType,
        score: (resultAnalysis.score || 0)
          + consumedTiles.length * 20
          + extensionBonus,
        sameRecipientDouble: consumedTiles.length >= 2 ? 1 : 0
      });
    };

    if (isSetRecipient && group.length < 4) {
      const completed = RummyAIUtils.generateKCombinations(freeTiles, 1, options.ctx, (consumedTiles) => {
        const resultGroup = normalizeGroupTiles([...group, ...consumedTiles]);
        const resultAnalysis = RummyRules.explainGroup(resultGroup);
        if (!resultAnalysis.valid || (resultAnalysis.kind !== "set" && resultAnalysis.kind !== "wild")) return true;
        pushExtension(consumedTiles, resultGroup, resultAnalysis, true);
        return true;
      });
      if (completed === false) return [];
    }

    if (isRunRecipient && analysis.canonicalNumbers.length === group.length) {
      const originalNumbers = analysis.canonicalNumbers;
      const originalMin = Math.min(...originalNumbers);
      const originalMax = Math.max(...originalNumbers);
      const gapNumbers = new Set(
        (analysis.jokerAssignments || [])
          .map(assignment => assignment.actsAsNumber)
          .filter(number => Number.isInteger(number) && number > originalMin && number < originalMax)
      );
      for (let consumeCount = 1; consumeCount <= maxConsume; consumeCount += 1) {
        const completed = RummyAIUtils.generateKCombinations(freeTiles, consumeCount, options.ctx, (consumedTiles) => {
          const resultGroup = normalizeGroupTiles([...group, ...consumedTiles]);
          const resultAnalysis = RummyRules.explainGroup(resultGroup);
          if (!resultAnalysis.valid || (resultAnalysis.kind !== "run" && resultAnalysis.kind !== "wild")) return true;

          const resultNumbers = resultAnalysis.canonicalNumbers || [];
          const startIndex = resultNumbers.indexOf(originalNumbers[0]);
          if (startIndex < 0 || startIndex + originalNumbers.length > resultNumbers.length) return true;
          const matches = originalNumbers.every((number, index) => resultNumbers[startIndex + index] === number);
          if (!matches) return true;

          const addedFront = startIndex;
          const addedBack = resultNumbers.length - (startIndex + originalNumbers.length);
          const appendedOneSide = addedFront === 0 || addedBack === 0;
          const nonJokerConsumed = consumedTiles.filter(tile => !tile.joker);
          const gapFillCount = nonJokerConsumed.filter(tile => gapNumbers.has(tile.number)).length;
          const frontCount = nonJokerConsumed.filter(tile => tile.number < originalMin).length;
          const backCount = nonJokerConsumed.filter(tile => tile.number > originalMax).length;
          const invalidInternal = nonJokerConsumed.some(tile =>
            tile.number >= originalMin
            && tile.number <= originalMax
            && !gapNumbers.has(tile.number)
          );
          if (options.allowGapFill && gapFillCount > 0) {
            if (!options.allowTwoTileSameRecipient && consumeCount > 1) return true;
            if (nonJokerConsumed.length !== consumedTiles.length) return true;
            if (invalidInternal || gapFillCount !== 1) return true;

            const edgeAppendCount = frontCount + backCount;
            if (edgeAppendCount > 1) return true;
            if (options.directOnly) return true;
            if (edgeAppendCount === 1 && !appendedOneSide) return true;

            const extensionType = edgeAppendCount === 1 ? "gap-fill+append" : "gap-fill";
            pushExtension(consumedTiles, resultGroup, resultAnalysis, extensionType, true);
            return true;
          }

          const directAppend = (addedFront + addedBack) === consumeCount;
          if (directAppend) {
            if (options.directOnly && !appendedOneSide) return true;
            if (!options.allowTwoTileSameRecipient && consumeCount > 1) return true;
            const extensionType = addedFront > 0 && addedBack > 0
              ? "append-both"
              : addedFront > 0
                ? "append-front"
                : "append-back";
            pushExtension(consumedTiles, resultGroup, resultAnalysis, extensionType, appendedOneSide);
            return true;
          }

          if (!options.allowGapFill) return true;

          if (nonJokerConsumed.length !== consumedTiles.length) return true;
          if (invalidInternal || gapFillCount !== 1) return true;

          const edgeAppendCount = frontCount + backCount;
          if (edgeAppendCount > 1) return true;
          if (edgeAppendCount === 1 && !appendedOneSide) return true;

          const extensionType = edgeAppendCount === 1 ? "gap-fill+append" : "gap-fill";
          pushExtension(consumedTiles, resultGroup, resultAnalysis, extensionType, true);
          return true;
        });
        if (completed === false) break;
      }
    }

    const seen = new Set();
    return extensions
      .filter(extension => {
        const key = `${extension.consumedIds.slice().sort((a, b) => a - b).join(",")}::${serializeTableState([extension.resultGroup])}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      })
      .sort((a, b) => b.score - a.score || b.consumedTiles.length - a.consumedTiles.length)
      .slice(0, options.maxRecipientExtensionsPerGroup || 2);
  }

  findChainAppendTailPlan(state, ctx, freeTiles, budget) {
    const options = arguments.length > 4 ? arguments[4] : {};
    if (freeTiles.length === 0 && !options.allowRackOnlyTail) {
      return {
        group: null,
        rackSubset: { ids: [], tiles: [], size: 0, score: 0 },
        score: 0,
        stage: "closed"
      };
    }

    const freeOnlyPool = normalizeGroupTiles([...freeTiles]);
    if (freeOnlyPool.length >= 3) {
      const freeOnlyAnalysis = RummyRules.explainGroup(freeOnlyPool);
      if (freeOnlyAnalysis.valid) {
        return {
          group: freeOnlyPool,
          rackSubset: { ids: [], tiles: [], size: 0, score: 0 },
          score: (freeOnlyAnalysis.score || 0) + freeOnlyPool.length * 12,
          stage: "free-only",
          closureKind: "free-only"
        };
      }
    }

    const subsets = this.getChainTailSubsetCandidates(state, ctx, freeTiles, budget, options);
    const candidates = options.allowRackOnlyTail
      ? [{ ids: [], tiles: [], size: 0, score: 0 }, ...subsets]
      : subsets;
    let best = null;

    for (const subset of candidates) {
      if (this.isTimedOut(ctx)) break;
      const pool = normalizeGroupTiles([...freeTiles, ...subset.tiles]);
      if (pool.length < 3) continue;
      const analysis = RummyRules.explainGroup(pool);
      if (!analysis.valid) continue;
      const closureMeta = this.describeChainTailClosure(pool, freeTiles, subset.tiles);
      const plan = {
        group: pool,
        rackSubset: subset,
        score: (analysis.score || 0)
          + (subset.score || 0)
          + pool.length * 10
          + (closureMeta.scoreBoost || 0)
          - (closureMeta.usesJoker ? 12 : 0),
        stage: subset.size > 0 ? "free-plus-rack" : "free-only",
        closureKind: closureMeta.kind
      };
      if (!best || plan.score > best.score) {
        best = plan;
      }
    }

    return best;
  }

  getChainTailSubsetCandidates(state, ctx, freeTiles, budget, options = {}) {
    const maxRackSubsetSize = Math.max(
      0,
      Math.min(
        options.maxRackSubsetSize ?? budget.maxRackSubsetSize ?? 0,
        this.config.chainTailClosureMicroRackMax ?? budget.maxRackSubsetSize ?? 0
      )
    );
    if (maxRackSubsetSize <= 0) return [];

    const protectedSubsets = options.preferProtected
      ? this.getProtectedRackSubsets(state, ctx, freeTiles)
      : [];
    const enumeratedSubsets = RummyAIUtils.enumerateRackSubsets(state.rack, { maxSize: maxRackSubsetSize, ctx });
    const subsetMap = new Map();
    [...protectedSubsets, ...enumeratedSubsets].forEach(subset => {
      if (!subset || subset.size < 1 || subset.size > maxRackSubsetSize) return;
      const key = (subset.ids || []).join(",");
      const current = subsetMap.get(key);
      if (!current || (subset.score || 0) > (current.score || 0)) {
        subsetMap.set(key, subset);
      }
    });
    const rawSubsets = [...subsetMap.values()];
    const maxSubsetCandidates = Math.max(6, options.maxSubsetCandidates || 12);

    return rawSubsets
      .map(subset => {
        const pool = normalizeGroupTiles([...freeTiles, ...subset.tiles]);
        const analysis = pool.length >= 3 ? RummyRules.explainGroup(pool) : { valid: false };
        const closureMeta = analysis.valid
          ? this.describeChainTailClosure(pool, freeTiles, subset.tiles)
          : { kind: "invalid", scoreBoost: -999, usesJoker: subset.tiles.some(tile => tile.joker) };
        const noJokerBonus = closureMeta.usesJoker ? 0 : 12;
        const subsetSizeBias = subset.size === 1 ? 14 : subset.size === 2 ? 6 : 2;
        return {
          ...subset,
          closureMeta,
          rankingScore: (closureMeta.scoreBoost || 0) + noJokerBonus + subsetSizeBias + (subset.score || 0)
        };
      })
      .sort((a, b) =>
        (b.rankingScore || 0) - (a.rankingScore || 0)
        || (a.size || 0) - (b.size || 0)
        || ((b.score || 0) - (a.score || 0))
      )
      .slice(0, maxSubsetCandidates);
  }

  describeChainTailClosure(pool, freeTiles, rackTiles = []) {
    const analysis = RummyRules.explainGroup(pool);
    const freeNonJokers = (freeTiles || []).filter(tile => !tile.joker);
    const rackNonJokers = (rackTiles || []).filter(tile => !tile.joker);
    const usesJoker = pool.some(tile => tile.joker);
    if (!analysis.valid) {
      return { kind: "invalid", scoreBoost: -999, usesJoker };
    }

    const allNonJokers = [...freeNonJokers, ...rackNonJokers];
    if (allNonJokers.length > 0 && allNonJokers.every(tile => tile.number === allNonJokers[0].number)) {
      return { kind: "same-number", scoreBoost: 34, usesJoker };
    }

    if (analysis.kind === "run" || analysis.kind === "wild") {
      const freeNumbers = freeNonJokers.map(tile => tile.number).sort((a, b) => a - b);
      const rackNumbers = rackNonJokers.map(tile => tile.number).sort((a, b) => a - b);
      const freeMin = freeNumbers.length > 0 ? freeNumbers[0] : null;
      const freeMax = freeNumbers.length > 0 ? freeNumbers[freeNumbers.length - 1] : null;
      const directAppend = rackNumbers.length > 0
        && freeMin != null
        && rackNumbers.every(number => number < freeMin || number > freeMax);
      const gapFill = rackNumbers.length > 0
        && freeMin != null
        && rackNumbers.some(number => number > freeMin && number < freeMax);
      if (directAppend) {
        return { kind: "direct-run-end", scoreBoost: 26, usesJoker };
      }
      if (gapFill) {
        return { kind: "single-gap", scoreBoost: 20, usesJoker };
      }
    }

    return { kind: "generic", scoreBoost: 10, usesJoker };
  }

  estimateDonorRetainedClosurePotential(ctx, freeTiles, retainedPlans = []) {
    if (!freeTiles?.length || !retainedPlans?.length) return 0;
    const validGroups = RummyAIUtils.getValidGroupsFromTiles(
      freeTiles,
      ctx.poolGroupCache,
      {
        maxSize: freeTiles.length,
        ctx
      }
    );
    for (const donorPlan of retainedPlans) {
      const looseIds = (donorPlan.looseTiles || []).map(tile => tile.id);
      if (looseIds.length === 0) continue;
      const matches = validGroups.some(group =>
        looseIds.every(id => group.ids.includes(id))
        && (!donorPlan.sourceKind || donorPlan.sourceKind === "wild" || group.kind === donorPlan.sourceKind || group.kind === "wild")
      );
      if (matches) return 20;
    }
    return 0;
  }

  estimateChainTailClosurePotential(state, ctx, input) {
    const freeTiles = normalizeGroupTiles([...(input?.freeTiles || [])]);
    const retainedPlans = input?.retainedPlans || [];
    const budget = input?.budget || {};
    if (freeTiles.length === 0) {
      return { score: 100, stage: "closed", tailPlan: null };
    }

    const preview = this.findChainAppendTailPlan(state, ctx, freeTiles, budget, {
      preferProtected: true,
      maxRackSubsetSize: this.config.chainTailClosureMicroRackMax ?? budget.maxRackSubsetSize,
      maxSubsetCandidates: this.level >= 6 ? 14 : 10
    });

    let score = 0;
    if (preview?.group) {
      const rackSize = preview.rackSubset?.size || 0;
      if (rackSize === 0) score += 80;
      else if (rackSize === 1) score += 55;
      else if (rackSize === 2) score += 35;
      else score += 24;
      score += preview.score || 0;
    } else {
      score += this.estimateDonorRetainedClosurePotential(ctx, freeTiles, retainedPlans);
    }

    if (preview?.group?.some(tile => tile.joker)) {
      score -= 12;
    }
    if (!preview?.group && freeTiles.length >= 4) {
      score -= 18;
    }

    return {
      score,
      stage: preview?.stage || (score > 0 ? "retained-assist" : "none"),
      tailPlan: preview || null
    };
  }

  cloneChainAppendPlan(plan) {
    return {
      ...plan,
      donorGroupIndices: [...(plan.donorGroupIndices || [])],
      recipientGroupIndices: [...(plan.recipientGroupIndices || [])],
      donorPlans: (plan.donorPlans || []).map(entry => ({
        ...entry,
        freedTiles: deepCopy(entry.freedTiles || []),
        retainedGroups: deepCopy(entry.retainedGroups || []),
        looseTiles: deepCopy(entry.looseTiles || [])
      })),
      retainedGroups: deepCopy(plan.retainedGroups || []),
      recipientExtensions: deepCopy(plan.recipientExtensions || []),
      recipientExtensionBuckets: deepCopy(plan.recipientExtensionBuckets || []),
      originalFreeTiles: deepCopy(plan.originalFreeTiles || []),
      remainingFreeTiles: deepCopy(plan.remainingFreeTiles || []),
      tailPlan: plan.tailPlan
        ? {
            ...plan.tailPlan,
            group: plan.tailPlan.group ? deepCopy(plan.tailPlan.group) : null,
            rackSubset: plan.tailPlan.rackSubset
              ? {
                  ...plan.tailPlan.rackSubset,
                  ids: [...(plan.tailPlan.rackSubset.ids || [])],
                  tiles: deepCopy(plan.tailPlan.rackSubset.tiles || [])
                }
              : { ids: [], tiles: [], size: 0, score: 0 }
          }
        : null,
      budget: { ...(plan.budget || {}) },
      repairFlags: { ...(plan.repairFlags || {}) }
    };
  }

  buildChainPlanResult(state, ctx, plan) {
    const consumedIds = new Set();
    for (const extension of plan.recipientExtensions || []) {
      for (const tileId of extension.consumedIds || []) {
        if (consumedIds.has(tileId)) {
          return { candidate: null, finishable: false, rejectReason: "invalidRecipient" };
        }
        consumedIds.add(tileId);
      }
    }

    const recipientValid = (plan.recipientExtensions || []).every(extension =>
      RummyRules.explainGroup(extension.resultGroup || []).valid
    );
    if (!recipientValid) {
      return { candidate: null, finishable: false, rejectReason: "invalidRecipient" };
    }

    const retainedValid = (plan.retainedGroups || []).every(group => RummyRules.analyzeGroup(group).valid);
    if (!retainedValid) {
      return { candidate: null, finishable: false, rejectReason: "invalidRetained" };
    }

    if (plan.tailPlan?.group && !RummyRules.analyzeGroup(plan.tailPlan.group).valid) {
      return { candidate: null, finishable: false, rejectReason: "tailMissing" };
    }
    if ((plan.remainingFreeTiles?.length || 0) > 0 && !plan.tailPlan?.group) {
      return {
        candidate: null,
        finishable: false,
        rejectReason: plan.budget.requireAllFreedTilesUsedOrRetained ? "leftoverFreeTiles" : "tailMissing"
      };
    }

    const candidate = this.buildChainAppendCandidate(state, ctx, plan);
    if (!candidate) {
      return { candidate: null, finishable: false, rejectReason: "noRepairFound" };
    }
    const finishable = this.canFinishTurn(candidate, ctx);
    return { candidate, finishable, rejectReason: finishable ? null : "noRepairFound" };
  }

  applyChainDonorReclose(ctx, plan) {
    let repaired = false;
    for (const donorPlan of plan.donorPlans || []) {
      if (!donorPlan.looseTiles || donorPlan.looseTiles.length === 0) continue;
      const looseIds = donorPlan.looseTiles.map(tile => tile.id);
      if (!looseIds.every(id => plan.remainingFreeTiles.some(tile => tile.id === id))) continue;
      const validGroups = RummyAIUtils.getValidGroupsFromTiles(
        plan.remainingFreeTiles,
        ctx.poolGroupCache,
        {
          maxSize: plan.remainingFreeTiles.length,
          ctx
        }
      );
      const candidates = validGroups
        .filter(group => looseIds.every(id => group.ids.includes(id)))
        .filter(group => {
          if (!donorPlan.sourceKind || donorPlan.sourceKind === "wild") return true;
          return group.kind === donorPlan.sourceKind || group.kind === "wild";
        })
        .sort((a, b) =>
          b.score - a.score
          || a.ids.length - b.ids.length
        );
      if (candidates.length === 0) continue;
      const chosen = candidates[0];
      const chosenIds = new Set(chosen.ids);
      plan.retainedGroups.push(normalizeGroupTiles(deepCopy(chosen.tiles)));
      plan.remainingFreeTiles = plan.remainingFreeTiles.filter(tile => !chosenIds.has(tile.id));
      repaired = true;
    }
    return repaired;
  }

  rebuildChainPlanWithRecipients(state, ctx, plan, recipientExtensions, options = {}) {
    const nextPlan = this.cloneChainAppendPlan(plan);
    nextPlan.recipientExtensions = deepCopy(recipientExtensions);
    const consumedIds = new Set();
    nextPlan.recipientExtensions.forEach(extension => {
      (extension.consumedIds || []).forEach(id => consumedIds.add(id));
    });
    nextPlan.remainingFreeTiles = (plan.originalFreeTiles || []).filter(tile => !consumedIds.has(tile.id));
    nextPlan.retainedGroups = deepCopy(plan.retainedGroups || []);
    if (options.recloseDonor) {
      nextPlan.repairFlags.chainRepairDonorClosed = this.applyChainDonorReclose(ctx, nextPlan) ? 1 : 0;
    }
    nextPlan.tailPlan = this.findChainAppendTailPlan(
      state,
      ctx,
      nextPlan.remainingFreeTiles,
      nextPlan.budget,
      options.tailOptions || {}
    );
    nextPlan.tailClosurePotential = this.estimateChainTailClosurePotential(state, ctx, {
      freeTiles: nextPlan.remainingFreeTiles,
      retainedPlans: nextPlan.donorPlans,
      recipientExtensions: nextPlan.recipientExtensions,
      budget: nextPlan.budget
    }).score;
    return nextPlan;
  }

  recordSuccessfulChainRepair(ctx, plan) {
    const repairFlags = plan?.repairFlags || {};
    const repaired = repairFlags.chainRepairDonorClosed
      || repairFlags.chainRepairRollbackUsed
      || repairFlags.chainRepairFinishable;
    if (repaired) {
      this.markChainRepair(ctx, "repairedFinishable");
    }
    if (repairFlags.chainRepairDonorClosed) {
      this.markChainRepair(ctx, "donorReclosed");
      this.markChainRepair(ctx, "retainedAssistTail");
    }
    if (repairFlags.chainRepairRollbackUsed) {
      this.markChainRepair(ctx, "recipientRollback");
    }
    if (repairFlags.chainRepairRollbackTailAware) {
      this.markChainRepair(ctx, "recipientRollbackTailAware");
    }
    if (repairFlags.chainRepairMicroTailBuilt) {
      this.markChainRepair(ctx, "microTailBuilt");
    }
    if (plan?.tailPlan?.stage === "free-only") {
      this.markChainRepair(ctx, "freeOnlyTail");
    } else if (plan?.tailPlan?.stage === "free-plus-rack") {
      this.markChainRepair(ctx, "freePlusRackTail");
    }
  }

  tryChainPlanWithMicroTail(state, ctx, plan, repairFlags = {}) {
    let attempt = this.buildChainPlanResult(state, ctx, plan);
    const fallbackCandidate = attempt.candidate || null;
    if (attempt.candidate && attempt.finishable) {
      this.recordSuccessfulChainRepair(ctx, plan);
      return {
        candidate: attempt.candidate,
        plan,
        rejectReason: null
      };
    }

    const shouldTryMicroTail = ctx.featureFlags?.chainRepair
      && (plan.remainingFreeTiles?.length || 0) <= 3
      && (plan.remainingFreeTiles?.length || 0) >= 1;
    if (!shouldTryMicroTail) {
      return {
        candidate: fallbackCandidate,
        plan,
        rejectReason: attempt.rejectReason || "noRepairFound"
      };
    }

    const microPlan = this.cloneChainAppendPlan(plan);
    microPlan.tailPlan = this.findChainAppendTailPlan(
      state,
      ctx,
      microPlan.remainingFreeTiles,
      microPlan.budget,
      {
        preferProtected: true,
        maxRackSubsetSize: this.config.chainTailClosureMicroRackMax ?? (this.level >= 6 ? 3 : 2),
        maxSubsetCandidates: this.level >= 6 ? 14 : 10
      }
    );
    microPlan.repairFlags = {
      ...(plan.repairFlags || {}),
      ...repairFlags,
      chainRepairMicroTailBuilt: microPlan.tailPlan?.group ? 1 : 0,
      chainRepairFinishable: 1
    };
    attempt = this.buildChainPlanResult(state, ctx, microPlan);
    if (attempt.candidate && attempt.finishable) {
      this.recordSuccessfulChainRepair(ctx, microPlan);
      return {
        candidate: attempt.candidate,
        plan: microPlan,
        rejectReason: null
      };
    }

    return {
      candidate: fallbackCandidate || attempt.candidate || null,
      plan: microPlan,
      rejectReason: attempt.rejectReason || "noRepairFound"
    };
  }

  repairChainToFinishable(state, ctx, plan, options = {}) {
    const basePlan = this.cloneChainAppendPlan(plan);
    let outcome = this.tryChainPlanWithMicroTail(state, ctx, basePlan, basePlan.repairFlags || {});
    if (outcome.candidate && !outcome.rejectReason) return outcome;

    let lastRejectReason = outcome.rejectReason || "noRepairFound";
    let fallbackCandidate = outcome.candidate || null;
    let fallbackPlan = outcome.plan || basePlan;
    if (ctx.featureFlags?.chainRepair) {
      const donorPlan = this.cloneChainAppendPlan(plan);
      const donorClosed = this.applyChainDonorReclose(ctx, donorPlan);
      if (donorClosed) {
        donorPlan.repairFlags = {
          ...(donorPlan.repairFlags || {}),
          chainRepairDonorClosed: 1,
          chainRepairFinishable: 1
        };
        donorPlan.tailPlan = this.findChainAppendTailPlan(state, ctx, donorPlan.remainingFreeTiles, donorPlan.budget);
        donorPlan.tailClosurePotential = this.estimateChainTailClosurePotential(state, ctx, {
          freeTiles: donorPlan.remainingFreeTiles,
          retainedPlans: donorPlan.donorPlans,
          recipientExtensions: donorPlan.recipientExtensions,
          budget: donorPlan.budget
        }).score;
        outcome = this.tryChainPlanWithMicroTail(state, ctx, donorPlan, donorPlan.repairFlags);
        if (outcome.candidate && !outcome.rejectReason) return outcome;
        lastRejectReason = outcome.rejectReason || lastRejectReason;
        if (!fallbackCandidate && outcome.candidate) {
          fallbackCandidate = outcome.candidate;
          fallbackPlan = outcome.plan || donorPlan;
        }
      }

      if ((plan.recipientExtensions || []).length > 1) {
        const rollbackPlans = [...plan.recipientExtensions]
          .map((extension, index) => {
            const recipientExtensions = plan.recipientExtensions.filter((_, entryIndex) => entryIndex !== index);
            const rollbackPlan = this.rebuildChainPlanWithRecipients(
              state,
              ctx,
              plan,
              recipientExtensions,
              { recloseDonor: true }
            );
            rollbackPlan.repairFlags = {
              ...(rollbackPlan.repairFlags || {}),
              chainRepairRollbackUsed: 1,
              chainRepairFinishable: 1
            };
            const tailPotential = this.estimateChainTailClosurePotential(state, ctx, {
              freeTiles: rollbackPlan.remainingFreeTiles,
              retainedPlans: rollbackPlan.donorPlans,
              recipientExtensions: rollbackPlan.recipientExtensions,
              budget: rollbackPlan.budget
            });
            rollbackPlan.tailClosurePotential = tailPotential.score;
            return {
              index,
              extension,
              rollbackPlan,
              tailPotential
            };
          })
          .sort((a, b) =>
            (b.tailPotential.score || 0) - (a.tailPotential.score || 0)
            || ((a.extension.score || 0) - (b.extension.score || 0))
          );
        for (const removal of rollbackPlans) {
          const rollbackPlan = removal.rollbackPlan;
          rollbackPlan.repairFlags = {
            ...(rollbackPlan.repairFlags || {}),
            chainRepairRollbackTailAware: this.config.chainTailClosureRollbackAware ? 1 : 0
          };
          outcome = this.tryChainPlanWithMicroTail(state, ctx, rollbackPlan, rollbackPlan.repairFlags);
          if (outcome.candidate && !outcome.rejectReason) return outcome;
          lastRejectReason = outcome.rejectReason || lastRejectReason;
          if (!fallbackCandidate && outcome.candidate) {
            fallbackCandidate = outcome.candidate;
            fallbackPlan = outcome.plan || rollbackPlan;
          }
          if (this.level <= 5) break;
        }
      }

      if (this.level >= 6) {
        for (let index = 0; index < (plan.recipientExtensions || []).length; index += 1) {
          const extension = plan.recipientExtensions[index];
          if ((extension.sameRecipientDouble || 0) <= 0) continue;
          const bucket = plan.recipientExtensionBuckets?.[index] || [];
          const smaller = bucket.find(candidate =>
            (candidate.consumedTiles?.length || 0) < (extension.consumedTiles?.length || 0)
          );
          if (!smaller) continue;
          const recipientExtensions = plan.recipientExtensions.map((entry, entryIndex) =>
            entryIndex === index ? deepCopy(smaller) : deepCopy(entry)
          );
          const rollbackPlan = this.rebuildChainPlanWithRecipients(
            state,
            ctx,
            plan,
            recipientExtensions,
            { recloseDonor: true }
          );
          rollbackPlan.repairFlags = {
            ...(rollbackPlan.repairFlags || {}),
            chainRepairRollbackUsed: 1,
            chainRepairFinishable: 1
          };
          outcome = this.tryChainPlanWithMicroTail(state, ctx, rollbackPlan, rollbackPlan.repairFlags);
          if (outcome.candidate && !outcome.rejectReason) return outcome;
          lastRejectReason = outcome.rejectReason || lastRejectReason;
          if (!fallbackCandidate && outcome.candidate) {
            fallbackCandidate = outcome.candidate;
            fallbackPlan = outcome.plan || rollbackPlan;
          }
          break;
        }
      }
    }

    if ((lastRejectReason === "tailMissing" || lastRejectReason === "leftoverFreeTiles" || lastRejectReason === "noRepairFound")
      && (fallbackPlan?.tailClosurePotential ?? plan.tailClosurePotential ?? 0) < 20) {
      this.markChainReject(ctx, "tailClosureLowPotential");
    }
    this.markChainReject(ctx, lastRejectReason || "noRepairFound");
    return {
      candidate: fallbackCandidate,
      plan: fallbackPlan,
      rejectReason: lastRejectReason || "noRepairFound"
    };
  }

  buildChainAppendCandidate(state, ctx, plan) {
    if (
      plan.budget.requireAllFreedTilesUsedOrRetained
      && (plan.remainingFreeTiles?.length || 0) > 0
    ) {
      return null;
    }

    const sourceGroupIndices = Array.from(new Set([
      ...plan.donorGroupIndices,
      ...plan.recipientGroupIndices
    ])).sort((a, b) => a - b);
    const createdGroups = [
      ...plan.recipientExtensions.map(extension => extension.resultGroup)
    ];
    if (plan.tailPlan?.group) {
      createdGroups.push(plan.tailPlan.group);
    }

    const structuralGain = plan.recipientExtensions.reduce((sum, extension) => sum + extension.consumedTiles.length, 0)
      + (plan.tailPlan?.group ? 1 : 0)
      + (plan.recipientExtensions.length >= 2 ? 1 : 0);
    if (structuralGain < (plan.budget.minStructuralGain || 0)) return null;
    if (sourceGroupIndices.length > (plan.budget.maxTouchedGroups || sourceGroupIndices.length)) return null;

    const sourceTableIds = sourceGroupIndices
      .flatMap(index => state.table[index].map(tile => tile.id));
    const detailParts = [
      `${plan.donorGroupIndices.map(index => `${index + 1}번 줄`).join(", ")}에서 뺀 타일로 `
      + `${plan.recipientGroupIndices.map(index => `${index + 1}번 줄`).join(", ")}을 연장하세요.`
    ];
    if (plan.tailPlan?.group) {
      detailParts.push(`남은 타일은 ${formatTileList(plan.tailPlan.group)} 새 줄로 만드세요.`);
    }

    return this.createRearrangedState(state, ctx, {
      mode: "chain-append",
      sourceGroupIndices,
      sourceTableIds,
      sourceRackIds: plan.tailPlan?.rackSubset?.ids || [],
      retainedGroups: plan.retainedGroups,
      createdGroups,
      detailText: detailParts.join(" "),
      jokerAssignments: createdGroups.flatMap(group => RummyRules.explainGroup(group).jokerAssignments || []),
      statBoost: {
        chainAppendCount: plan.recipientExtensions.length,
        chainAppendMultiRecipient: plan.recipientExtensions.length >= 2 ? 1 : 0,
        chainAppendSameRecipientDouble: plan.recipientExtensions.some(extension => extension.sameRecipientDouble > 0) ? 1 : 0,
        chainAppendTailBuilt: plan.tailPlan?.group ? 1 : 0,
        chainRepairFinishable: plan.repairFlags?.chainRepairFinishable ? 1 : 0,
        chainRepairRollbackUsed: plan.repairFlags?.chainRepairRollbackUsed ? 1 : 0,
        chainRepairDonorClosed: plan.repairFlags?.chainRepairDonorClosed ? 1 : 0,
        chainTailClosed: plan.tailPlan?.group ? 1 : 0,
        chainTailClosedWithRack: (plan.tailPlan?.rackSubset?.size || 0) > 0 ? 1 : 0,
        chainTailClosedAfterRollback: plan.repairFlags?.chainRepairRollbackUsed ? 1 : 0
      }
    });
  }

  generateChainAppendMoves(state, ctx) {
    if (!this.config.allowChainAppend) return [];

    const budget = this.getGeneratorBudget("chain-append");
    const donorCombos = RummyAIUtils.getTableGroupCombos(
      state.table,
      budget.maxDonorGroups || 1,
      Math.min(this.config.maxGroupComboBranches || 8, 10)
    ).filter(combo => combo.indices.length >= 1 && combo.indices.length <= (budget.maxDonorGroups || 1));
    const candidates = [];
    const candidateLimit = Math.max((this.config.chainAppendQuota || 4) * 6, 12);

    for (const donorCombo of donorCombos) {
      if (this.isTimedOut(ctx) || candidates.length >= candidateLimit) break;

        const donorPlanBuckets = donorCombo.indices.map(index =>
          this.getFlexibleExtractionPlans(state.table[index], ctx, {
            maxRemove: Math.min(2, budget.maxFreeTableTiles || 4),
            maxSolutions: 2,
            maxLooseTiles: Math.min(2, budget.maxFreeTableTiles || 4)
          }).slice(0, 6)
        );
      if (donorPlanBuckets.some(bucket => bucket.length === 0)) continue;

      const continueDonorPlans = RummyAIUtils.cartesianPick(donorPlanBuckets, ctx, (selectedPlans) => {
        if (this.isTimedOut(ctx) || candidates.length >= candidateLimit) return false;

        const donorGroupIndices = [...donorCombo.indices];
        const retainedGroups = selectedPlans.flatMap(plan => deepCopy(plan.retainedGroups || []));
        const freeTiles = selectedPlans.flatMap(plan => [...plan.freedTiles, ...plan.looseTiles]);
        if (freeTiles.length === 0 || freeTiles.length > (budget.maxFreeTableTiles || 4)) return true;

        const availableRecipientIndices = state.table
          .map((_, index) => index)
          .filter(index => !donorGroupIndices.includes(index));
        const maxRecipientGroups = Math.min(
          budget.maxRecipientGroups || 1,
          Math.max(0, (budget.maxTouchedGroups || 2) - donorGroupIndices.length)
        );
        if (maxRecipientGroups <= 0) return true;

        const recipientCombos = this.getChainAppendRecipientCombos(availableRecipientIndices, maxRecipientGroups);
        for (const recipientGroupIndices of recipientCombos) {
          if (this.isTimedOut(ctx) || candidates.length >= candidateLimit) return false;

          const extensionBuckets = recipientGroupIndices.map(index =>
            this.enumerateRecipientExtensions(state.table[index], freeTiles, {
              ctx,
              directOnly: budget.directOnly,
              allowGapFill: budget.allowGapFill,
              allowTwoTileSameRecipient: budget.allowTwoTileSameRecipient,
              maxRecipientExtensionsPerGroup: budget.maxRecipientExtensionsPerGroup
            })
          );
          if (extensionBuckets.some(bucket => bucket.length === 0)) continue;

          const recipientPlans = [];
          const continueRecipients = RummyAIUtils.cartesianPick(extensionBuckets, ctx, (recipientExtensions) => {
            if (this.isTimedOut(ctx) || candidates.length >= candidateLimit) return false;

            const consumedIds = new Set();
            for (const extension of recipientExtensions) {
              for (const tileId of extension.consumedIds) {
                if (consumedIds.has(tileId)) return true;
                consumedIds.add(tileId);
              }
            }

            const remainingFreeTiles = freeTiles.filter(tile => !consumedIds.has(tile.id));
            const tailPotential = this.estimateChainTailClosurePotential(state, ctx, {
              freeTiles: remainingFreeTiles,
              retainedPlans: selectedPlans,
              recipientExtensions,
              budget
            });
            const structureScore = recipientExtensions.reduce((sum, extension) => sum + (extension.score || 0), 0)
              + recipientExtensions.length * 20
              + (recipientExtensions.some(extension => extension.sameRecipientDouble > 0) ? 12 : 0);
            recipientPlans.push({
              recipientExtensions: deepCopy(recipientExtensions),
              remainingFreeTiles,
              tailPlan: tailPotential.tailPlan,
              tailClosurePotential: tailPotential.score,
              rankingScore: tailPotential.score * (this.config.chainTailClosureBias || 1) + structureScore
            });
            return true;
          });
          if (continueRecipients === false) return false;

          recipientPlans
            .sort((a, b) =>
              (b.rankingScore || 0) - (a.rankingScore || 0)
              || ((b.tailClosurePotential || 0) - (a.tailClosurePotential || 0))
            )
            .slice(0, Math.max(4, (this.config.chainAppendQuota || 4) * 2))
            .forEach(planEntry => {
              if (this.isTimedOut(ctx) || candidates.length >= candidateLimit) return;
              if ((planEntry.tailClosurePotential || 0) < 0) {
                this.markChainReject(ctx, "tailClosureLowPotential");
                return;
              }
              const chainPlan = {
                donorGroupIndices,
                donorPlans: selectedPlans,
                recipientGroupIndices,
                retainedGroups,
                recipientExtensions: planEntry.recipientExtensions,
                recipientExtensionBuckets: extensionBuckets,
                originalFreeTiles: freeTiles,
                remainingFreeTiles: planEntry.remainingFreeTiles,
                tailPlan: planEntry.tailPlan,
                tailClosurePotential: planEntry.tailClosurePotential,
                budget,
                repairFlags: {}
              };
              const repaired = this.repairChainToFinishable(state, ctx, chainPlan);
              if (repaired.candidate) candidates.push(repaired.candidate);
            });
        }
        return candidates.length < candidateLimit;
      });
      if (continueDonorPlans === false) break;
    }

    if (ctx.debugEnabled) {
      candidates.forEach(candidate => this.markCandidateType(ctx, candidate, "generated"));
    }
    return candidates;
  }

  generateDualGroupBridgeMoves(state, ctx) {
    const candidates = [];
    const budget = this.getGeneratorBudget("bridge");
    const combos = RummyAIUtils.getTableGroupCombos(
      state.table,
      Math.min(budget.maxTouchedGroups || this.config.maxTouchedGroups || 2, 2),
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
              maxSolutions: budget.maxPartitionSolutions || this.config.maxPartitionSolutionsBridge || 4,
              ctx
            });
            const removedJoker = removedTiles.find(tile => tile.joker);
            partitions.slice(0, budget.maxPartitionSolutions || this.config.maxPartitionSolutionsBridge || 4).forEach(partition => {
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
          maxSolutions: 2,
          ctx
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
                maxSolutions,
                ctx
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
          maxSolutions: 2,
          ctx
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
    const budget = this.getGeneratorBudget("exact");
    const groupCombos = RummyAIUtils.getTableGroupCombos(
      state.table,
      budget.maxTouchedGroups || this.config.maxTouchedGroups,
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
          maxSolutions: budget.maxPartitionSolutions || this.config.maxPartitionSolutions,
          ctx
        });

        partitions.slice(0, budget.maxPartitionSolutions || this.config.maxPartitionSolutions || 6).forEach(partition => {
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

    if (ctx.debugEnabled) {
      candidates.forEach(candidate => this.markCandidateType(ctx, candidate, "generated"));
    }
    return candidates;
  }

  isReserveWorthyChainCandidate(candidate) {
    if (!candidate) return false;
    const stats = candidate.stats || {};
    return (stats.chainAppendMultiRecipient || 0) > 0
      || (stats.chainAppendTailBuilt || 0) > 0
      || (stats.chainAppendSameRecipientDouble || 0) > 0
      || (candidate.rackReduction || 0) >= 2;
  }

  generateRearrangementMoves(state, ctx) {
    const buckets = [];
    const reservedBuckets = [];
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
    if (this.modeEnabled("chain-append")) {
      const chainCandidates = this.pickQuota(
        this.generateChainAppendMoves(state, ctx),
        ctx,
        this.config.chainAppendQuota ?? this.config.maxRearrangeBranches
      );
      if (ctx.debugEnabled) {
        chainCandidates.forEach(candidate => this.markCandidateType(ctx, candidate, "afterQuota"));
      }
      const reserve = Math.max(0, this.config.chainAppendReserve || 0);
      reservedBuckets.push(
        ...chainCandidates
          .filter(candidate => this.isReserveWorthyChainCandidate(candidate))
          .slice(0, reserve)
      );
      buckets.push(...chainCandidates);
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
      const exactCandidates = this.pickQuota(
        this.generateExactCoverRearrangementMoves(state, ctx),
        ctx,
        this.config.exactQuota ?? this.config.maxRearrangeBranches
      );
      if (ctx.debugEnabled) {
        exactCandidates.forEach(candidate => this.markCandidateType(ctx, candidate, "afterQuota"));
      }
      buckets.push(...exactCandidates);
    }

    const finalMoves = this.dedupeAndSortCandidatesWithReserve(
      buckets,
      ctx,
      this.config.maxRearrangeBranches,
      reservedBuckets
    );
    if (ctx.debugEnabled) {
      finalMoves.forEach(candidate => this.markCandidateType(ctx, candidate, "afterReserve"));
    }
    return finalMoves;
  }
}
