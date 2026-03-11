class RummyAIUtils {
  static popcount(mask) {
    let count = 0;
    let value = mask;
    while (value > 0) {
      value &= value - 1;
      count += 1;
    }
    return count;
  }

  static cloneState(state) {
    return {
      rack: deepCopy(state.rack),
      table: deepCopy(state.table),
      opened: state.opened,
      baseTableCount: state.baseTableCount,
      actions: [...state.actions],
      stats: { ...state.stats },
      meta: deepCopy(state.meta || {})
    };
  }

  static serializeState(state) {
    const rackKey = state.rack.map(tile => tile.id).sort((a, b) => a - b).join(",");
    return `${rackKey}::${serializeTableState(state.table)}`;
  }

  static getValidGroupsFromTiles(tiles, cache, maxSize = tiles.length) {
    const ids = tiles.map(tile => tile.id).sort((a, b) => a - b).join(",");
    const key = `${ids}|${maxSize}`;
    if (!cache.has(key)) {
      const found = [];
      const total = 1 << tiles.length;
      for (let mask = 1; mask < total; mask += 1) {
        const size = this.popcount(mask);
        if (size < 3 || size > maxSize) continue;
        const subset = [];
        for (let i = 0; i < tiles.length; i += 1) {
          if (mask & (1 << i)) subset.push(tiles[i]);
        }
        const result = RummyRules.analyzeGroup(subset);
        if (!result.valid) continue;
        found.push({
          ids: subset.map(tile => tile.id).sort((a, b) => a - b),
          size,
          score: result.score || 0,
          jokerCount: subset.filter(tile => tile.joker).length
        });
      }
      found.sort((a, b) =>
        b.size - a.size ||
        b.score - a.score ||
        a.jokerCount - b.jokerCount ||
        a.ids.join("-").localeCompare(b.ids.join("-"))
      );
      cache.set(key, found);
    }

    const byId = new Map(tiles.map(tile => [tile.id, tile]));
    return cache.get(key)
      .map(group => ({
        ...group,
        tiles: group.ids.map(id => byId.get(id)).filter(Boolean)
      }))
      .filter(group => group.tiles.length === group.ids.length);
  }

  static scoreRackSubset(tiles) {
    const nonJokers = tiles.filter(tile => !tile.joker);
    const numbers = new Set(nonJokers.map(tile => tile.number)).size;
    const colors = new Set(nonJokers.map(tile => tile.color)).size;
    return tiles.reduce((sum, tile) => sum + (tile.joker ? 25 : tile.number + 6), 0)
      + (numbers < nonJokers.length ? 18 : 0)
      + (colors === 1 && nonJokers.length > 1 ? 18 : 0)
      + (nonJokers.length > 1
        ? Math.max(0, 10 - (Math.max(...nonJokers.map(tile => tile.number)) - Math.min(...nonJokers.map(tile => tile.number))))
        : 0)
      + tiles.length * 12;
  }

  static enumerateRackSubsets(rack, maxSize) {
    const total = 1 << rack.length;
    const subsets = [];
    for (let mask = 1; mask < total; mask += 1) {
      const size = this.popcount(mask);
      if (size === 0 || size > maxSize) continue;
      const tiles = [];
      for (let i = 0; i < rack.length; i += 1) {
        if (mask & (1 << i)) tiles.push(rack[i]);
      }
      subsets.push({
        ids: tiles.map(tile => tile.id),
        tiles,
        size,
        score: this.scoreRackSubset(tiles)
      });
    }
    subsets.sort((a, b) => b.score - a.score || b.size - a.size);
    return subsets;
  }

  static getRackSubsets(rack, maxSize, limit = 24) {
    const subsets = this.enumerateRackSubsets(rack, maxSize);
    return subsets.slice(0, limit);
  }

  static getTableGroupCombos(table, maxGroups, limit = 8) {
    const combos = [];
    const visit = (start, picked) => {
      if (picked.length > 0) {
        const size = picked.reduce((sum, index) => sum + table[index].length, 0);
        const jokerCount = picked.reduce((sum, index) => sum + table[index].filter(tile => tile.joker).length, 0);
        combos.push({
          indices: [...picked],
          score: size * 12 + jokerCount * 30
        });
      }
      if (picked.length === maxGroups) return;
      for (let index = start; index < table.length; index += 1) {
        picked.push(index);
        visit(index + 1, picked);
        picked.pop();
      }
    };
    visit(0, []);
    combos.sort((a, b) => b.score - a.score || a.indices.length - b.indices.length);
    return combos.slice(0, limit);
  }

  static findExactCoverPartitions(pool, cache, options = {}) {
    if (pool.length < 3) return [];
    const groups = this.getValidGroupsFromTiles(pool, cache, pool.length);
    if (groups.length === 0) return [];

    const poolIndexById = new Map(pool.map((tile, index) => [tile.id, index]));
    const candidates = groups.map(group => {
      let mask = 0;
      group.ids.forEach(id => {
        mask |= 1 << poolIndexById.get(id);
      });
      return {
        ...group,
        mask
      };
    });
    const byIndex = Array.from({ length: pool.length }, () => []);
    candidates.forEach(candidate => {
      for (let index = 0; index < pool.length; index += 1) {
        if (candidate.mask & (1 << index)) byIndex[index].push(candidate);
      }
    });
    byIndex.forEach(list => list.sort((a, b) => b.size - a.size || b.score - a.score));

    const allMask = (1 << pool.length) - 1;
    const solutions = [];
    const seen = new Set();
    const maxSolutions = options.maxSolutions || 6;

    const dfs = (usedMask, selected) => {
      if (solutions.length >= maxSolutions) return;
      if (usedMask === allMask) {
        const mappedGroups = selected.map(candidate => normalizeGroupTiles(candidate.tiles));
        const signature = serializeTableState(mappedGroups);
        if (seen.has(signature)) return;
        seen.add(signature);
        solutions.push({
          groups: mappedGroups,
          score: selected.reduce((sum, candidate) => sum + candidate.score, 0),
          signature
        });
        return;
      }

      let firstOpen = -1;
      for (let index = 0; index < pool.length; index += 1) {
        if ((usedMask & (1 << index)) === 0) {
          firstOpen = index;
          break;
        }
      }
      if (firstOpen < 0) return;

      for (const candidate of byIndex[firstOpen]) {
        if ((candidate.mask & usedMask) !== 0) continue;
        selected.push(candidate);
        dfs(usedMask | candidate.mask, selected);
        selected.pop();
        if (solutions.length >= maxSolutions) return;
      }
    };

    dfs(0, []);
    solutions.sort((a, b) => b.score - a.score || b.groups.length - a.groups.length);
    return solutions;
  }
}
