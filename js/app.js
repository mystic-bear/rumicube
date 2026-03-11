let aiBridge;

try {
  aiBridge = new AIBridge();
} catch (error) {
  console.error("AI bridge bootstrap failed:", error);
  aiBridge = createUnavailableAIBridge(error);
}

window.aiBridge = aiBridge;
window.ui = ui;

const game = new Game();
window.game = game;

ui.renderSetup();
ui.renderRuleOptions();
ui.renderQuickStartMixedLevel();
