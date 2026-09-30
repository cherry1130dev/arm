/**
 * ==========================================================================
 * IoT Teleoperation Cockpit - Central Configuration & Storage Manager
 * ==========================================================================
 */

export const STORAGE_KEY = 'IOT_TELEOP_CONFIG_V2';

export const DEFAULT_CONFIG = {
  firebase: {
    dbUrl: "https://your-project-id-default-rtdb.firebaseio.com",
    apiKey: "",
    projectId: "my-iot-project",
    authDomain: "my-iot-project.firebaseapp.com",
    rootPath: "/test_bench"
  },
  camera: {
    ip: "192.168.1.150",
    port: 81,
    path: "/stream",
    visionMode: "normal", // normal, night, thermal, hud
    autoConnect: false,
    showHudCrosshair: true
  },
  armJoints: {
    base: {
      id: "base",
      name: "Base Turret (Yaw)",
      min: 0,
      max: 180,
      ideal: 90,
      description: "Horizontal 180° rotation"
    },
    shoulder: {
      id: "shoulder",
      name: "Shoulder Boom (Pitch)",
      min: 15,
      max: 165,
      ideal: 90,
      description: "Main arm lift & vertical pitch"
    },
    elbow: {
      id: "elbow",
      name: "Elbow Articulation (Pitch)",
      min: 0,
      max: 180,
      ideal: 90,
      description: "Forearm extension angle"
    },
    wrist: {
      id: "wrist",
      name: "Wrist Tool (Pitch/Roll)",
      min: 0,
      max: 180,
      ideal: 90,
      description: "End effector orientation"
    },
    gripper: {
      id: "gripper",
      name: "Gripper Claw",
      min: 20,
      max: 140,
      ideal: 80,
      description: "Clamp jaw aperture (20° Closed - 140° Open)"
    }
  },
  presets: {
    pick: {
      id: "pick",
      name: "Pick",
      cmd: "pic",
      angles: { base: 90, shoulder: 45, elbow: 135, wrist: 60, gripper: 130 },
      description: "Descend and prepare claw for grasp"
    },
    pos1: {
      id: "pos1",
      name: "Position 1",
      cmd: "pos1",
      angles: { base: 45, shoulder: 70, elbow: 90, wrist: 90, gripper: 80 },
      description: "Left inspection quadrant"
    },
    pos2: {
      id: "pos2",
      name: "Position 2",
      cmd: "pos2",
      angles: { base: 90, shoulder: 110, elbow: 75, wrist: 100, gripper: 80 },
      description: "High elevation observation"
    },
    pos3: {
      id: "pos3",
      name: "Position 3",
      cmd: "pos3",
      angles: { base: 135, shoulder: 70, elbow: 90, wrist: 90, gripper: 80 },
      description: "Right delivery quadrant"
    },
    drop: {
      id: "drop",
      name: "Drop",
      cmd: "drop",
      angles: { base: 140, shoulder: 60, elbow: 110, wrist: 70, gripper: 30 },
      description: "Payload release & claw open"
    },
    idle: {
      id: "idle",
      name: "Idle State",
      cmd: "idle",
      angles: { base: 90, shoulder: 90, elbow: 90, wrist: 90, gripper: 80 },
      description: "Safe stowed center balance"
    }
  },
  rover: {
    speed: 70,
    turnRate: 65,
    autoBrakeOnRelease: true,
    soundFx: true
  }
};

/**
 * Deep merge utility to ensure loaded config merges cleanly with defaults
 */
function deepMerge(target, source) {
  const output = { ...target };
  if (isObject(target) && isObject(source)) {
    Object.keys(source).forEach(key => {
      if (isObject(source[key])) {
        if (!(key in target)) {
          Object.assign(output, { [key]: source[key] });
        } else {
          output[key] = deepMerge(target[key], source[key]);
        }
      } else {
        Object.assign(output, { [key]: source[key] });
      }
    });
  }
  return output;
}

function isObject(item) {
  return (item && typeof item === 'object' && !Array.isArray(item));
}

/**
 * Load configuration from localStorage, falling back to defaults
 */
export function loadConfig() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      return JSON.parse(JSON.stringify(DEFAULT_CONFIG));
    }
    const parsed = JSON.parse(raw);
    return deepMerge(DEFAULT_CONFIG, parsed);
  } catch (err) {
    console.warn('[CONFIG] Failed to load from localStorage, using defaults:', err);
    return JSON.parse(JSON.stringify(DEFAULT_CONFIG));
  }
}

/**
 * Save configuration to localStorage
 */
export function saveConfig(cfg) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(cfg));
    return true;
  } catch (err) {
    console.error('[CONFIG] Failed to save to localStorage:', err);
    return false;
  }
}

/**
 * Reset configuration to system defaults
 */
export function resetConfig() {
  try {
    localStorage.removeItem(STORAGE_KEY);
    return JSON.parse(JSON.stringify(DEFAULT_CONFIG));
  } catch (err) {
    console.error('[CONFIG] Reset error:', err);
    return DEFAULT_CONFIG;
  }
}
