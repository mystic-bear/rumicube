class RummyHintEngine {
  static copySearchMeta(target, move) {
    target.searchTruncated = !!move?.searchTruncated;
    target.partial = !!move?.partial;
    target.partialReason = move?.partialReason || null;
    target.searchPhase = move?.searchPhase || null;
    if (target.searchTruncated) {
      target.truncationNote = "현재 탐색 범위 기준 최선안입니다.";
    }
    return target;
  }

  static buildStrategicDrawComment(move) {
    if (move.drawReasonCode === "hold-opening") {
      return {
        title: "AI-6 힌트",
        summary: move.summary || "등록 보류",
        shortText: "전략 드로우",
        reason: "지금 등록은 가능하지만 손패 구조를 너무 약하게 만듭니다. 이 턴에는 형태를 보존하는 쪽이 더 좋습니다.",
        leadText: "추천: 지금 등록을 강행하기보다 1장을 뽑으세요.",
        steps: ["1장 뽑기로 턴을 넘기고 다음 턴 기회를 노리세요."],
        futureBenefit: "다음 턴에 더 안정적인 등록 전환을 노릴 수 있습니다."
      };
    }
    if (move.drawReasonCode === "preserve-shape") {
      return {
        title: "AI-6 힌트",
        summary: move.summary || "구조 보존",
        shortText: "전략 드로우",
        reason: "둘 수 있는 수는 있지만, 이 수는 얻는 것보다 손패 구조를 더 크게 해칩니다.",
        leadText: "추천: 지금은 1장을 뽑고 더 좋은 형태를 유지하세요.",
        steps: ["현재 구조를 소비하지 말고 1장을 뽑으세요."],
        futureBenefit: "손패 유연성을 유지해 다음 턴 더 강한 후속 수를 노릴 수 있습니다."
      };
    }
    return {
      title: "AI-6 힌트",
      summary: move.summary || "완성 대기",
      shortText: "전략 드로우",
      reason: "지금의 낮은 효율 수보다 1장을 뽑는 쪽의 기대값이 더 높습니다.",
      leadText: "추천: 1장을 뽑아 다음 턴 가치를 높이세요.",
      steps: ["더 큰 가치를 노릴 수 있도록 1장을 뽑으세요."],
      futureBenefit: "좋은 드로우 한 장이 현재 수보다 다음 턴을 더 크게 개선합니다."
    };
  }

  static buildNoMoveHint(gameState) {
    const openingPending = !!(gameState.ruleOptions.initial30 && !gameState.currentPlayer.opened);
    return {
      title: "AI-6 힌트",
      summary: "1장 뽑기",
      shortText: openingPending ? "등록 수 없음" : "유효 수 없음",
      reason: openingPending
        ? "현재 탐색 범위에서는 30점 등록을 만족하는 합법 수를 찾지 못했습니다."
        : "현재 탐색 범위에서는 더 나은 합법 수를 찾지 못했습니다.",
      leadText: "추천: 1장을 뽑으세요.",
      moveType: "draw",
      score: 0,
      rackTileIds: [],
      tableTileIds: [],
      targetGroupIndices: [],
      steps: ["1장 뽑기로 턴을 이어가세요."],
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
      (action.sourceGroupIndices || []).forEach(index => touchedGroupLabels.add(`${index + 1}번 줄`));

      if (action.type === "new-group") {
        (action.sourceRackIds || []).forEach(id => rackTileIds.add(id));
        findGroupIndicesByTileIds(move.table, [action.createdGroupIds]).forEach(index => targetGroupIndices.add(index));
        createdGroupsSummary.push(formatTileList((action.createdGroupIds || []).map(id => tileLookup.get(id)).filter(Boolean)));
        steps.push(`${formatTileList(sourceRackTiles)}로 새 줄을 만드세요.`);
        return;
      }

      if (action.type === "append") {
        (action.sourceRackIds || []).forEach(id => rackTileIds.add(id));
        const resultIndices = findGroupIndicesByTileIds(move.table, [action.resultGroupIds]);
        resultIndices.forEach(index => targetGroupIndices.add(index));
        const targetIndex = resultIndices[0];
        steps.push(`${formatTileList(sourceRackTiles)}를 ${targetIndex !== undefined ? `${targetIndex + 1}번 줄` : "대상 줄"}에 추가하세요.`);
        return;
      }

      if (action.type === "rearrange") {
        (action.sourceRackIds || []).forEach(id => rackTileIds.add(id));
        (action.sourceTableIds || []).forEach(id => tableTileIds.add(id));
        findGroupIndicesByTileIds(move.table, action.resultGroupIds || []).forEach(index => targetGroupIndices.add(index));
        const sourceLabel = (action.sourceGroupIndices || []).map(index => `${index + 1}번 줄`).join(", ");
        const sourceText = sourceTableTiles.length > 0 ? formatTileList(sourceTableTiles) : "선택한 테이블 타일";
        steps.push(`${sourceLabel || "테이블"}을 ${sourceText}${sourceRackTiles.length > 0 ? `, ${formatTileList(sourceRackTiles)}` : ""}와 함께 재배치하세요.`);
        (action.resultGroupIds || []).forEach(groupIds => {
          const targetIndex = findGroupIndicesByTileIds(move.table, [groupIds])[0];
          const groupTiles = groupIds.map(id => tileLookup.get(id)).filter(Boolean);
          if (groupTiles.length === 0) return;
          if ((action.sourceTableIds || []).some(id => groupIds.includes(id))) {
            preservedGroupsSummary.push(formatTileList(groupTiles));
          } else {
            createdGroupsSummary.push(formatTileList(groupTiles));
          }
          steps.push(`${targetIndex !== undefined ? `${targetIndex + 1}번 줄` : "결과 줄"}을 ${formatTileList(groupTiles)}로 완성하세요.`);
        });
      }
    });

    const openingScore = move.openingScore || 0;
    const futureBenefit = move.futureMobility > 0
      ? `이 수는 이후에 이어 붙일 수 있는 손패 ${move.futureMobility}장을 남깁니다.`
      : "";
    const reason = !gameState.currentPlayer.opened && gameState.ruleOptions.initial30 && openingScore >= 30
      ? `이 수는 ${openingScore}점으로 초기 등록을 만족하면서 손패를 ${move.rackReduction || 0}장 줄입니다.`
      : move.type === "rearrange"
        ? `이 수는 손패를 ${move.rackReduction || 0}장 줄이면서 테이블을 유효하게 유지합니다.`
        : `현재 탐색 범위에서 찾은 최선의 합법 수로, 손패를 ${move.rackReduction || 0}장 줄입니다.`;
    const leadText = move.type === "rearrange"
      ? `추천: ${move.summary || "테이블을 재배치하세요"}.`
      : move.type === "append"
        ? "추천: 기존 줄에 타일을 추가하세요."
        : `추천: ${move.summary || "표시된 수를 두세요"}.`;

    const hint = {
      title: "AI-6 힌트",
      summary: move.summary || "최선 수",
      shortText: move.summary || (
        move.type === "rearrange"
          ? "재배치"
          : move.type === "append"
            ? "줄에 추가"
            : "새 줄 만들기"
      ),
      reason,
      leadText,
      moveType: move.type,
      score: move.score || 0,
      rackTileIds: [...rackTileIds],
      tableTileIds: [...tableTileIds],
      targetGroupIndices: [...targetGroupIndices],
      steps: steps.length > 0 ? steps : ["표시된 추천 수를 실행하세요."],
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
