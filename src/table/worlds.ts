/** Les cinq mondes : chaque monde change le décor, les couleurs des lampes et le multiplicateur. */
export interface WorldTheme { id: string; name: string; mult: number; bg1: string; bg2: string; ink: string; accent: string; lamp: string; rail: string; pattern: "circuit" | "lava" | "ice" | "jungle" | "stars" }
export const WORLDS: WorldTheme[] = [
  { id: "neon", name: "NÉON", mult: 1, bg1: "#101a3a", bg2: "#060a18", ink: "#2a3f7a", accent: "#4ad1ff", lamp: "#ffd24a", rail: "#8fa3c8", pattern: "circuit" },
  { id: "lave", name: "LAVE", mult: 2, bg1: "#3a1008", bg2: "#140404", ink: "#7a2a12", accent: "#ff5a3c", lamp: "#ffb347", rail: "#c89a7a", pattern: "lava" },
  { id: "glace", name: "GLACE", mult: 3, bg1: "#0e2a3a", bg2: "#04101a", ink: "#2a6a8a", accent: "#bfefff", lamp: "#9ae6ff", rail: "#b8d8e8", pattern: "ice" },
  { id: "jungle", name: "JUNGLE", mult: 4, bg1: "#0c2e14", bg2: "#031006", ink: "#1f6a2e", accent: "#7dff8a", lamp: "#ffe27a", rail: "#a8c8a0", pattern: "jungle" },
  { id: "cosmos", name: "COSMOS", mult: 5, bg1: "#1c0a3a", bg2: "#070214", ink: "#4a2a8a", accent: "#ff8cf0", lamp: "#ffffff", rail: "#c0a8e0", pattern: "stars" },
];
