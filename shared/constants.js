const COLORS = [
  { key: "red", icon: "🍓", label: "빨강" },
  { key: "blue", icon: "💧", label: "파랑" },
  { key: "yellow", icon: "🌼", label: "노랑" },
  { key: "black", icon: "🌑", label: "검정" }
];

const PLAYER_PRESETS = [
  { slot: 0, name: "토끼", icon: "🐰", accent: "var(--p1)" },
  { slot: 1, name: "곰", icon: "🐻", accent: "var(--p2)" },
  { slot: 2, name: "여우", icon: "🦊", accent: "var(--p3)" },
  { slot: 3, name: "부엉이", icon: "🦉", accent: "var(--p4)" }
];

const ANIMAL_OPTIONS = [
  { name: "토끼", icon: "🐰" },
  { name: "곰", icon: "🐻" },
  { name: "여우", icon: "🦊" },
  { name: "부엉이", icon: "🦉" },
  { name: "너구리", icon: "🦝" },
  { name: "돼지", icon: "🐷" },
  { name: "햄스터", icon: "🐹" },
  { name: "코알라", icon: "🐨" },
  { name: "늑대", icon: "🐺" },
  { name: "소", icon: "🐮" },
  { name: "호랑이", icon: "🐯" },
  { name: "사자", icon: "🦁" },
  { name: "팬더", icon: "🐼" },
  { name: "기린", icon: "🦒" },
  { name: "고양이", icon: "🐱" },
  { name: "강아지", icon: "🐶" }
];

const SETUP_STATES = ["HUMAN", "AI-1", "AI-2", "AI-3", "AI-4", "AI-5", "AI-6", "OFF"];
const AI_LEVEL_INFO = {
  1: { short: "AI-1", label: "AI-1 초급", desc: "초급" },
  2: { short: "AI-2", label: "AI-2 쉬움", desc: "쉬움" },
  3: { short: "AI-3", label: "AI-3 보통", desc: "보통" },
  4: { short: "AI-4", label: "AI-4 어려움", desc: "어려움" },
  5: { short: "AI-5", label: "AI-5 최상", desc: "최상" },
  6: { short: "AI-6", label: "AI-6 챌린지", desc: "챌린지" }
};
const HINT_LIMIT_OPTIONS = [0, 3, 5, null];
const getHintLimitLabel = (value) => value === null ? "무제한" : `${value}개`;
