class RummyHintEngine {
  static copySearchMeta(target, move) {
    target.searchTruncated = !!move?.searchTruncated;
    target.partial = !!move?.partial;
    target.partialReason = move?.partialReason || null;
    target.searchPhase = move?.searchPhase || null;
    if (target.searchTruncated) {
      target.truncationNote = "Current best within the explored search window.";
    }
    return target;
  }

  static buildStrategicDrawComment(move) {
    if (move.drawReasonCode === "hold-opening") {
      return {
        title: "AI-6 Hint",
        summary: move.summary || "Hold opening",
        shortText: "Strategic draw",
        reason: "Opening is possible later, but the current play weakens the rack too much. Preserving shape is stronger here.",
        leadText: "Recommendation: draw one tile instead of forcing the opening now.",
        steps: ["Use Draw to end the turn with a stronger rack shape."],
        futureBenefit: "This keeps a better opening conversion for a later turn."
      };
    }
    if (move.drawReasonCode === "preserve-shape") {
      return {
        title: "AI-6 Hint",
        summary: move.summary || "Preserve shape",
        shortText: "Strategic draw",
        reason: "There is a playable line, but it damages the rack structure more than it helps.",
        leadText: "Recommendation: draw one tile and keep the better shape.",
        steps: ["Use Draw instead of spending the current structure."],
        futureBenefit: "The rack stays more flexible for a stronger follow-up."
      };
    }
    return {
      title: "AI-6 Hint",
      summary: move.summary || "Fish for completion",
      shortText: "Strategic draw",
      reason: "A draw has higher expected value than the immediate low-impact play.",
      leadText: "Recommendation: draw one tile and improve the next turn.",
      steps: ["Use Draw to keep the higher-value plan alive."],
      futureBenefit: "A useful draw improves the next turn more than the current move."
    };
  }

  static buildNoMoveHint(gameState) {
    const openingPending = !!(gameState.ruleOptions.initial30 && !gameState.currentPlayer.opened);
    return {
      title: "AI-6 Hint",
      summary: "1장 뽑기",
      shortText: openingPending ? "No opening line" : "No move found",
      reason: openingPending
        ? "No valid opening-30 line was found in the current search window."
        : "No legal improvement was found in the current search window.",
      leadText: "Recommendation: draw one tile.",
      moveType: "draw",
      score: 0,
      rackTileIds: [],
      tableTileIds: [],
      targetGroupIndices: [],
      steps: ["Use Draw to continue the turn."],
      openingScore: 0,
      hintSource: "no-move",
      engineMissFallback: true,
      searchTruncated: false,
      partial: false,
      partialReason: null,
      searchPhase: null
    };
  }

  static buildHintFromMove(gameState, move) {
    const tileLookup = new Map(
      [...gameState.currentPlayer.rack, ...gameState.table.flat(), ...move.table.flat()].map(tile => [tile.id, tile])
    );
    const rackTileIds = new Set();
    const tableTileIds = new Set();
    const targetGroupIndices = new Set();
    const touchedGroupLabels = new Set();
    const createdGroupsSummary = [];
    const preservedGroupsSummary = [];
    const steps = [];
    const openingBreakdown = (move.openingDetails || []).map(group =>
      `${formatTileList(group.tiles || [])} = ${group.score}`
    );

    (move.actions || []).forEach(action => {
      const sourceRackTiles = (action.sourceRackIds || []).map(id => tileLookup.get(id)).filter(Boolean);
      const sourceTableTiles = (action.sourceTableIds || []).map(id => tileLookup.get(id)).filter(Boolean);
      (action.sourceGroupIndices || []).forEach(index => touchedGroupLabels.add(`Group ${index + 1}`));

      if (action.type === "new-group") {
        (action.sourceRackIds || []).forEach(id => rackTileIds.add(id));
        findGroupIndicesByTileIds(move.table, [action.createdGroupIds]).forEach(index => targetGroupIndices.add(index));
        createdGroupsSummary.push(formatTileList((action.createdGroupIds || []).map(id => tileLookup.get(id)).filter(Boolean)));
        steps.push(`Create a new group from ${formatTileList(sourceRackTiles)}.`);
        return;
      }

      if (action.type === "append") {
        (action.sourceRackIds || []).forEach(id => rackTileIds.add(id));
        const resultIndices = findGroupIndicesByTileIds(move.table, [action.resultGroupIds]);
        resultIndices.forEach(index => targetGroupIndices.add(index));
        const targetIndex = resultIndices[0];
        steps.push(`Append ${formatTileList(sourceRackTiles)} to ${targetIndex !== undefined ? `Group ${targetIndex + 1}` : "the target group"}.`);
        return;
      }

      if (action.type === "rearrange") {
        (action.sourceRackIds || []).forEach(id => rackTileIds.add(id));
        (action.sourceTableIds || []).forEach(id => tableTileIds.add(id));
        findGroupIndicesByTileIds(move.table, action.resultGroupIds || []).forEach(index => targetGroupIndices.add(index));
        const sourceLabel = (action.sourceGroupIndices || []).map(index => `Group ${index + 1}`).join(", ");
        const sourceText = sourceTableTiles.length > 0 ? formatTileList(sourceTableTiles) : "selected table tiles";
        steps.push(`Rearrange ${sourceLabel || "the table"} using ${sourceText}${sourceRackTiles.length > 0 ? ` and ${formatTileList(sourceRackTiles)}` : ""}.`);
        (action.resultGroupIds || []).forEach(groupIds => {
          const targetIndex = findGroupIndicesByTileIds(move.table, [groupIds])[0];
          const groupTiles = groupIds.map(id => tileLookup.get(id)).filter(Boolean);
          if (groupTiles.length === 0) return;
          if ((action.sourceTableIds || []).some(id => groupIds.includes(id))) {
            preservedGroupsSummary.push(formatTileList(groupTiles));
          } else {
            createdGroupsSummary.push(formatTileList(groupTiles));
          }
          steps.push(`Finish ${targetIndex !== undefined ? `Group ${targetIndex + 1}` : "the result"} as ${formatTileList(groupTiles)}.`);
        });
      }
    });

    const openingScore = move.openingScore || 0;
    const futureBenefit = move.futureMobility > 0
      ? `This leaves ${move.futureMobility} rack tiles with future extension potential.`
      : "";
    const reason = !gameState.currentPlayer.opened && gameState.ruleOptions.initial30 && openingScore >= 30
      ? `This reaches the opening requirement with ${openingScore} points while reducing the rack by ${move.rackReduction || 0}.`
      : move.type === "rearrange"
        ? `This reduces the rack by ${move.rackReduction || 0} while keeping the table valid.`
        : `This is the best legal move found and reduces the rack by ${move.rackReduction || 0}.`;
    const leadText = move.type === "rearrange"
      ? `Recommendation: ${move.summary || "rearrange the table"}.`
      : move.type === "append"
        ? "Recommendation: append to the existing table."
        : `Recommendation: ${move.summary || "play the highlighted move"}.`;

    const hint = {
      title: "AI-6 Hint",
      summary: move.summary || "Best move",
      shortText: move.summary || move.type || "move",
      reason,
      leadText,
      moveType: move.type,
      score: move.score || 0,
      rackTileIds: [...rackTileIds],
      tableTileIds: [...tableTileIds],
      targetGroupIndices: [...targetGroupIndices],
      steps: steps.length > 0 ? steps : ["Play the highlighted line."],
      openingScore,
      openingBreakdown,
      touchedGroupLabels: [...touchedGroupLabels],
      createdGroupsSummary,
      preservedGroupsSummary,
      futureBenefit,
      hintSource: "move",
      engineMissFallback: false
    };

    return this.copySearchMeta(hint, move);
  }

  static buildDrawHint(gameState, move) {
    const comment = this.buildStrategicDrawComment(move);
    const hint = {
      title: comment.title,
      summary: comment.summary,
      shortText: comment.shortText,
      reason: comment.reason,
      leadText: comment.leadText,
      moveType: "draw",
      score: move.score || 0,
      rackTileIds: [],
      tableTileIds: [],
      targetGroupIndices: [],
      steps: comment.steps,
      futureBenefit: comment.futureBenefit || "",
      openingScore: 0,
      hintSource: "strategic-draw",
      engineMissFallback: false
    };
    return this.copySearchMeta(hint, move);
  }

  static buildHintFromMoveOrFallback(gameState, move) {
    if (!move) return this.buildNoMoveHint(gameState);
    if (move.type === "draw") return this.buildDrawHint(gameState, move);
    return this.buildHintFromMove(gameState, move);
  }

  static getHint(gameState, options = {}) {
    const parentReporter = options.reporter || null;
    const aiOptions = {
      ...options,
      reporter: parentReporter
        ? {
            onProgress: (payload) => {
              if (payload?.kind === "move" && payload.move) {
                parentReporter.onProgress?.({
                  kind: "hint",
                  hint: this.buildHintFromMoveOrFallback(gameState, payload.move),
                  searchPhase: payload.searchPhase || payload.move.searchPhase || null,
                  partialReason: payload.partialReason || payload.move.partialReason || null
                });
                return;
              }
              if (payload?.kind === "hint") {
                parentReporter.onProgress?.(payload);
              }
            },
            onMeta: (payload) => parentReporter.onMeta?.(payload)
          }
        : null
    };

    const move = RummyAI.chooseMove(gameState, 6, aiOptions);
    return this.buildHintFromMoveOrFallback(gameState, move);
  }
}
