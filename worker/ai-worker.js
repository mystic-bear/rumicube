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
  const { type, id, stateVersion, gameState, aiLevel } = event.data;

  try {
    if (type === "chooseMove") {
      const move = RummyAI.chooseMove(gameState, aiLevel);
      self.postMessage({ type: "moveResult", id, stateVersion, move });
      return;
    }

    if (type === "getHint") {
      const hint = RummyHintEngine.getHint(gameState);
      self.postMessage({ type: "hintResult", id, stateVersion, hint });
    }
  } catch (error) {
    self.postMessage({
      type: "error",
      id,
      stateVersion,
      message: error instanceof Error ? error.message : String(error)
    });
  }
};

self.postMessage({ type: "ready" });
