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
    includeDebug: !!gameState?.aiDebug,
    reporter
  };

  try {
    if (type === "chooseMove") {
      const result = RummyAI.chooseMove(gameState, aiLevel, options);
      const move = result && typeof result === "object" && Object.prototype.hasOwnProperty.call(result, "move")
        ? result.move
        : result;
      const debugStats = result && typeof result === "object" && Object.prototype.hasOwnProperty.call(result, "debugStats")
        ? result.debugStats
        : null;
      self.postMessage({ type: "moveResult", id, stateVersion, move, debugStats });
      return;
    }

    if (type === "getHint") {
      const result = RummyHintEngine.getHint(gameState, options);
      const hint = result && typeof result === "object" && Object.prototype.hasOwnProperty.call(result, "hint")
        ? result.hint
        : result;
      const debugStats = result && typeof result === "object" && Object.prototype.hasOwnProperty.call(result, "debugStats")
        ? result.debugStats
        : null;
      self.postMessage({ type: "hintResult", id, stateVersion, hint, debugStats });
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
