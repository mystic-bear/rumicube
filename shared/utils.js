const deepCopy = (value) => JSON.parse(JSON.stringify(value));
const getSetupStateLabel = (state, compact = false) => {
  if (state === "HUMAN" || state === "OFF") return state;
  const level = Number(String(state).split("-")[1]);
  const info = AI_LEVEL_INFO[level];
  return compact ? (info?.short || state) : (info?.label || state);
};
const calculateInitialOpenScore = (groups) => groups.reduce((sum, group) => sum + (RummyRules.analyzeGroup(group).score || 0), 0);
const isInitialOpenSatisfied = (groups) => groups.length > 0 && calculateInitialOpenScore(groups) >= 30;
const normalizeGroupTiles = (group) => {
  const colorOrder = { red: 0, blue: 1, yellow: 2, black: 3, joker: 4 };
  const non = group.filter(tile => !tile.joker);
  const jokers = group.filter(tile => tile.joker);
  if (non.length === 0) return [...jokers];

  const sameColor = non.every(tile => tile.color === non[0].color);
  const sameNumber = non.every(tile => tile.number === non[0].number);

  if (sameColor) {
    return [...non].sort((a, b) => a.number - b.number || a.id - b.id).concat(jokers);
  }

  if (sameNumber) {
    return [...non].sort((a, b) => colorOrder[a.color] - colorOrder[b.color] || a.id - b.id).concat(jokers);
  }

  return [...group];
};
const normalizeTableGroups = (table) => table.map(group => normalizeGroupTiles(group)).filter(group => group.length > 0);
const serializeTableState = (table) => table
  .map(group => normalizeGroupTiles(group).map(tile => tile.id).sort((a, b) => a - b).join("-"))
  .sort()
  .join("|");
const getColorIcon = (colorKey) => COLORS.find(color => color.key === colorKey)?.icon || "";
const formatTileText = (tile) => tile?.joker ? "조커🃏" : `${tile?.number}${getColorIcon(tile?.color)}`;
const formatTileList = (tiles) => tiles.map(tile => formatTileText(tile)).join(", ");
const findGroupIndicesByTileIds = (table, groupTileIdsList) => {
  const indices = [];
  groupTileIdsList.forEach(groupTileIds => {
    if (!groupTileIds || groupTileIds.length === 0) return;
    const idSet = new Set(groupTileIds);
    const index = table.findIndex(group => group.every(tile => idSet.has(tile.id)) && group.length === idSet.size);
    if (index >= 0 && !indices.includes(index)) indices.push(index);
  });
  return indices;
};
