class RummyHintEngine {
  static buildStrategicDrawComment(move) {
    const meta = move.drawMeta || {};
    if (move.drawReasonCode === "hold-opening") {
      return {
        title: "AI-6 힌트",
        summary: move.summary || "등록 보류 드로우",
        shortText: "등록 보류",
        reason: "등록은 가능하지만 현재 수는 손패를 많이 줄이지 못하고 패 모양도 약합니다. 지금은 30점을 억지로 여는 것보다 더 큰 등록 기회를 보는 편이 좋습니다.",
        leadText: "추천: 이번 턴은 바로 등록하지 말고 1장을 뽑으세요.",
        steps: ["1장 뽑기 버튼을 눌러 턴을 넘기세요."],
        futureBenefit: meta.hitRate > 0
          ? "유효한 연결 타일을 받을 확률이 아직 남아 있어, 다음 턴 더 좋은 등록을 노릴 수 있습니다."
          : "조커와 연결 대기를 보존해 다음 턴 더 큰 등록을 노릴 수 있습니다."
      };
    }
    if (move.drawReasonCode === "preserve-shape") {
      return {
        title: "AI-6 힌트",
        summary: move.summary || "구조 보존 드로우",
        shortText: "구조 보존",
        reason: "낼 수 있는 수는 있지만 1장만 줄고 기존 연결 구조가 많이 깨집니다. 지금은 손패 형태를 지키는 편이 더 유리합니다.",
        leadText: "추천: 약한 1장 플레이 대신 드로우를 선택하세요.",
        steps: ["1장 뽑기 버튼을 눌러 턴을 넘기세요."],
        futureBenefit: meta.futureLoss > 0
          ? `지금 드로우를 선택하면 다음 턴에 활용할 연결 구조 ${meta.futureLoss}단계를 보존할 수 있습니다.`
          : "남아 있는 연속 대기와 같은 숫자 대기를 유지해 다음 턴 폭이 더 넓어집니다."
      };
    }
    return {
      title: "AI-6 힌트",
      summary: move.summary || "완성 대기 드로우",
      shortText: "완성 대기",
      reason: "현재는 약한 수밖에 없지만, 한 장만 맞으면 바로 새 줄이나 추가가 가능한 대기가 여러 개 있습니다.",
      leadText: "추천: 이번 턴은 1장을 뽑아 완성 타일을 노리세요.",
      steps: ["1장 뽑기 버튼을 눌러 턴을 넘기세요."],
      futureBenefit: meta.hitRate > 0
        ? "다음 드로우에서 유효한 연결 타일을 받을 가능성이 높습니다."
        : "다음 드로우에서 강한 연결 타일이 오면 한 번에 전개할 여지가 큽니다."
    };
  }

  static getHint(gameState) {
    const move = RummyAI.chooseMove(gameState, 6);
    if (move && move.type === "draw") {
      const comment = this.buildStrategicDrawComment(move);
      return {
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
        openingScore: 0
      };
    }
    if (!move) {
      const reason = !gameState.currentPlayer.opened && gameState.ruleOptions.initial30
        ? "아직 30점 등록 전이라 기존 테이블 재배열은 사용할 수 없습니다."
        : gameState.table.length > 0
          ? "현재 탐색 범위 내에서 유효한 재배열을 찾지 못했습니다."
          : "현재 상태에서는 손패를 안전하게 줄이는 유효 수보다 드로우가 더 안정적입니다.";
      return {
        title: "AI-6 힌트",
        summary: "1장 뽑기",
        shortText: "드로우 추천",
        reason,
        leadText: "추천: 이번 턴은 1장 뽑기를 고려하세요.",
        moveType: "draw",
        score: 0,
        rackTileIds: [],
        tableTileIds: [],
        targetGroupIndices: [],
        steps: ["1장 뽑기 버튼을 눌러 턴을 넘기세요."],
        openingScore: 0
      };
    }

    const tileLookup = new Map(
      [...gameState.currentPlayer.rack, ...gameState.table.flat(), ...move.table.flat()].map(tile => [tile.id, tile])
    );
    const rackTileIds = new Set();
    const tableTileIds = new Set();
    const targetGroupIndices = new Set();
    const steps = [];
    const touchedGroupLabels = new Set();
    const createdGroupsSummary = [];
    const preservedGroupsSummary = [];
    const openingBreakdown = (move.openingDetails || []).map(group => `${formatTileList(group.tiles || [])} = ${group.score}점`);

    move.actions.forEach(action => {
      const sourceRackTiles = (action.sourceRackIds || []).map(id => tileLookup.get(id)).filter(Boolean);
      const sourceTableTiles = (action.sourceTableIds || []).map(id => tileLookup.get(id)).filter(Boolean);
      (action.sourceGroupIndices || []).forEach(index => touchedGroupLabels.add(`${index + 1}번 줄`));

      if (action.type === "new-group") {
        (action.sourceRackIds || []).forEach(id => rackTileIds.add(id));
        const groupIndices = findGroupIndicesByTileIds(move.table, [action.createdGroupIds]);
        groupIndices.forEach(index => targetGroupIndices.add(index));
        createdGroupsSummary.push(formatTileList((action.createdGroupIds || []).map(id => tileLookup.get(id)).filter(Boolean)));
        steps.push(`손패의 ${formatTileList(sourceRackTiles)}으로 새 줄을 만드세요.`);
        steps.push("새 줄 버튼을 눌러 조합을 확정하세요.");
        return;
      }

      if (action.type === "append") {
        (action.sourceRackIds || []).forEach(id => rackTileIds.add(id));
        const resultIndices = findGroupIndicesByTileIds(move.table, [action.resultGroupIds]);
        resultIndices.forEach(index => targetGroupIndices.add(index));
        const targetIndex = findGroupIndicesByTileIds(move.table, [action.resultGroupIds])[0];
        const tileText = formatTileList(sourceRackTiles);
        steps.push(`손패의 ${tileText}을 ${targetIndex !== undefined ? `${targetIndex + 1}번 줄` : "강조된 줄"}에 추가하세요.`);
        return;
      }

      if (action.type === "rearrange") {
        (action.sourceRackIds || []).forEach(id => rackTileIds.add(id));
        (action.sourceTableIds || []).forEach(id => tableTileIds.add(id));
        findGroupIndicesByTileIds(move.table, action.resultGroupIds || []).forEach(index => targetGroupIndices.add(index));
        const groupText = (action.sourceGroupIndices || []).map(index => `${index + 1}번 줄`).join(", ");
        const sourceText = sourceTableTiles.length > 0 ? formatTileList(sourceTableTiles) : "강조된 타일";
        const rackText = sourceRackTiles.length > 0 ? ` 손패의 ${formatTileList(sourceRackTiles)}도 함께 사용하세요.` : "";
        steps.push(`${groupText || "강조된 줄"}에서 ${sourceText}을 꺼내 재배열하세요.${rackText}`);
        (action.resultGroupIds || []).forEach(groupIds => {
          const targetIndex = findGroupIndicesByTileIds(move.table, [groupIds])[0];
          const groupTiles = groupIds.map(id => tileLookup.get(id)).filter(Boolean);
          if (groupTiles.length === 0) return;
          if ((action.sourceTableIds || []).some(id => groupIds.includes(id))) {
            preservedGroupsSummary.push(formatTileList(groupTiles));
          } else {
            createdGroupsSummary.push(formatTileList(groupTiles));
          }
          steps.push(`${targetIndex !== undefined ? `${targetIndex + 1}번 줄` : "결과 줄"}을 ${formatTileList(groupTiles)} 형태로 맞추세요.`);
        });
      }
    });

    const openingScore = move.openingScore || 0;
    const jokerNotes = move.jokerNotes || [];
    jokerNotes.forEach(note => {
      if (note && !steps.includes(note)) steps.push(note);
    });
    if (!gameState.currentPlayer.opened && gameState.ruleOptions.initial30 && openingScore >= 30 && openingBreakdown.length > 0) {
      steps.unshift(`이 수는 ${openingScore}점으로 30점 등록을 충족합니다.`);
      openingBreakdown.slice().reverse().forEach(line => {
        steps.unshift(line);
      });
    }
    const leadText = move.type === "rearrange"
      ? `추천: ${move.summary}으로 테이블을 재정리하세요.`
      : move.type === "append"
        ? "추천: 기존 줄에 1장을 추가하세요."
        : `추천: ${move.summary}을 실행하세요.`;
    const reason = !gameState.currentPlayer.opened && gameState.ruleOptions.initial30 && openingScore >= 30
      ? `손패 ${move.rackReduction}장을 줄이면서 초기 등록 ${openingScore}점을 충족합니다.`
      : move.type === "rearrange"
        ? `손패 ${move.rackReduction}장을 줄이면서 기존 테이블을 안정적으로 유지할 수 있습니다.`
        : move.rackReduction > 0
          ? `이번 턴에 손패 ${move.rackReduction}장을 줄일 수 있는 최선 수입니다.`
          : "현재 상태에서는 추가 이득보다 안전한 정리가 더 중요합니다.";
    const futureBenefit = move.futureMobility > 0
      ? `남은 손패 중 ${move.futureMobility}장은 다음 턴에도 기존 줄과 연결될 가능성이 큽니다.`
      : "남은 손패는 다음 턴에 새 조합 중심으로 풀어야 합니다.";
    const shortParts = [];
    if (move.stats.rearrangeCount > 0) shortParts.push(`재배열 ${move.stats.rearrangeCount}회`);
    if (move.stats.newGroupCount > 0) shortParts.push(`새 줄 ${move.stats.newGroupCount}개`);
    if (move.stats.appendCount > 0) shortParts.push(`줄 추가 ${move.stats.appendCount}회`);

    return {
      title: "AI-6 힌트",
      summary: move.summary,
      shortText: shortParts.join(" · ") || move.summary,
      reason,
      leadText,
      moveType: move.type,
      score: move.score,
      rackTileIds: [...rackTileIds],
      tableTileIds: [...tableTileIds],
      targetGroupIndices: [...targetGroupIndices],
      steps: steps.length > 0 ? steps : ["강조된 타일과 줄을 중심으로 수를 진행하세요."],
      openingScore,
      openingBreakdown,
      touchedGroupLabels: [...touchedGroupLabels],
      createdGroupsSummary,
      preservedGroupsSummary,
      futureBenefit
    };
  }
}

RummyHintEngine.buildStrategicDrawComment = function(move) {
  const meta = move.drawMeta || {};
  if (move.drawReasonCode === "hold-opening") {
    return {
      title: "AI-6 힌트",
      summary: move.summary || "전략 드로우",
      shortText: "등록 보류 드로우",
      reason: "등록은 가능하지만 현재 수는 손패를 많이 줄이지 못하고 패 구조도 약하게 만듭니다. 더 강한 등록 타이밍을 노리는 편이 좋습니다.",
      leadText: "추천: 지금은 등록을 미루고 1장을 뽑으세요.",
      steps: ["1장 뽑기 버튼을 눌러 턴을 마무리하세요."],
      futureBenefit: meta.bagCount >= 10 && meta.opponentMinRack >= 7
        ? "가방과 상대 손패 여유가 있어, 지금 약하게 열기보다 더 강한 등록 타이밍을 노리는 편이 좋습니다."
        : ""
    };
  }
  if (move.drawReasonCode === "preserve-shape") {
    return {
      title: "AI-6 힌트",
      summary: move.summary || "전략 드로우",
      shortText: "구조 보존 드로우",
      reason: "현재 수는 가능하지만 손패 구조를 많이 깨거나 조커를 소모합니다. 지금은 연결 형태를 보존하는 편이 더 유리합니다.",
      leadText: "추천: 약한 1장 플레이 대신 1장을 뽑으세요.",
      steps: ["1장 뽑기 버튼을 눌러 턴을 마무리하세요."],
      futureBenefit: meta.futureLoss > 0 || meta.futureMobilityLoss > 0
        ? "지금 구조를 보존하면 다음 턴에 더 자연스럽고 강한 연결을 만들 가능성이 높습니다."
        : ""
    };
  }
  return {
    title: "AI-6 힌트",
    summary: move.summary || "전략 드로우",
    shortText: "전략 드로우",
    reason: "현재 플레이보다 드로우가 더 안정적인 선택입니다.",
    leadText: "추천: 이번 턴은 1장을 뽑으세요.",
    steps: ["1장 뽑기 버튼을 눌러 턴을 마무리하세요."],
    futureBenefit: ""
  };
};

RummyHintEngine.getHint = function(gameState) {
  const move = RummyAI.chooseMove(gameState, 6);
  if (move && move.type === "draw") {
    const comment = this.buildStrategicDrawComment(move);
    return {
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
  }
  if (!move) {
    const reason = !gameState.currentPlayer.opened && gameState.ruleOptions.initial30
      ? "아직 30점 등록 전이라 기존 테이블만으로는 유효한 수를 만들기 어렵습니다."
      : gameState.table.length > 0
        ? "현재 탐색 범위 안에서는 추가 유효 수를 찾지 못했습니다."
        : "현재 상태에서는 손패를 안전하게 줄이면서 유효한 새 줄을 만들기 어렵습니다.";
    return {
      title: "AI-6 힌트",
      summary: "1장 뽑기",
      shortText: "드로우 추천",
      reason,
      leadText: "추천: 이번 턴은 1장을 뽑는 쪽을 우선 고려하세요.",
      moveType: "draw",
      score: 0,
      rackTileIds: [],
      tableTileIds: [],
      targetGroupIndices: [],
      steps: ["1장 뽑기 버튼을 눌러 턴을 진행하세요."],
      openingScore: 0,
      hintSource: "no-move",
      engineMissFallback: true
    };
  }

  const tileLookup = new Map(
    [...gameState.currentPlayer.rack, ...gameState.table.flat(), ...move.table.flat()].map(tile => [tile.id, tile])
  );
  const rackTileIds = new Set();
  const tableTileIds = new Set();
  const targetGroupIndices = new Set();
  const steps = [];
  const touchedGroupLabels = new Set();
  const createdGroupsSummary = [];
  const preservedGroupsSummary = [];
  const openingBreakdown = (move.openingDetails || []).map(group => `${formatTileList(group.tiles || [])} = ${group.score}점`);

  move.actions.forEach(action => {
    const sourceRackTiles = (action.sourceRackIds || []).map(id => tileLookup.get(id)).filter(Boolean);
    const sourceTableTiles = (action.sourceTableIds || []).map(id => tileLookup.get(id)).filter(Boolean);
    (action.sourceGroupIndices || []).forEach(index => touchedGroupLabels.add(`${index + 1}번 줄`));

    if (action.type === "new-group") {
      (action.sourceRackIds || []).forEach(id => rackTileIds.add(id));
      const groupIndices = findGroupIndicesByTileIds(move.table, [action.createdGroupIds]);
      groupIndices.forEach(index => targetGroupIndices.add(index));
      createdGroupsSummary.push(formatTileList((action.createdGroupIds || []).map(id => tileLookup.get(id)).filter(Boolean)));
      steps.push(`손패의 ${formatTileList(sourceRackTiles)}로 새 줄을 만드세요.`);
      steps.push("새 줄 버튼을 눌러 조합을 확정하세요.");
      return;
    }

    if (action.type === "append") {
      (action.sourceRackIds || []).forEach(id => rackTileIds.add(id));
      const resultIndices = findGroupIndicesByTileIds(move.table, [action.resultGroupIds]);
      resultIndices.forEach(index => targetGroupIndices.add(index));
      const targetIndex = resultIndices[0];
      const tileText = formatTileList(sourceRackTiles);
      steps.push(`${tileText}을 ${targetIndex !== undefined ? `${targetIndex + 1}번 줄` : "강조된 줄"}에 추가하세요.`);
      return;
    }

    if (action.type === "rearrange") {
      (action.sourceRackIds || []).forEach(id => rackTileIds.add(id));
      (action.sourceTableIds || []).forEach(id => tableTileIds.add(id));
      findGroupIndicesByTileIds(move.table, action.resultGroupIds || []).forEach(index => targetGroupIndices.add(index));
      const groupText = (action.sourceGroupIndices || []).map(index => `${index + 1}번 줄`).join(", ");
      const sourceText = sourceTableTiles.length > 0 ? formatTileList(sourceTableTiles) : "강조된 타일";
      const rackText = sourceRackTiles.length > 0 ? ` 손패의 ${formatTileList(sourceRackTiles)}도 함께 사용하세요.` : "";
      steps.push(`${groupText || "강조된 줄"}에서 ${sourceText}을 꺼내 재배열하세요.${rackText}`);
      (action.resultGroupIds || []).forEach(groupIds => {
        const targetIndex = findGroupIndicesByTileIds(move.table, [groupIds])[0];
        const groupTiles = groupIds.map(id => tileLookup.get(id)).filter(Boolean);
        if (groupTiles.length === 0) return;
        if ((action.sourceTableIds || []).some(id => groupIds.includes(id))) {
          preservedGroupsSummary.push(formatTileList(groupTiles));
        } else {
          createdGroupsSummary.push(formatTileList(groupTiles));
        }
        steps.push(`${targetIndex !== undefined ? `${targetIndex + 1}번 줄` : "결과 줄"}을 ${formatTileList(groupTiles)} 형태로 맞추세요.`);
      });
    }
  });

  const openingScore = move.openingScore || 0;
  const jokerNotes = move.jokerNotes || [];
  jokerNotes.forEach(note => {
    if (note && !steps.includes(note)) steps.push(note);
  });
  if (!gameState.currentPlayer.opened && gameState.ruleOptions.initial30 && openingScore >= 30 && openingBreakdown.length > 0) {
    steps.unshift(`이번 수는 ${openingScore}점으로 30점 등록을 충족합니다.`);
    openingBreakdown.slice().reverse().forEach(line => {
      steps.unshift(line);
    });
  }

  const leadText = move.type === "rearrange"
    ? `추천: ${move.summary}로 테이블을 재정리하세요.`
    : move.type === "append"
      ? "추천: 기존 줄에 1장을 추가하세요."
      : `추천: ${move.summary}를 실행하세요.`;
  const reason = !gameState.currentPlayer.opened && gameState.ruleOptions.initial30 && openingScore >= 30
    ? `손패 ${move.rackReduction}장을 줄이면서 초기 등록 ${openingScore}점을 충족합니다.`
    : move.type === "rearrange"
      ? `손패 ${move.rackReduction}장을 줄이면서 기존 테이블을 안정적으로 재정리할 수 있습니다.`
      : move.rackReduction > 0
        ? `이번 턴에 손패 ${move.rackReduction}장을 줄일 수 있는 최선의 수입니다.`
        : "현재 상태에서는 추가 이득보다 안정적인 정리가 더 중요합니다.";
  const futureBenefit = move.futureMobility > 0
    ? `이후 손패 중 ${move.futureMobility}장은 다음 턴에도 기존 줄과 연결될 가능성이 높습니다.`
    : "이후 손패는 다음 턴에 새 조합 중심으로 다뤄야 할 가능성이 큽니다.";
  const shortParts = [];
  if (move.stats.rearrangeCount > 0) shortParts.push(`재배열 ${move.stats.rearrangeCount}회`);
  if (move.stats.newGroupCount > 0) shortParts.push(`새 줄 ${move.stats.newGroupCount}개`);
  if (move.stats.appendCount > 0) shortParts.push(`줄 추가 ${move.stats.appendCount}회`);

  return {
    title: "AI-6 힌트",
    summary: move.summary,
    shortText: shortParts.join(" · ") || move.summary,
    reason,
    leadText,
    moveType: move.type,
    score: move.score,
    rackTileIds: [...rackTileIds],
    tableTileIds: [...tableTileIds],
    targetGroupIndices: [...targetGroupIndices],
    steps: steps.length > 0 ? steps : ["강조된 대상과 줄을 순서대로 진행하세요."],
    openingScore,
    openingBreakdown,
    touchedGroupLabels: [...touchedGroupLabels],
    createdGroupsSummary,
    preservedGroupsSummary,
    futureBenefit,
    hintSource: "move",
    engineMissFallback: false
  };
};
