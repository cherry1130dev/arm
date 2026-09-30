/**
 * ==========================================================================
 * 5-DOF Robotic Arm & Rover Teleoperation Controller
 * Realistic 3D Simulation & 16:9 Screen Manager
 * ==========================================================================
 */

import { loadConfig } from './config.js';
import { sfx } from './soundFx.js';
import { ArmSimulation3D } from './armSimulation3D.js';
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
  
  // 3D Arm Simulation Instance
  armSim3D: null,
  
  // Camera Stream
  streamActive: false,
  frameCount: 0,
  lastFpsTimestamp: performance.now(),
  currentFps: 0,
  
  // Arm Joint Angles (initialized to ideal defaults from settings)
  armAngles: {
    base: config.armJoints.base.ideal,
    shoulder: config.armJoints.shoulder.ideal,
    elbow: config.armJoints.elbow.ideal,
    wrist: config.armJoints.wrist.ideal,
    gripper: config.armJoints.gripper.ideal
  },
  isAnimating: false,
  activeJoint: 'base',
  isArmMinimized: false,
  
  // Rover
  activeKeys: new Set(),
  
  // Telemetry & Latency
  lastCommandSent: null,
  lastCommandTimestamp: null,
  missionStartTime: Date.now(),
  debounceTimers: {}
};

const JOINTS = ['base', 'shoulder', 'elbow', 'wrist', 'gripper'];

// DOM Element Cache
const dom = {
  // Top Badges
  dotFirebase: document.getElementById('dotFirebase'),
  textFirebase: document.getElementById('textFirebase'),
  textLatency: document.getElementById('textLatency'),
  textNodeHeartbeat: document.getElementById('textNodeHeartbeat'),
  btnToggleAudio: document.getElementById('btnToggleAudio'),
  audioText: document.getElementById('audioText'),

  // Container 1: 3D Arm Simulation
  threeContainer: document.getElementById('threeContainer'),
  eePosText: document.getElementById('eePosText'),
  clawStateText: document.getElementById('clawStateText'),
  btnResetView: document.getElementById('btnResetView'),

  // Container 2: Camera Stream
  camViewport: document.getElementById('camViewport'),
  streamImage: document.getElementById('streamImage'),
  camPlaceholder: document.getElementById('camPlaceholder'),
  camFpsBadge: document.getElementById('camFpsBadge'),
  inputCamIp: document.getElementById('inputCamIp'),
  inputCamPort: document.getElementById('inputCamPort'),
  inputCamPath: document.getElementById('inputCamPath'),
  btnConnectStream: document.getElementById('btnConnectStream'),
  btnSnapshot: document.getElementById('btnSnapshot'),
  btnFullscreenCam: document.getElementById('btnFullscreenCam'),

  // Container 3: Arm Controls & Minimize Toggle
  btnToggleArmMinimize: document.getElementById('btnToggleArmMinimize'),
  minimizeBtnIcon: document.getElementById('minimizeBtnIcon'),
  minimizeBtnText: document.getElementById('minimizeBtnText'),
  armSlidersBody: document.getElementById('armSlidersBody'),
  armMinimizedSummary: document.getElementById('armMinimizedSummary'),

  // Small Container 1: Presets
  presetButtons: document.querySelectorAll('.preset-pill-btn'),

  // Small Container 2: Car Navigation
  carButtons: document.querySelectorAll('.car-btn'),
  btnOpenKeyModal: document.getElementById('btnOpenKeyModal'),
  btnCloseKeyModal: document.getElementById('btnCloseKeyModal'),
  btnOkKeyModal: document.getElementById('btnOkKeyModal'),
  keyboardModal: document.getElementById('keyboardModal'),

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
  logEvent('system', '5-DOF Teleoperation controller initializing...');

  // 1. Setup Joint Sliders from Configuration
  setupJointSliders();

  // 2. Setup Camera Defaults from Configuration
  setupCameraDefaults();

  // 3. Connect to Firebase if credentials configured
  initFirebase();

  // 4. Initialize Realistic 3D Simulation (Three.js)
  init3DSimulation();

  // 5. Bind All Interactive UI Events
  bindArmEvents();
  bindMinimizeToggle();
  bindCameraEvents();
  bindCarEvents();
  bindKeyboardEvents();
  bindModalEvents();
  bindTerminalEvents();

  // 6. Start Mission Clock
  setInterval(updateMissionClock, 1000);

  logEvent('system', 'Ready. Realistic 3D model with 4-direction support loaded.');
}

/**
 * Initialize Three.js Realistic 3D Arm Simulation
 */
function init3DSimulation() {
  if (dom.threeContainer && window.THREE) {
    try {
      state.armSim3D = new ArmSimulation3D(dom.threeContainer);
      state.armSim3D.setAngles(state.armAngles);
      updateEndEffectorTelemetry();
    } catch (err) {
      console.error('[3D SIM ERROR]', err);
      logEvent('warn', 'Failed to initialize 3D canvas: ' + err.message);
    }
  }

  // Reset Camera View button
  dom.btnResetView?.addEventListener('click', () => {
    sfx.playClick();
    if (state.armSim3D) state.armSim3D.resetView();
  });
}

/**
 * Configure Joint Sliders with Min, Max, and Default Ideal Values
 */
function setupJointSliders() {
  JOINTS.forEach(joint => {
    const jConfig = config.armJoints[joint];
    if (!jConfig) return;

    const slider = document.getElementById(`slider_${joint}`);
    const badge = document.getElementById(`badge_${joint}`);
    const hint = document.getElementById(`hint_${joint}`);
    const idealMarker = document.getElementById(`ideal_marker_${joint}`);
    const miniBadge = document.getElementById(`miniBadge_${joint}`);

    if (slider) {
      slider.min = jConfig.min;
      slider.max = jConfig.max;
      slider.value = jConfig.ideal;
      state.armAngles[joint] = jConfig.ideal;
    }

    if (badge) badge.textContent = `${jConfig.ideal}°`;
    if (miniBadge) miniBadge.textContent = `${jConfig.ideal}°`;
    if (hint) hint.textContent = `${jConfig.min}° – ${jConfig.max}°`;

    if (idealMarker && jConfig.max > jConfig.min) {
      const pct = ((jConfig.ideal - jConfig.min) / (jConfig.max - jConfig.min)) * 100;
      idealMarker.style.left = `${pct}%`;
    }
  });
}

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
    updateFirebaseStatus(false, 'NO CONFIG');
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

    onValue(state.dbRef, (snapshot) => {
      if (snapshot.exists()) {
        handleIncomingData(snapshot.val());
      }
    }, (error) => {
      console.error('[FIREBASE] Sync error:', error);
      updateFirebaseStatus(false, 'SYNC ERROR');
    });

    const connectedRef = ref(state.firebaseDb, '.info/connected');
    onValue(connectedRef, (snap) => {
      const isOnline = snap.val() === true;
      state.isFirebaseConnected = isOnline;
      updateFirebaseStatus(isOnline, isOnline ? 'ONLINE' : 'OFFLINE');
    });

  } catch (err) {
    console.error('[FIREBASE INIT FAILED]', err);
    updateFirebaseStatus(false, 'INIT FAILED');
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

function handleIncomingData(data) {
  if (!data) return;

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

    if (state.lastCommandTimestamp) {
      const rtt = Math.round(performance.now() - state.lastCommandTimestamp);
      if (dom.feedbackLatency) dom.feedbackLatency.textContent = `${rtt} ms`;
      if (dom.textLatency) dom.textLatency.textContent = `${rtt} ms`;
      state.lastCommandTimestamp = null;
    }

    logEvent('ack', `[ESP ACK] ${ackText}`);
  }

  if (data.heartbeat) {
    if (dom.textNodeHeartbeat) dom.textNodeHeartbeat.textContent = 'ONLINE';
  }
}

/**
 * Dispatch Unique Command to Firebase RTDB
 */
async function sendCommand(cmdString, extraPayload = null) {
  sfx.playClick();
  state.lastCommandSent = cmdString;
  state.lastCommandTimestamp = performance.now();

  if (dom.feedbackCmd) dom.feedbackCmd.textContent = cmdString;
  logEvent('cmd', `[TX COMMAND] ${cmdString}`);

  if (!state.firebaseDb || !state.isFirebaseConnected) return;

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
  }
}

/**
 * Sync Arm Joint Angles to Firebase
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
        servo_angle: currentAngles[targetJoint || 'base'],
        last_joint: targetJoint || 'base'
      };

      await update(ref(state.firebaseDb, rootPath), payload);
    } catch (err) {
      console.error('[SYNC ARM ERROR]', err);
    }
  }, 40);
}

/**
 * Update 3D Arm Model and Telemetry Overlay
 */
function update3DModel() {
  if (state.armSim3D) {
    state.armSim3D.setAngles(state.armAngles);
    updateEndEffectorTelemetry();
  }
}

function updateEndEffectorTelemetry() {
  if (!state.armSim3D) return;
  const pos = state.armSim3D.getEndEffectorWorldPos();
  if (dom.eePosText) {
    dom.eePosText.textContent = `X: ${pos.x > 0 ? '+' : ''}${pos.x} | Y: +${pos.y} | Z: ${pos.z > 0 ? '+' : ''}${pos.z} mm`;
  }
  if (dom.clawStateText) {
    const clawAngle = state.armAngles.gripper;
    dom.clawStateText.textContent = `${clawAngle}° APERTURE`;
  }
}

/**
 * Smoothly Animate 3D Arm to Preset Angles
 */
function animateToAngles(targetAngles, durationMs = 380) {
  const startAngles = { ...state.armAngles };
  const startTime = performance.now();
  state.isAnimating = true;

  function step(currentTime) {
    const elapsed = currentTime - startTime;
    const progress = Math.min(1, elapsed / durationMs);
    const ease = progress < 0.5 
      ? 2 * progress * progress 
      : 1 - Math.pow(-2 * progress + 2, 2) / 2;

    JOINTS.forEach(j => {
      if (targetAngles[j] !== undefined) {
        state.armAngles[j] = Math.round(startAngles[j] + (targetAngles[j] - startAngles[j]) * ease);
        
        const slider = document.getElementById(`slider_${j}`);
        const badge = document.getElementById(`badge_${j}`);
        const miniBadge = document.getElementById(`miniBadge_${j}`);
        if (slider) slider.value = state.armAngles[j];
        if (badge) badge.textContent = `${state.armAngles[j]}°`;
        if (miniBadge) miniBadge.textContent = `${state.armAngles[j]}°`;
      }
    });

    update3DModel();

    if (progress < 1) {
      requestAnimationFrame(step);
    } else {
      state.isAnimating = false;
      syncArmAngles();
    }
  }

  requestAnimationFrame(step);
}

/**
 * Apply Pose Preset with Smooth 3D Animation & Unique Command Dispatch
 */
function applyPosePreset(presetId) {
  const preset = config.presets[presetId];
  if (!preset) return;

  sfx.playPreset();
  const uniqueCmd = preset.cmd || presetId;

  animateToAngles(preset.angles, 400);

  sendCommand(uniqueCmd, {
    arm_angles: preset.angles,
    preset_name: preset.name
  });
}

/**
 * Bind Arm Sliders & Nudge Buttons
 */
function bindArmEvents() {
  JOINTS.forEach(joint => {
    const slider = document.getElementById(`slider_${joint}`);
    const badge = document.getElementById(`badge_${joint}`);
    const miniBadge = document.getElementById(`miniBadge_${joint}`);

    if (slider) {
      slider.addEventListener('input', (e) => {
        const val = parseInt(e.target.value, 10);
        state.armAngles[joint] = val;
        state.activeJoint = joint;
        if (badge) badge.textContent = `${val}°`;
        if (miniBadge) miniBadge.textContent = `${val}°`;
        update3DModel();
        syncArmAngles(joint);
      });
    }
  });

  // Nudge Buttons ([-5°], [Ideal], [+5°])
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
      const miniBadge = document.getElementById(`miniBadge_${joint}`);

      if (slider) slider.value = newAngle;
      if (badge) badge.textContent = `${newAngle}°`;
      if (miniBadge) miniBadge.textContent = `${newAngle}°`;

      sfx.playClick();
      update3DModel();
      syncArmAngles(joint);
    });
  });

  // Presets (Pick, Drop, Pos 1-3, Idle)
  dom.presetButtons.forEach(btn => {
    btn.addEventListener('click', () => {
      const presetId = btn.getAttribute('data-preset');
      btn.classList.add('active');
      setTimeout(() => btn.classList.remove('active'), 350);
      applyPosePreset(presetId);
    });
  });
}

/**
 * Arm Controls Minimize / Show Less / Show More Toggle
 */
function bindMinimizeToggle() {
  dom.btnToggleArmMinimize?.addEventListener('click', () => {
    state.isArmMinimized = !state.isArmMinimized;
    sfx.playClick();

    if (state.isArmMinimized) {
      dom.armSlidersBody.classList.add('hidden');
      dom.armMinimizedSummary.classList.remove('hidden');
      dom.minimizeBtnIcon.innerHTML = '&plus;';
      dom.minimizeBtnText.textContent = 'Show More';
    } else {
      dom.armSlidersBody.classList.remove('hidden');
      dom.armMinimizedSummary.classList.add('hidden');
      dom.minimizeBtnIcon.innerHTML = '&minus;';
      dom.minimizeBtnText.textContent = 'Show Less';
    }
  });
}

/**
 * Camera Stream Handlers (Separate Container)
 */
function bindCameraEvents() {
  dom.btnConnectStream?.addEventListener('click', () => {
    if (state.streamActive) {
      disconnectStream();
    } else {
      connectStream();
    }
  });

  dom.btnSnapshot?.addEventListener('click', captureSnapshot);

  dom.btnFullscreenCam?.addEventListener('click', () => {
    if (!document.fullscreenElement) {
      dom.camViewport.requestFullscreen?.();
    } else {
      document.exitFullscreen?.();
    }
  });

  // Audio Toggle
  dom.btnToggleAudio?.addEventListener('click', () => {
    const isEnabled = sfx.toggleSound();
    dom.audioText.textContent = `SFX: ${isEnabled ? 'ON' : 'MUTE'}`;
  });
}

function connectStream() {
  const ip = dom.inputCamIp.value.trim();
  const port = dom.inputCamPort.value.trim();
  const path = dom.inputCamPath.value.trim();

  if (!ip) {
    alert('Please enter a valid ESP32-CAM IP address');
    return;
  }

  const streamUrl = `http://${ip}:${port}${path}`;
  logEvent('system', `Connecting to camera stream: ${streamUrl}`);

  dom.streamImage.src = streamUrl;
  dom.streamImage.style.display = 'block';
  dom.camPlaceholder.style.display = 'none';

  state.streamActive = true;
  state.frameCount = 0;
  state.lastFpsTimestamp = performance.now();

  dom.btnConnectStream.textContent = 'Disconnect';
  dom.btnConnectStream.classList.add('btn-danger');

  dom.streamImage.onload = () => {
    onStreamFrame();
  };
  dom.streamImage.onerror = () => {
    logEvent('warn', 'Camera feed offline. Recheck IP and power.');
  };
}

function disconnectStream() {
  state.streamActive = false;
  dom.streamImage.src = '';
  dom.streamImage.style.display = 'none';
  dom.camPlaceholder.style.display = 'flex';

  dom.btnConnectStream.textContent = 'Connect Stream';
  dom.btnConnectStream.classList.remove('btn-danger');
  if (dom.camFpsBadge) dom.camFpsBadge.textContent = '0.0 FPS';
  logEvent('system', 'Camera stream disconnected.');
}

function onStreamFrame() {
  state.frameCount++;
  const now = performance.now();
  const elapsed = now - state.lastFpsTimestamp;

  if (elapsed >= 1000) {
    state.currentFps = ((state.frameCount * 1000) / elapsed).toFixed(1);
    if (dom.camFpsBadge) dom.camFpsBadge.textContent = `${state.currentFps} FPS`;
    state.frameCount = 0;
    state.lastFpsTimestamp = now;
  }
}

function captureSnapshot() {
  sfx.playClick();
  const canvas = document.createElement('canvas');
  canvas.width = 640;
  canvas.height = 480;
  const ctx = canvas.getContext('2d');

  if (state.streamActive && dom.streamImage.naturalWidth) {
    ctx.drawImage(dom.streamImage, 0, 0, 640, 480);
  } else if (state.armSim3D && state.armSim3D.renderer) {
    // Capture from 3D canvas
    ctx.drawImage(state.armSim3D.renderer.domElement, 0, 0, 640, 480);
  }

  // Draw Timestamp Watermark
  ctx.fillStyle = 'rgba(0, 0, 0, 0.6)';
  ctx.fillRect(10, 445, 310, 25);
  ctx.fillStyle = '#00d2ff';
  ctx.font = '11px "JetBrains Mono"';
  ctx.fillText(`TELEOP CAPTURE • ${new Date().toISOString()}`, 16, 462);

  const a = document.createElement('a');
  a.href = canvas.toDataURL('image/jpeg', 0.92);
  a.download = `teleop_snap_${Date.now()}.jpg`;
  a.click();

  logEvent('system', 'Snapshot saved.');
}

/**
 * Bind Rover / Car Navigation Controls (Forward, Backward, Left, Right, Stop)
 */
function bindCarEvents() {
  dom.carButtons.forEach(btn => {
    const cmd = btn.getAttribute('data-cmd');

    btn.addEventListener('mousedown', () => {
      btn.classList.add('pressed');
      executeCarCommand(cmd);
    });

    btn.addEventListener('mouseup', () => {
      btn.classList.remove('pressed');
      if (cmd !== 'ROVER_STOP') {
        executeCarCommand('ROVER_STOP');
      }
    });

    btn.addEventListener('mouseleave', () => {
      if (btn.classList.contains('pressed')) {
        btn.classList.remove('pressed');
        if (cmd !== 'ROVER_STOP') {
          executeCarCommand('ROVER_STOP');
        }
      }
    });

    btn.addEventListener('touchstart', (e) => {
      e.preventDefault();
      btn.classList.add('pressed');
      executeCarCommand(cmd);
    });

    btn.addEventListener('touchend', (e) => {
      e.preventDefault();
      btn.classList.remove('pressed');
      if (cmd !== 'ROVER_STOP') {
        executeCarCommand('ROVER_STOP');
      }
    });
  });
}

function executeCarCommand(cmd) {
  if (cmd === 'ROVER_STOP') {
    sfx.playStop();
  } else {
    sfx.playDrive();
  }
  sendCommand(cmd);
}

/**
 * Keyboard Navigation Controls
 */
function bindKeyboardEvents() {
  const keyMap = {
    'KeyW': 'ROVER_FWD',
    'ArrowUp': 'ROVER_FWD',
    'KeyS': 'ROVER_REV',
    'ArrowDown': 'ROVER_REV',
    'KeyA': 'ROVER_LEFT',
    'ArrowLeft': 'ROVER_LEFT',
    'KeyD': 'ROVER_RIGHT',
    'ArrowRight': 'ROVER_RIGHT',
    'Space': 'ROVER_STOP'
  };

  window.addEventListener('keydown', (e) => {
    if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) {
      if (document.activeElement.tagName !== 'INPUT') {
        e.preventDefault();
      }
    }

    if (document.activeElement.tagName === 'INPUT') return;

    const cmd = keyMap[e.code];
    if (cmd && !state.activeKeys.has(e.code)) {
      state.activeKeys.add(e.code);
      executeCarCommand(cmd);
    }
  });

  window.addEventListener('keyup', (e) => {
    if (document.activeElement.tagName === 'INPUT') return;

    const cmd = keyMap[e.code];
    if (cmd) {
      state.activeKeys.delete(e.code);
      if (state.activeKeys.size === 0) {
        executeCarCommand('ROVER_STOP');
      }
    }
  });
}

/**
 * Keyboard Shortcuts Modal Dialog Handler (Popup)
 */
function bindModalEvents() {
  const modal = dom.keyboardModal;
  if (!modal) return;

  dom.btnOpenKeyModal?.addEventListener('click', () => {
    modal.classList.remove('hidden');
    sfx.playClick();
  });

  dom.btnCloseKeyModal?.addEventListener('click', () => {
    modal.classList.add('hidden');
  });

  dom.btnOkKeyModal?.addEventListener('click', () => {
    modal.classList.add('hidden');
  });

  modal.addEventListener('click', (e) => {
    if (e.target === modal) modal.classList.add('hidden');
  });

  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !modal.classList.contains('hidden')) {
      modal.classList.add('hidden');
    }
  });
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
    if (dom.terminalLog.children.length > 80) {
      dom.terminalLog.removeChild(dom.terminalLog.lastChild);
    }
  }
}

function bindTerminalEvents() {
  dom.btnToggleTerminal?.addEventListener('click', () => {
    dom.terminalDrawer.classList.toggle('hidden');
    const isHidden = dom.terminalDrawer.classList.contains('hidden');
    dom.btnToggleTerminal.innerHTML = isHidden ? 'Show Terminal &blacktriangledown;' : 'Hide Terminal &blacktriangle;';
  });

  dom.btnClearLog?.addEventListener('click', () => {
    if (dom.terminalLog) dom.terminalLog.innerHTML = '';
  });
}

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
