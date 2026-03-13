/**
 * UI Theme — mirrors Rust `UiPalette` in `src/tui/mod.rs`
 *
 * Three theme presets: NebulaPulse, GraphiteMist, GhostGlass.
 */

import type { UiThemePreset } from "../config/settings.js";
import type { LogoFont } from "./logos.js";

// ============================================================================
// PALETTE
// ============================================================================

export interface UiPalette {
    name: string;

    // Primary colors
    accent: string;       // Main accent color
    accentDim: string;    // Dimmed accent
    bg: string;           // Background base
    bgAlt: string;        // Alternate background
    fg: string;           // Primary text
    fgDim: string;        // Dimmed text
    fgMuted: string;      // Very dim text

    // Semantic
    success: string;
    error: string;
    warning: string;
    info: string;
    danger: string;       // Critical/overflow (distinct from error)

    // Logo
    logoTop: string;      // Gradient top
    logoMid: string;      // Gradient middle
    logoBottom: string;   // Gradient bottom
    logoFont: LogoFont;   // Preferred logo font style

    // Status bar
    statusBg: string;
    statusFg: string;

    // Borders
    border: string;
    borderActive: string;
}

// ============================================================================
// PRESETS
// ============================================================================

const NEBULA_PULSE: UiPalette = {
    name: "Nebula Pulse",
    accent: "#c678dd",
    accentDim: "#9b59b6",
    bg: "#1e1e2e",
    bgAlt: "#2a2a3e",
    fg: "#e0e0e0",
    fgDim: "#a0a0b0",
    fgMuted: "#6c6c80",
    success: "#98c379",
    error: "#e06c75",
    warning: "#e5c07b",
    info: "#61afef",
    danger: "#ff4444",
    logoTop: "#ff6b6b",
    logoMid: "#ffd93d",
    logoBottom: "#c678dd",
    logoFont: "block",
    statusBg: "#2a2a3e",
    statusFg: "#a0a0b0",
    border: "#3a3a4e",
    borderActive: "#c678dd",
};

const GRAPHITE_MIST: UiPalette = {
    name: "Graphite Mist",
    accent: "#61afef",
    accentDim: "#4a8bbf",
    bg: "#1a1b26",
    bgAlt: "#24283b",
    fg: "#c0caf5",
    fgDim: "#8b95c9",
    fgMuted: "#565f89",
    success: "#9ece6a",
    error: "#f7768e",
    warning: "#e0af68",
    info: "#7dcfff",
    danger: "#ff3333",
    logoTop: "#7dcfff",
    logoMid: "#61afef",
    logoBottom: "#4a8bbf",
    logoFont: "simple3d",
    statusBg: "#24283b",
    statusFg: "#8b95c9",
    border: "#3b4261",
    borderActive: "#61afef",
};

const GHOST_GLASS: UiPalette = {
    name: "Ghost Glass",
    accent: "#56b6c2",
    accentDim: "#3d8c95",
    bg: "#0d1117",
    bgAlt: "#161b22",
    fg: "#c9d1d9",
    fgDim: "#8b949e",
    fgMuted: "#484f58",
    success: "#56d364",
    error: "#f85149",
    warning: "#d29922",
    info: "#58a6ff",
    danger: "#ff4040",
    logoTop: "#56d364",
    logoMid: "#56b6c2",
    logoBottom: "#58a6ff",
    logoFont: "threeD",
    statusBg: "#161b22",
    statusFg: "#8b949e",
    border: "#30363d",
    borderActive: "#56b6c2",
};

// ============================================================================
// THEME RESOLVER
// ============================================================================

export function getThemePalette(preset: UiThemePreset): UiPalette {
    switch (preset) {
        case "nebula_pulse":
            return NEBULA_PULSE;
        case "graphite_mist":
            return GRAPHITE_MIST;
        case "ghost_glass":
            return GHOST_GLASS;
        default:
            return NEBULA_PULSE;
    }
}

/**
 * Blend between two hex colors (for gradient logos, etc.)
 */
export function blendColors(start: string, end: string, t: number): string {
    const sR = parseInt(start.slice(1, 3), 16);
    const sG = parseInt(start.slice(3, 5), 16);
    const sB = parseInt(start.slice(5, 7), 16);
    const eR = parseInt(end.slice(1, 3), 16);
    const eG = parseInt(end.slice(3, 5), 16);
    const eB = parseInt(end.slice(5, 7), 16);

    const r = Math.round(sR + (eR - sR) * t);
    const g = Math.round(sG + (eG - sG) * t);
    const b = Math.round(sB + (eB - sB) * t);

    return `#${r.toString(16).padStart(2, "0")}${g.toString(16).padStart(2, "0")}${b.toString(16).padStart(2, "0")}`;
}
