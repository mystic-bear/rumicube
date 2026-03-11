class RummyRules {
  static maxRunScore(length) {
    const start = Math.max(1, 14 - length);
    return (length * (2 * start + length - 1)) / 2;
  }

  static explainGroup(group) {
    const basic = this.analyzeGroup(group);
    if (!basic.valid) {
      return {
        ...basic,
        canonicalNumbers: [],
        jokerAssignments: []
      };
    }

    const non = group.filter(tile => !tile.joker);
    if (basic.kind === "set" || (basic.kind === "wild" && non.length > 0 && non.every(tile => tile.number === non[0].number))) {
      const number = non[0]?.number ?? 13;
      return {
        ...basic,
        canonicalNumbers: Array.from({ length: group.length }, () => number),
        jokerAssignments: group
          .filter(tile => tile.joker)
          .sort((a, b) => a.id - b.id)
          .map(tile => ({
            tileId: tile.id,
            actsAsNumber: number,
            actsAsColor: null
          }))
      };
    }

    if (basic.kind === "run" || basic.kind === "wild") {
      const len = group.length;
      const numbers = non.map(tile => tile.number).sort((a, b) => a - b);
      const bestStart = non.length === 0
        ? Math.max(1, 14 - len)
        : Math.min(numbers[0], 13 - len + 1);
      const canonicalNumbers = Array.from({ length: len }, (_, index) => bestStart + index);
      const nonNumbers = new Set(non.map(tile => tile.number));
      const missingNumbers = canonicalNumbers.filter(number => !nonNumbers.has(number));
      const color = non[0]?.color || null;
      return {
        ...basic,
        canonicalNumbers,
        jokerAssignments: group
          .filter(tile => tile.joker)
          .sort((a, b) => a.id - b.id)
          .map((tile, index) => ({
            tileId: tile.id,
            actsAsNumber: missingNumbers[index] ?? canonicalNumbers[canonicalNumbers.length - 1] ?? null,
            actsAsColor: color
          }))
      };
    }

    return {
      ...basic,
      canonicalNumbers: [],
      jokerAssignments: []
    };
  }

  static analyzeSet(group) {
    const len = group.length;
    if (len === 0) return { valid: false, possible: false, label: "빈 줄", score: 0, kind: null };
    if (len > 4) return { valid: false, possible: false, label: "세트 불가", score: 0, kind: null };

    const non = group.filter(tile => !tile.joker);
    if (non.length === 0) {
      return len >= 3
        ? { valid: true, possible: true, label: "조커 세트", score: len * 13, kind: "set" }
        : { valid: false, possible: true, label: "세트 대기", score: 0, kind: null };
    }

    const number = non[0].number;
    if (!non.every(tile => tile.number === number)) {
      return { valid: false, possible: false, label: "규칙 불일치", score: 0, kind: null };
    }

    const colors = non.map(tile => tile.color);
    if (new Set(colors).size !== colors.length) {
      return { valid: false, possible: false, label: "규칙 불일치", score: 0, kind: null };
    }

    if (len >= 3) {
      return { valid: true, possible: true, label: group.some(tile => tile.joker) ? "세트(조커)" : "세트", score: number * len, kind: "set" };
    }

    return { valid: false, possible: true, label: "세트 대기", score: 0, kind: null };
  }

  static analyzeRun(group) {
    const len = group.length;
    if (len === 0) return { valid: false, possible: false, label: "빈 줄", score: 0, kind: null };
    if (len > 13) return { valid: false, possible: false, label: "런 불가", score: 0, kind: null };

    const non = group.filter(tile => !tile.joker);
    if (non.length === 0) {
      return len >= 3
        ? { valid: true, possible: true, label: "조커 런", score: this.maxRunScore(len), kind: "run" }
        : { valid: false, possible: true, label: "런 대기", score: 0, kind: null };
    }

    const color = non[0].color;
    if (!non.every(tile => tile.color === color)) {
      return { valid: false, possible: false, label: "규칙 불일치", score: 0, kind: null };
    }

    const numbers = non.map(tile => tile.number).sort((a, b) => a - b);
    if (new Set(numbers).size !== numbers.length) {
      return { valid: false, possible: false, label: "규칙 불일치", score: 0, kind: null };
    }

    const minNum = numbers[0];
    const maxNum = numbers[numbers.length - 1];
    const startMin = Math.max(1, maxNum - len + 1);
    const startMax = Math.min(minNum, 13 - len + 1);

    if (startMin > startMax) {
      return { valid: false, possible: false, label: "규칙 불일치", score: 0, kind: null };
    }

    if (len >= 3) {
      const bestStart = startMax;
      const score = (len * (2 * bestStart + len - 1)) / 2;
      return { valid: true, possible: true, label: group.some(tile => tile.joker) ? "런(조커)" : "런", score, kind: "run" };
    }

    return { valid: false, possible: true, label: "런 대기", score: 0, kind: null };
  }

  static analyzeGroup(group) {
    if (!group || group.length === 0) {
      return { valid: false, ready: false, label: "빈 줄", score: 0, kind: null };
    }

    const setRes = this.analyzeSet(group);
    const runRes = this.analyzeRun(group);

    if (setRes.valid && runRes.valid) {
      return {
        valid: true,
        ready: true,
        label: "조커 세트/런",
        score: Math.max(setRes.score, runRes.score),
        kind: "wild"
      };
    }

    if (setRes.valid) {
      return { valid: true, ready: true, label: setRes.label, score: setRes.score, kind: setRes.kind };
    }
    if (runRes.valid) {
      return { valid: true, ready: true, label: runRes.label, score: runRes.score, kind: runRes.kind };
    }

    if (setRes.possible || runRes.possible) {
      return {
        valid: false,
        ready: false,
        label: setRes.possible ? setRes.label : runRes.label,
        score: 0,
        kind: null
      };
    }

    return {
      valid: false,
      ready: group.length >= 3,
      label: group.length >= 3 ? "규칙 불일치" : "조합 대기",
      score: 0,
      kind: null
    };
  }
}
