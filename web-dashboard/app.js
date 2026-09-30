/**
 * ==========================================================================
 * Cockpit Teleoperation Controller Application
 * 5-DOF Manipulator & Rover RC Ground Control Station
 * ==========================================================================
 */

import { loadConfig } from './config.js';
import { sfx } from './soundFx.js';
import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.8.0/firebase-app.js';
import { 
  getDatabase, 
  ref, 
  set, 
  update,
  onValue, 
  off 
} from 'https://www.gstatic.com/firebasejs/10.8.0/firebase-database.js';

// Load Persistent Configuration
let config = loadConfig();

// App State
const state = {
  firebaseApp: null,
  firebaseDb: null,
  dbRef: null,
  isFirebaseConnected: false,
  
  // Stream
  streamActive: false,
  streamTimer: null,
  frameCount: 0,
  lastFpsTimestamp: performance.now(),
  currentFps: 0,
  simulatorActive: false,
  simAnimId: null,
  visionMode: 'normal',
  simPitch: 0,
  simRoll: 0,
  
  // Arm Joint Angles (initialized to ideal angles from settings)
  armAngles: {
    base: config.armJoints.base.ideal,
    shoulder: config.armJoints.shoulder.ideal,
    elbow: config.armJoints.elbow.ideal,
    wrist: config.armJoints.wrist.ideal,
    gripper: config.armJoints.gripper.ideal
  },
  activeJoint: 'base',
  
  // Rover
  roverSpeed: config.rover.speed || 70,
  activeKeys: new Set(),
  lastDriveCommand: null,
  lightsOn: false,
  
  // Telemetry & Latency
  lastCommandSent: null,
  lastCommandTimestamp: null,
  missionStartTime: Date.now(),
  debounceTimers: {}
};

const JOINTS = ['base', 'shoulder', 'elbow', 'wrist', 'gripper'];

// DOM Element Cache
const dom = {
  // HUD Badges
  dotFirebase: document.getElementById('dotFirebase'),
  textFirebase: document.getElementById('textFirebase'),
  dotCamera: document.getElementById('dotCamera'),
  textCamera: document.getElementById('textCamera'),
  textLatency: document.getElementById('textLatency'),
  textNodeHeartbeat: document.getElementById('textNodeHeartbeat'),
  btnToggleAudio: document.getElementById('btnToggleAudio'),
  audioText: document.getElementById('audioText'),
  
  // Stream Viewport & Options
  fpvViewport: document.getElementById('fpvViewport'),
  streamImage: document.getElementById('streamImage'),
  simulatorCanvas: document.getElementById('simulatorCanvas'),
  hudFpsText: document.getElementById('hudFpsText'),
  hudBwText: document.getElementById('hudBwText'),
  hudStreamMsg: document.getElementById('hudStreamMsg'),
  activeVisionMode: document.getElementById('activeVisionMode'),
  filterButtons: document.querySelectorAll('.filter-btn'),
  btnSnapshot: document.getElementById('btnSnapshot'),
  btnFullscreen: document.getElementById('btnFullscreen'),
  inputCamIp: document.getElementById('inputCamIp'),
  inputCamPort: document.getElementById('inputCamPort'),
  inputCamPath: document.getElementById('inputCamPath'),
  btnConnectStream: document.getElementById('btnConnectStream'),
  btnToggleSimulator: document.getElementById('btnToggleSimulator'),

  // Arm Sliders & Presets
  presetButtons: document.querySelectorAll('.preset-action-btn'),

  // Rover RC Controls
  dpadButtons: document.querySelectorAll('.dpad-btn'),
  speedPills: document.querySelectorAll('.speed-pill'),
  btnRoverLights: document.getElementById('btnRoverLights'),
  btnRoverHorn: document.getElementById('btnRoverHorn'),

  // Terminal & Feedback
  feedbackCmd: document.getElementById('feedbackCmd'),
  feedbackAck: document.getElementById('feedbackAck'),
  feedbackLatency: document.getElementById('feedbackLatency'),
  feedbackUptime: document.getElementById('feedbackUptime'),
  btnToggleTerminal: document.getElementById('btnToggleTerminal'),
  terminalDrawer: document.getElementById('terminalDrawer'),
  btnClearLog: document.getElementById('btnClearLog'),
  terminalLog: document.getElementById('terminalLog')
};

/**
 * App Initialization
 */
function init() {
  logEvent('system', 'Cockpit teleoperation system initializing...');

  // 1. Initialize Arm Joint Sliders from Configuration
  setupJointSliders();

  // 2. Setup Camera Options from Configuration
  setupCameraDefaults();

  // 3. Connect to Firebase if configured
  initFirebase();

  // 4. Bind All Interactive UI Events
  bindStreamEvents();
  bindArmEvents();
  bindRoverEvents();
  bindKeyboardEvents();
  bindTerminalEvents();

  // 5. Start Mission Clock
  setInterval(updateMissionClock, 1000);

  // 6. Start in Simulator Mode by default for immediate visual feedback
  startSimulator();
  logEvent('system', 'Ready for teleoperation. Camera simulator active.');
}

/**
 * Configure Joint Sliders with Min, Max, and Default Ideal (Center) Values
 */
function setupJointSliders() {
  JOINTS.forEach(joint => {
    const jConfig = config.armJoints[joint];
    if (!jConfig) return;

    const slider = document.getElementById(`slider_${joint}`);
    const badge = document.getElementById(`badge_${joint}`);
    const hint = document.getElementById(`hint_${joint}`);
    const idealMarker = document.getElementById(`ideal_marker_${joint}`);

    if (slider) {
      slider.min = jConfig.min;
      slider.max = jConfig.max;
      // Default set to ideal center angle from settings!
      slider.value = jConfig.ideal;
      state.armAngles[joint] = jConfig.ideal;
    }

    if (badge) {
      badge.textContent = `${jConfig.ideal}°`;
    }

    if (hint) {
      hint.textContent = `Min: ${jConfig.min}° • Ideal: ${jConfig.ideal}° • Max: ${jConfig.max}°`;
    }

    // Position the ideal indicator marker along the slider track
    if (idealMarker && jConfig.max > jConfig.min) {
      const pct = ((jConfig.ideal - jConfig.min) / (jConfig.max - jConfig.min)) * 100;
      idealMarker.style.left = `${pct}%`;
    }
  });
}

/**
 * Setup Camera Defaults from Configuration
 */
function setupCameraDefaults() {
  if (config.camera) {
    if (dom.inputCamIp) dom.inputCamIp.value = config.camera.ip || '192.168.1.150';
    if (dom.inputCamPort) dom.inputCamPort.value = config.camera.port || 81;
    if (dom.inputCamPath) dom.inputCamPath.value = config.camera.path || '/stream';
  }
}

/**
 * Firebase Realtime Database Integration
 */
function initFirebase() {
  const fb = config.firebase;
  if (!fb || !fb.dbUrl || !fb.apiKey || !fb.projectId) {
    updateFirebaseStatus(false, 'NO CONFIG (VISIT SETTINGS)');
    logEvent('warn', 'Firebase credentials not configured. Open Settings to set them.');
    return;
  }

  updateFirebaseStatus(false, 'CONNECTING...');

  try {
    state.firebaseApp = initializeApp({
      apiKey: fb.apiKey,
      databaseURL: fb.dbUrl,
      projectId: fb.projectId,
      authDomain: fb.authDomain || undefined
    }, 'CockpitApp_' + Date.now());

    state.firebaseDb = getDatabase(state.firebaseApp);
    const rootPath = fb.rootPath || '/test_bench';
    state.dbRef = ref(state.firebaseDb, rootPath);

    // Attach stream listener for incoming hardware acknowledgments & echo
    onValue(state.dbRef, (snapshot) => {
      if (snapshot.exists()) {
        const val = snapshot.val();
        handleIncomingData(val);
      }
    }, (error) => {
      console.error('[FIREBASE] Sync error:', error);
      updateFirebaseStatus(false, 'SYNC ERROR');
      logEvent('warn', `Firebase stream error: ${error.message}`);
    });

    // Check .info/connected
    const connectedRef = ref(state.firebaseDb, '.info/connected');
    onValue(connectedRef, (snap) => {
      const isOnline = snap.val() === true;
      state.isFirebaseConnected = isOnline;
      if (isOnline) {
        updateFirebaseStatus(true, 'ONLINE (REALTIME)');
        logEvent('system', 'Firebase Realtime Database connected.');
      } else {
        updateFirebaseStatus(false, 'OFFLINE');
      }
    });

  } catch (err) {
    console.error('[FIREBASE INIT FAILED]', err);
    updateFirebaseStatus(false, 'INIT FAILED');
    logEvent('warn', `Failed to init Firebase: ${err.message}`);
  }
}

function updateFirebaseStatus(online, label) {
  if (dom.dotFirebase) {
    dom.dotFirebase.className = `pill-dot ${online ? 'connected' : 'disconnected'}`;
  }
  if (dom.textFirebase) {
    dom.textFirebase.textContent = label;
  }
}

/**
 * Handle incoming Realtime Database payload from ESP
 */
function handleIncomingData(data) {
  if (!data) return;

  // 1. Device Acknowledgment
  if (data.device_ack) {
    let ackText = '';
    if (typeof data.device_ack === 'string') {
      ackText = data.device_ack;
    } else if (typeof data.device_ack === 'object') {
      ackText = data.device_ack.status || JSON.stringify(data.device_ack);
      if (data.device_ack.device_uptime_ms) {
        const upSec = Math.floor(data.device_ack.device_uptime_ms / 1000);
        if (dom.textNodeHeartbeat) dom.textNodeHeartbeat.textContent = `${upSec}s UP`;
      }
    }

    if (dom.feedbackAck) dom.feedbackAck.textContent = ackText;

    // Calculate roundtrip latency
    if (state.lastCommandTimestamp) {
      const rtt = Math.round(performance.now() - state.lastCommandTimestamp);
      if (dom.feedbackLatency) dom.feedbackLatency.textContent = `${rtt} ms`;
      if (dom.textLatency) dom.textLatency.textContent = `${rtt} ms`;
      state.lastCommandTimestamp = null;
    }

    logEvent('ack', `[ESP ACK] ${ackText}`);
  }

  // 2. Node heartbeat ping
  if (data.heartbeat) {
    if (dom.textNodeHeartbeat) dom.textNodeHeartbeat.textContent = 'ONLINE';
  }
}

/**
 * Dispatch Unique Command to Firebase RTDB
 * @param {string} cmdString - Unique command name (e.g. "pic", "drop", "pos1", "ROVER_FWD")
 * @param {object|null} extraPayload - Optional payload like arm angles
 */
async function sendCommand(cmdString, extraPayload = null) {
  sfx.playClick();
  state.lastCommandSent = cmdString;
  state.lastCommandTimestamp = performance.now();

  if (dom.feedbackCmd) dom.feedbackCmd.textContent = cmdString;
  logEvent('cmd', `[TX COMMAND] ${cmdString}`);

  if (!state.firebaseDb || !state.isFirebaseConnected) {
    logEvent('warn', `Offline mode: Command [${cmdString}] simulated locally.`);
    return;
  }

  try {
    const rootPath = config.firebase.rootPath || '/test_bench';
    const payload = {
      command: cmdString,
      timestamp: Date.now()
    };

    if (extraPayload) {
      Object.assign(payload, extraPayload);
    }

    await update(ref(state.firebaseDb, rootPath), payload);
  } catch (err) {
    console.error('[SEND CMD ERROR]', err);
    logEvent('warn', `Failed to send command ${cmdString}: ${err.message}`);
  }
}

/**
 * Dispatch Arm Joint Angles Update
 */
function syncArmAngles(targetJoint = null) {
  const currentAngles = { ...state.armAngles };
  const rootPath = config.firebase.rootPath || '/test_bench';

  if (state.debounceTimers.arm) {
    clearTimeout(state.debounceTimers.arm);
  }

  state.debounceTimers.arm = setTimeout(async () => {
    if (!state.firebaseDb || !state.isFirebaseConnected) return;

    try {
      const payload = {
        arm_angles: currentAngles,
        // Legacy single servo support
        servo_angle: currentAngles[targetJoint || 'base'],
        last_joint: targetJoint || 'base'
      };

      await update(ref(state.firebaseDb, rootPath), payload);
      logEvent('cmd', `[ARM SYNC] J1:${currentAngles.base}° J2:${currentAngles.shoulder}° J3:${currentAngles.elbow}° J4:${currentAngles.wrist}° J5:${currentAngles.gripper}°`);
    } catch (err) {
      console.error('[SYNC ARM ERROR]', err);
    }
  }, 40); // 40ms debounce for buttery-smooth slider responsiveness
}

/**
 * Set and Animate Arm to Specified Angles
 */
function applyPosePreset(presetId) {
  const preset = config.presets[presetId];
  if (!preset) return;

  sfx.playPreset();
  const uniqueCmd = preset.cmd || presetId;

  // 1. Update Sliders and Badges
  JOINTS.forEach(joint => {
    if (preset.angles && preset.angles[joint] !== undefined) {
      const targetAngle = preset.angles[joint];
      state.armAngles[joint] = targetAngle;

      const slider = document.getElementById(`slider_${joint}`);
      const badge = document.getElementById(`badge_${joint}`);

      if (slider) slider.value = targetAngle;
      if (badge) badge.textContent = `${targetAngle}°`;
    }
  });

  // 2. Dispatch Unique Command String (pic, pos1, drop, idle...) and angles payload to ESP
  sendCommand(uniqueCmd, {
    arm_angles: { ...state.armAngles },
    preset_name: preset.name
  });
}

/**
 * Bind Arm Controls & Presets
 */
function bindArmEvents() {
  // Sliders Input Listeners
  JOINTS.forEach(joint => {
    const slider = document.getElementById(`slider_${joint}`);
    const badge = document.getElementById(`badge_${joint}`);

    if (slider) {
      slider.addEventListener('input', (e) => {
        const val = parseInt(e.target.value, 10);
        state.armAngles[joint] = val;
        state.activeJoint = joint;
        if (badge) badge.textContent = `${val}°`;
        syncArmAngles(joint);
      });
    }
  });

  // Nudge Buttons ([-5°], [Ideal/Center], [+5°])
  document.querySelectorAll('.nudge-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const joint = btn.getAttribute('data-joint');
      const isCenter = btn.getAttribute('data-center') === 'true';
      const delta = parseInt(btn.getAttribute('data-delta'), 10) || 0;
      const jConfig = config.armJoints[joint];

      if (!jConfig) return;

      let newAngle = state.armAngles[joint];

      if (isCenter) {
        newAngle = jConfig.ideal;
      } else {
        newAngle = Math.max(jConfig.min, Math.min(jConfig.max, newAngle + delta));
      }

      state.armAngles[joint] = newAngle;
      state.activeJoint = joint;

      const slider = document.getElementById(`slider_${joint}`);
      const badge = document.getElementById(`badge_${joint}`);

      if (slider) slider.value = newAngle;
      if (badge) badge.textContent = `${newAngle}°`;

      sfx.playClick();
      syncArmAngles(joint);
    });
  });

  // Preset Buttons (Pick, Pos1, Pos2, Pos3, Drop, Idle)
  dom.presetButtons.forEach(btn => {
    btn.addEventListener('click', () => {
      const presetId = btn.getAttribute('data-preset');
      // Visual feedback
      btn.classList.add('active');
      setTimeout(() => btn.classList.remove('active'), 350);
      applyPosePreset(presetId);
    });
  });
}

/**
 * Bind Rover RC D-Pad & Aux Controls
 */
function bindRoverEvents() {
  // D-Pad Directional Buttons
  dom.dpadButtons.forEach(btn => {
    const cmd = btn.getAttribute('data-cmd');

    // Mouse / Touch Hold handling
    btn.addEventListener('mousedown', () => {
      btn.classList.add('pressed');
      executeRoverCommand(cmd);
    });

    btn.addEventListener('mouseup', () => {
      btn.classList.remove('pressed');
      if (config.rover.autoBrakeOnRelease && cmd !== 'ROVER_STOP') {
        executeRoverCommand('ROVER_STOP');
      }
    });

    btn.addEventListener('mouseleave', () => {
      if (btn.classList.contains('pressed')) {
        btn.classList.remove('pressed');
        if (config.rover.autoBrakeOnRelease && cmd !== 'ROVER_STOP') {
          executeRoverCommand('ROVER_STOP');
        }
      }
    });

    btn.addEventListener('touchstart', (e) => {
      e.preventDefault();
      btn.classList.add('pressed');
      executeRoverCommand(cmd);
    });

    btn.addEventListener('touchend', (e) => {
      e.preventDefault();
      btn.classList.remove('pressed');
      if (config.rover.autoBrakeOnRelease && cmd !== 'ROVER_STOP') {
        executeRoverCommand('ROVER_STOP');
      }
    });
  });

  // Speed Mode Selector
  dom.speedPills.forEach(pill => {
    pill.addEventListener('click', () => {
      dom.speedPills.forEach(p => p.classList.remove('active'));
      pill.classList.add('active');
      const spd = parseInt(pill.getAttribute('data-speed'), 10) || 70;
      state.roverSpeed = spd;
      sfx.playClick();
      logEvent('system', `Rover throttle set to: ${spd}%`);
    });
  });

  // Aux Lights
  dom.btnRoverLights?.addEventListener('click', () => {
    state.lightsOn = !state.lightsOn;
    dom.btnRoverLights.classList.toggle('active', state.lightsOn);
    const cmd = state.lightsOn ? 'ROVER_LIGHTS_ON' : 'ROVER_LIGHTS_OFF';
    executeRoverCommand(cmd);
  });

  // Aux Horn
  dom.btnRoverHorn?.addEventListener('mousedown', () => {
    dom.btnRoverHorn.classList.add('active');
    executeRoverCommand('ROVER_HORN');
  });
  dom.btnRoverHorn?.addEventListener('mouseup', () => {
    dom.btnRoverHorn.classList.remove('active');
  });
}

function executeRoverCommand(cmd) {
  if (cmd === 'ROVER_STOP') {
    sfx.playStop();
    state.simPitch = 0;
    state.simRoll = 0;
  } else {
    sfx.playDrive();
    // Simulate FPV camera tilt with vehicle dynamics
    if (cmd === 'ROVER_FWD') state.simPitch = -4;
    else if (cmd === 'ROVER_REV') state.simPitch = 4;
    else if (cmd === 'ROVER_LEFT' || cmd === 'ROVER_SPIN_L') state.simRoll = -5;
    else if (cmd === 'ROVER_RIGHT' || cmd === 'ROVER_SPIN_R') state.simRoll = 5;
  }

  sendCommand(cmd, { speed: state.roverSpeed });
}

/**
 * Gaming Keyboard Controls (WASD, QE, Spacebar)
 */
function bindKeyboardEvents() {
  const keyMap = {
    'KeyW': { cmd: 'ROVER_FWD', btnId: 'btnRoverFwd', kbdId: 'keyW' },
    'ArrowUp': { cmd: 'ROVER_FWD', btnId: 'btnRoverFwd', kbdId: 'keyW' },
    'KeyS': { cmd: 'ROVER_REV', btnId: 'btnRoverRev', kbdId: 'keyS' },
    'ArrowDown': { cmd: 'ROVER_REV', btnId: 'btnRoverRev', kbdId: 'keyS' },
    'KeyA': { cmd: 'ROVER_LEFT', btnId: 'btnRoverLeft', kbdId: 'keyA' },
    'ArrowLeft': { cmd: 'ROVER_LEFT', btnId: 'btnRoverLeft', kbdId: 'keyA' },
    'KeyD': { cmd: 'ROVER_RIGHT', btnId: 'btnRoverRight', kbdId: 'keyD' },
    'ArrowRight': { cmd: 'ROVER_RIGHT', btnId: 'btnRoverRight', kbdId: 'keyD' },
    'KeyQ': { cmd: 'ROVER_SPIN_L', btnId: 'btnRoverSpinL', kbdId: 'keyQ' },
    'KeyE': { cmd: 'ROVER_SPIN_R', btnId: 'btnRoverSpinR', kbdId: 'keyE' },
    'Space': { cmd: 'ROVER_STOP', btnId: 'btnRoverStop', kbdId: 'keySpace' }
  };

  window.addEventListener('keydown', (e) => {
    // Prevent scrolling on Space or Arrows
    if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) {
      if (document.activeElement.tagName !== 'INPUT') {
        e.preventDefault();
      }
    }

    if (document.activeElement.tagName === 'INPUT') return;

    const action = keyMap[e.code];
    if (action && !state.activeKeys.has(e.code)) {
      state.activeKeys.add(e.code);

      // Highlight keycap and D-Pad button
      const kbd = document.getElementById(action.kbdId);
      const btn = document.getElementById(action.btnId);
      if (kbd) kbd.classList.add('active');
      if (btn) btn.classList.add('pressed');

      executeRoverCommand(action.cmd);
    }
  });

  window.addEventListener('keyup', (e) => {
    if (document.activeElement.tagName === 'INPUT') return;

    const action = keyMap[e.code];
    if (action) {
      state.activeKeys.delete(e.code);

      const kbd = document.getElementById(action.kbdId);
      const btn = document.getElementById(action.btnId);
      if (kbd) kbd.classList.remove('active');
      if (btn) btn.classList.remove('pressed');

      // If all keys released and auto-brake is enabled, stop rover
      if (state.activeKeys.size === 0 && config.rover.autoBrakeOnRelease) {
        executeRoverCommand('ROVER_STOP');
      }
    }
  });
}

/**
 * Camera Stream & Simulator Controls
 */
function bindStreamEvents() {
  // Connect Stream
  dom.btnConnectStream?.addEventListener('click', () => {
    if (state.streamActive) {
      disconnectStream();
    } else {
      connectStream();
    }
  });

  // Toggle Simulator
  dom.btnToggleSimulator?.addEventListener('click', () => {
    if (state.simulatorActive) {
      stopSimulator();
      dom.btnToggleSimulator.classList.remove('active');
    } else {
      disconnectStream();
      startSimulator();
      dom.btnToggleSimulator.classList.add('active');
    }
  });

  // Vision Filter Buttons
  dom.filterButtons.forEach(btn => {
    btn.addEventListener('click', () => {
      dom.filterButtons.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      const mode = btn.getAttribute('data-filter');
      setVisionMode(mode);
    });
  });

  // Snapshot
  dom.btnSnapshot?.addEventListener('click', captureSnapshot);

  // Fullscreen
  dom.btnFullscreen?.addEventListener('click', () => {
    if (!document.fullscreenElement) {
      dom.fpvViewport.requestFullscreen?.();
    } else {
      document.exitFullscreen?.();
    }
  });

  // Audio SFX Toggle
  dom.btnToggleAudio?.addEventListener('click', () => {
    const isEnabled = sfx.toggleSound();
    dom.audioText.textContent = `SFX: ${isEnabled ? 'ON' : 'MUTE'}`;
    logEvent('system', `Cockpit audio effects: ${isEnabled ? 'ENABLED' : 'MUTED'}`);
  });
}

function setVisionMode(mode) {
  state.visionMode = mode;
  dom.fpvViewport.classList.remove('filter-nvg', 'filter-thermal', 'filter-hud');

  if (mode === 'nvg') dom.fpvViewport.classList.add('filter-nvg');
  else if (mode === 'thermal') dom.fpvViewport.classList.add('filter-thermal');
  else if (mode === 'hud') dom.fpvViewport.classList.add('filter-hud');

  const modeNames = { normal: 'OPTICAL (RGB)', nvg: 'NIGHT VISION (NVG)', thermal: 'THERMAL (FLIR)', hud: 'TACTICAL WIREFRAME' };
  if (dom.activeVisionMode) dom.activeVisionMode.textContent = modeNames[mode] || 'OPTICAL (RGB)';
  sfx.playClick();
}

/**
 * Connect to ESP32-CAM MJPEG Stream
 */
function connectStream() {
  const ip = dom.inputCamIp.value.trim();
  const port = dom.inputCamPort.value.trim();
  const path = dom.inputCamPath.value.trim();

  if (!ip) {
    alert('Please enter a valid ESP32-CAM IP address');
    return;
  }

  stopSimulator();

  const streamUrl = `http://${ip}:${port}${path}`;
  logEvent('system', `Connecting to ESP32-CAM stream: ${streamUrl}`);
  dom.hudStreamMsg.textContent = 'CONNECTING TO SENSOR...';

  dom.streamImage.style.display = 'block';
  dom.simulatorCanvas.style.display = 'none';

  dom.streamImage.src = streamUrl;
  state.streamActive = true;
  state.frameCount = 0;
  state.lastFpsTimestamp = performance.now();

  dom.btnConnectStream.innerHTML = `
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="btn-icon">
      <rect x="6" y="6" width="12" height="12"/>
    </svg>
    Disconnect
  `;
  dom.btnConnectStream.classList.add('btn-danger');

  dom.dotCamera.className = 'pill-dot connected';
  dom.textCamera.textContent = 'LIVE FEED';

  // Monitor frame loading for FPS calculation
  dom.streamImage.onload = () => {
    onStreamFrame();
    dom.hudStreamMsg.textContent = 'LIVE FPV ACTIVE';
  };

  dom.streamImage.onerror = () => {
    logEvent('warn', 'Stream connection failed. Check Wi-Fi and Camera IP.');
    dom.hudStreamMsg.textContent = 'STREAM OFFLINE (CHECK IP)';
  };
}

function disconnectStream() {
  state.streamActive = false;
  dom.streamImage.src = '';
  dom.streamImage.style.display = 'none';

  dom.btnConnectStream.innerHTML = `
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="btn-icon">
      <polygon points="5 3 19 12 5 21 5 3"/>
    </svg>
    Connect Stream
  `;
  dom.btnConnectStream.classList.remove('btn-danger');

  dom.dotCamera.className = 'pill-dot disconnected';
  dom.textCamera.textContent = 'OFFLINE';
  dom.hudFpsText.textContent = '0.0';
  dom.hudStreamMsg.textContent = 'STREAM DISCONNECTED';

  // Fallback to simulator
  startSimulator();
}

function onStreamFrame() {
  state.frameCount++;
  const now = performance.now();
  const elapsed = now - state.lastFpsTimestamp;

  if (elapsed >= 1000) {
    state.currentFps = ((state.frameCount * 1000) / elapsed).toFixed(1);
    dom.hudFpsText.textContent = state.currentFps;
    const estBw = Math.round(state.currentFps * 32); // rough estimate ~32KB per VGA JPEG frame
    dom.hudBwText.textContent = `${estBw} KB/s`;

    state.frameCount = 0;
    state.lastFpsTimestamp = now;
  }
}

/**
 * High-Tech Canvas Camera Simulator (when hardware camera is offline)
 */
function startSimulator() {
  state.simulatorActive = true;
  dom.simulatorCanvas.style.display = 'block';
  dom.streamImage.style.display = 'none';

  dom.dotCamera.className = 'pill-dot connected';
  dom.textCamera.textContent = 'SIMULATOR';
  dom.hudStreamMsg.textContent = 'RUNNING TELEOP SIMULATOR';

  const canvas = dom.simulatorCanvas;
  const ctx = canvas.getContext('2d');

  canvas.width = 640;
  canvas.height = 480;

  let targetX = 320;
  let targetSpeed = 1.2;

  function renderSim() {
    if (!state.simulatorActive) return;

    // Background Gradient (Horizon + Ground)
    const skyGrad = ctx.createLinearGradient(0, 0, 0, 480);
    skyGrad.addColorStop(0, '#02060c');
    skyGrad.addColorStop(0.5, '#071526');
    skyGrad.addColorStop(0.51, '#061c16');
    skyGrad.addColorStop(1, '#010906');
    ctx.fillStyle = skyGrad;
    ctx.fillRect(0, 0, 640, 480);

    // Save for tilt/pitch transformation
    ctx.save();
    ctx.translate(320, 240);
    ctx.rotate((state.simRoll * Math.PI) / 180);
    ctx.translate(0, state.simPitch * 3);

    // Perspective Ground Grid (Simulating Rover terrain navigation)
    ctx.strokeStyle = 'rgba(0, 240, 255, 0.25)';
    ctx.lineWidth = 1;

    // Vanishing Lines
    for (let x = -400; x <= 400; x += 80) {
      ctx.beginPath();
      ctx.moveTo(x * 0.05, 0);
      ctx.lineTo(x * 1.8, 240);
      ctx.stroke();
    }

    // Horizontal Depth Grid Lines
    for (let y = 15; y < 240; y += 22) {
      ctx.beginPath();
      ctx.moveTo(-450, y);
      ctx.lineTo(450, y);
      ctx.stroke();
    }

    // Horizon line
    ctx.strokeStyle = 'rgba(0, 255, 136, 0.6)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(-400, 0);
    ctx.lineTo(400, 0);
    ctx.stroke();

    ctx.restore();

    // Simulated Target Object / Beacon
    targetX += targetSpeed;
    if (targetX > 450 || targetX < 190) targetSpeed = -targetSpeed;

    ctx.strokeStyle = '#ffb700';
    ctx.lineWidth = 2;
    ctx.strokeRect(targetX - 25, 230, 50, 40);

    ctx.fillStyle = '#ffb700';
    ctx.font = '10px "JetBrains Mono"';
    ctx.fillText('TARGET_OBJ // DIST: 1.4m', targetX - 50, 222);

    // Simulated Arm End-Effector Silhouette in lower viewport
    drawArmOverlay(ctx);

    // Simulated Noise / Scanline artifact
    ctx.fillStyle = 'rgba(255, 255, 255, 0.015)';
    for (let i = 0; i < 480; i += 4) {
      ctx.fillRect(0, i, 640, 1);
    }

    // Frame Counter for FPS
    onStreamFrame();

    state.simAnimId = requestAnimationFrame(renderSim);
  }

  state.simAnimId = requestAnimationFrame(renderSim);
}

function stopSimulator() {
  state.simulatorActive = false;
  if (state.simAnimId) {
    cancelAnimationFrame(state.simAnimId);
  }
}

/**
 * Draw 5-DOF Arm Joint Kinematics Representation on Simulator Viewport
 */
function drawArmOverlay(ctx) {
  const baseAngle = state.armAngles.base;
  const shoulderAngle = state.armAngles.shoulder;
  const gripperAngle = state.armAngles.gripper;

  ctx.save();
  ctx.translate(320, 480); // Bottom center origin

  ctx.strokeStyle = 'rgba(0, 240, 255, 0.6)';
  ctx.lineWidth = 6;
  ctx.lineCap = 'round';

  // Base Turret
  const baseRad = ((baseAngle - 90) * Math.PI) / 360;
  ctx.rotate(baseRad);

  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.lineTo(0, -50);
  ctx.stroke();

  // Shoulder Boom
  ctx.translate(0, -50);
  const shoulderRad = -((shoulderAngle - 90) * Math.PI) / 180;
  ctx.rotate(shoulderRad);

  ctx.strokeStyle = 'rgba(0, 255, 136, 0.7)';
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.lineTo(0, -60);
  ctx.stroke();

  // Claw / Gripper Aperture
  ctx.translate(0, -60);
  ctx.strokeStyle = '#ff3366';
  ctx.lineWidth = 3;

  const jawSpread = (gripperAngle / 140) * 16;
  ctx.beginPath();
  ctx.moveTo(-jawSpread, -12);
  ctx.lineTo(0, 0);
  ctx.lineTo(jawSpread, -12);
  ctx.stroke();

  ctx.restore();
}

/**
 * Capture Snapshot Image from Stream or Simulator
 */
function captureSnapshot() {
  sfx.playClick();
  const canvas = document.createElement('canvas');
  canvas.width = 640;
  canvas.height = 480;
  const ctx = canvas.getContext('2d');

  if (state.streamActive && dom.streamImage.naturalWidth) {
    ctx.drawImage(dom.streamImage, 0, 0, 640, 480);
  } else if (state.simulatorActive) {
    ctx.drawImage(dom.simulatorCanvas, 0, 0, 640, 480);
  } else {
    logEvent('warn', 'No active stream to capture.');
    return;
  }

  // Draw Timestamp Watermark
  ctx.fillStyle = 'rgba(0, 0, 0, 0.6)';
  ctx.fillRect(10, 445, 300, 25);
  ctx.fillStyle = '#00f0ff';
  ctx.font = '12px "JetBrains Mono"';
  ctx.fillText(`TELEOP GCS SNAPSHOT • ${new Date().toISOString()}`, 16, 462);

  const dataUrl = canvas.toDataURL('image/jpeg', 0.92);
  const a = document.createElement('a');
  a.href = dataUrl;
  a.download = `teleop_snap_${Date.now()}.jpg`;
  a.click();

  logEvent('system', 'Snapshot captured and downloaded.');
}

/**
 * Terminal Event Log
 */
function logEvent(type, message) {
  const time = new Date().toLocaleTimeString();
  const entry = document.createElement('div');
  entry.className = `log-entry ${type}`;
  entry.textContent = `[${time}] ${message}`;

  if (dom.terminalLog) {
    dom.terminalLog.prepend(entry);
    // Keep max 80 entries
    if (dom.terminalLog.children.length > 80) {
      dom.terminalLog.removeChild(dom.terminalLog.lastChild);
    }
  }
}

function bindTerminalEvents() {
  dom.btnToggleTerminal?.addEventListener('click', () => {
    dom.terminalDrawer.classList.toggle('hidden');
    const isHidden = dom.terminalDrawer.classList.contains('hidden');
    dom.btnToggleTerminal.innerHTML = isHidden ? 'Show Flight Log &blacktriangledown;' : 'Hide Flight Log &blacktriangle;';
  });

  dom.btnClearLog?.addEventListener('click', () => {
    if (dom.terminalLog) dom.terminalLog.innerHTML = '';
    logEvent('system', 'Flight log cleared.');
  });
}

/**
 * Mission Clock Uptime
 */
function updateMissionClock() {
  const elapsedSec = Math.floor((Date.now() - state.missionStartTime) / 1000);
  const hrs = String(Math.floor(elapsedSec / 3600)).padStart(2, '0');
  const mins = String(Math.floor((elapsedSec % 3600) / 60)).padStart(2, '0');
  const secs = String(elapsedSec % 60).padStart(2, '0');

  if (dom.feedbackUptime) {
    dom.feedbackUptime.textContent = `${hrs}:${mins}:${secs}`;
  }
}

// Boot application when DOM is ready
document.addEventListener('DOMContentLoaded', init);
