class RummyAIUtils {
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

  static serializeSearchState(state) {
    const rackKey = state.rack.map(tile => tile.id).sort((a, b) => a - b).join(",");
    const tableKey = serializeTableState(state.table);
    return `${rackKey}::${tableKey}::opened=${state.opened ? 1 : 0}::base=${state.baseTableCount || 0}`;
  }

  static normalizeGenerationOptions(maxSizeOrOptions, maybeOptions, fallbackMaxSize) {
    if (typeof maxSizeOrOptions === "object" && maxSizeOrOptions !== null) {
      return {
        maxSize: Math.max(0, Number(maxSizeOrOptions.maxSize) || fallbackMaxSize),
        ctx: maxSizeOrOptions.ctx || null
      };
    }
    return {
      maxSize: Math.max(0, Number(maxSizeOrOptions) || fallbackMaxSize),
      ctx: maybeOptions?.ctx || null
    };
  }

  static normalizeExactCoverOptions(options = {}) {
    return {
      ctx: options.ctx || null,
      maxSolutions: Math.max(1, Number(options.maxSolutions) || 6)
    };
  }

  static markDeadlineReached(ctx) {
    if (ctx && !ctx.truncatedReason) {
      ctx.truncatedReason = "soft-deadline";
    }
  }

  static isDeadlineReached(ctx) {
    if (!ctx || typeof ctx.deadlineAt !== "number") return false;
    if (Date.now() < ctx.deadlineAt) return false;
    this.markDeadlineReached(ctx);
    return true;
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

  static generateKCombinations(items, count, ctx, visit) {
    if (count < 0 || count > items.length) return true;
    if (count === 0) return visit([]);

    const picked = [];
    const dfs = (start) => {
      if (this.isDeadlineReached(ctx)) return false;
      if (picked.length === count) return visit([...picked]);
      const remaining = count - picked.length;
      for (let index = start; index <= items.length - remaining; index += 1) {
        picked.push(items[index]);
        const shouldContinue = dfs(index + 1);
        picked.pop();
        if (shouldContinue === false) return false;
      }
      return true;
    };

    return dfs(0);
  }

  static cartesianPick(groups, ctx, visit) {
    if (groups.length === 0) return visit([]);
    const picked = [];
    const dfs = (depth) => {
      if (this.isDeadlineReached(ctx)) return false;
      if (depth >= groups.length) return visit([...picked]);
      for (const item of groups[depth]) {
        picked.push(item);
        const shouldContinue = dfs(depth + 1);
        picked.pop();
        if (shouldContinue === false) return false;
      }
      return true;
    };
    return dfs(0);
  }

  static createCachedGroupEntry(groupTiles) {
    const result = RummyRules.analyzeGroup(groupTiles);
    if (!result.valid) return null;
    return {
      ids: groupTiles.map(tile => tile.id).sort((a, b) => a - b),
      size: groupTiles.length,
      score: result.score || 0,
      jokerCount: groupTiles.filter(tile => tile.joker).length
    };
  }

  static getValidGroupsFromTiles(tiles, cache, maxSizeOrOptions = tiles.length, maybeOptions = {}) {
    const { maxSize, ctx } = this.normalizeGenerationOptions(maxSizeOrOptions, maybeOptions, tiles.length);
    const ids = tiles.map(tile => tile.id).sort((a, b) => a - b).join(",");
    const key = `${ids}|${maxSize}`;
    if (cache.has(key)) {
      const byId = new Map(tiles.map(tile => [tile.id, tile]));
      return cache.get(key)
        .map(group => ({
          ...group,
          tiles: group.ids.map(id => byId.get(id)).filter(Boolean)
        }))
        .filter(group => group.tiles.length === group.ids.length);
    }

    const found = [];
    const seen = new Set();
    let completed = true;
    const jokers = tiles.filter(tile => tile.joker);
    const nonJokers = tiles.filter(tile => !tile.joker);

    const addGroup = (groupTiles) => {
      if (groupTiles.length < 3 || groupTiles.length > maxSize) return true;
      const entry = this.createCachedGroupEntry(groupTiles);
      if (!entry) return true;
      const signature = entry.ids.join("-");
      if (seen.has(signature)) return true;
      seen.add(signature);
      found.push(entry);
      return true;
    };

    const byNumber = new Map();
    nonJokers.forEach(tile => {
      if (!byNumber.has(tile.number)) byNumber.set(tile.number, new Map());
      const colors = byNumber.get(tile.number);
      if (!colors.has(tile.color)) colors.set(tile.color, []);
      colors.get(tile.color).push(tile);
    });

    for (const colorMap of byNumber.values()) {
      if (this.isDeadlineReached(ctx)) {
        completed = false;
        break;
      }
      const colorEntries = [...colorMap.entries()];
      const maxSetSize = Math.min(4, maxSize);
      for (let groupSize = 3; groupSize <= maxSetSize; groupSize += 1) {
        const minRealTiles = Math.max(1, groupSize - jokers.length);
        const maxRealTiles = Math.min(groupSize, colorEntries.length);
        for (let realTileCount = minRealTiles; realTileCount <= maxRealTiles; realTileCount += 1) {
          const jokersNeeded = groupSize - realTileCount;
          const continueColors = this.generateKCombinations(colorEntries, realTileCount, ctx, (pickedColors) => {
            const tileChoices = pickedColors.map(([, variants]) => variants);
            return this.cartesianPick(tileChoices, ctx, (selectedTiles) => {
              return this.generateKCombinations(jokers, jokersNeeded, ctx, (jokerTiles) =>
                addGroup([...selectedTiles, ...jokerTiles])
              );
            });
          });
          if (continueColors === false) {
            completed = false;
            break;
          }
        }
        if (!completed) break;
      }
      if (!completed) break;
    }

    if (completed) {
      const byColor = new Map();
      nonJokers.forEach(tile => {
        if (!byColor.has(tile.color)) byColor.set(tile.color, new Map());
        const numbers = byColor.get(tile.color);
        if (!numbers.has(tile.number)) numbers.set(tile.number, []);
        numbers.get(tile.number).push(tile);
      });

      for (const numberMap of byColor.values()) {
        if (this.isDeadlineReached(ctx)) {
          completed = false;
          break;
        }
        for (let start = 1; start <= 13; start += 1) {
          if (this.isDeadlineReached(ctx)) {
            completed = false;
            break;
          }
          let presentNumbers = [];
          let missingCount = 0;
          for (let end = start; end <= 13; end += 1) {
            if (numberMap.has(end)) presentNumbers.push(end);
            else missingCount += 1;

            const minJokersNeeded = missingCount;
            const maxJokersUsable = Math.min(jokers.length, maxSize - presentNumbers.length);
            if (maxJokersUsable < minJokersNeeded) continue;
            if (presentNumbers.length + minJokersNeeded > maxSize) break;

            for (let jokerCount = minJokersNeeded; jokerCount <= maxJokersUsable; jokerCount += 1) {
              const totalSize = presentNumbers.length + jokerCount;
              if (totalSize < 3 || totalSize > maxSize) continue;
              const tileChoices = presentNumbers.map(number => numberMap.get(number));
              const continueRuns = this.cartesianPick(tileChoices, ctx, (selectedTiles) => {
                return this.generateKCombinations(jokers, jokerCount, ctx, (jokerTiles) =>
                  addGroup([...selectedTiles, ...jokerTiles])
                );
              });
              if (continueRuns === false) {
                completed = false;
                break;
              }
            }
            if (!completed) break;
          }
          if (!completed) break;
          presentNumbers = [];
          missingCount = 0;
        }
        if (!completed) break;
      }
    }

    found.sort((a, b) =>
      b.size - a.size ||
      b.score - a.score ||
      a.jokerCount - b.jokerCount ||
      a.ids.join("-").localeCompare(b.ids.join("-"))
    );

    if (completed) {
      cache.set(key, found);
    }

    const byId = new Map(tiles.map(tile => [tile.id, tile]));
    return found
      .map(group => ({
        ...group,
        tiles: group.ids.map(id => byId.get(id)).filter(Boolean)
      }))
      .filter(group => group.tiles.length === group.ids.length);
  }

  static enumerateRackSubsets(rack, maxSizeOrOptions, maybeOptions = {}) {
    const { maxSize, ctx } = this.normalizeGenerationOptions(maxSizeOrOptions, maybeOptions, rack.length);
    if (maxSize <= 0 || rack.length === 0) return [];

    const subsets = [];
    for (let size = 1; size <= Math.min(maxSize, rack.length); size += 1) {
      const completed = this.generateKCombinations(rack, size, ctx, (tiles) => {
        subsets.push({
          ids: tiles.map(tile => tile.id),
          tiles,
          size,
          score: this.scoreRackSubset(tiles)
        });
        return true;
      });
      if (completed === false) break;
    }

    subsets.sort((a, b) => b.score - a.score || b.size - a.size);
    return subsets;
  }

  static getRackSubsets(rack, maxSize, limit = 24, options = {}) {
    const subsets = this.enumerateRackSubsets(rack, { maxSize, ctx: options.ctx || null });
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
    const { ctx, maxSolutions } = this.normalizeExactCoverOptions(options);
    const groups = this.getValidGroupsFromTiles(pool, cache, { maxSize: pool.length, ctx });
    if (groups.length === 0) return [];

    const candidates = groups.map(group => ({
      ...group,
      idSet: new Set(group.ids)
    }));
    const byTileId = new Map(pool.map(tile => [tile.id, []]));
    candidates.forEach(candidate => {
      candidate.ids.forEach(id => {
        if (byTileId.has(id)) byTileId.get(id).push(candidate);
      });
    });
    byTileId.forEach(list => list.sort((a, b) =>
      b.size - a.size ||
      b.score - a.score ||
      a.jokerCount - b.jokerCount
    ));

    const uncoveredIds = new Set(pool.map(tile => tile.id));
    const solutions = [];
    const seen = new Set();

    const dfs = (selected) => {
      if (this.isDeadlineReached(ctx) || solutions.length >= maxSolutions) return;
      if (uncoveredIds.size === 0) {
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

      let pivotId = null;
      let pivotCandidates = null;
      for (const tileId of uncoveredIds) {
        const fitting = (byTileId.get(tileId) || []).filter(candidate =>
          candidate.ids.every(id => uncoveredIds.has(id))
        );
        if (fitting.length === 0) return;
        if (!pivotCandidates || fitting.length < pivotCandidates.length) {
          pivotId = tileId;
          pivotCandidates = fitting;
          if (fitting.length === 1) break;
        }
      }

      if (!pivotId || !pivotCandidates) return;
      for (const candidate of pivotCandidates) {
        if (this.isDeadlineReached(ctx) || solutions.length >= maxSolutions) return;
        candidate.ids.forEach(id => uncoveredIds.delete(id));
        selected.push(candidate);
        dfs(selected);
        selected.pop();
        candidate.ids.forEach(id => uncoveredIds.add(id));
      }
    };

    dfs([]);
    solutions.sort((a, b) => b.score - a.score || b.groups.length - a.groups.length);
    return solutions;
  }
}
