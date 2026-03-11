importScripts(
  "../shared/constants.js",
  "../shared/rules-core.js",
  "../shared/utils.js",
  "ai-utils.js",
  "ai-base.js",
  "ai-levels.js",
  "ai-dispatcher.js",
  "hint-engine.js"
);

self.onmessage = function(event) {
  const {
    type,
    id,
    stateVersion,
    gameState,
    aiLevel,
    budgetMs,
    softDeadlineMs,
    allowPartial
  } = event.data;

  const startedAt = Date.now();
  const softDeadlineAt = typeof softDeadlineMs === "number"
    ? startedAt + Math.max(0, softDeadlineMs)
    : null;
  const reporter = {
    onProgress(payload) {
      if (!payload) return;
      if (payload.kind === "hint" && payload.hint) {
        self.postMessage({
          type: "partialHint",
          id,
          stateVersion,
          hint: payload.hint,
          searchPhase: payload.searchPhase || null,
          partialReason: payload.partialReason || null
        });
        return;
      }
      if (payload.kind === "move" && payload.move) {
        self.postMessage({
          type: "partialMove",
          id,
          stateVersion,
          move: payload.move,
          searchPhase: payload.searchPhase || null,
          partialReason: payload.partialReason || null
        });
      }
    },
    onMeta(payload) {
      self.postMessage({
        type: "progress",
        id,
        stateVersion,
        progressMeta: payload || null
      });
    }
  };
  const options = {
    budgetMs,
    softDeadlineMs,
    softDeadlineAt,
    allowPartial: allowPartial !== false,
    reporter
  };

  try {
    if (type === "chooseMove") {
      const move = RummyAI.chooseMove(gameState, aiLevel, options);
      self.postMessage({ type: "moveResult", id, stateVersion, move });
      return;
    }

    if (type === "getHint") {
      const hint = RummyHintEngine.getHint(gameState, options);
      self.postMessage({ type: "hintResult", id, stateVersion, hint });
    }
  } catch (error) {
    self.postMessage({
      type: "error",
      id,
      stateVersion,
      message: error instanceof Error ? error.message : String(error),
      code: error?.code || "worker-error"
    });
  }
};

self.postMessage({ type: "ready" });
